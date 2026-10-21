# Travel-aware scheduling (SCH-003 partial)

A builder manager can set `travel_minutes` through the existing authenticated native scheduling HTTP doors. These are human scheduling decisions; a feasible slot does not mean that a subcontractor confirmed attendance. The Schedule capacity panel edits resource allocations and travel buffers, and displays cross-job allocations, calendars and confirmation risk.

## Book and move

`POST /api/plinth/jobs/:job/schedules` accepts the usual `expected_version`, `trade`, `description`, timezone-bearing `start` and `end`, plus optional `travel_minutes`. `POST /api/plinth/jobs/:job/schedules/:id/move` accepts new start/end and an optional buffer. Existing authorization, job assignments and atomic version checks apply.

A buffer is an integer from 0 to 1440 elapsed minutes. A missing buffer on a new task means zero. Omitting it on a move or planner update preserves the current value; explicitly providing zero clears it. Negative, fractional, null, string and over-limit values are refused.

For the same case-insensitive trade, overlapping work is refused. Between two different jobs, the gap between the earlier finish and later start must be at least the larger of their two buffers. Buffers are not added together. Equality is permitted. The calculation uses normalized UTC instants, so offset changes and nonworking hours do not turn elapsed travel into working minutes. Same-job adjacency requires no inter-site travel. Cancelled tasks and zero-duration milestones consume no travel capacity.

For example, a crew finishing at 09:00 with a 60-minute buffer may start at another site at 10:00 if that site's buffer is no larger. A second-site buffer of 90 minutes instead requires 10:30. Moving either booking rechecks the relationship in both chronological directions.

## Review and publish

Each task supplied to `POST /api/plinth/jobs/:job/schedule/preview` can include the same field. Preview returns conflicts with `reason: "overlap"` or `reason: "travel"`, other-job and booking identifiers, and for travel conflicts `required_travel_minutes` and `available_travel_minutes`. It makes no write. `schedule/publish` requires the exact reviewed digest and rechecks current cross-job bookings under the installation clock and authority fence. Changed travel inputs need a fresh preview; refused or racing writes cannot leave a partial booking.

Schedule templates retain their tasks' buffers. Their existing preview/apply doors enforce the translated schedule against current bookings. Approval, baseline and revision snapshots preserve the reviewed tasks and buffers; normal job archives carry them as part of the job without a schema migration.

## Capacity calendars and confirmations

Owners/admins create named crews and equipment in **Schedule → Capacity and trade confirmations → Crew and equipment calendars**. Capacity is whole units. Availability windows restrict when a resource can work; an empty list allows any time except leave. Leave and availability use half-open UTC intervals, displayed in the viewer’s local time. Calendar edits retain the reviewer and reason.

Allocate resources and an elapsed travel buffer to each booked task. The panel lists their booked work across jobs. Native booking, approval, move, planner publication and template application refuse excess simultaneous units, leave, missing resources and out-of-window work. Other-job allocations include travel. Every save shares the global transaction clock; a concurrent publication or calendar revision invalidates stale checks. Existing published work stays put when a later calendar change creates a conflict, and its confirmation becomes visibly at risk.

Invite a person through **People & access**, then select their released company scope and request their explicit confirmation from the booking. The person must be an assigned contact of that company for the booking’s trade; every inbox fetch and response rechecks that membership. The request appears in that person’s **Trade inbox**. This is a native inbox invitation, not an email-delivery claim. The inbox contains only that task’s site, trade and dates. It grants no access to the client job, financials or another job. A proposed alternative does not move or reserve anything; the builder must book feasible dates and issue a fresh invitation. Only the personally invited contact confirms the exact current slot, after live resource checks. Changing dates, trade, resources or travel invalidates an earlier invitation.

SCH-003 remains partial pending ct approval of this conservative contact-grant/privacy default. SCH-004 and NOTIFY-001 carry outbound delivery and escalation.
