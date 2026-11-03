# Verification record

Checked on **3 November 2026**, against this local project copy. Results below distinguish tested application behavior from provider flows that still need a signed-in user.

## Current results

Search follow-up on 3 November: reproduced a missing partial-address result despite a healthy index. Search now matches case-insensitive sender/recipient fragments against existing keyword fields and unfinished final words in subject/body. All 45 isolated real-service tests passed again, including new prefix/substring/case/domain, literal wildcard and ownership/mailbox filter checks. Backend typecheck/build passed; the API was restarted with the fix. Existing indexes require no rebuild or deletion.

- Host: Windows, Node.js **24.13.1**, Docker Engine **29.9.2**. Node 22.12+ remains the documented target; GitHub Actions is configured for Node 22 but has not run on GitHub yet.
- Locked npm dependencies installed and Prisma 6.19 client generated.
- PostgreSQL, Redis and Elasticsearch application containers started with the configured persistent volumes; all three Compose health checks passed.
- All **three migrations** applied successfully, including mailbox search-version repair.
- API `/health/ready`, frontend and Elasticsearch returned **HTTP 200**. Google authorization entry point returned the expected redirect. This does not prove completed Google consent/token exchange.
- Backend and frontend TypeScript checks and production builds passed. The composer is loaded separately so the initial frontend does not download its editor code.
- **45 tests passed, 0 failed, 0 skipped** in the real integration runner. This total includes unit/API tests and recipient parsing tests.
- **12 Playwright tests passed**, covering both desktop and mobile views. These use controlled HTTP fixtures, not simulated production authentication.
- Real Ethereal SMTP connection, STARTTLS and authentication with the supplied credentials passed. **No email was sent by that connection check.**
- API, email/search/Slack worker and Vite frontend are running as hidden local processes. Their logs and process IDs are stored in ignored `.runtime/` files.
- The provided Figma was inspected in the browser. White/green styling and sidebar, row, compose and detail layouts were implemented; pixel-perfect fidelity is not claimed.
- Environment files, runtime logs, Playwright output and dependencies are excluded by `.gitignore`. No GitHub repository was created, pushed or shared; the user deferred that step.

## Behavior tested against real services

The dedicated `docker-compose.test.yml` stack used PostgreSQL on port 15432, Redis on 16379 and Elasticsearch on 19200. It did not use the application database, provider credentials or production queues, and its containers were removed at completion.

- Scheduling API writes relational records and real delayed BullMQ jobs.
- Duplicate/concurrent requests replay the same batch; changed payloads conflict.
- Foreign users cannot schedule with another user's sender or read their messages; sender responses omit credentials.
- **1,000 real recipient rows and delayed jobs** persist with exact initial offsets and no duplicate publication on replay. No SMTP delivery is requested by this burst test.
- Real API and worker subprocesses stop and restart with future jobs preserved; work runs no earlier than due; terminal records are not reprocessed. This test uses an invalid encrypted credential to verify pre-SMTP failure persistence without sending mail.
- A separate BullMQ producer/worker replacement executes a delayed test handler once and preserves its completed deterministic job ID.
- Redis sender leases allow one holder; atomic hourly admission caps competing calls; repeated reservations, cross-connection delay, UTC-window deferral and Slack outbox deduplication work.
- Exhausted worker jobs remain scheduled, move to the next UTC hour and consume zero SMTP attempts and zero retry attempts.
- Missing queue jobs recover from database state; SENT rows are not recreated.
- Real Elasticsearch indexes content, enforces tenant/status scope and rejects stale external versions. Star/archive/trash changes increment database search versions and update searchable mailbox state.
- SMTP unit tests verify stable Message-ID, encrypted sender credentials, plain/rich body formats, persisted attachments, rejected recipients and transport cleanup. A lost lease after attachment loading prevents the SMTP handoff.
- OAuth tests cover state/session ownership, expiry, exact callback binding, bot-token encryption, missing scopes and safe provider error handling.

## Browser coverage

Six scenarios run at desktop and mobile sizes: Google entry point; profile and logout; scheduled/sent rows and details; CSV parsing/deduplication plus scheduling time/pacing/idempotency/CSRF headers; loading/empty/service error states; Slack connection setup; viewport checks are included in mailbox and compose scenarios. Screenshots and traces are written into ignored `test-results/`.

Browser fixtures are installed only in the Playwright test context. No test login or authentication bypass is present in production routes.

## Reproduce

```sh
npm ci
npm run db:generate
npm run verify
npx playwright install chromium
npm run test:e2e
npm run test:integration
```

The integration command requires Docker's Linux engine. It starts an isolated stack, migrates the test database, runs tests sequentially and removes only its test containers. Do not run old manual test commands against application queues.

For an already running dedicated test stack, supply `DATABASE_TEST_URL`, `REDIS_TEST_PORT`, and `ELASTICSEARCH_TEST_URL`, then run `npm run test:integration -- --external`. The database name must end in `_test`.

## Remaining live evidence

- Complete Google consent/login in the browser using an account allowed by the configured OAuth client.
- Schedule a real email through the authenticated dashboard, verify Ethereal acceptance/preview and show a successful-send restart scenario.
- Complete Slack OAuth, invite the bot to the chosen channel, and show a real rate-limit notification plus disconnect/reconnect. Current Slack documentation requires an HTTPS callback; configure the tunnel and provider app as described in `docs/SETUP.md`.
- Redis container/AOF restart and an actual Elasticsearch outage/recovery demonstration have not been exercised in this run. API/worker restart and real indexing were tested.
- Sustained SMTP throughput and the SMTP acceptance/database-commit ambiguity window are not proven by unit/integration tests. Exactly-once SMTP delivery is not guaranteed.
- Record the required five-minute live demo and complete the deferred private GitHub/reviewer access steps.

See `docs/ASSIGNMENT-CHECKLIST.md`, `docs/SETUP.md` and `docs/DEMO.md` for the remaining submission steps.
