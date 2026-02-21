# QA Test Plan (Chorly)

## Purpose
Validate end-to-end behavior for family setup, role-based assignment, chore creation, instance generation, child visibility, completion, approval, and payouts.

## Execution Rules
- Use a dedicated QA tenant/family when possible.
- Record pass/fail per test ID.
- For failures, capture: expected vs actual, timestamp, endpoint/page, and relevant logs.
- Unless stated otherwise, run in this order: `SMOKE` then `REGRESSION`.

## Test Data
- Parent admin: `role=parent`, `isAdmin=true`
- Child A: `role=child`
- Child B: `role=child`
- Optional Parent non-admin: `role=parent`, `isAdmin=false`

## Suite: SMOKE

### SMOKE-01 Create family with required role
1. Open `/register` or `/family/create`.
2. Create family with valid required fields including `role`.
3. Verify user is created and role is persisted.
Expected:
- Request succeeds.
- Created admin has `role` set (`parent` or `child` per selection).

### SMOKE-02 Invite requires role
1. Open `/admin/family`.
2. Send invite with role `child`.
3. Attempt invite without role via API.
Expected:
- With role: success.
- Without role: validation error.

### SMOKE-03 Create chore and assign child
1. Open `/admin/chores#new-chore`.
2. Create chore assigned to Child A.
3. Confirm success popup is shown.
4. Click `OK`.
Expected:
- Success modal appears with summary.
- `OK` redirects to `/chorespace`.

### SMOKE-04 Generated instances visible in child view
1. Run worker generate for active tenant:
   - `DEV_TENANT_ID=<tenant-id> pnpm --filter chorly-worker generate`
2. Open `/child` as Child A.
Expected:
- New chore instances appear in the weekly list/calendar.

### SMOKE-05 Complete and approve lifecycle
1. Child A marks one assigned instance as done.
2. Parent approves it in `/parent/review`.
Expected:
- Status transitions `assigned -> done -> approved`.

## Suite: REGRESSION

### REG-01 Assignee dropdown excludes parents
1. Open `/admin/chores#new-chore`.
2. Inspect assignee options.
Expected:
- Only users with `role=child` are listed.

### REG-02 Shared chore child selection
1. Toggle `Shared chore`.
2. Verify shared list contains only children.
Expected:
- Only child users appear.
- Assignment mode is implicit round-robin for shared tasks.

### REG-02B Shared round-robin alternation (daily)
1. Create a daily repeating chore with `Shared chore` enabled and exactly two children selected.
2. Run generation for the tenant:
   - `DEV_TENANT_ID=<tenant-id> pnpm --filter chorly-worker generate`
3. Query assignments for the next 4 due instances.
Expected:
- Exactly one assignee per instance.
- Assignee alternates Child A, Child B, Child A, Child B.

### REG-03 Repeating calendar presets
1. Set schedule type `Repeating calendar`.
2. Verify repeat options include Outlook-like presets.
Expected:
- Options like `Every Sunday`, `First Sunday of every month` exist.

### REG-04 Add to favorites persistence
1. Create chore with `Add to favorites` checked.
2. Query templates endpoint.
Expected:
- Template entry exists for the new chore.

### REG-05 Role enforcement in Users admin
1. Open `/admin/users`.
2. Create user with role.
3. Attempt API create without role.
Expected:
- With role: success.
- Without role: validation error.

### REG-06 Today vs Week visibility
1. Create a chore due tomorrow.
2. Generate instances.
3. Check `/today` and `/week` as assigned child.
Expected:
- `/today`: task appears only on due date.
- `/week`/child weekly view: task appears in upcoming days.

### REG-09 Delete one occurrence from parent view
1. In `/parent`, pick an upcoming instance and click `Delete occurrence`.
2. Reload parent and child views.
Expected:
- Only that instance is removed.
- Other instances in the recurring series remain.

### REG-10 Delete recurring chore from parent view
1. In `/parent`, click `Delete recurring chore` for a recurring task.
2. Reload parent and child views.
Expected:
- Chore definition is disabled for future generation.
- Upcoming unapproved instances for that recurring chore are removed.

### REG-11 Recurrence end date
1. Create a recurring chore with `Recurrence end = End date`.
2. Generate instances.
3. Verify no instances are created after the selected end date.
Expected:
- Instances exist up to the end date only.

### REG-07 Away user behavior
1. Mark Child B away.
2. For non-shared chore with `Skip away users=true`, generate instances.
Expected:
- Away child is excluded from newly generated assignments.

### REG-08 Rewards and earnings
1. Create reward-enabled chore, assign to child, generate, complete, approve.
2. Check `/users/:id/earnings` and child money panel.
Expected:
- Earned amount updates correctly after approval.

## Diagnostics Checklist (when tests fail)
- API health: `GET http://localhost:4000/health`
- Confirm chores exist:
  - `select count(*) from "ChoreDefinition" where "isTemplate"=false and "deletedAt" is null;`
- Confirm instances exist:
  - `select count(*) from "ChoreInstance";`
- Run generator with correct tenant:
  - `DEV_TENANT_ID=<tenant-id> pnpm --filter chorly-worker generate`
- Inspect API logs:
  - `docker logs --tail 200 chorly-api-1`

## On-demand Execution
When you ask me to execute the plan, specify:
- `SMOKE`, `REGRESSION`, or specific IDs (example: `SMOKE-01, SMOKE-04, REG-06`).
