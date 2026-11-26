# Service Level Objectives, profiling, and release recipes

Practical SLIs/SLOs, Prometheus/Alertmanager rules, Node profiling under [ADR 0012](decisions/0012-node-permission-model.md), and zero-bloat production release patterns. All measurement windows use **UTC**.

## 1. SLIs, SLOs, and error budgets

Measurements cover a **rolling 30-day UTC window** (43,200 minutes). Client disconnects (`status: 499, aborted: true` in `src/server/nitro/http.ts`) are excluded from error counts because they represent impatient clients or load-test shutdowns, not server faults.

| Service surface | SLI definition | 30-day SLO target | 30-day error budget | Primary runbook |
| --- | --- | --- | --- | --- |
| **HTTP availability** (SSR pages + `/api/*`) | Proportion of non-`499` requests returning `< 500` | **99.9%** | 0.1% (~43.2 min equivalent full outage) | [high-error-rate-and-rollback.md](runbooks/high-error-rate-and-rollback.md) |
| **API latency** (`/api/*`, excl. `/api/health`) | Proportion of successful `/api/*` requests completing in `≤ 200 ms` (p95) and `≤ 500 ms` (p99) | **p95 ≤ 200 ms** / **p99 ≤ 500 ms** | 5% of requests > 200 ms | [database-outage-and-pool.md](runbooks/database-outage-and-pool.md) |
| **SSR page latency** (`/`, `/dashboard`, `/login`, `/account`) | Server-side document response time excluding client network | **p95 ≤ 300 ms** | 5% of renders > 300 ms | [database-outage-and-pool.md](runbooks/database-outage-and-pool.md) |
| **Auth error budget** (`/api/auth/*` + auth server functions) | Proportion of non-`499` auth requests returning `< 500` (`401`/`403`/`429` are valid denials, not server errors) | **99.95%** | 0.05% (~21.6 min equivalent) | [auth-abuse-and-secret-rotation.md](runbooks/auth-abuse-and-secret-rotation.md) |
| **Readiness / DB reachability** (`GET /api/ready`) | Proportion of synthetic/orchestrator readiness probes returning `200` (excluding planned drain windows) | **99.95%** | ~21.6 min/month | [database-outage-and-pool.md](runbooks/database-outage-and-pool.md) |

> **Note on ADR 0009 (`/_serverFn/<id>`):** Until TanStack/router#8246 returns `404` for unknown server function IDs ([ADR 0009](decisions/0009-unknown-server-function-id.md)), stale browser tabs after a deploy produce `500` on `/_serverFn/*` with log `msg: "server function request failed"`. Track `/_serverFn/*` unknown-ID errors separately or alert only when they persist > 30 minutes after a rollout so routine deploys do not page on-call.

## 2. Prometheus and Alertmanager rules

The rules below align with the Wave 1/Wave 2 server telemetry metrics (`src/server/observability/telemetry.ts`: `http_requests_total`, `http_request_duration_ms`, `http_errors_total`, `auth_events_total`).

> **Security requirement for `/metrics`:** When `/metrics` is wired in Wave 2, restrict scraping to an internal network/port or require a bearer token (`METRICS_TOKEN`)—never expose `/metrics` publicly through `deploy/Caddyfile`. Until `/metrics` is enabled in your deployment, equivalent HTTP SLIs can be exported by your edge proxy (Caddy/Envoy/Ingress metrics) or log-derived metrics from `msg: "request"`.

### Recording rules (`prometheus-rules.yaml`)

```yaml
groups:
  - name: app-sli-recording
    interval: 30s
    rules:
      - record: job:http_requests:rate5m
        expr: sum by (job) (rate(http_requests_total{status!="499"}[5m]))

      - record: job:http_error_ratio:rate5m
        expr: |
          sum by (job) (rate(http_errors_total{status=~"5.."}[5m]))
          / clamp_min(sum by (job) (rate(http_requests_total{status!="499"}[5m])), 1e-9)

      - record: job:http_error_ratio:rate30m
        expr: |
          sum by (job) (rate(http_errors_total{status=~"5.."}[30m]))
          / clamp_min(sum by (job) (rate(http_requests_total{status!="499"}[30m])), 1e-9)

      - record: job:http_error_ratio:rate1h
        expr: |
          sum by (job) (rate(http_errors_total{status=~"5.."}[1h]))
          / clamp_min(sum by (job) (rate(http_requests_total{status!="499"}[1h])), 1e-9)

      - record: job:http_error_ratio:rate6h
        expr: |
          sum by (job) (rate(http_errors_total{status=~"5.."}[6h]))
          / clamp_min(sum by (job) (rate(http_requests_total{status!="499"}[6h])), 1e-9)

      - record: job:api_latency_ms:p95_5m
        expr: |
          histogram_quantile(
            0.95,
            sum by (job, le) (rate(http_request_duration_ms_bucket{route=~"/api/.*"}[5m]))
          )
```

### Multi-window burn-rate alerts (`alertmanager-rules.yaml`)

Uses Google SRE multi-window burn rates for a 99.9% SLO (`budget = 0.001`):

- **Fast burn (page):** 14.4× burn rate consumes 2% of the 30-day budget in 1 hour (must hold across both 1 h and 5 m windows).
- **Slow burn (ticket):** 6× burn rate consumes 5% of the 30-day budget in 6 hours (must hold across both 6 h and 30 m windows).

```yaml
groups:
  - name: app-slo-alerts
    rules:
      - alert: AppErrorBudgetFastBurn
        expr: |
          job:http_error_ratio:rate1h > (14.4 * 0.001)
          and
          job:http_error_ratio:rate5m > (14.4 * 0.001)
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: 'Fast SLO error-budget burn (>14.4x for 1h/5m)'
          runbook: 'docs/runbooks/high-error-rate-and-rollback.md'

      - alert: AppErrorBudgetSlowBurn
        expr: |
          job:http_error_ratio:rate6h > (6 * 0.001)
          and
          job:http_error_ratio:rate30m > (6 * 0.001)
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: 'Slow SLO error-budget burn (>6x for 6h/30m)'
          runbook: 'docs/runbooks/high-error-rate-and-rollback.md'

      - alert: ApiLatencyP95High
        expr: job:api_latency_ms:p95_5m > 200
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: 'API p95 latency above 200 ms for 10m'
          runbook: 'docs/runbooks/database-outage-and-pool.md'

      - alert: AuthDeniedSpike
        expr: sum(rate(auth_events_total{outcome="denied"}[5m])) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'Sustained auth denial/rate-limit burst (>5/s) — check abuse or TRUSTED_PROXIES'
          runbook: 'docs/runbooks/auth-abuse-and-secret-rotation.md'

      - alert: AppReadinessFailing
        expr: probe_success{endpoint="/api/ready"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'GET /api/ready failing — Postgres unreachable or all pods draining'
          runbook: 'docs/runbooks/database-outage-and-pool.md'
```

## 3. Production Node profiling (ADR 0012 compatible)

The production container (`Dockerfile`) runs with:

```sh
node --permission --allow-fs-read=/app/.output --allow-net --disable-warning=ExperimentalWarning .output/server/index.mjs
```

And `deploy/kubernetes.yaml` enforces `readOnlyRootFilesystem: true`. Attempting to write `--cpu-prof` or `--heap-prof` without granting a dedicated writable directory fails with `ERR_ACCESS_DENIED` (Node permission model) or `EROFS` (read-only rootfs).

### Safe profiling recipe (keep `--permission` enabled)

Never disable `--permission` or grant `--allow-fs-write=*` to capture a profile. Instead, start a **single temporary profiling replica** (or isolated staging container) with a bounded tmpfs/`emptyDir` and `--allow-fs-write=/tmp/profiles`:

#### Docker (bounded tmpfs)

```sh
docker run --rm --name app-prof \
  --env-file deploy.env \
  --read-only \
  --cap-drop ALL \
  --tmpfs /tmp/profiles:rw,noexec,nosuid,size=256m,uid=1000,gid=1000 \
  "$APP_IMAGE" \
  node --permission \
    --allow-fs-read=/app/.output \
    --allow-fs-write=/tmp/profiles \
    --allow-net \
    --disable-warning=ExperimentalWarning \
    --cpu-prof --cpu-prof-dir=/tmp/profiles --cpu-prof-interval=1000 \
    --heap-prof --heap-prof-dir=/tmp/profiles --heap-prof-interval=524288 \
    .output/server/index.mjs
```

Send `SIGTERM` after capturing the target workload (`docker kill -s SIGTERM app-prof` or extract before container exit) so Node flushes `.cpuprofile` and `.heapprofile` cleanly during graceful shutdown, then copy the files out (`docker cp` before `--rm`, or bind-mount a dedicated host directory owned by uid `1000`).

#### Kubernetes (ephemeral profiling pod / patch)

Mount an `emptyDir` (`sizeLimit: 256Mi`) at `/tmp/profiles` on one profiling Deployment replica, add `--allow-fs-write=/tmp/profiles` plus `--cpu-prof --cpu-prof-dir=/tmp/profiles` (or `--heapsnapshot-signal=SIGUSR2 --diagnostic-dir=/tmp/profiles` for on-demand heap snapshots via `kubectl exec <pod> -- kill -USR2 1`), pull the files with `kubectl cp <pod>:/tmp/profiles ./profiles`, and delete the profiling Deployment immediately afterward.

Open `.cpuprofile` and `.heapprofile` in Chrome DevTools Performance/Memory panels or `speedscope` offline.

## 4. Production release recipes (zero vendor bloat)

These patterns rely strictly on your deployment platform, edge proxy, and the app's own lightweight primitives—no heavyweight third-party release SDKs are pulled into the server or client bundle.

### Canarying

**Prerequisites:** All database migrations in the candidate release must already be backward compatible with the stable release (expand-first, [high-error-rate-and-rollback.md](runbooks/high-error-rate-and-rollback.md#3-forward-only-expandcontract-rollback-strategy)).

#### Kubernetes canary Deployment

Run a second Deployment (`app-canary`) with `replicas: 1` sharing the `app.kubernetes.io/name: app` Service selector while stable `app` runs `replicas: 9` (giving ~10% traffic with a stock Service), or assign exact weights with Gateway API `HTTPRoute`:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: app-canary-route
spec:
  parentRefs: [{ name: edge-gateway }]
  rules:
    - backendRefs:
        - { name: app-stable, port: 80, weight: 95 }
        - { name: app-canary, port: 80, weight: 5 }
```

Promote through `5% -> 25% -> 100%` only if the canary holds:

- 0 `ResponseSchemaError` / `uncaught exception` log lines
- Error rate within 0.05% of stable baseline
- `/api/*` p95 latency within 15% of stable baseline and no `pg_stat_statements` regressions

If any check fails, set canary weight to `0` and scale `app-canary` to `0`.

#### Fly.io canary / rolling

`deploy/fly.toml` defaults to `strategy = "rolling"` with `min_machines_running = 2`, `release_command = "node .output/migrate.mjs"`, and `/api/ready` health checks. For explicit canary gating before rolling remaining machines:

```sh
fly deploy --strategy canary
# Inspect canary machine logs and /api/ready; if unhealthy, cancel or redeploy previous image
fly logs --instance <canary-machine-id>
```

### Traffic shaping and load shedding

Defense in depth across edge and app layers prevents Postgres `max_connections` saturation during traffic spikes:

1. **App-level shedding (already built in):**
   - Body-size and streaming rejection in `src/start.ts`: `413` above 64 KiB, `400` on invalid `Content-Length`, `411` on chunked writes.
   - Auth per-IP rate limits (`429` + `X-Retry-After`) and per-user API write limits (`60/60 s`, `429` + `RateLimited.retryAfter`).
   - Postgres statement/connection bounds (`statement_timeout: 15s`, `connectionTimeoutMillis: 5000`).
2. **Edge-level shaping (`Retry-After` shedding):**
   - Add per-IP burst limits at the edge (Caddy `rate_limit` plugin, Envoy local/global rate limits, or Cloudflare WAF) on public anonymous endpoints (`GET /api/posts`, `/`) so scrapers get `429 Too Many Requests` with `Retry-After: 10` before consuming Node event-loop time or Postgres pool slots.
   - Prioritize authenticated write/read paths and `/api/ready` above anonymous public feed traffic when configuring edge concurrency caps.
   - Ensure the edge preserves `Retry-After` and `X-Retry-After` headers from upstream `429` responses.

### Tap compare / shadowing (dark launch)

Validate a new release's performance and response shape against real read traffic without affecting users by mirroring **read-only (`GET`/`HEAD`)** requests at the edge and discarding the shadow response.

> **Hard rule:** NEVER shadow mutating requests (`POST`, `PATCH`, `DELETE`), `/api/auth/*`, or `/_serverFn/*` against production databases or SMTP—double-writing mutates user data, burns rate-limit buckets, and sends duplicate emails.

Example Envoy `Route` rule mirroring 10% of `GET /api/posts` to `app-shadow`:

```yaml
match:
  prefix: /api/posts
  headers:
    - name: ':method'
      exact_match: GET
route:
  cluster: app-stable
  request_mirror_policies:
    - cluster: app-shadow
      runtime_fraction:
        default_value: { numerator: 10, denominator: HUNDRED }
```

In Caddy, keep `deploy/Caddyfile` as the primary proxy and place a lightweight sidecar/module or Envoy front proxy when tap-compare is needed. Point `app-shadow` at a **read-only replica** (or isolated staging DB) and compare status codes, p95 latency, and JSON schema conformance (`openapi.json`) offline.

### Teeing (observability and log fan-out)

Split operational streams off the request hot path rather than adding synchronous network calls inside request handlers:

- **Logs:** Container stdout/stderr emits one JSON line per event (`src/server/log.ts`). Configure your log agent (Vector, Fluent Bit, or OpenTelemetry Collector) to tee lines to both a hot search index (7–30 days for incident triage) and compressed object storage (immutable retention).
- **Traces and metrics *(Wave 2)*:** When `OTEL_EXPORTER_OTLP_ENDPOINT` is configured (`src/server/observability/telemetry.ts`), point it at a local/cluster OpenTelemetry Collector that tees spans and metrics to Prometheus/Grafana/Jaeger without adding extra client exporters or blocking requests on shutdown.

### A/B testing boundary via typed feature flags

Keep experiment evaluation strictly **server-side** using the typed OpenFeature-compatible flag registry (`src/server/feature-flags.ts`, introduced in Wave 1/Wave 2):

- **Zero client SDK bloat:** No third-party A/B script enters the browser bundle, preserving the <300 KiB client budget, strict nonce CSP ([ADR 0010](decisions/0010-content-security-policy.md)), and Lighthouse 100/100 scores.
- **Deterministic assignment:** `isFlagEnabled(flagName, { userId })` hashes `${flagName}:${subject}` (`rolloutBucket` via `sha256` uint32 mod 100) for sticky percentage rollouts (`{ enabled, rolloutPercent }`) without extra DB round-trips or cookies; global emergency overrides come from validated JSON in `FEATURE_FLAGS` (`parseFeatureFlagsEnv`).
- **Strict security boundary:**
  - Never gate authentication, authorization (`Authentication` middleware, author ownership checks), CSRF, or rate limiting behind an A/B flag.
  - SSR pages already send `Cache-Control: private, no-store`, preventing variant leakage across users; never vary prerendered static routes (`/about`) by user flag.
  - Emit only the variant key (never user emails or PII) to telemetry or `audit_log` / RUM vitals (`src/lib/client-telemetry.ts`).
