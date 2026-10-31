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

Submittal review sends no automatic supplier notice. Prepare the PO with its
supplier email, then open **Notify supplier of this review** on the current
completed cycle. The signed-in owner explicitly authorizes sending the
exact product version, disposition, comments, annotations and specified-scope
deviations. Providers supporting attachments include the reviewed originals.
RER managed mail instead identifies each retained original by filename, media
type, byte size and SHA-256 checksum, and names the sender’s contact address
in the body. It does not attach files or grant supplier access to the office
register. The notice
does not issue a PO or release procurement. Other recipients, older cycles,
unreviewed packages, changed commitment terms, revoked reviewers and suppressed mailboxes are refused.
Use an authorized alternative channel for a suppressed mailbox.

The register retains the recipient, cycle, sending person and provider outcome
for each attempt without changing the review cycle. Provider acceptance is
labelled as acceptance, never confirmed mailbox delivery. A refused attempt
can receive a new explicit owner send. An accepted or unknown attempt cannot
be sent again, including after archive recovery. An unknown outcome requires
reconciliation with the supplier outside this send door. Full NOTIFY-001
channel preferences and signed delivery reconciliation remain unfinished;
this explicit email door does not claim to implement them.

The native archive includes the register, exact file bytes and review history.
Job erasure removes that history and its originals under the existing hold
and erasure rules; a later erasure journal fences an older archive.

The public register is `GET /api/plinth/jobs/{job}/submittals`. The collection
accepts an owner submission, and each record has `annotate`, `review`,
`resubmit`, `release` and `notify` actions using the current job version and exact
cycle identity. The dedicated originals door applies the same current access.
