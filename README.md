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
- MongoDB Community Server 8, installed on this computer (no Docker needed)

## Setup

1. **Install packages**

   ```bash
   npm install
   ```

2. **Install and start MongoDB** on this computer

   - Download **MongoDB Community Server** from https://www.mongodb.com/try/download/community and install it
     with "Install MongoD as a Service" ticked. It then runs in the background on port **27017** and starts
     with Windows.
   - Check it is running (PowerShell): `Get-Service MongoDB` → `Running`.
     If it is `Stopped`, open PowerShell **as Administrator** and run `Start-Service MongoDB`.
   - Keep enough free space on the drive that holds MongoDB's data folder: when the disk is full, MongoDB
     stops itself. The folder is `dbPath` in `C:\Program Files\MongoDB\Server\8.0\bin\mongod.cfg`.

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
   - `Mail.Read` (recommended, read-only: lets the worker find bounce reports and replies in the sending
     inboxes, so bounced addresses and people who reply "no" are never emailed again, follow-ups skip
     people who replied, and a 5.7.708 bounce pauses the campaign; in Outlook format it also reads the
     Message-ID Microsoft gave each email from **Sent Items**, and finds the first email of a follow-up).
     Without it sending still works.

   Then click **Grant admin consent for <your company>**. The status must show green ticks.
   After adding a permission, press **Verify** on the app's Providers page: the app reads which permissions
   Microsoft granted and warns you (Providers page and campaign readiness list) when `Mail.Read` is missing.

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

### 5. Sending format: Outlook standard (default) or MIME

Each provider connection has a **Sending format** (Providers → Edit):

| Format                         | What happens                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Outlook standard** (default) | The app sends Microsoft only the subject, the HTML text and the recipient (JSON). **Microsoft builds the email** — Message-ID, Date, plain-text version — exactly like an email typed in Outlook. A follow-up is a real **reply** to the first email (same conversation, subject `RE: …`). |
| **Raw MIME** (the older way)   | The app builds the whole email itself (its own Message-ID, Reply-To, `List-Unsubscribe` header, text + HTML parts). A follow-up is a new email with `In-Reply-To` / `References` headers.                                                                                                  |

**Switch back to MIME:** Providers → ⋯ → Edit → Sending format → **Raw MIME** → Save. Then restart the worker
(`npm run worker` / `npm run dev:all`). Try a format without changing the setting:
`npm run email:test -- --campaign "<name>" --to you@gmail.com --format mime` (add `--send --yes` to send).

**Which permissions each part needs** (Application permissions, with admin consent):

| What                                                             | Permission                                                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Send an email (both formats)                                     | `Mail.Send`                                                                                                |
| Follow-up as a reply, when the first email's id is already known | `Mail.Send` only                                                                                           |
| Find the first email of a follow-up by its Message-ID            | `Mail.Read`                                                                                                |
| Read the Message-ID Microsoft gave an Outlook-format email       | `Mail.Read` (without it: the email is sent, the Message-ID stays empty and bounces are matched by address) |
| Bounces and replies                                              | `Mail.Read`                                                                                                |

`Mail.ReadWrite` is **not** needed: the app uses Graph's one-step `reply` action, not "create a draft reply,
then send it" (that way would need `Mail.ReadWrite`).

**The name people see ("From")**: in Outlook format Microsoft always uses the mailbox's own **display name from
Microsoft 365** — the app cannot change it. Set it in https://admin.microsoft.com → **Users → Active users →**
the user → **Manage contact information → Display name** (it can take a few hours to show everywhere).
The inbox's "Display name" field in this app is only used by the MIME format and the readiness checks; keep
both the same.

If the first email of a follow-up can't be found (deleted from Sent Items, or no `Mail.Read`), the follow-up is
sent as a new email with its own subject, and the activity log says so.

### Dry run vs. real sending

> While `DRY_RUN=true`, test emails are only simulated (written to the server log as
> `[DRY RUN] not really sent (Outlook format (JSON))` or `(MIME format)` — the format the connection uses).
> Nothing is sent in either format.
> To send for real: set `DRY_RUN=false` **and** `SENDING_ENABLED=true` in `.env.local` and restart the app.
> **Verify** works in both modes: it only asks Microsoft for a token and never sends email.

### Outlook readiness (while writing a campaign)

The campaign editor checks the email as you type (about half a second after you stop) and lists, in plain words,
what is missing or risky: ✅ OK, ⚠️ Warning (you can still start) and ⛔ Must fix (Start / Resume is blocked —
also by the server, so it can't be skipped). Many items have an **Add it** / **Use …** button that fixes the text,
or **Show me** that selects the problem in the editor. The review step and the campaign page also check the
inboxes, the domains' DNS, the `Mail.Read` permission and whether you sent yourself a test
(**Send test to myself**).

## The worker (the background sender)

`npm run worker` runs these repeating jobs in one separate process:

| Job        | Every | What it does                                                                                                         |
| ---------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| Planner    | 30 s  | For each running campaign, picks the next email for each inbox and gives it a time                                   |
| Sender     | 10 s  | Sends the emails whose time has come (different inboxes at the same time)                                            |
| Recovery   | 60 s  | Marks emails stuck in `sending` (worker crashed) as `failed / UNKNOWN_STATE`                                         |
| Mailbox    | 5 min | Bounces and replies for the engine's own emails (live mode only)                                                     |
| Sent Items | 5 min | Every email sent from each inbox (also typed by hand in Outlook), replies to them, tracking links in them. Read-only |

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

## Click tracking (who clicked the link in my hand-written email)

Every contact gets their own link, e.g. `https://go.racko.ai/r/k7f2Qa9xLm_3`. The random part (the
**token**) tells the engine whose link it is — it contains no name or email. When someone opens it, the engine
saves the click, judges whether a person or a security scanner opened it, and sends the browser on to racko.ai
in a fraction of a second.

### Settings (`.env.local`)

| Variable                 | Example                 | What it is                                                                                    |
| ------------------------ | ----------------------- | --------------------------------------------------------------------------------------------- |
| `TRACKING_BASE_URL`      | `https://go.racko.ai`   | Start of every link. `http://localhost:3000` while testing on this computer                   |
| `TRACKING_ALLOWED_HOSTS` | `racko.ai,www.racko.ai` | The ONLY sites a link may lead to (stops scammers using our links to send people elsewhere)   |
| `TRACKING_FALLBACK_URL`  | `https://racko.ai`      | Where unknown links — and any error — go. People never see an error page                      |
| `TRACKING_IP_SECRET`     | 32+ random characters   | Key that scrambles visitor IP addresses (HMAC). Raw IPs are never stored                      |
| `TRUST_PROXY`            | `false`                 | `true` only when the engine runs behind Nginx or Cloudflare                                   |
| `MAILBOX_READING`        | `true`                  | Reading Sent Items + replies (read-only, also in DRY_RUN). `npm run simulate` switches it off |

Make a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
Restart the website and the worker after changing `.env.local`.

### Putting a link into an email

1. **Contacts** → the link icon next to a person (or open the person → **Copy link**).
2. Leave the destination empty for the homepage, or type a path like `/pricing`. Choose the link words
   (default "take a look at Racko").
3. **Copy link**, then paste into your Outlook email: Outlook shows the words with the link behind them.
   (The copy holds two versions: a "rich" one for Outlook and the plain address for anything else.)
4. Copying again gives the **same** link. Tick "Make a new link" for a fresh one (the old one keeps working).

For a whole list: **Contacts → Lists → ⋯ → Download links (CSV)** (email, name, company, status, link).
Use each person's own link only in the email to that person. The engine finds the links in your Sent Items and
shows a red **Wrong link** warning when one person's link was pasted into an email to someone else (their clicks
would count for the wrong person).

### Real click vs. maybe a bot

Company email security (Microsoft Defender Safe Links, Mimecast, Proofpoint, Barracuda, Gmail) often opens every
link by itself seconds after the email arrives. So each click gets a verdict, with the reason in plain English:

- ✅ **Real click** — looks like a person.
- ⚠️ **Maybe a bot** — e.g. opened within 60 seconds of sending, opened 3+ times in 10 seconds, the same visitor
  opened several people's links, or the browser left out details real browsers always send.
- 🤖 **Bot** — a HEAD request (like `curl -I`), no browser name, a script, or a known scanner / link preview.
  The list of known scanners is `src/server/tracking/scanners.ts` (one line per scanner).

Some scanners pretend to be a normal browser, so a few may still show as real clicks. A click opened before the
engine knew when the email was sent is judged again once the email is found in Sent Items.
See them under **Sent emails → Link clicks**, on each person's timeline, and on the dashboard: "Real clicks this
week" and the **Clicks per person** table (real clicks and bot opens per person, this week or all time).
Clicks are kept for one year.

### Going live (needed before real people's clicks work)

While `TRACKING_BASE_URL` is `localhost`, links only open on this computer (the app shows a yellow banner).
For the people you email, the engine must be on the internet over HTTPS, 24/7:

- **Recommended:** a small VPS (e.g. Hetzner ~€4.5/month, DigitalOcean/Lightsail ~$6/month) with Nginx and a
  free Let's Encrypt certificate (Phase 8). Point `go.racko.ai` at it in the racko.ai DNS settings, then set
  `TRACKING_BASE_URL=https://go.racko.ai` and `TRUST_PROXY=true`.
- A Cloudflare Tunnel from this PC is quicker but links break whenever the PC is off or asleep.

## Docker

Local development stays as above (no Docker). Docker is for running the engine on a server.

- **Image:** GitHub Actions (`.github/workflows/docker.yml`) builds it and pushes it to Docker Hub as
  `gisul-docker/outreach-engine` on every push to `main` (tags `latest` and `sha-<commit>`) and on version
  tags `v1.2.3`. Pull requests only check that the image still builds. The workflow needs, under GitHub →
  Settings → Secrets and variables → Actions: secrets `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`
  (a Docker Hub access token with Read & Write), and optionally the variable `DOCKERHUB_NAMESPACE`
  (default `gisul-docker`).
- **One image, two jobs:** the website (`next start`, the default command) and the worker
  (`tsx src/worker/index.ts`).
- **`docker-compose.yml`** starts `mongo` (MongoDB 8, data kept in the `mongo-data` volume), a one-time
  `setup` step (`db:indexes` + `seed`), then `web` and `worker`. Settings come from `.env.local`;
  `MONGODB_URI` is replaced so the containers use the MongoDB container.

```bash
docker login                            # only if the Docker Hub repository is private
docker compose pull
docker compose up -d                    # website on http://localhost:3000 (WEB_PORT=8080 to change)
docker compose logs -f worker           # watch the worker
docker compose down                     # stop (data stays in the mongo-data volume)
docker compose run --rm web npm run sent:check   # any script from the table below
```

The container MongoDB is reachable from this computer only, on port **27018** (e.g. MongoDB Compass:
`mongodb://localhost:27018/outreach`). Port 27017 is left for the MongoDB service installed on Windows.

## Scripts

| Command                    | What it does                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev:all`          | Website and worker together (use this for daily work)                                                                                                                     |
| `npm run dev`              | Website only (http://localhost:3000)                                                                                                                                      |
| `npm run worker`           | Worker only (the background sender). Stop with Ctrl+C                                                                                                                     |
| `npm run typecheck`        | TypeScript type check                                                                                                                                                     |
| `npm run lint`             | ESLint (also blocks importing server code into client code)                                                                                                               |
| `npm test`                 | Unit tests (vitest)                                                                                                                                                       |
| `npm run build`            | Production build                                                                                                                                                          |
| `npm start`                | Run the production build (after `npm run build`)                                                                                                                          |
| `npm run seed`             | Create the admin user + settings (safe to repeat)                                                                                                                         |
| `npm run db:indexes`       | Make MongoDB indexes match the models (safe to repeat)                                                                                                                    |
| `npm run simulate`         | Dry-run simulation of the worker in a separate database                                                                                                                   |
| `npm run email:test`       | Show exactly what goes to Microsoft for a campaign (Outlook JSON or raw MIME); `--send --yes` sends it to test addresses; `--format outlook\|mime` tries the other format |
| `npm run mailbox:check`    | Look for bounce reports / replies in the sending inboxes now                                                                                                              |
| `npm run sent:check`       | Read every inbox's Sent Items + replies now (hand-sent emails, tracking links) and print today / week / month counts                                                      |
| `npm run tracking:rebuild` | Recalculate every contact's emailed / replied / clicked numbers and every link's click counters                                                                           |
| `npm run format`           | Format all files with Prettier                                                                                                                                            |

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
