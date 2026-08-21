# Email Scheduler — Assessment & Enhancement Report

Reviewed at commit `c8474c3`. Companion doc: [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md).

> **Status: acted on.** Tier 0 and Tier 1 have been implemented, along with most
> of Tier 2 (campaigns, templates with merge tags, audiences, domain
> verification, analytics, test sends). This document is kept as the record of
> what was wrong and why the current architecture looks the way it does — the
> findings below describe the **old** code, not what ships now.
>
> Still open: follow-up sequences with reply detection, A/B subject testing,
> multi-tenant teams, inbox rotation, and integration tests against real
> Postgres/Redis. See §11 of PROJECT_CONTEXT.md.

---

## Executive summary

The skeleton is genuinely good. Queue-based scheduling with BullMQ delayed jobs,
Postgres as source of truth, Redis rate-limit counters, a restart-recovery pass, typed
end-to-end — that is the right shape for this problem, and most assignment-grade
projects don't get that far.

What separates it from something real is not architecture, it's **the guarantees**. The
three properties the README advertises — restart persistence, idempotency, atomic rate
limiting — each hold in the happy path and break in a specific, reachable case. Fixing
those is a few days of work and it is the highest-leverage thing you can do, because
everything else you'd build sits on top of them.

Beyond that, the honest gap is that this is a **scheduler**, not an **email product**.
It sends to Ethereal, so nothing arrives; there's no unsubscribe link, no bounce
handling, no suppression list, no domain authentication. Any of those missing makes it
unusable for real sending regardless of how good the queue is — the first two are legal
requirements, the second two are why mail lands in spam.

**Current state:** solid portfolio project, strong interview story.
**To be real-world usable:** ~1 week for correctness + a real ESP; ~3–4 weeks for a
product someone would actually run a campaign on.

Scorecard (1–5):

| Dimension | | Comment |
|---|---|---|
| Architecture & tech choices | 4 | Right primitives, right reasons |
| Correctness under failure | 2 | Duplicate-send and lost-email paths exist |
| Security | 2 | IDOR, no auth rate limiting, plaintext SMTP creds, token in localStorage |
| Scalability | 2 | O(n) round-trips per send, unpaginated reads, no indexes, worker in API process |
| Real-world email readiness | 1 | Fake SMTP, no unsubscribe/bounces/suppression/DKIM |
| Product depth | 2 | No cancel, no templates, no campaigns, no analytics |
| Operability | 1 | No tests, no CI, no migrations, no metrics, no graceful shutdown |
| Frontend | 3 | Clean and complete-looking, but several controls are decorative |

---

## Part 1 — Correctness defects

These are ordered by how badly they'd hurt in production.

### C1. Duplicate sends via the rate-limit reschedule path — **critical**

[`emailWorker.ts:30`](backend/src/queues/emailWorker.ts:30)

```ts
await emailQueue.add('send-email', job.data, {
    delay: delayMs,
    jobId: `${emailId}-retry-${Date.now()}`,   // ← no longer the email's uuid
});
```

Idempotency in this system is "the BullMQ job id **is** the email's uuid." This line
abandons that. Two consequences, both reachable:

1. The `Date.now()` suffix makes every reschedule unique, so nothing dedupes them. If a
   sender sits at its limit across two hour boundaries, multiple retry jobs for the same
   `emailId` can coexist and each will send.
2. Worse, the reschedule leaves **no live job under `email.id`** while the DB row is set
   back to `pending`. If the process restarts in that window, `recoverOrphanedJobs()`
   looks up `emailQueue.getJob(email.id)`, finds nothing, and enqueues a *second* job.
   Now the retry job and the recovered job both fire. **The recipient gets the email
   twice.**

Fix: keep the id stable — `job.moveToDelayed(resetAt)` (BullMQ's built-in rate-limit
mechanism) or `jobId: emailId` on a re-add after removing the original. Never encode a
timestamp into a job id you rely on for dedup.

### C2. Emails scheduled during downtime are silently dropped — **critical**

[`emailService.ts:132`](backend/src/services/emailService.ts:132)

```ts
gte(emails.scheduledAt, new Date())   // "Only future emails"
```

Recovery ignores anything whose send time already passed. Deploy at 14:00, come back at
14:03, and every email scheduled for 14:01 is stranded as `queued` forever — no send, no
error, no dashboard signal. This is precisely the failure restart-persistence is
supposed to prevent.

Also uncovered: rows left in `processing` when the process died mid-send. The recovery
filter only matches `pending`/`queued`, so those are orphaned permanently.

Fix: recover past-due rows with `delay: 0` (they're late, send them or mark them
expired per policy) and add `processing` rows older than a visibility timeout to the
recovery set.

### C3. Rate limit is not atomic and can be exceeded — **high**

[`rateLimitService.ts:27`](backend/src/services/rateLimitService.ts:27) and
[`emailWorker.ts:22`](backend/src/queues/emailWorker.ts:22)

The code does `GET` → decide → `INCR` as three separate operations. With
`WORKER_CONCURRENCY=5` (and more once you run multiple replicas), five workers can all
read `199` and all proceed. `INCR` *is* atomic; **check-then-act around it is not**.
The README and `interview_guide.md` both claim this is race-free — it isn't, and that's
an easy question to get caught on in an interview.

Fix: `INCR` first, compare the returned value, and if it's over the limit
`DECR`/reschedule — or do the whole thing in one Lua script (also lets you set TTL and
counter in a single round trip).

### C4. Hour windows use server local time — **high**

`getHourWindow()` builds its key from `getFullYear/getMonth/getDate/getHours`, and
`resetAt` is computed with local `setHours`. Change the container's `TZ`, or run
replicas in different regions, and workers disagree about which bucket they're in —
during a DST shift you get a doubled or skipped hour. Users also pick times in *their*
browser's timezone with no timezone shown anywhere.

Fix: UTC everywhere internally (`getUTCHours`), store an IANA timezone per user, and
render/schedule against it explicitly.

### C5. A row is marked `failed` before BullMQ has finished retrying — **medium**

[`emailWorker.ts:81`](backend/src/queues/emailWorker.ts:81) sets `status: 'failed'` in
the `catch`, then re-throws so BullMQ retries (`attempts: 3`). So a transient SMTP blip
makes the email vanish from the Scheduled tab and appear as failed in Sent — then
silently succeed two minutes later. Users watching the dashboard see a lie.

Fix: on catch, record `error_message` and an attempt counter but keep the status as
`retrying`; only write `failed` from the worker's `failed` event when
`job.attemptsMade >= job.opts.attempts`.

### C6. `POST /schedule` is not idempotent at the API boundary — **medium**

Every call inserts brand-new rows with brand-new uuids, so the job-id dedup can never
trigger. A double-click, an axios retry, or a proxy replay schedules the whole batch
twice. Additionally, BullMQ only dedupes while the job still *exists*, and
`removeOnComplete` clears it — so the guarantee is time-boxed even in the ideal case.

Fix: accept an `Idempotency-Key` header, store it unique-constrained, and return the
original response on replay.

### C7. No graceful shutdown — **medium**

`index.ts` never handles `SIGTERM`/`SIGINT` and never closes the worker, queue, Redis,
or Postgres clients. Render sends SIGTERM on every deploy; in-flight sends are killed
mid-flight, leaving `processing` rows that C2 then fails to recover. This trio (C1+C2+C7)
is how you get both duplicates *and* losses from a single routine deploy.

### C8. IDOR on the rate-limit endpoint — **medium**

[`emailController.ts:188`](backend/src/controllers/emailController.ts:188) reads
`req.params.senderId` and never checks it belongs to `req.user`. Any authenticated user
can enumerate any sender's send volume. Low blast radius today, but it's the exact class
of bug that becomes serious the moment senders carry real identities. Every handler
taking an id should filter by `userId` in the same query.

### C9. `calculateScheduledTime` uses the wrong counter — **low/medium**

It reads the **current** hour's Redis count to place emails scheduled for a **future**
hour. For a send scheduled tomorrow, that number is meaningless. The spread logic also
recomputes per recipient inside the loop, adding a Redis round-trip per recipient.

Fix: compute the spread arithmetically from the batch itself; enforce the real limit at
send time in the worker (which is where it's authoritative anyway).

### C10. Broken/misleading tooling

- `db:generate` / `db:migrate` use drizzle-kit ≥0.21 command names against the installed
  **0.20.18**, which expects `generate:pg` / `up:pg`. They don't work.
- `drizzle.config.ts` points `out` at `src/db/migrations`, which doesn't exist — the
  schema has only ever been applied with `db:push`, meaning **there is no migration
  history for the production database**. The first schema change against real data is
  going to hurt.

---

## Part 2 — What's needed to be usable in the real world

This is the section that answers "what would make this actually useful". Roughly in the
order it should be built.

### 2.1 Send real email (the unavoidable prerequisite)

Ethereal is a sink; nothing arrives. Swap `smtpService.ts` for a provider abstraction
(`EmailProvider` interface) with an **Amazon SES** or **Resend** implementation, keeping
Ethereal as the dev/test driver. Prefer the provider's HTTP API over SMTP — faster, no
blocked ports, and it returns a real `messageId` you can correlate webhooks against.

Then the things that make mail actually *land*:

- **Domain authentication** — SPF, DKIM, DMARC. Add a `domains` table with a
  verification flow (show users the DNS records, poll until they resolve). Unverified
  domains shouldn't be allowed to send. This is the single biggest deliverability lever.
- **Per-domain/per-provider throughput caps**, not just per-sender.
- **Warmup schedule** — ramp daily volume on a new domain instead of blasting 5,000 on
  day one, which is the fastest way to get blocklisted.

### 2.2 Compliance — non-negotiable for bulk email

Sending bulk commercial email without these is illegal in most jurisdictions
(CAN-SPAM, GDPR, CASL), and providers will suspend the account regardless.

- **Unsubscribe** — a signed one-click link injected into every outbound body, plus the
  `List-Unsubscribe` and `List-Unsubscribe-Post` headers.
- **Suppression list** — global per-account. Unsubscribes, hard bounces, and spam
  complaints go in; the worker checks it immediately before sending, not at schedule
  time.
- **Physical address / sender identity** in the footer.
- **Consent tracking** — where each recipient came from and when.
- **Data deletion / export** endpoints for GDPR requests.

### 2.3 Feedback loop — bounces, complaints, engagement

Right now "sent" means "handed to SMTP", which tells you nothing. Add:

- **Webhook receiver** (`POST /api/webhooks/:provider`, signature-verified) for
  delivered / bounced / complained / opened / clicked.
- An **`email_events`** table (append-only) keyed by provider message id, with the
  `emails` row carrying a denormalized latest status.
- **Hard vs soft bounce** handling: hard → suppress permanently; soft → retry with
  backoff, suppress after N.
- **Complaint rate monitoring** with an automatic pause when it crosses ~0.1%.

### 2.4 Product features people expect from a scheduler

- **Cancel / reschedule / edit** a queued email or a whole batch. Its absence is the
  most obvious functional hole — you currently cannot un-send a mistake, and the API has
  no `DELETE` or `PATCH` at all.
- **Campaigns.** Introduce a `campaigns` table; `emails` becomes its recipients. This
  fixes the data model (the body is currently duplicated into every row), and unlocks
  per-campaign stats, pause/resume, and throttle.
- **Templates + merge tags** — `{{first_name}}`. Today the CSV parser
  (`compose/page.tsx`) throws away every column that isn't an email address, so
  personalization is impossible. Parse headers, map columns to variables, show a live
  preview with sample data.
- **Timezone-aware scheduling** — "9am in each recipient's timezone", plus a business-
  hours-only option.
- **Recipient lists / segments** that persist between campaigns instead of re-uploading
  a CSV each time.
- **Test send** to yourself before scheduling to 5,000 people.
- **Follow-up sequences** with reply detection (IMAP or provider inbound webhooks) —
  "send step 2 in 3 days unless they replied". This is the feature that turns a scheduler
  into a cold-outreach tool, and it's what a company like ReachInbox actually sells.
- **Attachments** — the UI already collects them and silently drops them. Either
  implement (S3/R2 upload + reference in the job payload) or remove the control.
- **Honour the per-campaign delay/hourly-limit inputs** that already exist in the
  compose UI and in `ScheduleEmailRequest` but are ignored by the service.

### 2.5 Scale and performance

- **Bulk-insert recipients** in one statement inside a transaction, and use
  `queue.addBulk()`. The current 3 round-trips × N recipients means a 10k send is 30k
  sequential network calls — it will time out long before it finishes. Better still:
  insert rows synchronously, return 202, and let a **fan-out job** enqueue the sends.
- **Pagination + filters** on `/scheduled` and `/sent`. They currently return every row
  a user has ever created.
- **Indexes**: `emails(user_id, status, scheduled_at)`, `emails(sender_id, status)`,
  `emails(bullmq_job_id)`. There are none today beyond keys.
- **Split the worker out of the API process** (`src/worker.ts`, separate Render service).
  Right now scaling the API multiplies your workers — and since BullMQ's `limiter` is
  per-worker, two API replicas silently double your intended global send rate.
- **Archive/partition** old email rows; this table grows by one row per recipient
  forever.
- **Connection pooling** on Nodemailer (`pool: true, maxConnections`), and bound the
  unbounded `transporterCache` Map in `smtpService.ts` with an LRU.
- **Live dashboard updates** — SSE or polling; today status changes are invisible until
  a manual refresh.

### 2.6 Security hardening

- **Encrypt SMTP credentials at rest.** `senders.smtp_pass` is plaintext. Fine for
  throwaway Ethereal accounts, unacceptable the moment they're real provider or customer
  credentials. Use envelope encryption (KMS) or prefer OAuth tokens.
- **Rate-limit `/api/auth/login` and `/register`** (`express-rate-limit` + Redis store).
  There is currently nothing between an attacker and unlimited credential stuffing.
- **Pick one token transport.** Storing the JWT in `localStorage` *and* an httpOnly
  cookie gives you the weaknesses of both — the httpOnly protection is worthless once
  the same token is XSS-readable. Recommendation: httpOnly cookie with
  `sameSite: 'none'; secure: true` for the cross-site Vercel→Render setup (the current
  `lax` cookie isn't even being sent), refresh-token rotation, and a server-side
  denylist so logout actually revokes.
- **Validate input with zod at the boundary.** It's already a dependency but only used
  for env parsing. Recipient addresses are accepted if they merely contain `@` — invalid
  addresses go straight to the provider and hurt your sender reputation.
- **Sanitize HTML bodies** (DOMPurify server-side) before storing and before
  `dangerouslySetInnerHTML` in `email/[id]/page.tsx`. Self-XSS today; stored XSS the
  moment teams or shared templates exist.
- **Password policy**, email verification (the `email_verified` column exists and is
  never read), and password reset.
- **Per-user API quotas** so one account can't exhaust the shared worker pool.
- **CORS allowlist** rather than a single origin string, so preview deployments work.

### 2.7 Operability

- **Tests.** There are none. Priorities, in order: rate-limiter concurrency behaviour,
  recovery logic, the worker state machine, and the schedule endpoint. Vitest +
  Testcontainers (Postgres + Redis) will catch C1–C5 as regressions.
- **CI** — typecheck, lint, test on PR.
- **Real migrations** — generate them, commit them, run on deploy. `db:push` against a
  production database with real data is a footgun.
- **Structured logging** (pino) with request ids and job ids, so you can trace one email
  end to end. The emoji `console.log`s are unsearchable in aggregate.
- **Health check that actually checks** — `/health` returns static `ok` while Postgres or
  Redis is down, so Render keeps routing traffic to a broken instance. Add `/ready` that
  pings both.
- **Queue observability** — mount [Bull Board](https://github.com/felixmosh/bull-board)
  behind admin auth; expose queue depth, failure rate, and oldest-delayed-job as metrics.
- **Alerting** on DLQ growth and on complaint/bounce rate thresholds.
- **Dockerfile + docker-compose** for a one-command local stack (Postgres, Redis, API,
  worker, web).
- **Runbook** — what to do when the queue backs up, when a domain gets blocklisted, when
  the provider suspends the account.

---

## Part 3 — Prioritized plan

Impact × effort. "Effort" assumes one developer.

### Tier 0 — before anyone relies on it (~3–5 days)

| # | Item | Effort |
|---|---|---|
| 1 | Fix duplicate sends (C1) — stable job ids / `moveToDelayed` | 0.5d |
| 2 | Fix recovery to include past-due + stuck `processing` (C2) | 0.5d |
| 3 | Atomic rate limiting via Lua or INCR-then-check (C3) | 0.5d |
| 4 | Graceful shutdown: SIGTERM → drain worker, close connections (C7) | 0.5d |
| 5 | Status only becomes `failed` after final attempt (C5) | 0.5d |
| 6 | Ownership checks on every id-taking handler (C8) | 0.5d |
| 7 | zod validation + real email-format validation at the API boundary | 0.5d |
| 8 | Auth rate limiting | 0.25d |
| 9 | Tests covering 1–5 | 1d |

### Tier 1 — makes it genuinely usable (~1–2 weeks)

| # | Item | Effort |
|---|---|---|
| 10 | Real ESP behind a provider interface (SES/Resend), Ethereal in dev | 2d |
| 11 | Unsubscribe link + `List-Unsubscribe` + suppression list | 2d |
| 12 | Bounce/complaint webhooks + `email_events` table | 2d |
| 13 | Cancel / reschedule / delete endpoints + UI | 1d |
| 14 | Bulk insert + `addBulk` + pagination + indexes | 1.5d |
| 15 | Split worker into its own process/service | 0.5d |
| 16 | Committed migrations, Dockerfile, CI | 1d |
| 17 | Encrypt SMTP credentials at rest | 0.5d |
| 18 | UTC hour windows + per-user timezone | 1d |

### Tier 2 — turns it into a product (~2–4 weeks)

Campaigns model · templates with merge tags from CSV headers · recipient lists ·
domain verification with DNS checks · analytics dashboard (delivered/opened/clicked/
bounced) · test sends · follow-up sequences with reply detection · Bull Board + metrics ·
warmup scheduling.

### Tier 3 — differentiators

Multi-tenant teams with roles · public API with API keys and outbound webhooks ·
A/B subject testing · deliverability scoring and spam-word linting · inbox rotation
across multiple senders · AI-assisted copy and send-time optimization.

---

## Part 4 — Quick wins (each under an hour)

- Remove or implement the attachment button and the delay/hourly-limit inputs in
  `compose/page.tsx` — decorative controls read as bugs.
- Return `body` and `senderEmail` from `/api/emails/sent`, or add `GET /api/emails/:id`,
  so the preview page stops showing its placeholder branch and stops downloading the
  entire sent list to find one row.
- Make `/health` ping Postgres and Redis.
- Fix the `db:generate` / `db:migrate` scripts for drizzle-kit 0.20.
- Add a 404 handler.
- Align the README with reality: `frontend/.env` vs `.env.local`, and soften the
  restart-persistence / idempotency / atomicity claims until Tier 0 lands.
- Add a `.gitignore` at the repo root.
- Cap `transporterCache` in `smtpService.ts`.

---

## Part 5 — Note on the interview narrative

`interview_guide.md` describes the *intended* design, and it's well written — but three
of its headline claims are exactly the three defects above (idempotency via job ids,
zero-loss restart recovery, race-free atomic rate limiting). A sharp interviewer who
reads the code will find them.

Two ways to play it, both fine:

1. **Fix Tier 0 first**, then every claim is true and you can walk through the code.
2. **Get there first yourself.** "Here's the invariant I designed for, here's the one
   path that violates it, here's how I found it and how I'd fix it" is a *stronger*
   answer than a clean system — it demonstrates you can reason about distributed failure
   modes rather than just wire up a library.

The second framing is worth more than it sounds, and it costs nothing to prepare.
