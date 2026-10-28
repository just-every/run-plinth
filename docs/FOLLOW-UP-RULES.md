# Follow-up preview rules

The owner opens People & access, then Settings, and chooses a job. Each estimate,
selection and collection sequence keeps its attributed configuration revisions.
Editing, pausing and resuming append a revision; they never overwrite an earlier one.

The rule records recipients, explicit recipient preview consent, a configuring-owner
escalation recipient, quiet hours in an IANA time zone, a whole-cent review limit,
ordered steps, start and stop dates, and an event or scheduled trigger.
A recipient enables or withdraws their own consent in the job's follow-up Settings.
The default is off. This consent authorizes previews only.

An event sequence starts at estimate preparation, selection presentation or an issued
invoice's due date. A scheduled sequence starts at the later of its configured start
and the source's scheduled date. Selection scheduled dates use the decision deadline.
Step offsets are calendar days, with due dates evaluated in the rule's quiet-hours zone.

A dated preview reads the current source state and returns one stable prospective
identity for each rule, source revision, step and recipient. It records the rule
revision in the returned action. It does not reserve, deliver, acknowledge or persist
an action. Repeating a preview returns the same prospective identities, rather than
creating work or consuming a step.

Only the current estimate draft on a quoting job, the current presented selection,
and a positive balance on an issued invoice can be eligible. Accepted estimates,
signed, disputed or withdrawn selections, and fully reconciled invoices are withheld.
A recipient opt-out stops the sequence, including escalation. Pause, expired stop dates,
quiet hours, insufficient consent, missing current access, mailbox suppression,
changed installation authority and amounts above the owner's limit are withheld with
an explanation. Escalations remain with the configuring owner and concern outstanding
work only. No financial decision is authorized by the review limit.

The job's rule collection, its dated preview read, and each person's own consent
collection are beneath /api/plinth/jobs. Each save uses the current job version and
ordinary authentication, audit, erasure and transaction fences. Rule configuration and
other people's consent history are private to the owner. Restore never makes an old
installation generation current.

Remaining AUTO-001 work includes actual notice delivery and once-only dispatch
history, recipient channel selection and required-notice routing, provider outcomes,
and bid, RFI, confirmation and warranty integrations. NOTIFY-001 retains its configured
mail, Twilio sender, APNs and FCM prerequisites. INT-007 retains its hosted catch-all
and signed webhook proof and its applicable policy boundaries. AUTO-003 and AUTO-004
retain the field approval and processor and accounting reconciliation dependencies.
These preview settings neither implement those duties nor waive them.
