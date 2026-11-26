# Runbook: Database outage and connection pool starvation

Use this runbook when `/api/ready` returns `503 Database unavailable`, logs emit `postgres pool error`, requests stall for 5 s before failing, or deploys fail during `node .output/migrate.mjs`.

## Symptoms

- `GET /api/ready` responds `503` with `{"_tag":"ServiceUnavailable","message":"Database unavailable"}` (after up to 5 s, matching `connectionTimeoutMillis: 5000` in `src/server/db/client.ts`).
- `GET /api/health` still responds `200 {"status":"ok"}` (liveness intentionally never checks Postgres so an outage does not trigger a restart loop).
- JSON stderr logs show:
  - `postgres pool error` (idle connection dropped by Postgres, pooler, or network)
  - `api defect` / `auth request failed` / `server function failed` with pg error codes (`53300` too_many_connections, `57014` query_canceled / statement_timeout, `55P03` lock_not_available, `08P01` / `unsupported startup parameter: statement_timeout`, `ECONNREFUSED`, `ETIMEDOUT`).
- Migrator logs `migration failed` or repeated `migration waited too long for a table lock, retrying` (`scripts/migrate.ts`).

## 1. Verify connection math

Each app process creates one `pg.Pool` (`src/server/db/client.ts`) with:

- `max`: `DATABASE_POOL_MAX` (default `10`, valid `1..100`)
- `connectionTimeoutMillis`: `5000` (5 s)
- `idleTimeoutMillis`: `10_000` (10 s)
- `application_name`: `'app'` (migrator uses `'app-migrate'`)

At peak load during a rolling deploy, total required connections must satisfy:

```text
  replicas × DATABASE_POOL_MAX
+ maxSurge × DATABASE_POOL_MAX          (rolling deploy overlap; 1 in deploy/kubernetes.yaml)
+ concurrent migrator init containers   (1 connection each, queued on advisory lock)
+ admin / psql / pg_dump / monitoring
≤ max_connections − superuser_reserved_connections
```

Check current limits and usage in PostgreSQL:

```sql
SHOW max_connections;
SHOW superuser_reserved_connections;

SELECT
  coalesce(application_name, '<none>') AS app,
  usename,
  state,
  count(*) AS connections
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY 1, 2, 3
ORDER BY connections DESC;
```

**Immediate mitigations for `53300: sorry, too many clients already`:**

1. Lower `DATABASE_POOL_MAX` (for example from `10` to `5`) across replicas if you do not yet have a pooler—each request holds a connection only for its individual queries.
2. Put PgBouncer (or the managed provider's transaction-mode pooler) in front of Postgres so Postgres sees only the pooler's `default_pool_size` while app pools bound client concurrency.
3. Terminate leaked ad-hoc `psql` or stale `idle in transaction` admin sessions (Section 4).

## 2. PgBouncer transaction mode vs direct URL

### Startup parameter mismatch (`DATABASE_URL_POOLED`)

When `DATABASE_URL_POOLED` is `false` (the default), `src/server/db/client.ts` passes `statement_timeout: 15_000` and `idle_in_transaction_session_timeout: 30_000` as startup parameters. PgBouncer in transaction mode rejects untracked startup parameters with:

```text
unsupported startup parameter: statement_timeout
```

Every connection then fails and `/api/ready` returns `503`.

**Fix:**

1. Set `DATABASE_URL_POOLED=true` on the app (check the `starting` log line to confirm `"databaseUrlPooled": true`).
2. Enforce both timeouts on the database role so every backend connection opened by the pooler inherits them:

   ```sql
   ALTER ROLE app SET statement_timeout = '15s';
   ALTER ROLE app SET idle_in_transaction_session_timeout = '30s';
   ```

3. Verify the role settings:

   ```sql
   SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'app';
   ```

### `MIGRATION_DATABASE_URL` for migrations

`node .output/migrate.mjs` (`scripts/migrate.ts`) reads `MIGRATION_DATABASE_URL` first and falls back to `DATABASE_URL`. While its transaction-scoped `SET LOCAL` and `pg_advisory_xact_lock('8098991147069224299')` work through PgBouncer in transaction mode (verified by `pnpm ci:docker`), managed poolers can have shorter idle/query limits or lower concurrency caps.

- Point `MIGRATION_DATABASE_URL` at the **direct** Postgres URL whenever `DATABASE_URL` uses a pooler (Neon, Supabase, RDS Proxy, PgBouncer).
- Manual out-of-transaction DDL such as `CREATE INDEX CONCURRENTLY` ([operations.md](../operations.md#migration-safety)) **must** run over a direct connection.

## 3. Diagnose pool starvation and lock contention

Pool starvation occurs when all `DATABASE_POOL_MAX` connections are occupied by slow queries, blocked locks, or `idle in transaction` sessions, causing new requests to queue until `connectionTimeoutMillis` (5 s) expires.

### Inspect active sessions and wait events

```sql
SELECT
  pid,
  application_name,
  state,
  wait_event_type,
  wait_event,
  round(extract(epoch FROM now() - xact_start)::numeric, 1) AS xact_s,
  round(extract(epoch FROM now() - query_start)::numeric, 1) AS query_s,
  left(query, 140) AS query_sample
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND state IS DISTINCT FROM 'idle'
ORDER BY xact_s DESC NULLS LAST;
```

### Find lock chains (blocking vs blocked queries)

```sql
SELECT
  blocked.pid AS blocked_pid,
  blocked.application_name AS blocked_app,
  round(extract(epoch FROM now() - blocked.query_start)::numeric, 1) AS wait_s,
  pg_blocking_pids(blocked.pid) AS blocking_pids,
  left(blocked.query, 100) AS blocked_query,
  left(blocker.query, 100) AS blocking_query,
  blocker.state AS blocker_state
FROM pg_stat_activity AS blocked
JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS blocker_pid ON true
JOIN pg_stat_activity AS blocker ON blocker.pid = blocker_pid
WHERE blocked.datname = current_database()
ORDER BY wait_s DESC;
```

### Check `pg_stat_statements` for query regressions

```sql
SELECT
  calls,
  round(mean_exec_time::numeric, 1) AS mean_ms,
  round(max_exec_time::numeric, 1) AS max_ms,
  round(total_exec_time::numeric, 1) AS total_ms,
  left(query, 140) AS query_sample
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 15;
```

Look for sequential scans on `post` or `session` (check `EXPLAIN (ANALYZE, BUFFERS)` for missing `post_keyset_idx`, `post_author_keyset_idx`, or `session_expires_at_idx`) or an invalid concurrent index:

```sql
SELECT indexrelid::regclass AS index_name, indisvalid, indisready
FROM pg_index
WHERE NOT indisvalid;
```

## 4. Cancel or terminate runaway backends (`pg_terminate_backend`)

Always try graceful query cancellation first, then terminate the backend only if cancellation does not clear the blocker (for example, a stuck `idle in transaction` session holding locks):

```sql
-- Step 1: Gentle cancel (sends SIGINT to the running statement, keeps session)
SELECT pg_cancel_backend(<pid>);

-- Step 2: Re-check pg_stat_activity; if still blocking or idle-in-transaction, terminate backend
SELECT pg_terminate_backend(<pid>);
```

To clear all stuck `idle in transaction` connections older than 60 seconds (excluding your own session):

```sql
SELECT pid, pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND state = 'idle in transaction'
  AND now() - xact_start > interval '60 seconds';
```

**Expected app behavior after `pg_terminate_backend`:**

- Terminated idle connections trigger `postgres pool error` in app logs; `pg.Pool` automatically discards the dead socket and opens a new connection on the next query.
- Terminated in-flight requests return a safe `500` (API/auth) or `Error('Internal error')` (server functions) without leaking SQL parameters.
- Verify recovery immediately with `curl -fsS "$APP_URL/api/ready"`.

## 5. Migration lock timeouts

`scripts/migrate.ts` takes `pg_advisory_xact_lock('8098991147069224299')` (bounded by `MIGRATE_LOCK_TIMEOUT`, default `5min`), then sets `MIGRATE_DDL_LOCK_TIMEOUT` (default `5s`) for DDL and retries up to 5 times (backoffs 1, 2, 3, 4 s).

If a migration fails with code `55P03` (`lock_not_available`):

1. Check `pg_stat_activity` for another `app-migrate` session holding the advisory lock, or a long-running query/backup (`pg_dump`) holding `ACCESS SHARE` on the target table.
2. Wait for the backup or long query to finish (or cancel it if safe), then re-run the migration job.
3. Never bypass `MIGRATE_DDL_LOCK_TIMEOUT` blindly on a busy table—a blocked `ALTER TABLE` queues every subsequent `SELECT`/`INSERT` behind it. If adding an index on a large table, build it manually with `CREATE INDEX CONCURRENTLY` first ([operations.md](../operations.md#migration-safety)).

## 6. Full database outage and recovery verification

1. **Do not restart healthy app pods** while Postgres is down—`/api/health` keeps pods alive and `/api/ready` removes them from load-balancer rotation automatically.
2. Check Postgres host health, disk space (`df -h` / provider storage quota—full disk causes WAL write failures), TLS certificate expiry (`sslrootcert`), and network/firewall rules.
3. If data corruption or accidental destructive DDL occurred, stop the app and restore from PITR or the latest custom dump following [operations.md](../operations.md#backups-and-restore).
4. Once Postgres is back:
   - Confirm `GET /api/ready` returns `200 {"status":"ok"}` across all replicas.
   - Confirm `rate_limit` table works (remember `rate_limit` is `UNLOGGED`: after a crash or failover Postgres truncates it automatically, resetting windows cleanly with no manual repair needed).
   - Confirm no lingering `postgres pool error` lines appear over the next 5 minutes.
