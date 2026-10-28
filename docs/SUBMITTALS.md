# Vendor submittals

Open a job’s **Purchasing** page. Prepare a draft purchase order, then use
**Register a required submittal** to identify the exact vendor product version,
required review date, specified scope and designated reviewer. Attach one to
five original PDF, PNG or JPEG files, each up to 2 MB. Declare every known
deviation from specified scope explicitly.

The owner registers, routes, resubmits and selects an approved version. The
designated current internal job manager annotates the original’s page and
records an explicit approved, rejected or revise-and-resubmit disposition with
comments. Existing job assignments, document permissions and financial order
visibility apply. Agents and external people cannot use this office register.
These conservative authority defaults await ct confirmation; they do not grant
external designer or supplier access.

Each resubmission appends a cycle with its own originals, reviewer authority,
annotations and decision. A closed cycle cannot be changed. Downloads retain
the original bytes and verify their checksum. Earlier cycles remain visible
after a new submission, including its rejected product and scope deviations.

Select the exact approved product version before using the ordinary PO issue
door. Issue, shipment, receipt, approved amendments and supplier sends recheck
the current cycle, exact commitment economics and reviewer authority. An
amendment needs a new cycle reviewing its proposed economics. A new cycle or
revoked reviewer holds later procurement effects; restoring an assignment
does not revive an earlier review. Register requirements before issuing the PO.
An existing issued commitment cannot acquire a retroactive review requirement.

Submittal review sends no supplier notice. Use an authorized supplier channel
to communicate the reviewed originals and disposition. Automatic supplier
notification and full notification routing remain unfinished DOC-004 work.

The native archive includes the register, exact file bytes and review history.
Job erasure removes that history and its originals under the existing hold
and erasure rules; a later erasure journal fences an older archive.

The public register is `GET /api/plinth/jobs/{job}/submittals`. The collection
accepts an owner submission, and each record has `annotate`, `review`,
`resubmit` and `release` actions using the current job version and exact
cycle identity. The dedicated originals door applies the same current access.
