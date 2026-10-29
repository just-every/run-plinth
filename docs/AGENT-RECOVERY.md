# Private recovery comparisons

Recovery packets compare proposed dates, remaining cost, native margin and expected cash for one delayed package and labor overrun. They do not execute a recovery. The signed-in owner requests the packet through the native HTTP door; an explicitly consented owner-sponsored agent can read it and prepare comparisons through MCP.

1. Read `GET /api/plinth/jobs/<job-id>/recovery/sources`. Inspect the native facts and their digest, including dependencies, actuals, work holds, resource calendars, other booked work, issued orders, accepted budget, recorded costs and invoice balances.
2. Send `POST /api/plinth/jobs/<job-id>/recovery/requests` with the current `expected_version`, reviewed `source_digest`, `confirm: true`, a dated `purpose` and `as_of`, and the exact `package_order_id`, `package_task_id`, `package_cost_code`, `labor_task_id` and `labor_cost_code`. The package task must be a recorded delivery milestone; the labor task must already depend on it. Explicitly choose `share_with_owner_agents: true` or `false`.
3. Read the retained packet at `GET /api/plinth/jobs/<job-id>/recovery/requests/<request-id>`. The owner can inspect historical packets even when their source review is stale. Agents can access only current, consented packets.

The source packet contains private business facts. Setting `share_with_owner_agents` authorizes current owner-sponsored draft agents to use these exact facts under the installation's current agent policy. It grants no raw cost-door access or external audience. Revoke it with `POST /api/plinth/jobs/<job-id>/recovery/requests/<request-id>/revoke`, the current `expected_version` and `confirm: true`.

## Preparing alternatives

Send `POST /api/plinth/jobs/<job-id>/recovery/requests/<request-id>/compare` with `expected_version`, a unique `key` and exactly two `alternatives`. Each alternative supplies:

- An `id`, `name`, dated `assumptions` and native `schedule` preview input. Keep every recorded task, milestone and dependency. Durations and allocations are proposed assumptions.
- Native `forecast` assumptions for every current code: remaining quantity, minutes per unit, labor rate in integer cents per hour, exact unconsumed commitments, unbought cost, risk and source reference. Pending client prices never become approved revenue.
- An inert `amendment` with proposed delivery date, additional integer cents and reason. Its additional cost enters the package code exactly once. No purchase amendment is issued or sent.
- An unapproved `client_decision` description and proposed integer price delta. That delta is shown separately and does not enter native margin or expected collections.
- `cash` assumptions with `start_period`, `months`, `opening_cash_cents` and one `remaining_dates` entry per code. Optional `invoice_dates` can rephase an existing issued invoice's unpaid balance; they create no invoice or receipt.

The native planner calculates working-calendar completion and propagates dependencies. Recorded leave, availability, capacity, travel and work holds remain in force. The bound labor task must also supply enough crew minutes for the forecast's remaining labor effort. A feasible native proposal still requires actual supplier, subcontractor, builder and client decisions.

Money is integer cents. Expected cash uses recorded unpaid sources and explicitly dated remaining assumptions. It is not a bank balance or accounting reconciliation. The `difference` fields are the second alternative minus the first: a negative finish difference is earlier, and a negative margin difference is worse.

## Human review and MCP

The owner records a reasoned preference or rejection at `POST /api/plinth/jobs/<job-id>/recovery/requests/<request-id>/review/<proposal-id>`, supplying `expected_version`, the proposal `digest`, `alternative_id`, `decision: "retain"` or `"reject"`, and `reason`. Infeasible alternatives cannot be retained. Both alternatives and every earlier review remain immutable history. Retaining a comparison authorizes no commitment, baseline publication, attendance confirmation, client change, delivery receipt or funds movement.

MCP exposes `plinth.recovery.requests`, `plinth.recovery.read` and `plinth.recovery.compare`. A comparison call needs both the shared door's `idempotency_key` and its native proposal `key`. Its reply is an opaque draft reference; read the packet to inspect the comparison. Replaying a key never creates a second proposal, and changing its alternatives is refused.

Relevant source changes require a new owner review. Revoked consent, changed sponsor authority, changed policy decisions and erasure also fence cached replies. Archives retain historical alternatives and rejections, while restored authority requires an explicit new destination-owner packet. Proposal work emits no connector or notice event and leaves the existing human execution doors unchanged.
