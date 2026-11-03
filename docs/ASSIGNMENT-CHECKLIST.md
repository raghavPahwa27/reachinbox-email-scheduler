# Assignment coverage

Implementation and live verification are separate. See the current run record in [VERIFICATION.md](../VERIFICATION.md).

| Requirement | Implementation / evidence |
| --- | --- |
| TypeScript + Express + relational DB | Backend TypeScript; Express routes; PostgreSQL/Prisma schema and SQL migrations |
| Persistent scheduling without cron | BullMQ delayed jobs, deterministic job IDs, Redis AOF volumes; database recovery listener |
| Multiple Ethereal senders | Owned sender CRUD, encrypted SMTP credentials, Nodemailer transport, preview URLs |
| Idempotency and restarts | Unique batch keys/payload hashes, terminal-state checks, deterministic queue IDs, real subprocess restart integration test |
| Configurable concurrency | `WORKER_CONCURRENCY`; per-sender Redis leases across workers |
| Delay between emails | Redis-backed next-send time; global/sender/batch delay with conservative attempt spacing |
| Hourly cap and deferral | Atomic Redis Lua UTC counters; next-hour BullMQ delay; no discarded messages or consumed retries on deferral |
| Slack OAuth | Session-bound real OAuth flow; encrypted per-user bot token; connect/disconnect/reconnect controls |
| Live Slack rate-limit notification | Atomic outbox event published before SMTP; independent notification worker uses `chat.postMessage`; real delivery must be shown in the demo |
| Elasticsearch | Versioned indexing, tenant-scoped search, mailbox/status filters, durable dirty flags and recovery |
| Live BullMQ dashboard | `/admin/queues`, protected by login and `ADMIN_EMAILS` |
| Google OAuth and user details | Real OIDC flow with PKCE/state/nonce; name/email/avatar; logout |
| Compose and lead file | Subject, rich/plain body, CSV/text parsing/count/dedupe, start time, delay and hourly cap |
| Scheduled and Sent screens | Paginated owned messages, status/times, loading/empty/error states and message details |
| Figma styling | Supplied design inspected; white/green sidebar, rows and compose layouts; desktop/mobile screenshots from browser tests |
| Reusable typed frontend | Shared forms/dialogs/editor/API types; formatted TypeScript; composer loaded on demand |
| Tests | Unit/API tests, desktop/mobile browser tests, isolated PostgreSQL/Redis/Elasticsearch integration stack and CI |
| README / architecture / trade-offs | README plus setup, verification and demo documents; SMTP crash ambiguity explicitly documented |
| Private GitHub and reviewer access | Deferred by user. Later create private repo and invite `Mitrajit` and `Yadav036` |
| Five-minute demo video | Recording guide provided; final video still needs real authenticated flows and must be recorded before submission |

## Before submitting

1. Run all checks and review actual results in the verification record.
2. Complete Google login, real Ethereal acceptance/preview and live Slack notification.
3. Demonstrate pending jobs surviving an API/worker restart and SENT jobs staying terminal.
4. Record the five-minute demo, add its link, and complete the deferred private GitHub submission.
