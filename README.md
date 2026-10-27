# Chorly

A family chores hub: parents create chores, kids mark them done on their phones, parents approve, kids earn.

- `apps/api`: NestJS + Prisma (Postgres). Served under `/api`.
- `apps/web`: Next.js 14, installable as an app (PWA) with push notifications.
- `apps/worker`: scheduler that generates chore occurrences and sends reminders.
- `packages/shared`: shared Zod schemas + types.

Single family per install. The first visitor sets up the family (`/register`); after that, setup is locked and parents add members on **Family members** (`/admin/users`). Kids need an email + password to log in (any address works, it's only a username).

Login uses an httpOnly session cookie (90 days). Parents (`role=parent`) can manage everything; kids can only see and complete their chores.

## Production on this Mac (Docker Desktop)

The stack in `docker-compose.yml`:

| service  | what it does |
|----------|--------------|
| caddy    | HTTPS with automatic Let's Encrypt certs, routes `/api` → api, everything else → web |
| api, web, worker | the app (one image built from `Dockerfile`) |
| postgres | database (not exposed outside Docker) |
| backup   | nightly `pg_dump` into `./backups`, keeps 14 days |
| ddns     | keeps the DNS record pointed at your home IP (opt-in profile) |

### 1. DNS + dynamic IP

Pick a hostname, e.g. `chores.the-raifs.me`.

**Recommended: move DNS to Cloudflare (free).** GoDaddy only allows API access (needed for DDNS) on accounts with 10+ domains, so their API usually returns 403 for personal accounts. You keep the domain registered at GoDaddy and only change its nameservers:

1. Create a free Cloudflare account → *Add a site* → `the-raifs.me` → Free plan. It imports your existing records.
2. In GoDaddy → *Domain* → *DNS* → *Nameservers* → *Change* → enter the two Cloudflare nameservers.
3. In Cloudflare, add an `A` record `chores` → your current public IP, **DNS only** (grey cloud).
4. Create an API token: *My Profile → API Tokens → Create Token → Edit zone DNS* template, zone `the-raifs.me`.
5. `cp deploy/ddns/config.cloudflare.example.json deploy/ddns/config.json` and fill in the token and the Zone ID (on the domain's Overview page).

If you do have GoDaddy API access, use `deploy/ddns/config.godaddy.example.json` instead (keys from developer.godaddy.com, *Production*).

The ddns updater has a status page on its own port only inside Docker; check `docker compose logs ddns`.

### 2. Router

Forward TCP **80** and **443** (and UDP 443 optionally) to this Mac's LAN IP. Give the Mac a DHCP reservation so its LAN IP doesn't change.

### 3. Configure and start

```bash
cp .env.example .env
```

Edit `.env`: set `POSTGRES_PASSWORD` (`openssl rand -hex 24`) and VAPID keys (`npx web-push generate-vapid-keys`). Then:

```bash
docker compose --profile ddns up -d --build
```

Open `https://chores.the-raifs.me` and set up the family. Caddy gets the certificate on first request (DNS must already point at you and ports must be forwarded).

### 4. Keep the Mac serving

- Docker Desktop → Settings → General → *Start Docker Desktop when you sign in*.
- System Settings → Energy → *Prevent automatic sleeping when the display is off* (or `sudo pmset -a sleep 0`).
- All containers use `restart: unless-stopped`.

### Updating

```bash
git pull
docker compose --profile ddns up -d --build
```

Database migrations run automatically when the api container starts.

### Restore a backup

```bash
gunzip -c backups/chorly-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U chorly chorly
```

## Phones (install + notifications)

- **Android / Chrome:** open the site → menu → *Install app*. Tap **🔔 Turn on notifications** in the header.
- **iPhone (iOS 16.4+):** open in Safari → Share → *Add to Home Screen*, open Chorly from the icon, then tap **🔔 Turn on notifications**. iOS only allows web push for home-screen apps.

Notifications sent:
- Kid marks a chore done → parents ("ready for approval").
- Parent approves → kid (with reward).
- 07:00 today's chores.
- 30 minutes before a chore's due time → the kid (once per chore; only chores with a time set, none during quiet hours `21:00-07:00`).
- 17:00 + 20:00 overdue chores → the kid. Each chore at most once a day, and only for 3 days after it was due.
- 20:00 overdue chores across the family → parents.
- Saturday 19:00 weekly summary: kids get their own week, parents get the family's.

Nobody is notified about their own action (a parent approving their own chore, say). Each member can turn any type off under **Account → Choose notifications**; this applies to email too.

Times are configurable with `CRON_*` env vars on the worker (see `apps/worker/src/scheduler.ts`), plus `DUE_SOON_MINUTES`, `OVERDUE_MAX_DAYS` and `QUIET_HOURS`.

## Local development

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
pnpm db:generate
pnpm db:migrate
pnpm db:seed   # optional sample family; password Password123!
pnpm dev
```

- Web: http://localhost:3000 (proxies `/api` to the API on :4000)
- Swagger: http://localhost:4000/api/docs (when `ENABLE_SWAGGER=true`)

Run a worker job once:

```bash
pnpm --filter chorly-worker generate
pnpm --filter chorly-worker reminders:morning
pnpm --filter chorly-worker reminders:due-soon
pnpm --filter chorly-worker reminders:overdue
pnpm --filter chorly-worker reminders:parents
pnpm --filter chorly-worker summary:weekly
```
