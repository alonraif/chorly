# Chorly

Monorepo apps:
- `apps/api`: NestJS 10 + Prisma + Swagger
- `apps/web`: Next.js 14
- `apps/worker`: tsx scripts for generation/reminders/summary
- `packages/shared`: shared Zod schemas + TS types (compiled to `dist`)

## Multi-tenant model
- Each family is a `Tenant`.
- Every user belongs to one family (`User.tenantId`).
- Requests are tenant-scoped by `x-user-id`.
- System admin can troubleshoot any family by adding `x-tenant-id`.

## Install + Run
```bash
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Endpoints:
- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- Swagger: `http://localhost:4000/docs`
- MailHog UI: `http://localhost:8025`

## Worker jobs
```bash
pnpm --filter chorly-worker generate
pnpm --filter chorly-worker reminders:morning
pnpm --filter chorly-worker reminders:overdue
pnpm --filter chorly-worker summary:weekly
```

By default worker runs for all tenants. To limit tenant: set `DEV_TENANT_ID` or `TENANT_ID` in `apps/worker/.env`.

## Family onboarding and invites
Create family (first sign-in):
```bash
curl -X POST http://localhost:4000/family/create \
  -H 'content-type: application/json' \
  -d '{"familyName":"Cohen Family","displayName":"Yael","email":"yael@example.com","locale":"he"}'
```

Invite family member (admin):
```bash
curl -X POST http://localhost:4000/family/invites \
  -H 'content-type: application/json' \
  -H 'x-user-id: <FAMILY_ADMIN_USER_ID>' \
  -d '{"email":"kid@example.com","expiresInDays":7}'
```

Accept invite:
```bash
curl -X POST http://localhost:4000/family/invites/accept \
  -H 'content-type: application/json' \
  -d '{"token":"<INVITE_TOKEN>","displayName":"Noam","locale":"en"}'
```

## System admin troubleshooting
Seed creates a system admin user: `root@chorly.local`.

System admin list all tenants:
```bash
curl http://localhost:4000/system/tenants -H 'x-user-id: <ROOT_USER_ID>'
```

System admin inspect a specific tenant context:
```bash
curl http://localhost:4000/users \
  -H 'x-user-id: <ROOT_USER_ID>' \
  -H 'x-tenant-id: <TENANT_ID>'
```
