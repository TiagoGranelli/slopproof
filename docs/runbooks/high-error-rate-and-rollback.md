# Runbook: High error rate and rollback

Use this runbook when 5xx error rates breach the SLO burn-rate threshold ([slos.md](../slos.md)), alerts fire on `api defect` or `server function failed`, or a deployment causes regressions.

## 1. Classify the error spike first

Filter recent JSON error logs before rolling back so you distinguish a genuine regression from expected post-deploy stale-tab noise or a downstream DB outage:

```sh
# Breakdown of error log messages over the last 10 minutes
kubectl logs -l app.kubernetes.io/name=app --since=10m \
  | jq -R 'fromjson? | select(type == "object" and .level == "error") | {msg, path, fn, status, errorName: .error.name}' \
  | sort | uniq -c | sort -rn
```

| Log signature | Likely cause | Immediate action |
| --- | --- | --- |
| `/api/ready` returns `503` + `postgres pool error` | Database outage or pool exhaustion (not an app bug) | Switch to [database-outage-and-pool.md](database-outage-and-pool.md). Do **not** blindly roll back. |
| `api defect` with `error.name: "ResponseSchemaError"` | Contract vs handler/DB response mismatch | Inspect `error.message` field paths; roll back if introduced by the latest deploy. |
| `server function request failed` on `/_serverFn/<id>` | Stale browser tabs calling previous build's server function IDs ([ADR 0009](../decisions/0009-unknown-server-function-id.md)) | Verify timing against deploy timestamp; expected short spike after rollout. Do **not** roll back for stale-tab noise alone. |
| `server function failed` with `fn` name | Runtime bug or DB failure inside a server function | Check `error.message` and `error.stack`; roll back if tied to new build. |
| `request error` (`tags`) or `uncaught exception, exiting` | Unhandled framework/runtime crash | Roll back immediately; capture stderr stack trace before pods recycle. |
| `request` with `status: 499, aborted: true` | Client disconnected before response settled (logged at `info`) | Not a server 5xx; check edge/client timeouts or slow queries if rate spikes. |
| Edge `502` / `503` during deploys only | Premature pod termination or missing SIGTERM drain | Jump to [Section 4: Graceful SIGTERM drain verification](#4-graceful-sigterm-drain-verification). |

## 2. Deep-dive on key error signatures

### `ResponseSchemaError` (`api defect`)

`src/server/api/web-handler.ts` catches every Effect API die, logs `api defect`, and answers with an empty `500`. When a handler produces a payload that violates its Effect `HttpApi` response schema, `describeSchemaDefect` logs:

```json
{
  "level": "error",
  "msg": "api defect",
  "method": "GET",
  "path": "/api/posts",
  "error": {
    "name": "ResponseSchemaError",
    "message": "Response body does not match its schema at: items.0.createdAt"
  }
}
```

- Only schema **paths** are logged—never user values—so the log is safe to share in an incident ticket.
- Common causes: a column nullability/format change in Postgres that drifted from `src/contract/`, or a code deploy running against a schema that did not finish migrating.
- **Mitigation:** If the spike began with a deploy, roll back the app image (Section 3). If caused by bad data in Postgres, fix the data or deploy a forward schema/handler fix after reproducing in `tests/api/`.

### `server function request failed` (`/_serverFn/<id>`, ADR 0009)

Server function IDs are hashed per build. After a deploy, open tabs and crawlers may still call `/_serverFn/<old-id>` until they reload. Per [ADR 0009](../decisions/0009-unknown-server-function-id.md), `serverFunctionRequestErrors` (`src/lib/server-function-errors.ts`) catches the resolver error, logs `server function request failed` with `path: "/_serverFn/<id>"`, and returns `500` with generic `Error('Internal error')` (without leaking the ID or stack; Start also prints that generic error to stderr).

How to separate normal ADR 0009 deploy noise from a real outage:

1. Check whether errors are exclusively `msg == "server function request failed"` with `error.message` matching `"Server function info not found for ..."` and decay within 15–30 minutes after rollout.
2. Verify a fresh page load (new browser tab) succeeds against the current build's `/_serverFn/<new-id>`.
3. If **new** sessions also fail on `/_serverFn/<id>`, you likely have mixed builds behind the load balancer (sticky/partial rollout) or a stale cached HTML document pointing at old asset hashes—check that SSR pages send `Cache-Control: private, no-store` and all replicas run the same image digest.

## 3. Forward-only expand/contract rollback strategy

Database migrations in this repo are **forward-only** (`drizzle/__drizzle_migrations`; no down migrations). Every schema change follows expand-then-contract ([operations.md](../operations.md#build-and-deploy)):

- **Expand release:** add nullable columns, new tables, or additive indexes while keeping old columns intact.
- **Contract release (later deploy):** drop unused columns or tables only after the old code is completely retired.

Because expand migrations stay backward compatible with the previous application version, **rolling back the app container image alone is safe**—leave already-applied migrations in place.

### Roll back on Kubernetes (`deploy/kubernetes.yaml`)

```sh
# Inspect revision history
kubectl rollout history deployment/app

# Roll back to the previous ReplicaSet (migrations initContainer will see 0 pending migrations and exit 0)
kubectl rollout undo deployment/app

# Watch rollout until all replicas pass /api/ready
kubectl rollout status deployment/app --timeout=180s
```

### Roll back on Fly.io (`deploy/fly.toml`)

```sh
# List recent releases and image references
fly releases --image

# Deploy the previous known-good image (release_command runs migrate.mjs, applying 0 pending migrations)
fly deploy --image <previous-image-ref>
```

### Roll back on Docker Compose (`deploy/compose.production.yaml`)

1. Edit `deploy.env` on the server to set `APP_IMAGE` back to the previous immutable tag/digest.
2. Pull and recreate (`migrate` runs first, sees 0 pending migrations, then `app` starts):

   ```sh
   docker compose -f compose.production.yaml --env-file deploy.env pull \
     && docker compose -f compose.production.yaml --env-file deploy.env up -d
   ```

### When a migration itself caused the outage

- **Never edit or delete an already-applied migration file** (`tests/unit/repo-policy.test.ts` blocks it and `drizzle.__drizzle_migrations` already recorded it).
- If a non-destructive schema change broke the previous app version (breaking the expand/contract rule), write a **new forward migration** restoring compatibility and deploy it.
- If a migration destroyed or corrupted data, stop the app and restore from a backup or PITR ([operations.md](../operations.md#backups-and-restore)).

## 4. Graceful SIGTERM drain verification

If 502/503 spikes or `Failed query` errors occur only during deployments or scaling events, verify the full shutdown sequence (`src/server/nitro/startup.ts`, `src/server/lifecycle.ts`):

1. **Orchestrator removes endpoints first:** in Kubernetes (`deploy/kubernetes.yaml`), `lifecycle.preStop.sleep.seconds: 5` keeps the pod serving while kube-proxy and ingress controllers drop it from Endpoints.
2. **SIGTERM arrives:** process logs `{"level":"info","msg":"draining","signal":"SIGTERM"}`.
3. **Readiness flips immediately:** `GET /api/ready` returns `503 {"_tag":"ServiceUnavailable","message":"Shutting down"}` and `src/server/nitro/http.ts` adds `Connection: close` to every response so keep-alive pools close cleanly.
4. **In-flight HTTP drain:** srvx stops accepting new connections, closes idle ones, and waits up to `SERVER_SHUTDOWN_TIMEOUT` seconds (default `5`).
5. **Ordered resource cleanup (`runShutdown`):**
   1. `auth-cleanup` (stops 10-minute expired-row timer)
   2. `background-tasks` (awaits pending SMTP mail sends up to 5 s connect / 15 s socket, `rate_limit` prunes, and Better Auth calls whose client disconnected early)
   3. `mailer` (closes SMTP transport)
   4. `effect-api` (disposes Effect `HttpRouter` runtime)
   5. `postgres-pool` (calls `pool.end()` last)
6. **Completion:** process logs `shutdown complete` with `cleanups`, per-step `steps` durations, and total `ms`, then exits with code `0`.

### Drain verification checklist

```sh
# Inspect the last terminating pod's shutdown logs (Kubernetes)
kubectl logs <terminating-or-previous-pod> --previous \
  | jq -R 'fromjson? | select(type == "object" and (.msg == "draining" or .msg == "shutdown complete" or .msg == "shutdown cleanup failed"))'
```

Confirm all five invariants:

- [ ] **Neither `CI` nor `TEST` is set in production:** srvx skips SIGTERM signal handling when either env var is present (`src/server/nitro/startup.ts` also skips registering `draining`), causing abrupt exits without draining.
- [ ] `draining` appears before `shutdown complete`.
- [ ] `shutdown complete` includes `"postgres-pool"` as the final entry in `cleanups` and zero `shutdown cleanup failed` lines appear.
- [ ] Orchestrator grace period exceeds `preStop + SERVER_SHUTDOWN_TIMEOUT + background-tasks` (`terminationGracePeriodSeconds: 35` in Kubernetes, `kill_timeout = 30` in Fly.io, `stop_grace_period: 30s` in Docker Compose).
- [ ] No `Failed query` or `postgres pool error` appears after `shutdown complete`, and no orphaned `application_name = 'app'` connections remain in `pg_stat_activity`.
