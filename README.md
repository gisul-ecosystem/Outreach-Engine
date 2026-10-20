# Outreach Engine

A self-hosted cold email sender. Connect your own Microsoft 365 mailboxes, manage sending domains
and inboxes, import contacts, and let a background worker send campaigns one email at a time —
with random gaps, inside a sending window, under a daily limit per inbox.

- Full specification: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)
- What is built so far: [docs/PROGRESS.md](docs/PROGRESS.md)

> **Safety:** `DRY_RUN=true` is the default. In dry-run mode no real email is sent.
> Real sending only happens when `DRY_RUN=false` **and** `SENDING_ENABLED=true`.

## Requirements

- Node.js 20.9 or newer (developed on Node 24)
- Docker Desktop (runs MongoDB locally)

## Setup

1. **Install packages**

   ```bash
   npm install
   ```

2. **Start MongoDB** (in Docker, on port **27018** so it never clashes with a MongoDB installed on Windows)

   ```bash
   docker compose up -d
   ```

3. **Create `.env.local`** — copy `.env.example` to `.env.local`, then generate the two secrets:

   ```bash
   # JWT_SECRET
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   # ENCRYPTION_KEY
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Paste each output into `.env.local`. Never commit `.env.local` and never share these values.
   Keep a safe copy of `ENCRYPTION_KEY`: if it is lost, saved provider secrets cannot be decrypted.

4. **Run the app** (website + worker together)

   ```bash
   npm run dev:all
   ```

   Open http://localhost:3000. Check http://localhost:3000/api/health — it should show `"db": "ok"`.

## Scripts

| Command                | What it does                                                |
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev:all`      | Website and worker together (use this for daily work)       |
| `npm run dev`          | Website only (http://localhost:3000)                        |
| `npm run worker`       | Worker only (the background sender). Stop with Ctrl+C       |
| `npm run typecheck`    | TypeScript type check                                       |
| `npm run lint`         | ESLint (also blocks importing server code into client code) |
| `npm test`             | Unit tests (vitest)                                         |
| `npm run build`        | Production build                                            |
| `npm start`            | Run the production build (after `npm run build`)            |
| `npm run format`       | Format all files with Prettier                              |
| `docker compose up -d` | Start MongoDB · `docker compose down` stops it (data kept)  |

## Project layout

```
src/app/            pages (app) + (auth), API route handlers in src/app/api/**
src/components/     UI components (shadcn/ui in components/ui)
src/lib/client/     browser-only helpers
src/shared/         zod schemas, enums, types used by both UI and server
src/server/         server-only code: config, db, services, providers, scheduler
src/worker/         the worker process (npm run worker)
scripts/            seed / maintenance scripts (run with tsx)
tests/              vitest tests
```

In production two processes run: `npm start` (website + API) and `npm run worker` (the sender).
The worker is never started from inside Next.js.
