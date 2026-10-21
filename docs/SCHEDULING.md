# Travel-aware scheduling (SCH-003 partial)

A builder manager can set `travel_minutes` through the existing authenticated native scheduling HTTP doors. These are human scheduling decisions; a feasible slot does not mean that a subcontractor confirmed attendance. There is no travel-buffer editor yet.

## Book and move

`POST /api/plinth/jobs/:job/schedules` accepts the usual `expected_version`, `trade`, `description`, timezone-bearing `start` and `end`, plus optional `travel_minutes`. `POST /api/plinth/jobs/:job/schedules/:id/move` accepts new start/end and an optional buffer. Existing authorization, job assignments and atomic version checks apply.

A buffer is an integer from 0 to 1440 elapsed minutes. A missing buffer on a new task means zero. Omitting it on a move or planner update preserves the current value; explicitly providing zero clears it. Negative, fractional, null, string and over-limit values are refused.

For the same case-insensitive trade, overlapping work is refused. Between two different jobs, the gap between the earlier finish and later start must be at least the larger of their two buffers. Buffers are not added together. Equality is permitted. The calculation uses normalized UTC instants, so offset changes and nonworking hours do not turn elapsed travel into working minutes. Same-job adjacency requires no inter-site travel. Cancelled tasks and zero-duration milestones consume no travel capacity.

For example, a crew finishing at 09:00 with a 60-minute buffer may start at another site at 10:00 if that site's buffer is no larger. A second-site buffer of 90 minutes instead requires 10:30. Moving either booking rechecks the relationship in both chronological directions.

## Review and publish

Each task supplied to `POST /api/plinth/jobs/:job/schedule/preview` can include the same field. Preview returns conflicts with `reason: "overlap"` or `reason: "travel"`, other-job and booking identifiers, and for travel conflicts `required_travel_minutes` and `available_travel_minutes`. It makes no write. `schedule/publish` requires the exact reviewed digest and rechecks current cross-job bookings under the installation clock and authority fence. Changed travel inputs need a fresh preview; refused or racing writes cannot leave a partial booking.

Schedule templates retain their tasks' buffers. Their existing preview/apply doors enforce the translated schedule against current bookings. Approval, baseline and revision snapshots preserve the reviewed tasks and buffers; normal job archives carry them as part of the job without a schema migration.

## Still open

SCH-003 remains partial. Availability and leave calendars, crew/equipment capacity and explicit subcontractor invitations, alternative dates and confirmations are not implemented. This travel slice does not narrow those requirements or claim attendance.
