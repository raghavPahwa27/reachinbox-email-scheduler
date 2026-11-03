# ReachInbox

A full-stack email scheduler built for the ReachInbox intern assignment. Google-authenticated users manage Ethereal senders, upload CSV/text recipients, schedule individual messages, inspect scheduled/sent/failed mail, search with Elasticsearch, and connect Slack for hourly-limit notifications.

This repository contains real integration implementations. OAuth and remote delivery need your own credentials. Ethereal accepts SMTP messages into a test inbox; it does **not** deliver them to real recipients. See [VERIFICATION.md](VERIFICATION.md) for what was actually run.

## Stack and layout

Node.js 22 LTS, TypeScript, Express 5, Prisma 6, PostgreSQL 16, BullMQ 5, Redis 7, Nodemailer, Elasticsearch 8, Google OIDC/OAuth, Slack OAuth, Zod; React 19, Vite 6, Tailwind 4, React Router, Lucide. `package-lock.json` locks installed versions.

```text
reachinbox/
  backend/
    prisma/schema.prisma
    prisma/migrations/                 # SQL schema, constraints, search version + NOTIFY triggers
    src/
      config/                          # validated environment, database, Redis
      integrations/{email,slack,google,elasticsearch}/
      middleware/                      # authentication, CSRF, authorization, errors
      queues/                          # BullMQ producers and retention
      routes/                          # auth, senders, emails, Slack
      services/                        # scheduling, distributed limiter, reconciliation
      types/ utils/ validators/ workers/
      app.ts server.ts worker.ts reconcile.ts
    test/
    .env.example package.json tsconfig.json
  frontend/
    src/{components,pages,context,services,types,utils}/
    src/App.tsx src/main.tsx src/styles.css
    .env.example package.json vite.config.ts
  docker-compose.yml
  package.json package-lock.json
  README.md VERIFICATION.md
```

## Quick start

Install Node.js 22.12+ and Docker Desktop/Compose. Allocate enough Docker memory for Elasticsearch (at least 2 GB total for these local services).

```sh
cd reachinbox
npm ci
npm run setup
npm run doctor
```

`setup` creates the local environment files and independently generates `JWT_SECRET` and `ENCRYPTION_KEY`, without printing them or overwriting existing files. Fill in provider credentials in `backend/.env`. Keep the encryption key stable: rotating it requires re-encrypting stored credentials. Never commit `.env` files. `doctor` reports configuration and service availability without displaying secrets.

```sh
docker compose up -d --wait
npm run db:generate
npm run db:migrate
npm run dev:api       # terminal 1
npm run dev:worker    # terminal 2
npm run dev:web       # terminal 3
```

Open <http://localhost:5173>. Log in with Google, add an Ethereal sender under **Manage senders**, then compose and schedule. The browser displays your local timezone; dates are sent as ISO UTC timestamps. Start the worker independently; running only the API does not send messages.

For built processes:

```sh
npm run build
npm run start -w backend
npm run worker -w backend
npm run preview -w frontend
```

Use a TLS reverse proxy for deployment, keep frontend/API on the same site, and set `NODE_ENV=production`. The app trusts one reverse proxy in production. Adjust that deployment topology explicitly if needed. Vite preview is only a local build check, not a production web server. The Compose file is local infrastructure: loopback-only ports, local development credentials and Elasticsearch security disabled. Production needs private networking, authenticated/TLS infrastructure and backups.

## Configuration

The complete variable list is in `backend/.env.example` and `frontend/.env.example`.

| Variables | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection including credentials/database |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Shared queue, session and throttle store |
| `PORT`, `FRONTEND_URL`, `NODE_ENV` | API listener, exact allowed frontend origin, secure-cookie mode |
| `JWT_SECRET` | At least 32 characters; signs server-side session cookies (no browser JWT) |
| `ENCRYPTION_KEY` | Base64 encoding of exactly 32 random bytes for AES-256-GCM |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Google OAuth web application |
| `ETHEREAL_HOST`, `ETHEREAL_PORT`, `ETHEREAL_USER`, `ETHEREAL_PASS` | Default SMTP account; individual senders can supply separate credentials |
| `ELASTICSEARCH_URL` | Elasticsearch endpoint |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI` | Slack OAuth application |
| `WORKER_CONCURRENCY` | Concurrent BullMQ email jobs, default 5 per worker |
| `MIN_DELAY_SECONDS` | Global minimum inter-send delay, default 2 |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Default sender hourly cap, 200 |
| `SYSTEM_MAX_EMAILS_PER_HOUR` | Maximum configurable cap, 1000 |
| `SMTP_TIMEOUT_MS` | Bounded SMTP attempt timeout, 30000 ms |
| `ADMIN_EMAILS` | Comma-separated Google-account emails allowed to inspect/manage all queues |
| `VITE_API_URL` (frontend) | API origin (no `/api` suffix) if overriding the default same-origin proxy |

Missing Google/Slack credentials disable those flows with an explicit configuration error; there is no development login bypass. Environment variables are loaded from `backend/.env` by the npm workspace scripts. Keep the default localhost spelling consistent in cookies and callbacks.

### Local ports and callback URLs

Express calls `app.listen(env.PORT)` in `backend/src/server.ts`. The validated default in `backend/src/config/env.ts` is **3001**. No local `.env` override was present when checked. Keep `PORT=3001` and register these exact local callbacks (replace previous port-5000 registrations):

- Google authorized redirect URI: `http://localhost:3001/api/auth/google/callback`
- Slack redirect URI: `https://YOUR-TUNNEL-HOST/api/slack/callback`; current Slack documentation requires HTTPS. See [local credentials and tunnel setup](docs/SETUP.md).

Callback route paths are unchanged. `FRONTEND_URL` remains `http://localhost:5173`; no frontend origin change is required. Leave `VITE_API_URL` empty to use Vite's proxy to port 3001. A deliberate future API port change requires updating `PORT`, both callback URLs, provider registrations and Vite's `/api` and `/admin` proxy targets together; the frontend port can stay unchanged.

### Google

1. Create a Google Cloud project; configure its OAuth consent screen. While in testing mode, add your own Google account to the test users.
2. Create an **OAuth client ID → Web application**. Register `http://localhost:3001/api/auth/google/callback` as an authorized redirect URI. This server flow requests only `openid email profile`.
3. Populate the three `GOOGLE_*` variables. For a public HTTPS deployment, register its exact callback too.
4. Use **Continue with Google**. The backend checks state, PKCE, nonce and the signed ID token, requires verified email, upserts the user by Google ID, regenerates the session and redirects to the dashboard.

Official reference: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

If Google returns `invalid_client`, copy the current client ID and secret from the same Web application OAuth client into `backend/.env`, then restart the API. Do not add Markdown escaping or alter the secret. The callback logs only a fixed stage/category; it never logs the raw provider response, authorization code, token or client secret. `session_expired` means the login state was missing/expired: start again from `http://localhost:5173`, use the same hostname throughout and allow cookies. Full provider consent/token exchange must be tested with your valid credentials.


### Slack

1. Create a Slack app in a workspace where you can install apps.
2. Add the **bot** scope `chat:write`. ReachInbox sends notifications with `chat.postMessage`; it does not request or require `incoming-webhook`. If that scope remains in your app from the previous setup, remove it in Slack's OAuth & Permissions settings. Slack may retain earlier grants until the app is reinstalled.
3. Register an HTTPS callback under OAuth & Permissions. Both authorization and token exchange use the same exact URI, bound to the session when connection begins. For local testing, use an HTTPS tunnel consistently for `FRONTEND_URL` and both provider callbacks, and register those exact URLs. Vite proxies `/api` to port 3001; permit only your tunnel hostname via `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`. See [step-by-step setup](docs/SETUP.md).
4. Put the matching app's client ID and **client secret** (not its signing secret or verification token) in `backend/.env`. Restart the API after changing them.
5. In Slack, open the notification channel (for example `#all-project`), click its name, and copy its Channel ID from the details. Click **Connect Slack** in ReachInbox, enter that ID, then authorize the app. Channel ID is bound to the authenticated user's OAuth session; it is not taken from the callback URL.
6. Invite the ReachInbox bot to that channel. `chat:write` permits posting to channels the bot has joined; this app does not request broad `chat:write.public`, `channels:read`, or `groups:read` permissions.
7. Connection status, disconnect and reconnect are on the dashboard. Disconnect deletes this user's stored credential; it does not revoke a workspace token shared with another user. To remove the entire app, uninstall it from Slack.

The callback checks both HTTP status and Slack's JSON `ok` flag. HTTP 200 with `ok:false` is an error. Safe logs include stage, allowlisted Slack error code and HTTP status, never raw response bodies, tokens, secrets, authorization codes or OAuth state. The dashboard shows actionable safe error codes. A successful response must contain a **bot** token, a workspace ID and `chat:write`; user tokens in `authed_user` are never stored as the bot credential. A missing workspace name falls back to its ID. OAuth state is random, expires after ten minutes, is bound to the signed-in Google user, and is consumed before exchange. A consumed or expired code requires a fresh Connect Slack attempt.

Slack tokens and SMTP passwords are encrypted with AES-256-GCM and random IVs. Tokens never appear in API responses. OAuth state is session-bound, expires after ten minutes and is consumed on callback. A workspace administrator may need to approve installation. Reference: [Slack OAuth](https://docs.slack.dev/authentication/installing-with-oauth/).

### Ethereal

Create a test account at <https://ethereal.email/create>. Copy the SMTP username/password into the default environment configuration, or supply them in **Manage senders** for each sender. Host is restricted to `smtp.ethereal.email`, using STARTTLS on 587 or TLS on 465; arbitrary SMTP destinations are deliberately rejected. Sender display identity is stored separately from authentication credentials. Successful sends log and store the Ethereal preview URL, available in message details. Never use production mailbox credentials for this assignment.

## Architecture and scheduling

The API and worker are separate Node processes. PostgreSQL is the authority for email state and ownership. Redis stores persistent BullMQ jobs, server-side sessions, sender leases, hourly counters and Slack deduplication/outbox keys. Elasticsearch is an eventually consistent read index, never the source of email records.

1. Validate the authenticated request with Zod, normalize/deduplicate recipients, enforce sender ownership, limits and a future start time.
2. In one PostgreSQL transaction insert a batch and all email rows with `createMany`. A unique `(userId,idempotencyKey)` batch prevents concurrent duplicate requests; a hash rejects changed payloads under an existing key with 409.
3. Each email has unique deterministic `email-<uuid>` BullMQ ID and a unique database idempotency key. Initial times are exactly `startTime + recipientIndex × delaySeconds`.
4. Bulk enqueue batches of up to 500 delayed jobs. If queue publication fails, database records remain committed and the API reports `queuePending`.
5. The worker reads the current DB record, ignores terminal states, obtains a distributed sender lease, checks earlier pending records, atomically claims PROCESSING, and admits an SMTP attempt via Lua. Delays/limits move the job to BullMQ's delayed state and update PostgreSQL without consuming retry attempts.
6. Nodemailer performs actual bounded SMTP delivery. Success writes SENT, `sentAt` and preview URL. Failures retry with exponential backoff, then record FAILED and the reason. Index updates are independent jobs.

A 10:00:00 start with a five-second delay produces initial times 10:00:00, 10:00:05 and 10:00:10. Actual sends can be later due to SMTP duration, an earlier batch, sender caps, service outages or retries. Past initial start times are rejected; exact idempotent replays remain valid after their original start time.

## Persistence, recovery and idempotency

Redis uses AOF with `appendfsync always`, `noeviction` and a persistent Docker volume. PostgreSQL and Elasticsearch also have named volumes. A normal API/worker restart does not recreate jobs or lose delayed work. Never run `docker compose down -v` against data you need.

A transactional PostgreSQL trigger emits `NOTIFY` with email IDs. The worker listens for committed changes and reconciles those records. It also reconciles on startup and PostgreSQL/Redis reconnection. This closes the commit-before-enqueue crash gap without cron, interval polling or blindly recreating every job. Recovery checks deterministic job IDs, leaves existing delayed/active/completed jobs alone, and only creates missing jobs for nonterminal DB rows. Terminal queue failures are synchronized back to PostgreSQL. An explicit recovery command is available:

```sh
npm run reconcile -w backend
```

Email jobs retain completed records for seven days (up to 10,000) and failed records for 30 days (up to 20,000). Database state still prevents completed emails from being resent after queue cleanup. BullMQ locks/stalled-job handling, an atomic DB claim, distributed sender leases and stable SMTP Message-IDs reduce duplicates. **Exactly-once SMTP delivery is impossible here**: a crash after SMTP acceptance but before recording SENT can lead to a duplicate on retry. Stable Message-ID is a hint, not a recipient-side guarantee. Loss of Redis persistence can also erase throttle counters; durable storage/backups matter.

## Concurrency, delay and rate limiting

`WORKER_CONCURRENCY` controls jobs per worker. Different senders can run concurrently; one Redis lease serializes delivery per sender across all workers. The effective minimum spacing is the maximum of the global minimum, sender minimum and batch delay. The next permitted send time is Redis-backed and conservatively advances from completion of an SMTP attempt. There is no in-memory last-send timestamp.

Hourly limits use **fixed UTC hour windows** (e.g. 10:00:00–10:59:59.999 UTC), using Redis TIME and atomic Lua. The effective limit is the minimum of batch limit, current sender limit and system maximum. Each admitted SMTP attempt reserves one slot; repeated deferrals consume none. An SMTP rejection or ambiguous timeout still consumes a slot, because a server may already have accepted the message. An actual retry is another attempt and uses another slot; this safely caps attempts rather than promising a count of successful deliveries. A reserved attempt lost to a crash may reduce that hour's capacity.

When full, jobs move to the next UTC boundary (or later inter-send slot), with PostgreSQL `scheduledAt` updated. Earlier pending messages take precedence by original schedule and ID, preserving order as far as practical. Exact equal-time recipient ordering is not guaranteed. Retries intentionally hold up newer messages for that sender until they succeed/fail. Fixed windows can allow a burst across an hour boundary; the inter-send delay remains enforced.

The reservation reaching the cap writes a Slack outbox event atomically in Redis. One deterministic notification job and a Redis deduplication key per sender/hour prevent repeated notifications for blocked messages. Workers load the current integration on every notification, so later connections work without restarts. No connection means no notification and no scheduling failure. Slack failures retry independently; email delivery does not wait for Slack. As with any external API, a crash after Slack accepts a message but before the dedupe write has an ambiguity window; a stable `client_msg_id` further reduces duplicates.

### 1,000+ recipients

Requests support up to 10,000 unique recipients, bounded body/file sizes, efficient `createMany` and bulk queue publication. A burst creates delayed work, not 1,000 simultaneous SMTP connections. Configured concurrency, sender serialization and Lua limits cap delivery. Deferrals preserve rows and jobs. The queue grows when input exceeds sending capacity; monitor delayed jobs and provision Redis storage accordingly. One API request is capped at 20 MB, including up to 10 MB of attachments encoded as base64. Recipient CSV/text uploads are capped at 2 MB. Under sustained multi-sender load, benchmark your SMTP/network/DB capacity before raising concurrency.

## Search

Elasticsearch maps tenant IDs/status as keywords, searchable fields as text, and timestamps as dates. Subject/body searches support unfinished final words, and sender/recipient searches match case-insensitive address fragments (for example, `rpahwa` in `rpahwa123@example.com`). Address fragments use escaped wildcard queries against the existing keyword fields; leading wildcards cost more at scale, so benchmark or use a dedicated n-gram index for larger deployments. Queries always filter by authenticated user; results are hydrated through a second ownership-constrained PostgreSQL query. Status filters and pagination are supported. The UI labels the selected mailbox being searched.

Database triggers increment `searchVersion` and retain `indexDirty` when searchable fields change. Queue jobs read current DB values and use Elasticsearch external versions, preventing stale concurrent updates from overwriting newer records. Cleaning the dirty flag is conditional on that version. Failed indexing retries exponentially; startup/reconnection/manual reconciliation recovers dirty records, including exhausted index jobs. Elasticsearch downtime does not reject successful scheduling or email delivery. During an outage search returns 503, while scheduled/sent tables remain available. Search may lag recent status changes by the Elasticsearch refresh interval and retry delay.

## Security and API

HTTP-only, SameSite=Lax session cookies, secure in production; Redis session persistence; session regeneration after login; CSRF tokens on mutations; exact-origin CORS; Zod validation; composite ownership foreign keys; encrypted secrets; bounded request sizes; central JSON errors. User session/identity is never accepted from client request bodies.

All normal API responses are `{ "data": ... }`; errors are `{ "error": { "message": "...", "code": "..." } }`. OAuth endpoints redirect. Dates are ISO strings.

| Endpoint | Behavior |
| --- | --- |
| GET `/api/auth/google`, `/api/auth/google/callback` | Actual Google OAuth flow |
| GET `/api/auth/me` | `{user,isAdmin,csrfToken,senderDefaults}` |
| POST `/api/auth/logout` | Destroy session |
| GET/POST `/api/senders` | List/create owned senders (secrets omitted) |
| PATCH/DELETE `/api/senders/:id` | Update/remove owned sender; history prevents deletion |
| POST `/api/emails/schedule` | Transactional scheduling; requires `Idempotency-Key` |
| GET `/api/emails/scheduled` | SCHEDULED and PROCESSING |
| GET `/api/emails/sent` | SENT and FAILED |
| GET `/api/emails/search?q=hello&status=SENT` | Tenant-scoped full-text search |
| GET `/api/emails/:id` | Owned email detail; other users get 404 |
| GET `/api/slack/connect`, `/api/slack/callback`, `/api/slack/status` | OAuth and connection status |
| POST `/api/slack/disconnect` | Remove current user's integration |
| GET `/admin/queues` | Live Bull Board; authenticated `ADMIN_EMAILS` only |
| GET `/health`, `/health/ready` | Process liveness / PostgreSQL+Redis readiness |

Listings accept `page=1&pageSize=20` and return `{items,total,page,pageSize}`. Queue administrators can inspect and manage all tenants' queues, so access is separately allowlisted. Bull Board mutations also require a trusted browser Origin; a normal logged-in user cannot manage queues.

Example scheduling request (use your login cookie and `/auth/me` CSRF token):

```http
POST /api/emails/schedule
Content-Type: application/json
X-CSRF-Token: <session token>
Idempotency-Key: <a stable UUID for this submission>

{
  "senderId": "<owned sender UUID>",
  "subject": "A quick introduction",
  "body": "Hi there,\nI'd love to connect.",
  "recipients": ["alex@example.com", "sam@example.com"],
  "startTime": "2030-01-01T10:00:00.000Z",
  "delaySeconds": 5,
  "hourlyLimit": 200
}
```

Replace `startTime` with a future time within the next year. Response: `{ "data": { "batchId": "...", "count": 2, "replayed": false, "queuePending": false } }`. Repeat the same key and normalized request for a safe retry. Reusing a key with a different request returns 409. The UI preserves its key for identical retries while the compose modal stays open.

Create sender body: `{ "name":"Outreach", "email":"sender@ethereal.email", "hourlyLimit":200, "minDelaySeconds":2 }` uses configured environment SMTP credentials; supply `smtpUser` and `smtpPassword` together to override. PATCH accepts changed fields. Existing sender limits can be tightened and apply to queued messages when processed.

## Tests and verification

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:integration
```

Unit/API tests use isolated test doubles where external dependencies must be controlled; production routes, SMTP, OAuth, queues and persistence use real integrations. Playwright runs desktop and mobile browser flows with controlled HTTP fixtures; it does not prove provider OAuth or SMTP acceptance. `test:integration` starts the separate `docker-compose.test.yml` stack on ports 15432/16379/19200, applies all migrations, runs real PostgreSQL/Redis/Elasticsearch tests sequentially, and removes the test containers. It never uses `backend/.env` credentials or application queues. The test database name must end in `_test`. GitHub Actions runs these checks through `.github/workflows/verify.yml`. See [VERIFICATION.md](VERIFICATION.md) for observed results and [the submission checklist](docs/ASSIGNMENT-CHECKLIST.md) for remaining evidence.

Manual end-to-end restart check after OAuth/SMTP configuration:

1. Start API and worker; schedule ten emails several minutes ahead. Record the batch ID and inspect delayed jobs in Bull Board.
2. Stop API and worker with SIGTERM. Keep Compose services running. Restart both processes before the first scheduled time.
3. Confirm the same deterministic jobs remain. Watch SENT timestamps and open Ethereal previews; verify sends occur no earlier than scheduled and satisfy delay/hourly limits.
4. Restart again after completion, then run reconciliation. SENT rows must remain SENT without new SMTP activity.
5. Repeat across Redis container restart with its volume retained. Test a sender cap of 2 with more than two recipients; remaining rows should move to the next UTC hour and connected Slack should receive one notification per sender/window.
6. Stop Elasticsearch, schedule mail, then restart Elasticsearch; indexing retries recover searchable records. For an outage longer than retry retention, run reconciliation.

## Requirement coverage and trade-offs

- Express/TypeScript, relational PostgreSQL/Prisma constraints, Zod validation, scoped REST APIs and pagination.
- Independent BullMQ worker, delayed jobs, bulk publication, retries, retention, graceful shutdown and event-driven reconciliation; no cron or polling scheduler.
- Distributed per-sender delay/hourly counters, deferrals, ordering preference, idempotency and honest SMTP crash semantics.
- Actual Nodemailer/Ethereal delivery, multiple encrypted sender configurations, real Google and Slack OAuth, live Slack notifications.
- Versioned Elasticsearch indexing, status filters, ownership checks and durable recovery.
- Authenticated, separately authorized Bull Board showing real queue state.
- Responsive React dashboard, profile/logout, compose, CSV/text validation/deduplication/count, scheduling controls, sender CRUD, Slack controls, loading/empty/error states and message details.
- Persistent infrastructure, migration, environment examples, tests and reproducible setup.

The [supplied Figma](https://www.figma.com/design/kOTwGlESjijCYnMgtHfvfU/Outbox-Labs-Assignment?node-id=59-4050) was inspected in the browser on 3 November 2026. The frontend follows its white background, green controls, compact sidebar, horizontal message rows, full-page compose/detail views and send-later popover. Product naming and extra sender/Slack controls differ; pixel-perfect fidelity is not claimed. Rich text and attachments are supported as additional features; campaigns, tracking and real mailbox delivery are outside this assignment. SMTP host restriction keeps sender configuration focused on Ethereal. Sender deletion is blocked once history exists. No production exactly-once or high-availability Redis failover is claimed. GitHub submission is deferred at the user's request. Use [the five-minute demo guide](docs/DEMO.md) to record the required live evidence.
