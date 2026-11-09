# Native actuals refresh preview

The signed-in owner opens Billing and chooses **Review sources and prepare preview**.
Reload sources before reviewing a new receipt, native bill or correction. The review
binds exact native source identities, revision digests, recorded dates, review states
and captured original checksums. Older receipt references have no captured original;
the screen says so rather than inventing custody.

Enter fresh assumptions for every ledger code: remaining quantity, minutes per unit,
hourly labor cents, unbought cents, risk cents and evidence. Blank assumptions leave the
forecast unavailable. Existing native calculations combine posted actuals with open
commitments and explicit unbought costs. Matched commitments enter once. Pending
scenarios never create approved revenue.

Explicitly allocate materials still stored to each SOV row and its issued POs.
The preview freezes completed-work values at the last human-approved application.
Shared receipt capacity is allocated once, and approved contract retainage rules
calculate prospective gross, withheld and net values. Missing approved SOV or
retainage terms remain unavailable; an unsupported allocation has a reason.
An unapproved daily note cannot certify completion.

Each saved preview retains its assumptions, exact source inventory, unresolved
exception owners and dates, and per-code differences from the prior saved preview.
A source correction marks earlier reviews stale. Historical snapshots remain readable
as history, with stale and inactive review labels. Replaying an operation cannot create
another preview or change reviewed inputs. Archives retain the history but exclude
installation-local review authority; the destination owner creates a fresh preview.

The private HTTP door is at `/api/plinth/jobs/:id/actuals-refresh`: GET lists current
sources and history, POST saves an explicitly confirmed review, and GET with a preview
ID requires its current source revision and local review. Owner sessions alone use
these doors. Bearer agents and other roles gain no new access.

This preview does not approve field time or production, post a bill, approve or issue
a claim or invoice, publish dates, clear an exception, send or pay. Native discrepancies
remain unresolved, and external accounting actuals remain explicitly unavailable
without authorized synchronization and independent reconciliation.
