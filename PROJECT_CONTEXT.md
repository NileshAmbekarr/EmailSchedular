# Project Context — Dispatch (Email Scheduler)

> Living reference for anyone working in this repo: what exists, how it is wired,
> and the conventions in use. User-facing setup lives in [README.md](README.md);
> the review that produced this architecture is [ASSESSMENT.md](ASSESSMENT.md).

---

## 1. What this is

A bulk email **scheduling and delivery** platform. A user composes one message,
attaches a recipient list, picks a time, and the system delivers personalised
copies — throttled per sender, spread across hours, surviving restarts, and
handling unsubscribes, bounces and complaints without manual intervention.

Two deployables plus an optional third:

| App | Path | Entry | Deploy |
|---|---|---|---|
| API | `backend/` | `src/index.ts` | Render / container |
| Worker | `backend/` | `src/worker.ts` | separate service (recommended) |
| Dashboard | `frontend/` | Next.js App Router | Vercel |

Managed dependencies: PostgreSQL (Supabase), Redis (Upstash), and one email
provider (Resend, SES, SMTP, or Ethereal for development).

---

## 2. Runtime architecture

```
Browser (Next.js)
    │  axios, httpOnly session cookie (withCredentials)
    ▼
Express API ──┬──► Postgres   campaigns, emails, events, suppressions, domains
              └──► Redis      BullMQ delayed jobs + rate-limit counters
                       │
                       ▼
                    Worker    claim → suppression → rate limit → render → send
                       │
                       └──► Provider ──► webhooks ──► email_events
```

**Postgres is the source of truth; Redis is a scheduling index.** Every guarantee
in the system falls out of that split — see §6.

Two queues:

- **`email-queue`** — one job per recipient. `jobId` is *always* the email row's
  uuid. Nothing may enqueue a send under any other id.
- **`campaign-queue`** — `fanout` jobs that page a campaign's rows into the send
  queue, plus a delayed `finalize` job that marks it complete.

---

## 3. Data model

[`backend/src/db/schema.ts`](backend/src/db/schema.ts) — 12 tables.

| Table | Purpose |
|---|---|
| `users` | account, IANA `timezone`, company name + postal address (footer), `tokens_valid_from` for revocation |
| `domains` | sending domain, DKIM keypair (private key encrypted), SPF/DKIM/DMARC verification state |
| `senders` | sending identity; `smtp_pass_encrypted` (AES-256-GCM), per-sender hourly/daily caps, warmup |
| `templates` | reusable subject + body, cached `variables` |
| `contact_lists` / `contacts` | persistent audiences; `fields` jsonb becomes merge data |
| `campaigns` | the batch: content stored **once**, schedule, throttle, tracking flags, denormalised counters |
| `emails` | one row per recipient: `merge_data`, `scheduled_at`, `status`, `attempt_count`, `provider_message_id` |
| `email_events` | append-only delivery timeline, unique on `provider_event_id` (webhook dedup) |
| `suppressions` | unique on `(user_id, email)` — never contact again |
| `api_keys` | SHA-256 hash + display prefix; plaintext shown once |
| `idempotency_keys` | request hash + stored response, 24h TTL |

`email_status`: `pending → queued → processing → retrying → sent → delivered`,
plus `bounced`, `failed`, `cancelled`, `suppressed`.

Indexes that matter: `emails(user_id, status, scheduled_at)` (dashboard),
`emails(status, scheduled_at)` (recovery scan),
`emails(provider_message_id)` (webhook lookup).

**Migrations** are generated and committed to `backend/drizzle/`. CI regenerates
and fails if the working tree changes. `db:push` is for scratch databases only.

---

## 4. Backend layout

```
backend/src/
├── app.ts                 express app factory (helmet, CORS allowlist, pino-http, /health, /ready)
├── index.ts               API server + graceful shutdown
├── worker.ts              standalone worker process
├── config/
│   ├── env.ts             zod-validated env, exits on invalid
│   ├── logger.ts          pino, with credential redaction
│   ├── database.ts        drizzle + postgres-js, ipv4first for Supabase/Render
│   └── redis.ts           ioredis + BullMQ connection options
├── db/{schema.ts,migrate.ts}
├── providers/             EmailProvider interface + smtp/resend/ses drivers + bounded cache
├── queues/
│   ├── queues.ts          queue definitions, MAX_SEND_ATTEMPTS
│   ├── emailWorker.ts     the send state machine
│   └── campaignWorker.ts  fan-out + finalize + due-campaign sweeper
├── services/
│   ├── campaignService.ts create, cancel, pause, resume, reschedule, reads, stats
│   ├── rateLimitService.ts atomic Lua reservation, UTC windows, warmup, schedule spreading
│   ├── recoveryService.ts orphan recovery + periodic sweeper
│   ├── suppressionService.ts Redis-cached lookups, soft-bounce thresholds
│   ├── complianceService.ts signed links, List-Unsubscribe headers, footer, tracking
│   ├── templateService.ts merge tags, sanitisation, html→text, spam linting
│   ├── webhookService.ts  signature verification, event normalisation, reputation guards
│   ├── domainService.ts   DKIM generation, DNS record building, live verification
│   ├── cryptoService.ts   AES-256-GCM, HMAC link tokens, API key + DKIM generation
│   └── timezoneService.ts IANA validation, wall-clock shifting, business hours
├── middleware/            auth (JWT + API key), validate (zod), idempotency, rateLimit, errorHandler
├── controllers/           auth, campaign, resource, public
└── routes/index.ts        every route, mounted in one place
```

---

## 5. The send path

[`queues/emailWorker.ts`](backend/src/queues/emailWorker.ts), in order:

1. **Load** the row with sender, campaign and user in one query.
2. **Short-circuit** on a terminal status, or a cancelled/paused campaign.
3. **Suppression check** — at send time, not schedule time.
4. **Reserve a rate-limit slot** (atomic Lua). If refused,
   `job.moveToDelayed(resetAt, token)` + `throw new DelayedError()` — same job id.
5. **Claim** the row: `UPDATE … WHERE id = ? AND status IN (pending, queued,
   retrying)`. No row returned means someone else owns it; exit without sending.
   **This is the exactly-once mechanism.**
6. **Render** — merge tags (HTML-escaped), sanitise, append tracking + compliance
   footer, build `List-Unsubscribe` headers.
7. **Send** through the sender's provider.
8. **Record** — status, `provider_message_id`, an `email_events` row, campaign
   counter.
9. **On failure** — permanent (`ProviderError.permanent`) suppresses the
   recipient and throws `UnrecoverableError`; transient releases the reserved
   slot and marks `retrying`, or `failed` on the final attempt.

---

## 6. Invariants — do not break these

1. **`jobId === emails.id`, always.** Nothing may enqueue a send under a derived
   or timestamped id. Deferral uses `moveToDelayed`, never a re-add.
2. **The conditional claim in step 5 is the only thing standing between a
   duplicated job and a duplicated email.** Never replace it with a read-then-write.
3. **Rate limiting is one Lua call.** Splitting the read from the increment
   reintroduces the race it exists to prevent.
4. **All time windows are UTC** (`getUTCHours`, not `getHours`).
5. **Recovery must cover past-due and `processing` rows**, not only future ones.
6. **Suppression is checked in the worker**, because a campaign can outlive an
   opt-out by days.
7. **Credentials are encrypted at rest** and never returned by any endpoint —
   `publicSender()` exists for exactly this reason.
8. **Every id-taking handler filters by `userId`** in the same query.

---

## 7. Frontend layout

```
frontend/src/
├── app/
│   ├── page.tsx + showcase.module.css   public showcase page
│   ├── login/page.tsx                   sign in / register
│   └── dashboard/
│       ├── layout.tsx                   sidebar shell + auth guard
│       ├── page.tsx                     overview: stats, daily chart, recent campaigns
│       ├── campaigns/{page,[id]/page}   list + detail with per-recipient table
│       ├── compose/page.tsx             composer: CSV merge data, preview, test send
│       ├── messages/{page,[id]/page}    message list + delivery timeline
│       ├── templates/page.tsx
│       ├── audiences/page.tsx
│       ├── suppressions/page.tsx
│       └── settings/page.tsx            profile, senders, domains, API keys
├── components/ui/index.tsx              badges, modal, pagination, formatters
├── hooks/useAuth.tsx                    cookie-based session
├── lib/api.ts                           typed axios client, ApiError, idempotency keys
└── types/index.ts
```

Styling: design tokens + dashboard system in `app/globals.css`; the showcase page
is isolated in a CSS module. Pages that show moving data poll on an interval
while something is in flight.

---

## 8. Auth

- Session **JWT in an httpOnly cookie**, `SameSite=None; Secure` in production so
  it survives the cross-site Vercel→Render setup. **No localStorage copy** — that
  would make the token XSS-readable and negate `httpOnly`.
- Claims are checked against `users.tokens_valid_from`, so `/logout-all` and a
  password reset actually revoke outstanding tokens.
- **API keys** via `X-API-Key`, stored as SHA-256.
- `express-rate-limit` with a Redis store: 10 auth attempts per 15 min keyed on
  IP + submitted email, 30 campaign creations per minute per user.

---

## 9. Configuration

Everything is validated in [`config/env.ts`](backend/src/config/env.ts); the
process exits on anything missing or malformed. Full annotated list in
[`backend/.env.example`](backend/.env.example). The ones with teeth:

| Var | Why it matters |
|---|---|
| `ENCRYPTION_KEY` | rotating it makes stored SMTP/DKIM credentials unreadable |
| `LINK_SECRET` | signs unsubscribe/tracking links; defaults to `JWT_SECRET` |
| `API_URL` | unsubscribe links are built from it — must be publicly reachable |
| `RUN_WORKER_IN_API` | `false` when the worker runs as its own service |
| `MAX_RECOVERY_LATENESS_MS` | past-due messages older than this are expired, not sent |
| `RESEND_WEBHOOK_SECRET` | required; unsigned webhooks are rejected |

---

## 10. Conventions

- TypeScript strict, ESM — **relative imports carry the `.js` extension**
  (`./config/env.js`) even though sources are `.ts`.
- `routes → controllers → services`. Controllers own HTTP shape and zod schemas;
  services own database and queue work. Responses are always
  `{ success, data?, error?, details?, pagination? }`.
- Handlers are wrapped in `asyncHandler`; errors become responses in exactly one
  place (`middleware/errorHandler.ts`).
- Structured logging only — `log('component')` returns a bound child logger.
  No `console.*` outside `config/env.ts` (which runs before the logger exists).
- Domain types are inferred from the Drizzle schema, never restated by hand.
- Tests: `backend/tests/*.test.ts`, vitest, 70 cases covering the rate limiter,
  templating, compliance/crypto and timezone logic.

---

## 11. Known gaps

- Provider webhooks are implemented for Resend and SES; SNS signature
  verification is not (the handler checks message shape, not the AWS signature).
- Password reset generates a token and logs the URL — no transactional email is
  actually sent, since that should not go through the campaign pipeline.
- No integration test spins up Postgres + Redis; the suite is unit-level.
- Follow-up sequences with reply detection (§Tier 2 in ASSESSMENT.md) are not
  built.
- Attachments are not supported — the UI control was removed rather than faked.
