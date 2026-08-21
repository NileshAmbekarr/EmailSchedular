# Dispatch — Email Scheduling Platform

Queue-backed bulk email scheduling with per-sender rate limiting, exactly-once
delivery, restart recovery, and the deliverability machinery a real sender needs:
unsubscribe handling, suppression lists, bounce/complaint webhooks and domain
authentication.

| | |
|---|---|
| **API + worker** | Express, TypeScript (ESM), BullMQ, Drizzle ORM |
| **Dashboard** | Next.js 16 (App Router), React 19 |
| **Data** | PostgreSQL (source of truth), Redis (scheduling index + counters) |
| **Sending** | Resend · Amazon SES · your own SMTP · Ethereal (dev sandbox) |

---

## Quick start

### Docker (everything at once)

```bash
docker compose up --build
```

Postgres, Redis, the API (`:3001`) and a separate worker. Migrations run before
the API accepts traffic. Then start the dashboard:

```bash
cd frontend && npm install && npm run dev
```

### Local

```bash
cd backend && npm install && cp .env.example .env
```

Fill in `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` and `ENCRYPTION_KEY`, then:

```bash
npm run db:migrate && npm run dev
```

Generate the two secrets with:

```bash
openssl rand -hex 32
```

---

## Using it

There's an interactive guide at **`/dashboard/guide`** — a live checklist that reads
your account state and shows which steps you've actually completed, plus concept
explanations and troubleshooting. It's the first thing to open on a new account.

The short version:

1. **You already have a sender.** Every account gets a sandbox sender backed by
   Ethereal, which *captures* mail and returns a preview link instead of
   delivering it. Run the full pipeline today without owning a domain.
2. **Set your company name and postal address** (Settings → Profile). They go in
   the footer of every campaign, and a postal address is legally required in
   commercial email.
3. **Compose → Send test.** Delivers to one address immediately, bypassing the
   campaign pipeline — no rows, no analytics.
4. **Schedule a campaign.** Paste addresses, upload a CSV, or pick a saved
   audience. Any column named `email` is the address; every other column becomes
   a merge tag, so `email,first_name,company` lets you write
   `{{first_name|there}}` — the part after `|` is the fallback.
5. **Verify a domain before real mail.** Settings → Domains generates a DKIM
   keypair and shows four DNS records to publish. The sandbox sender never
   delivers to real inboxes.

Five nouns worth knowing: a **sender** is the from-address and the unit
throttling applies to; a **domain** proves you own it; an **audience** is a saved
contact list; a **template** is reusable content; a **campaign** is one send that
owns its recipients, schedule and stats. Pause, cancel and reschedule all operate
at the campaign level.

## Architecture

```
Dashboard ──► API ──┬──► Postgres   source of truth: campaigns, messages, events
                    └──► Redis      delayed jobs + rate-limit counters
                             │
                             ▼
                          Worker ──► claim ─► suppression ─► rate limit ─► provider
                             ▲                                                │
                             └──────────── webhooks ──────────────────────────┘
```

**Postgres decides, Redis schedules.** BullMQ moves a message to a worker at the
right moment, but the database row is what says whether it may send. Losing Redis
costs timing, never mail — the recovery pass rebuilds the queue from the database.

### The three guarantees

**Nothing sends twice.** The job id is always the message's uuid, and the worker
claims the row with a conditional update (`WHERE status IN (pending, queued,
retrying)`). A duplicated or recovered job loses that race and exits without
sending. Rate-limited jobs are deferred with `moveToDelayed`, which preserves the
job id rather than minting a new one.

**Nothing gets dropped.** On boot and every five minutes, `recoverOrphanedJobs()`
reclaims rows stuck in `processing` past the visibility timeout, re-enqueues
anything queued without a live job, and handles messages whose slot passed during
an outage — sending them late, or expiring them past `MAX_RECOVERY_LATENESS_MS`
rather than delivering something stale.

**Limits actually hold.** Read, compare and increment happen inside a single Lua
script, so concurrent workers cannot all observe the last free slot. Windows are
keyed in UTC, so replicas never disagree about the current hour and DST cannot
double or skip one.

---

## Deliverability

On by default, because none of it is optional in practice:

- **One-click unsubscribe** — `List-Unsubscribe` + `List-Unsubscribe-Post`
  headers and a visible footer link, signed per recipient.
- **Suppression list** — unsubscribes, hard bounces and complaints, checked
  immediately before every send (not at schedule time, since a campaign queued on
  Monday may still be sending on Wednesday).
- **Domain authentication** — generated DKIM keypair, SPF and DMARC records, live
  DNS verification. A sender cannot use a domain until it passes.
- **Reputation guards** — campaigns auto-pause above `MAX_COMPLAINT_RATE` (0.1%)
  or `MAX_BOUNCE_RATE` (5%).
- **Warmup** — a three-week daily ramp for new domains.
- **Content linting** — advisory spam-trigger, subject-length and image-ratio
  checks in the composer.

---

## API

Auth is a session cookie or `X-API-Key`. Mutating endpoints accept
`Idempotency-Key`.

| Method | Path | |
|---|---|---|
| POST | `/api/auth/register` · `/login` · `/google` | |
| GET/PATCH | `/api/auth/me` | profile |
| POST | `/api/auth/logout` · `/logout-all` | `logout-all` revokes every issued token |
| POST | `/api/campaigns` | create + schedule |
| GET | `/api/campaigns` · `/campaigns/:id` | paginated |
| POST | `/api/campaigns/:id/cancel` · `/pause` · `/resume` | |
| PATCH | `/api/campaigns/:id/schedule` | reschedule |
| GET | `/api/emails` · `/emails/:id` | filter by `bucket`, `campaignId` |
| POST | `/api/emails/:id/cancel` | |
| POST | `/api/preview` · `/api/test-send` | composer |
| GET | `/api/stats` · `/api/queue` | analytics, queue depth |
| CRUD | `/api/senders` · `/templates` · `/lists` · `/suppressions` · `/domains` · `/api-keys` | |
| GET/POST | `/api/public/unsubscribe/:token` | signed, no session |
| GET | `/api/public/open/:token` · `/click/:token` | tracking |
| POST | `/api/webhooks/resend` · `/ses` | signature-verified |
| GET | `/health` · `/ready` | `/ready` probes Postgres and Redis |

Example:

```bash
curl -X POST $API/api/campaigns -H "Content-Type: application/json" -H "X-API-Key: esk_live_..." -H "Idempotency-Key: 9f2c" -d '{"name":"March launch","senderId":"...","subject":"Hi {{first_name|there}}","body":"<p>Hello</p>","scheduledAt":"2026-08-01T09:00:00Z","timezone":"Asia/Kolkata","listId":"..."}'
```

---

## Scaling

Run the worker as its own service so sending and serving scale apart — otherwise
adding an API replica silently multiplies your send rate:

```bash
RUN_WORKER_IN_API=false npm start
```

```bash
npm run start:worker
```

Large campaigns are expanded by a paged fan-out job (`FANOUT_BATCH_SIZE`), so
scheduling 100k recipients returns immediately instead of holding a request open
for 300k round trips.

---

## Development

```bash
npm run dev
```

| Script | |
|---|---|
| `npm run dev` | API with an in-process worker |
| `npm run dev:worker` | worker only |
| `npm test` | 70 unit tests |
| `npm run typecheck` | |
| `npm run db:generate` | after changing `src/db/schema.ts` |
| `npm run db:migrate` | apply committed migrations |

Migrations live in `backend/drizzle/` and are committed. CI fails if the schema
changes without one. Do not use `db:push` against a database with real data.

---

## Deployment notes

- **Migrating an existing v1 database.** The v2 schema is a rewrite — campaigns,
  events, suppressions, domains and encrypted credentials are all new, and the
  `emails` table changed shape. `drizzle/0000_*.sql` assumes an empty database.
  For a dev database, drop the old tables and run `npm run db:migrate`. For one
  with data worth keeping, write a data migration first.
- **`API_URL` must be publicly reachable.** Unsubscribe and tracking links are
  built from it and opened from recipients' mail clients.
- **Cross-site cookies.** In production the session cookie is
  `SameSite=None; Secure`, which is what makes a Vercel dashboard work against a
  Render API. Both ends must be HTTPS.
- **Webhook secrets.** `RESEND_WEBHOOK_SECRET` is required — unsigned webhooks
  are rejected, since forged events could suppress an entire list.

---

## Documentation

- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) — architecture, data model, conventions
- [ASSESSMENT.md](ASSESSMENT.md) — the review this rewrite came from
