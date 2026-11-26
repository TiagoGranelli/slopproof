# Runbook: Auth abuse and secret rotation

Use this runbook for credential stuffing, sign-up spam, widespread user lockouts (`429`), suspected `X-Forwarded-For` IP spoofing, or rotating `BETTER_AUTH_SECRET` and backing-service credentials.

## 1. Check `TRUSTED_PROXIES` and Caddy `trusted_proxies_strict`

Client IP resolution determines both per-IP auth rate-limit buckets and the `session.ip_address` recorded on every sign-in (IPv6 clients are bucketed and recorded by `/64` via `IPV6_SUBNET = 64` in `src/server/http/client-address.ts`).

How the chain works:

1. **Caddy (`deploy/Caddyfile`):** uses `trusted_proxies static {$EDGE_TRUSTED_PROXIES}` with `trusted_proxies_strict` (walks `X-Forwarded-For` right-to-left, stopping at the first untrusted address) and rewrites the header to a single IP: `header_up X-Forwarded-For {client_ip}`.
2. **App (`src/server/http/forwarded-for.ts`):** appends the TCP peer (`getRequestIP()`) as the rightmost hop. If `TRUSTED_PROXIES` is empty, it **drops** any incoming `X-Forwarded-For` and uses only the TCP peer.
3. **Better Auth (`src/server/auth.ts`):** walks `X-Forwarded-For` right-to-left using `advanced.ipAddress.trustedProxies` (`env.trustedProxies`) and takes the first hop outside those CIDRs.

### Common misconfigurations and symptoms

| Symptom | Root cause | Fix |
| --- | --- | --- |
| One attacker locks out **all** users with `429`; every session shows the proxy's private IP (for example `10.254.254.10` or a Docker bridge gateway) | App runs behind a proxy with `TRUSTED_PROXIES` unset, or the proxy's IP is missing from `TRUSTED_PROXIES` | Set `TRUSTED_PROXIES` to the exact proxy IP/CIDR (e.g., `10.254.254.10/32` in Compose, ingress controller pod CIDR in Kubernetes). |
| Log warning `Rate limiting could not determine a client IP ...` (`source: "better-auth"`) | Every hop in `X-Forwarded-For` (including the client) fell inside `TRUSTED_PROXIES` (too broad a CIDR, or internal probe traffic) | Narrow `TRUSTED_PROXIES` to only reverse-proxy hops—never include subnets that also host end users. |
| Attackers bypass `429` by sending arbitrary `X-Forwarded-For` headers | Edge proxy forwards client-supplied `X-Forwarded-For` without stripping/strict parsing, or `EDGE_TRUSTED_PROXIES` / `TRUSTED_PROXIES` trusts untrusted networks | Ensure `deploy/Caddyfile` keeps `trusted_proxies_strict` + `header_up X-Forwarded-For {client_ip}`, and verify `EDGE_TRUSTED_PROXIES` lists only upstream CDNs/LBs in front of Caddy. |

### Live spoofing check

1. Check the app's active `trustedProxies` from its `starting` log line:

   ```sh
   kubectl logs -l app.kubernetes.io/name=app | jq -R 'fromjson? | select(type == "object" and .msg == "starting") | {appUrl, trustedProxies}'
   ```

2. Check recent session IPs in Postgres—they should be diverse public client IPs (or `/64` IPv6 prefixes), never a single proxy address:

   ```sql
   SELECT ip_address, count(*) AS sessions, max(created_at) AS latest_utc
   FROM "session"
   WHERE created_at > now() - interval '1 hour'
   GROUP BY ip_address
   ORDER BY sessions DESC
   LIMIT 20;
   ```

3. From an external host (outside your CDN/proxy CIDRs), send a spoofed `X-Forwarded-For: 203.0.113.99` header to a sign-in attempt on a test account and confirm the recorded `session.ip_address` is your real external IP, **not** `203.0.113.99`.

## 2. Inspect Postgres `rate_limit` table

Both Better Auth limits (production build only) and the business API write limit share the `UNLOGGED` `rate_limit` table (`src/server/db/schema/rate-limit.ts`, `src/server/auth-rate-limit.ts`):

- **Auth limits (per IP / IPv6 `/64`):**
  - `3` per `10 s`: `/sign-in/*`, `/sign-up/*`, `/change-password`
  - `3` per `60 s`: `/request-password-reset`, `/send-verification-email`
  - `100` per `60 s`: other allowlisted auth endpoints (`/get-session` is not limited; non-allowlisted paths return `404` and write nothing)
- **Business API write limit (per user):** `60` per `60 s` across `POST`, `PATCH`, `DELETE /api/me/posts`, keyed as `api-write|<user id>` (`src/server/api/rate-limit.ts`).
- Idle rows older than 10 minutes are pruned automatically in the background.

### Triage queries

```sql
-- Top active rate-limit buckets right now (timestamps in UTC)
SELECT
  key,
  count,
  to_timestamp(last_request / 1000.0) AT TIME ZONE 'UTC' AS last_request_utc
FROM rate_limit
ORDER BY count DESC, last_request DESC
LIMIT 30;

-- Check API write abusers specifically
SELECT
  key,
  count,
  to_timestamp(last_request / 1000.0) AT TIME ZONE 'UTC' AS last_request_utc
FROM rate_limit
WHERE key LIKE 'api-write|%'
ORDER BY count DESC
LIMIT 20;

-- Total rows (detect distributed spray bloating the table)
SELECT count(*) AS active_buckets FROM rate_limit;
```

### Targeted unblock (false positive)

If a legitimate corporate NAT or user is trapped in a window, clear only their key (never truncate the table during an active attack):

```sql
DELETE FROM rate_limit WHERE key = '<exact-key-from-query-above>';
```

If an external IP or CIDR is spraying across thousands of accounts, block the source CIDR at the edge/WAF (Caddy or upstream firewall/CDN) in addition to the app rate limits.

## 3. Emergency toggle: `AUTH_SIGN_UP=closed`

If open sign-up (`AUTH_SIGN_UP=open`) is abused for spam registrations or outbound SMTP quota exhaustion:

1. Set `AUTH_SIGN_UP=closed` in the environment and roll/restart the app:
   - **Docker Compose:** set `AUTH_SIGN_UP=closed` in `deploy.env`, then `docker compose -f compose.production.yaml --env-file deploy.env up -d app`.
   - **Fly.io:** update `AUTH_SIGN_UP = "closed"` in `fly.toml` and `fly deploy` (or `fly secrets set AUTH_SIGN_UP=closed` if managed via secrets).
   - **Kubernetes:** `kubectl set env deployment/app AUTH_SIGN_UP=closed && kubectl rollout status deployment/app`.
2. **Exact effect:**
   - `src/server/auth.ts` disables `/sign-up/email` (`disabledPaths`).
   - `src/server/http/auth-endpoints.ts` removes `POST /sign-up/email` from `EXPOSED` (returns `404`).
   - `getSignUpPolicy` (`src/lib/auth.functions.ts`) returns `{ open: false }`, hiding public sign-up.
   - Existing users can still sign in, manage sessions, change/reset passwords, and delete accounts. Operators can still provision accounts via `node .output/create-user.mjs <email> "<Name>"`.
3. Clean up unverified spam accounts if needed (verify carefully before deleting):

   ```sql
   -- Preview unverified accounts created during the abuse window (UTC)
   SELECT count(*)
   FROM "user"
   WHERE email_verified = false
     AND created_at >= '2026-11-26T00:00:00Z';
   ```

## 4. Rotating `BETTER_AUTH_SECRET` (and other secrets)

### Impact of rotating `BETTER_AUTH_SECRET`

- **Immediate global sign-out:** changing `BETTER_AUTH_SECRET` invalidates **every** active session cookie with **no overlap period** ([operations.md](../operations.md#rotating-better_auth_secret)). All signed-in users must sign in again.
- **Do not set `BETTER_AUTH_SECRETS`:** Better Auth's versioned secret variable applies only to encrypted OAuth tokens (unused here) and is intentionally not wired into `src/server/env.ts`.

### Rotation procedure

1. **Generate a new secret** (minimum 32 characters enforced by `src/server/env.ts`):

   ```sh
   NEW_SECRET="$(openssl rand -base64 32)"
   ```

2. **Update the secret store** (never commit or bake into an image):
   - **Docker Compose:** update `BETTER_AUTH_SECRET` in `deploy.env` (`chmod 600 deploy.env`).
   - **Fly.io:** `fly secrets set BETTER_AUTH_SECRET="$NEW_SECRET"` (triggers a rolling restart).
   - **Kubernetes:**

     ```sh
     kubectl create secret generic app \
       --from-literal=DATABASE_URL="$DATABASE_URL" \
       --from-literal=BETTER_AUTH_SECRET="$NEW_SECRET" \
       --dry-run=client -o yaml | kubectl apply -f -
     kubectl rollout restart deployment/app
     kubectl rollout status deployment/app
     ```

3. **Coordinate multi-replica cutover:** during a slow rolling restart, old pods accept old cookies and new pods reject them. Complete the rollout promptly so all replicas converge on the new secret.
4. **If rotating due to a suspected compromise (not routine hygiene):**
   - Also purge existing session rows so no stolen token remains valid in Postgres:

     ```sql
     DELETE FROM "session";
     DELETE FROM "verification";
     ```

   - Rotate `DATABASE_URL` / `MIGRATION_DATABASE_URL` (`ALTER ROLE app PASSWORD '...';`, update secrets, restart) and `SMTP_URL` credentials if the secret store itself was exposed.
5. **Verify recovery:**
   - Confirm every replica logs `starting` and answers `200` on `GET /api/ready`.
   - Confirm a fresh sign-in succeeds, sets the `(__Secure-)better-auth.session_token` cookie, and authorizes `GET /api/me`.

## 5. Inspecting `audit_log` *(Wave 2 companion table)*

Once the Wave 2 audit-log schema (`src/server/db/schema/audit-log.ts`) and helper (`src/server/audit/audit-log.ts`) are migrated and wired, security-relevant events are recorded in `audit_log` with:

- `id` (`uuidv7`), `occurred_at` (`timestamptz`, indexed via `audit_log_occurred_at_idx`)
- `action` (indexed via `audit_log_action_occurred_idx`; e.g., sign-in, password reset, session revoke, account delete)
- `actor_id` (nullable `user.id` with `ON DELETE SET NULL`, indexed via `audit_log_actor_occurred_idx`)
- `ip_hash` (salted HMAC-SHA256 32-hex-char prefix via `hashAuditIp`—never raw client IP PII)
- `request_id` (correlates directly with server JSON logs / `x-request-id`)
- `outcome` (`success` | `denied` | `failure`, enforced by `audit_log_outcome_check`)
- `metadata` (allowlisted, sanitized JSONB via `sanitizeAuditMetadata`)

### Investigation queries (UTC)

```sql
-- Recent denied or failed auth events in the last 30 minutes
SELECT occurred_at, action, actor_id, ip_hash, request_id, outcome, metadata
FROM audit_log
WHERE occurred_at > now() - interval '30 minutes'
  AND outcome IN ('denied', 'failure')
ORDER BY occurred_at DESC
LIMIT 50;

-- Detect credential stuffing bursts grouped by hashed client IP
SELECT ip_hash, action, count(*) AS attempts, min(occurred_at) AS first_utc, max(occurred_at) AS last_utc
FROM audit_log
WHERE occurred_at > now() - interval '15 minutes'
  AND outcome <> 'success'
GROUP BY ip_hash, action
HAVING count(*) >= 10
ORDER BY attempts DESC;

-- Full timeline for a compromised user account
SELECT occurred_at, action, ip_hash, request_id, outcome, metadata
FROM audit_log
WHERE actor_id = '<user-id>'
ORDER BY occurred_at DESC
LIMIT 100;
```

Use the `request_id` from `audit_log` to pull matching `request`, `auth request failed`, or `server function failed` lines from your structured log collector.
