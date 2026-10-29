# Private decision preparation

The decision graph prepares private evidence and unsent requests. It does not choose a client option, approve a substitute, issue an order, send to a vendor or record delivery. Those actions keep their existing human review doors.

A signed-in owner creates a reviewed packet by posting to `/api/plinth/jobs/{job_id}/decision-graphs`. Supply the current `expected_version`, a calendar `as_of` date, an explicit `confirm: true`, a `review` reason and one or more `links`:

```json
{
  "selection_id": "exact-native-selection-identity",
  "revision_id": "latest-selection-revision-identity",
  "task_ids": ["dependent-task-identity"],
  "product_ids": ["reviewed-alternate-product-identity"],
  "rfi_ids": [],
  "order_ids": [],
  "lead_days": 14,
  "review_days": 5,
  "buffer_days": 2
}
```

Each selected record must belong to that job. An RFI must name a selected dependent task; an order must bind the exact selected decision revision. A product reference pins its latest reviewed supplier capture. Lead days cannot shorten the selection or selected product source. No unselected record is included in the packet.

The latest safe decision instant is the earliest dependent task start minus the stated lead, review and safety buffers. These are elapsed whole UTC calendar days, with the basis retained in the packet. The as-of date controls the warning and supplier quote validity; this is a reproducible proposal, not a published schedule promise.

Comparisons cite original and proposed specifications and supplier quotes. Supplier quote differences do not establish a client price. Missing price bases stay unknown. Expired or discontinued captures are marked unavailable. Submittal evidence remains unavailable in this packet; the existing submittal register and release requirements still apply.

The owner can list packet identities with a GET to the collection or read one with a GET to `/api/plinth/jobs/{job_id}/decision-graphs/{packet_id}`. A historical owner read includes `current: false` when selected evidence changes. The original comparison remains intact. Drafting and agent reads refuse stale packets, so the owner must review a new packet rather than silently updating its sources.

POST to `/api/plinth/jobs/{job_id}/decision-graphs/{packet_id}/draft` with `expected_version` and a stable `request_id` to retain an unsent request. Repeating that request identity adds no duplicate draft. The text is private, consent is unverified, and no recipient or outbound authority is inferred.

The MCP tools `plinth.decisions.list`, `plinth.decisions.read` and `plinth.decisions.draft` use only the sponsoring owner's reviewed packets. The draft tool also requires the normal agent-door idempotency key. Current policy, sponsor authority and source revisions are checked. A raw bearer cannot use the private packet HTTP doors. Custom roles, administrators, clients and other jobs gain no packet access.

Evidence distinguishes proposed choices, native signed approval, recorded vendor acknowledgment and human-recorded receipt. A draft, provider acceptance or acknowledgment never establishes receipt. Selected procurement can be complete only after every ordered physical quantity is received; a partial receipt, return, cancellation or unresolved selected RFI prevents closure. Monetary rounding never establishes a complete physical quantity. This completion state describes the selected native procurement evidence, not complete submittal handling or external follow-through.

Private archives retain reviewed evidence and draft history. A restored packet does not carry active drafting authority: a fresh owner review is required. Job erasure removes its packets with the job, and the existing erasure journal fences old archive replay.
