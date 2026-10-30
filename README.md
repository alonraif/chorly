# Chorly

A family chores hub: parents create chores, kids mark them done on their phones, parents approve, kids earn.

- `apps/api`: NestJS + Prisma (Postgres). Served under `/api`.
- `apps/web`: Next.js 14, installable as an app (PWA) with push notifications.
- `apps/worker`: scheduler that generates chore occurrences and sends reminders.
- `packages/shared`: shared Zod schemas + types.

Single family per install. The first visitor sets up the family (`/register`); after that, setup is locked and parents add members on **Family members** (`/admin/users`). Kids need an email + password to log in (any address works, it's only a username).

Login uses an httpOnly session cookie (90 days). Parents (`role=parent`) can manage everything; kids can only see and complete their chores. Chores can also be assigned to parents, themselves or each other: they check them off under **My chores** and any parent, including the one who did it, approves them.

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

### Chore photos and videos

Proofs live in the `chorly_proofs` Docker volume only until a parent approves or rejects the chore, then they're deleted. They aren't part of the nightly backup.

Profile pictures are stored in Postgres, so the nightly backup includes them.

### Restore a backup

```bash
gunzip -c backups/chorly-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U chorly chorly
```

## Family locator

Everyone, kids included, can open the map (**Map** tab, or the pin at the top for kids) and turn on **Share my location from this device**. The switch is per device, so a laptop doesn't pull someone away from the phone in their pocket, and sharing is opt-in: the location only leaves the device once its owner turns this on.

Only the last known position is kept (`UserLocation`), never a history. Turning sharing off deletes it. The map is drawn with MapLibre using free OpenFreeMap styles (Positron in light mode, Fiord in dark), which need no key.

**In a browser or installed web app, sharing only runs while Chorly is open and on screen.** They get no location once they're in the background or closed, on both iPhone and Android. Someone who leaves the app stays on the map at their last position, labelled with how long ago that was and faded after 10 minutes.

**The Android app keeps sharing in the background**, with a permanent "Sharing your location" notification while it does. Swiping the app away stops it, and some phones' battery savers can too.

### Places, alerts and the rest of the map

- **How you share.** The share sheet picks what the family sees (**Exact**, **Nearby** for only the neighbourhood, a couple of kilometres wide with no street or speed, or **Paused**, which shows as paused rather than silently disappearing) and for how long (an hour, until tonight, or until you stop). A timed share forgets the position by itself. Switching to Nearby blurs the stored position at once, on the server.
- **Places** (parents add them; everyone sees them): home, school, work, a favourite spot with a note, or anything else, each a circle on the map. Arriving at or leaving one sends a push to the rest of the family (`placeAlerts`). A phone has to be well inside or outside the circle, with a decent fix, before it counts, so GPS jitter on the edge doesn't spam the family.
- **Chores meet the map.** Arriving at a *home* place sends the person today's open chores. Reminders for overdue and due-soon chores wait while someone is at a *school* or *work* place. A chore can be tied to a place (chore editor, more options): the child can mark it done only while at the place, or only after visiting it that day. Parents are exempt. A place can also pay a child a reward the first time they arrive each day.
- **Errands.** Pin a task on the map ("pick up milk"). The nearest sharing member gets a nudge and can claim it; passing within 300 m reminds whoever took it, or anyone if nobody has. Whoever pinned it isn't nudged, and hears when someone takes it and when it's done. Once taken, only that person or a parent can finish or give it back.
- **Things.** The dog, a bike, the car: put them on the map and move them by hand.
- **Heading to…** Share an estimated arrival at a place, as a bubble on your avatar. The estimate is straight-line distance with a route factor, not a routing service.
- **Status.** Each person gets a battery chip and a status bubble worked out from where they are and how fast they move (home, school, walking, driving, asleep). People standing within 80 m of each other show as together. A tap on someone shows their details and directions, and sends a sticker (wave, come home, dinner's ready). A status that's out of date doesn't pretend otherwise: an old position shows no speed, battery or arrival estimate.
- **Phone alerts for parents.** Battery at or under 15% and not charging, or, for Android app users, no update for 45 minutes during the day.
- **Weekly recap** (Saturday 19:30, opt-in per member): time at the family's places over the past week, sent only to members who joined it, about members who joined it.

The only trail kept is `PlaceVisit`, the stays at the family's own places, and the worker deletes visits 14 days after they end (`location-watch`). Everything else is still the last known position only. Alert types can each be turned off under **Choose notifications**. Alerts for places work in Exact and Nearby, and Nearby still shows which of the family's places someone is at. Paused shares nothing.

## Phones (install + notifications)

- **Android app:** install the APK (see below) and tap **Turn on notifications** under Account.
- **Android / Chrome:** open the site → menu → *Install app*. Tap **🔔 Turn on notifications** in the header.
- **iPhone (iOS 16.4+):** open in Safari → Share → *Add to Home Screen*, open Chorly from the icon, then tap **🔔 Turn on notifications**. iOS only allows web push for home-screen apps.

### Android app

`mobile/` is a Capacitor wrapper that loads the live site, so web and API deploys reach it without a new APK. Rebuild only when something in `mobile/` changes (plugins, permissions, icon); bump `versionCode` in `mobile/android/app/build.gradle` first.

Building needs JDK 21 and the Android SDK (platform 35, build-tools 35):

```bash
cd mobile
npm install
export JAVA_HOME=/opt/homebrew/opt/openjdk@21 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
npm run apk
```

The APK is copied to `deploy/apk/chorly.apk`, which is what family members download under **Account → Get the Android app** (signed-in Android browsers only). A new build goes live right away, with no deploy. It's signed with `mobile/android/chorly-release.keystore` and the passwords in `keystore.properties`, both outside git. Back them up: phones only accept an update signed with the same key.

**Notifications** go through Firebase, so they need a free Firebase project with an Android app using the package name `me.theraifs.chorly`:

1. Put its `google-services.json` in `mobile/android/app/` and rebuild. An APK built without it works, but offers no notifications.
2. In *Project settings → Service accounts*, generate a private key and put it in `.env` as `FIREBASE_SERVICE_ACCOUNT` (`base64 -i key.json`), then `docker compose up -d`.

Notifications sent:
- Kid marks a chore done → parents ("ready for approval").
- Parent approves → kid (with reward).
- Parent rejects → kid (with the reason, if given); the chore goes back to not done.
- 07:00 today's chores.
- 30 minutes before a chore's due time → the kid (once per chore; only chores with a time set, none during quiet hours `21:00-07:00`).
- 17:00 + 20:00 overdue chores → the kid. Each chore at most once a day, and only for 3 days after it was due.
- 20:00 overdue chores across the family → parents.
- Saturday 19:00 weekly summary: kids get their own week, parents get the family's.
- Every 5 minutes, `location-watch`: ends timed shares, alerts parents to low batteries and quiet phones, and tidies old visits, errands and trips.
- Saturday 19:30 map recap for members who opted in.

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
pnpm --filter chorly-worker location:watch
pnpm --filter chorly-worker summary:places
```
