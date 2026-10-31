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

### SMOKE-01 First-run family setup
1. On an empty database, open `/` and follow "Set up your family" to `/register`.
2. Create the family and first parent.
3. Verify you land on `/parent` and are logged in.
4. Log out; verify `/` no longer offers setup and `POST /api/family/create` returns 403.

### SMOKE-02 Add kids and log in as a kid
1. On `/admin/users`, add a child with email + password.
2. Log in as the child.
Expected:
- Child lands on `/child` and cannot open parent pages.
- Parent-only API calls (e.g. approve, create user) return 403 for the child.

### SMOKE-03 Create chore and assign child
1. Open `/admin/chores#new-chore`.
2. Create chore assigned to Child A.
3. Tap `Add chore`.
Expected:
- The editor closes and a confirmation toast appears.
- The chore is listed on `/admin/chores`.

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

### SMOKE-06 Reject an approval
1. Child A marks one assigned instance as done.
2. Parent rejects it in `/parent/review`, with or without a reason.
Expected:
- Status transitions `assigned -> done -> assigned`, and no reward is paid.
- The chore is unchecked on the child's page and can be marked done again.
- Child A gets a push saying it isn't complete, with the reason if one was given.

### SMOKE-07 Mark done with a camera photo or video
1. On a phone, Child A taps a chore, chooses `Add proof` in the popup, takes a photo, and sends it.
2. Repeat with a short video on another chore, letting it reach the 15-second limit.
3. Parent opens `/parent/review`, views both, approves one and rejects the other.
Expected:
- Choosing `Mark done` in the popup finishes the chore without proof; closing it leaves the chore to do.
- The sheet only offers the live camera; nothing opens the photo library or a file picker.
- Both proofs show on the approval cards, and video plays (including on iPhone).
- After approving or rejecting, the proof is gone from disk and from `photoKeys`.
- A kid requesting a sibling's proof URL gets 404.

## Suite: REGRESSION

### REG-01 Assignee options include the whole family
1. Open `/admin/chores#new-chore`.
2. Inspect assignee options.
Expected:
- All active members are listed: kids first, then parents.

### REG-02 Parent assigns a chore to themselves or another parent
1. As Parent A, create a chore assigned to Parent A and one assigned to Parent B.
2. Open `My chores` as each parent, mark the chore done, then tap it again.
Expected:
- Each parent can check off only their own chore.
- The chore is approved straight away, with no proof popup, no entry in `Approvals` and no push.
- Tapping it again un-does it.
- On a chore rotating between a parent and a kid, the kid's turns still go to `Approvals`, and so does a non-admin parent's chore.
- A parent never earns: no balance on `My chores`, no reward labels, and a reward chore on a parent's turn adds nothing to the ledger.
- The chore editor hides the reward option when only parents are chosen.

### REG-02b Kids can't see parents' chores
1. As a kid, call `GET /api/instances` without `userId`, and with a parent's `userId`.
2. Call `GET /api/chores` and `GET /api/chores/:id` for a parent's chore.
Expected:
- No instance assigned to a parent is returned, unless the kid shares it with them (Together); kids' own instances are unaffected.
- `/api/chores` lists only the kid's own chores, without assignment data; `/api/chores/:id` returns 403.
- On a chore rotating between a kid and a parent, the kid sees only their own turns.
- Assignment mode is implicit round-robin for shared tasks.

### REG-02A Together chores
1. Create a chore for a parent and a kid with **Together**. Check it shows once for both, and as one joint column on the kitchen display.
2. The kid checks it off, then the parent approves it in Approvals.
3. Repeat with the parent checking it off, then undoing it.
4. Repeat with two kids on a reward chore.
Expected:
- The kid sees the chore, named with whoever shares it, and either person's check-off finishes it for both.
- A kid's check-off waits for approval; a parent's counts as approved straight away, and they can undo it.
- Two kids each earn half the reward, rounded down; a parent earns nothing, so a kid sharing with a parent earns all of it.

### REG-02B Shared round-robin alternation (daily)
1. Create a `Daily` chore with exactly two children selected and `Take turns` chosen.
2. Run generation for the tenant:
   - `DEV_TENANT_ID=<tenant-id> pnpm --filter chorly-worker generate`
3. Query assignments for the next 4 due instances.
Expected:
- Exactly one assignee per instance.
- Assignee alternates Child A, Child B, Child A, Child B.

### REG-03 Repeating calendar presets
1. In the chore editor, try `Weekly` with one day chosen, then `Monthly`.
Expected:
- The summary at the bottom shows `Every Sunday`, and `Monthly` offers `First Sunday of the month` and `Last Sunday of the month`.

### REG-04 Save as a suggestion
1. Create a chore with `Save as a suggestion` on, under `More options`.
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
3. Check `/child` as the assigned child.
Expected:
- The chore shows under `Coming up`, and moves to `Today` on its due date.

### REG-09 Delete one occurrence from parent view
1. In `/parent`, open an upcoming chore and choose `Skip just this one`.
2. Reload parent and child views.
Expected:
- Only that instance is removed.
- Other instances in the recurring series remain.

### REG-10 Delete recurring chore from parent view
1. In `/admin/chores`, open a recurring chore and choose `Delete`.
2. Reload parent and child views.
Expected:
- Chore definition is disabled for future generation.
- Upcoming unapproved instances for that recurring chore are removed.

### REG-11 Recurrence end date
1. Create a recurring chore with `Ends` set to `On a date`, under `More options`.
2. Generate instances.
3. Verify no instances are created after the selected end date.
Expected:
- Instances exist up to the end date only.

### REG-07 Away user behavior
1. Mark Child B away.
2. For a chore with `Skip people who are away` on, generate instances.
Expected:
- Away child is excluded from newly generated assignments.

### REG-08 Rewards and earnings
1. Create reward-enabled chore, assign to child, generate, complete, approve.
2. Check `/users/:id/earnings` and child money panel.
Expected:
- Earned amount updates correctly after approval.

### REG-10 Profile pictures
1. As a kid, open the account sheet → Profile picture → Choose from gallery, pick a photo, drag it, zoom with the slider and with a pinch, and save.
2. Take a new picture with Take a photo, flip the camera, position it, and save.
3. Log in as a parent and check the kid's picture on Family, Home, Approvals, and the chore editor.
4. As the kid, tap Remove picture.
Expected:
- The saved picture matches what was inside the circle, and the photo can't be dragged or zoomed out past its edges.
- The picture shows as a circle everywhere that member appears, without a reload for the person who changed it.
- After removal, the member's initials show again.
- Uploading a non-JPEG to `POST /api/users/me/avatar` returns 400; more than 512 KB returns 413.

### REG-11 Family locator
1. As a parent on a phone, open Map and turn on Share my location from this device. Allow location.
2. As a kid on another device, tap the pin at the top, turn sharing on, and tap the parent in the list.
3. Walk around with one phone while watching the other.
4. Lock one phone for 15 minutes, then check it from the other.
5. Turn sharing off on one device.
Expected:
- Both people appear on the map with their picture or initials and first name.
- Zoomed out, people and pins that would collide merge into one bubble. Tapping it zooms in; at street level people in the same spot stand side by side and every name is readable. Markers glide into and out of a bubble instead of jumping, and a reduced-motion setting turns that off.
- The sharing card shows only until someone has shared (or when the browser blocks location). After that a toolbar chip shows the state and opens the sharing sheet, including when sharing from another device.
- A moving phone updates the other's map within about 15 seconds.
- A locked phone's person stays in place, shows the time since the last update, and fades after 10 minutes.
- After turning off, the person leaves the map and shows Not sharing; their `UserLocation` row is gone.
- Blocking location in the browser shows the blocked message and the switch turns off.

### REG-12 Places and arrival alerts
1. As a parent, open Map → Places → Add a place. Create Home (kind Home) and School (kind School, reward 5): tap the map, drag the pin, then Use this spot.
2. As a kid, open Places. Try to add one.
3. With a kid's phone sharing, walk into the School circle, then out, then back in. Watch a parent's phone.
4. Walk to the edge of Home and stay there a few minutes.
Expected:
- The pin stays on the map until Use this spot; tapping a marker while choosing moves the pin and opens nothing. From far out the first tap zooms to the street, and a place shows its area around the pin.
- Parents can add, edit and delete places; kids see them but have no add, edit or delete buttons.
- Adding a place where someone already stands sends no "Arrived" push.
- The family gets "Arrived at School" and "Left School" pushes; the person who moved doesn't get their own.
- The kid gets the 5 reward once that day, not on the second arrival.
- Standing on the Home edge doesn't send repeated arrive/leave pushes.
- Turning off "Arrivals and departures" under Choose notifications stops those pushes.

### REG-13 Sharing modes and timers
1. Start sharing as Nearby for an hour. From another phone look at the person.
2. Switch to Paused, then back to Exact.
3. Share until tonight; set the phone's clock or the row's `shareUntil` in the past.
Expected:
- Nearby shows a dashed halo about 1.5 km wide, no street position, no speed, a "Nearby only" chip.
- Paused shows the person in the list as paused with no marker; nothing is reported while paused. Resuming at the same place sends no "Arrived" push.
- When a timed share ends the person leaves the map within 5 minutes (the worker) or at the next report, and the device stops reporting and says so, also if it was asleep when the time ran out.

### REG-14 Chores and places
1. Add a place and, in a chore's more options, tie the chore to it with "Be there". Assign it to a kid.
2. As the kid away from the place, open the chore and tap Mark done.
3. Walk to the place and try again.
4. Change the rule to "Visit that day", mark done after a visit, and again before one.
5. Leave a kid at a School place with an overdue chore until the evening nag time.
Expected:
- The chore shows "Be at X to mark it done", also in the Add proof popup; away from X, Mark done is refused with a message in the kid's language.
- At the place, Mark done works. With "Visit that day", a visit earlier that day is enough.
- Parents can mark such a chore done from anywhere.
- No overdue or due-soon push reaches a kid who is at a School or Work place; it arrives once they leave.
- Arriving at a Home place pushes today's open chores, at most once every three hours.

### REG-15 Errands, things and stickers
1. Pin an errand near a kid's phone from a parent's phone. As the kid, claim it.
2. Pin another near nobody, then walk past it with a phone.
3. Add a Thing (the dog), move it with "Move to me", then "Move on map".
4. Tap a family member, check their details and Directions, and send a sticker, twice in a row.
5. Tap "Heading to…", choose Home and Walking.
Expected:
- The nearest sharing member other than the author gets "You're the closest"; claiming shows "Taken by" and tells the author, as does finishing it; another person's claim is refused, and so is a kid finishing someone else's.
- Passing within 300 m reminds once, but not someone who was at the spot when it was pinned.
- The Thing moves on everyone's map; the sticker arrives in each person's language; the second one within 20 seconds is refused.
- An "Home in N min" bubble appears on the avatar and ends on arrival. The place you're at isn't offered, and a trip doesn't make an old position look fresh.

### REG-16 Phone alerts and recap
1. With a child's Android app sharing, let the battery fall under 15% unplugged, or set `UserLocation.battery` to 10.
2. Stop the Android app reporting for 45+ minutes during the day.
3. Turn on the weekly map recap in the share sheet for two members, then run `pnpm --filter chorly-worker summary:places`.
Expected:
- Parents get one low-battery push, and one "went quiet" push, each only once per episode; both can be turned off under Phone alerts.
- Only members who joined the recap get it, and it lists only members who joined.

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
