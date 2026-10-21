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

4. **Create the database indexes and your admin login.** Set `ADMIN_EMAIL` and `ADMIN_PASSWORD`
   (at least 8 characters) in `.env.local` first.

   ```bash
   npm run db:indexes
   npm run seed
   ```

   Both are safe to run again: they never change existing data.

5. **Run the app** (website + worker together)

   ```bash
   npm run dev:all
   ```

   Open http://localhost:3000 and log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
   Check http://localhost:3000/api/health — it should show `"db": "ok"`.

## Microsoft 365 setup

The app sends email through **Microsoft Graph** (Microsoft's official API) using an **app registration**:
a "robot login" for this app. No mailbox passwords are stored. A **Global Administrator** of your Microsoft 365
does this once (about 15 minutes).

### 1. Domains and mailboxes (Microsoft 365 admin center)

1. Go to https://admin.microsoft.com → **Settings → Domains → Add domain**, and follow the steps until the
   domain shows **Healthy**. Microsoft shows the DNS records to add (MX, SPF/TXT, autodiscover).
2. **DKIM:** go to https://security.microsoft.com → **Email & collaboration → Policies & rules → Threat policies →
   Email authentication settings → DKIM** → pick the domain → add the two CNAME records it shows → **Enable**.
3. **DMARC:** add a TXT record at `_dmarc.<your domain>` with `v=DMARC1; p=none; rua=mailto:<your email>`.
4. Create each sending mailbox: **Users → Active users → Add a user** (it needs an Exchange Online license).
5. In this app, add the domain on **Domains** and click **Re-check DNS** until SPF, DKIM, DMARC and MX are green.

### 2. App registration (Microsoft Entra admin center)

1. Go to https://entra.microsoft.com → **Applications → App registrations → New registration**.
   Name: `Outreach Engine`. Supported account types: **this organizational directory only**. No redirect URI.
   Click **Register**.
2. On the app's **Overview** page, copy the **Application (client) ID** and the **Directory (tenant) ID**.
3. **API permissions → Add a permission → Microsoft Graph → Application permissions**:
   - `Mail.Send` (required to send), unless you use the safer option in step 4 below
   - `User.Read.All` (optional, read-only: lets the app check that a mailbox exists)

   Then click **Grant admin consent for <your company>**. The status must show green ticks.

4. **Certificates & secrets → Client secrets → New client secret** → choose an expiry (e.g. 12 months) →
   **Add**. Copy the **Value** column right away (it is shown only once). **Write down the expiry date**:
   when the secret expires, sending stops until you create a new one and paste it in the app.

### 3. Connect it in this app

**Providers → Add Microsoft 365 connection** → paste the tenant ID, client ID and secret value → save.
The app verifies with Microsoft automatically. **Connected** means Microsoft gave the app a token.
Then add your mailboxes on **Inboxes** and use **Send test email**.

### 4. Strongly recommended: let the app send ONLY from your sending mailboxes

With `Mail.Send` granted in Entra, the app is allowed to send as **any** mailbox in your company. Limit it.
Run these in **PowerShell** as an Exchange admin. Replace the values in `<...>`.

**One-time: install and connect**

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Connect-ExchangeOnline -UserPrincipalName <admin@yourcompany.com>
```

**Option A (recommended): RBAC for Applications**

The **Enterprise application Object ID** is in Entra → **Applications → Enterprise applications** →
Outreach Engine → **Object ID**. It is different from the app registration's Object ID.

```powershell
# 1. Register the app in Exchange
New-ServicePrincipal -AppId <client-id> -ObjectId <enterprise-app-object-id> -DisplayName "Outreach Engine"

# 2. Tag every sending mailbox (repeat for each one)
Set-Mailbox -Identity sales@tryracko.in -CustomAttribute1 "outreach-sender"

# 3. A scope that only contains the tagged mailboxes
New-ManagementScope -Name "Outreach Sending Mailboxes" -RecipientRestrictionFilter "CustomAttribute1 -eq 'outreach-sender'"

# 4. Allow the app to send only inside that scope
New-ManagementRoleAssignment -App <client-id> -Role "Application Mail.Send" -CustomResourceScope "Outreach Sending Mailboxes"

# 5. Check: True for a sending mailbox, False for anyone else
Test-ServicePrincipalAuthorization -Identity <client-id> -Resource sales@tryracko.in
Test-ServicePrincipalAuthorization -Identity <client-id> -Resource ceo@yourcompany.com
```

Then go back to Entra → the app → **API permissions** and **remove `Mail.Send`** (Revoke admin consent →
Remove permission). Permissions granted in Entra are added on top of RBAC, so if you leave `Mail.Send` there,
the app can still send as everyone. Keep `User.Read.All` if you added it. Changes can take up to 2 hours to apply.

**Option B (older method): Application access policy** (keeps `Mail.Send` in Entra)

```powershell
# 1. A security group with the sending mailboxes
New-DistributionGroup -Name "Outreach Senders" -Alias outreach-senders -Type Security
Add-DistributionGroupMember -Identity "Outreach Senders" -Member sales@tryracko.in

# 2. Restrict the app to that group
New-ApplicationAccessPolicy -AppId <client-id> -PolicyScopeGroupId outreach-senders -AccessRight RestrictAccess -Description "Outreach Engine: sending mailboxes only"

# 3. Check: Granted for a sending mailbox, Denied for anyone else
Test-ApplicationAccessPolicy -Identity sales@tryracko.in -AppId <client-id>
Test-ApplicationAccessPolicy -Identity ceo@yourcompany.com -AppId <client-id>
```

When you add a new sending mailbox later, tag it (Option A step 2) or add it to the group (Option B step 1).

### Dry run vs. real sending

> While `DRY_RUN=true`, test emails are only simulated (written to the server log as `[DRY RUN] not really sent`).
> To send for real: set `DRY_RUN=false` **and** `SENDING_ENABLED=true` in `.env.local` and restart the app.
> **Verify** works in both modes: it only asks Microsoft for a token and never sends email.

## The worker (the background sender)

`npm run worker` runs three repeating jobs in one separate process:

| Job      | Every | What it does                                                                       |
| -------- | ----- | ---------------------------------------------------------------------------------- |
| Planner  | 30 s  | For each running campaign, picks the next email for each inbox and gives it a time |
| Sender   | 10 s  | Sends the emails whose time has come (different inboxes at the same time)          |
| Recovery | 60 s  | Marks emails stuck in `sending` (worker crashed) as `failed / UNKNOWN_STATE`       |

- **Only one worker can run.** It holds a lock in the database (renewed every tick). A second `npm run worker`
  prints "another worker is already running" and exits. After a crash the lock frees itself within 90 seconds.
- `GET /api/health` shows `workerRunning: true` while the worker's heartbeat is younger than 90 seconds.
- **Kill switch:** with `DRY_RUN=false` and `SENDING_ENABLED=false` the worker plans and sends nothing.
  `.env.local` is read when the worker starts, so restart it after changing it.
- Stop it with Ctrl+C: it finishes the email being sent, frees the lock and exits.
- An email stuck in `sending` is **never** sent again automatically (we cannot know if it left).
  Check the inbox's Sent folder, then handle it by hand.
- After updating, run `npm run db:indexes` once (a new index guarantees one email in flight per inbox).

### Simulation

`npm run simulate` (about 13 minutes) runs the real worker in dry-run mode against a **separate database
called `outreach_sim`** (your real data is never touched) and prints a report: emails sent per inbox, maximum
emails in flight per inbox, the smallest gap between sends, sends outside the window and duplicates.
It also tests pausing a campaign, killing the worker in the middle of a send, and starting a second worker.
Run one part only with `npm run simulate -- main|window|pause|crash`.

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
| `npm run seed`         | Create the admin user + settings (safe to repeat)           |
| `npm run db:indexes`   | Make MongoDB indexes match the models (safe to repeat)      |
| `npm run simulate`     | Dry-run simulation of the worker in a separate database     |
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
