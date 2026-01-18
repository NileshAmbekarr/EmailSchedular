# 📧 Email Scheduler - Full-Stack Application

A production-grade email scheduler service with dashboard, built for the ReachInbox hiring assignment.

## 🚀 Features

### Backend
- ✅ **BullMQ + Redis** for reliable job scheduling (no cron!)
- ✅ **PostgreSQL + Drizzle ORM** for persistent storage
- ✅ **Per-sender rate limiting** with Redis counters
- ✅ **Configurable concurrency** and delay between emails
- ✅ **Restart persistence** - jobs survive server restarts
- ✅ **Idempotency** - no duplicate emails sent
- ✅ **Ethereal SMTP** for testing email sends

### Frontend
- ✅ **Google OAuth** authentication
- ✅ **Email/Password** authentication
- ✅ **Dashboard** with Scheduled/Sent tabs
- ✅ **Compose Modal** with CSV upload
- ✅ **Premium dark theme** UI
- ✅ **Loading & empty states**
- ✅ **Toast notifications**

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | Express.js, TypeScript |
| Database | PostgreSQL, Drizzle ORM |
| Queue | BullMQ, Redis (Upstash) |
| SMTP | Nodemailer, Ethereal Email |
| Frontend | Next.js 14, TypeScript |
| Styling | CSS (ready for Tailwind) |
| Auth | Google OAuth, JWT |

---

## 📋 Prerequisites

- Node.js 18+
- npm or yarn
- PostgreSQL database (local or cloud like Neon/Supabase)
- Redis (Upstash recommended for cloud)
- Google Cloud Console project (for OAuth)

---

## ⚙️ Environment Setup

### 1. Backend Environment

Create `backend/.env`:

```env
# Database (PostgreSQL)
DATABASE_URL=postgresql://user:password@host:5432/email_scheduler

# Redis (Upstash)
UPSTASH_REDIS_URL=rediss://default:xxxxx@xxxxx.upstash.io:6379

# JWT Secret (min 32 chars)
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Rate Limiting
MAX_EMAILS_PER_HOUR_PER_SENDER=200
DELAY_BETWEEN_EMAILS_MS=2000
WORKER_CONCURRENCY=5

# Ethereal (leave empty to auto-generate)
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

### 2. Frontend Environment

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
```

### 3. Upstash Redis Setup

1. Go to [upstash.com](https://upstash.com)
2. Create a free account
3. Create a new Redis database
4. Copy the connection URL (starts with `rediss://`)

### 4. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Enable "Google+ API"
4. Go to Credentials → Create OAuth 2.0 Client ID
5. Add authorized origins: `http://localhost:3000`
6. Add authorized redirect URIs: `http://localhost:3000`
7. Copy Client ID and Client Secret

---

## 🚀 Running the Application

### Backend

```bash
cd backend

# Install dependencies
npm install

# Push database schema
npm run db:push

# Start development server
npm run dev
```

The backend will start on `http://localhost:3001`

### Frontend

```bash
cd frontend

# Install dependencies  
npm install

# Start development server
npm run dev
```

The frontend will start on `http://localhost:3000`

---

## 📊 Architecture

### Scheduling Flow

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Frontend   │ ──▶  │  Express API │ ──▶  │  PostgreSQL  │
│  (Next.js)   │      │   /schedule  │      │  (emails)    │
└──────────────┘      └──────┬───────┘      └──────────────┘
                             │
                             ▼
                      ┌──────────────┐
                      │    BullMQ    │
                      │  (delayed    │
                      │    jobs)     │
                      └──────┬───────┘
                             │
                             ▼
                      ┌──────────────┐
                      │   Redis      │
                      │  (Upstash)   │
                      └──────┬───────┘
                             │
                             ▼
                      ┌──────────────┐
                      │   Worker     │
                      │ (processes   │
                      │  at time)    │
                      └──────┬───────┘
                             │
                             ▼
                      ┌──────────────┐
                      │  Ethereal    │
                      │   SMTP       │
                      └──────────────┘
```

### How Persistence Works

1. When emails are scheduled, they're stored in **PostgreSQL** with `status: 'queued'`
2. Corresponding **BullMQ jobs** are created with the correct delay
3. On server restart:
   - `recoverOrphanedJobs()` runs automatically
   - Queries all pending/queued emails from DB
   - Checks if BullMQ job exists for each
   - Recreates missing jobs with correct delay

### How Rate Limiting Works

1. Each sender has a **Redis counter** keyed by `ratelimit:{senderId}:{hourWindow}`
2. Before processing, worker checks if count < limit
3. If under limit: increment counter, process email
4. If at limit: reschedule job to next hour window
5. Counters auto-expire after 1 hour (Redis TTL)

**Configuration:**
- `MAX_EMAILS_PER_HOUR_PER_SENDER=200` - emails per sender per hour
- `DELAY_BETWEEN_EMAILS_MS=2000` - minimum 2 seconds between sends
- `WORKER_CONCURRENCY=5` - process up to 5 jobs concurrently

---

## 📁 Project Structure

```
EmailSchedular/
├── backend/
│   ├── src/
│   │   ├── config/         # Environment, DB, Redis
│   │   ├── controllers/    # Route handlers
│   │   ├── db/             # Drizzle schema
│   │   ├── middleware/     # Auth middleware
│   │   ├── queues/         # BullMQ queue & worker
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic
│   │   ├── types/          # TypeScript types
│   │   └── index.ts        # Entry point
│   ├── drizzle.config.ts
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── app/            # Next.js pages
│   │   ├── components/     # React components
│   │   ├── hooks/          # Custom hooks
│   │   ├── lib/            # API client
│   │   └── types/          # TypeScript types
│   └── package.json
│
└── README.md
```

---

## 🧪 API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/google` | Google OAuth login |
| POST | `/api/auth/register` | Email/password register |
| POST | `/api/auth/login` | Email/password login |
| GET | `/api/auth/me` | Get current user |
| POST | `/api/auth/logout` | Logout |

### Emails (Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/emails/schedule` | Schedule emails |
| GET | `/api/emails/scheduled` | Get scheduled emails |
| GET | `/api/emails/sent` | Get sent emails |
| GET | `/api/emails/senders` | Get user's senders |
| POST | `/api/emails/senders` | Create new sender |
| GET | `/api/emails/rate-limit/:senderId` | Get rate limit info |

---

## ✅ Features Checklist

### Backend
- [x] Email scheduling via BullMQ delayed jobs
- [x] PostgreSQL persistence with Drizzle ORM
- [x] Per-sender rate limiting (configurable)
- [x] Delay between emails (configurable)
- [x] Worker concurrency (configurable)
- [x] Restart recovery (orphaned job detection)
- [x] Idempotency (unique job IDs)
- [x] Google OAuth + Email/Password auth
- [x] Ethereal SMTP integration

### Frontend
- [x] Google OAuth login
- [x] Email/Password login
- [x] Dashboard with user info
- [x] Scheduled emails table
- [x] Sent emails table
- [x] Compose modal with CSV upload
- [x] Loading states
- [x] Empty states
- [x] Error handling with toasts
- [x] Premium dark theme

---

## 🔄 Testing Restart Persistence

1. Schedule some emails for 5+ minutes in the future
2. Stop the backend server (`Ctrl+C`)
3. Start the backend again (`npm run dev`)
4. Watch the console for "Recovery complete" message
5. Verify emails still send at the correct time

---

## 📝 Notes & Trade-offs

1. **Ethereal Email**: Auto-generates test SMTP accounts. Emails are captured (not really sent) and can be viewed via preview URLs.

2. **Rate Limiting**: Using Redis INCR with TTL for atomic counters. Safe across multiple workers.

3. **Job Rescheduling**: When rate limit is hit, jobs are rescheduled to the next hour window rather than being dropped.

4. **Sender Accounts**: Each user gets a default sender with Ethereal credentials on registration.

---

## 👤 Author

Built for the ReachInbox Full-Stack Developer hiring assignment.
