# Owner follow-up rules

The owner opens People & access, then Settings, and chooses a job. Each estimate,
selection, collection, bid, RFI, confirmation and warranty sequence keeps its attributed configuration revisions.
Editing, pausing and resuming append a revision; they never overwrite an earlier one.

The rule records recipients, explicit recipient preview consent, a configuring-owner
escalation recipient, quiet hours in an IANA time zone, a whole-cent review limit,
ordered steps, start and stop dates, and an event or scheduled trigger.
A recipient enables or withdraws their own consent in the job's follow-up Settings.
The default is off. Existing preview consent alone authorizes no delivery. A person
separately chooses email or off and their own quiet hours for that sequence. Each
choice appends an attributed preference revision. Both the owner rule and the
recipient quiet window must permit a delivery; a personal choice never shortens
the rule window.

An event sequence starts at estimate preparation, selection presentation or an issued
invoice's due date. A scheduled sequence starts at the later of its configured start
and the source's scheduled date. Selection scheduled dates use the decision deadline.
Step offsets are calendar days, with due dates evaluated in the rule's quiet-hours zone.

A dated preview reads the current source state and returns one stable prospective
identity for each rule, source revision, step and recipient. It records the rule
revision in the returned action. It does not reserve, deliver, acknowledge or persist
an action. Repeating a preview returns the same prospective identities, rather than
creating work or consuming a step.

Only current outstanding sources can be eligible: the latest estimate draft on a
quoting job, a presented selection, a positive issued-invoice balance, an unanswered
bid invitation, an unresolved RFI, a current unconfirmed trade invitation or an
open warranty case. Private bid, RFI, confirmation and warranty sequences currently
name owner recipients only; they grant no new external record access. Accepted estimates,
signed, disputed or withdrawn selections, and fully reconciled invoices are withheld.
A recipient opt-out stops the sequence, including escalation. Pause, expired stop dates,
quiet hours, insufficient consent, missing current access, optional-mail suppression,
changed installation authority and amounts above the owner's limit are withheld with
an explanation. Escalations remain with the configuring owner and concern outstanding
work only. No financial decision is authorized by the review limit.

The job's rule collection, its dated preview read, and each person's own consent
collection are beneath /api/plinth/jobs. Each save uses the current job version and
ordinary authentication, audit, erasure and transaction fences. Rule configuration and
other people's consent history are private to the owner. Restore never makes an old
installation generation current.

An owner can separately approve once-only email delivery on a rule revision. The
hourly scheduler and the explicit Run now action evaluate the current installation
time. A dated preview cannot move the dispatch clock. Both paths reserve one
identity per rule, source revision, step and recipient before contacting the mail
provider. Changing a rule does not make an already reserved step send again.
History keeps the exact rule revision, recipient preference revision, source, step,
channel, required reason, owner and provider outcome. Accepted means provider
acceptance only. Signed delivery events update the displayed mail outcome.
Refused, unconfigured and unknown attempts are retained and never automatically
resent; the owner must review outstanding work through a separate ordinary door.

Required notices need an explicit owner reason and a recipient who has opted into
the sequence. They use email when that person's channel choice is off, stating why.
Withdrawing sequence consent stops the sequence, including escalation. Under the
INT-007 RL-101 suppression boundary, a required notice to an unsubscribed mailbox
may proceed, but an unusable or provider-suppressed mailbox creates an owned
alternative-channel follow-up in history without an email instruction. The owner
must arrange the authorized alternative; the software claims no delivery.

Immediately before an effect, dispatch rechecks the surviving job, source,
configuring owner, installation generation, recipient access, consent, channel,
quiet hours and exact rule revision. Pausing or resolving work, withdrawing consent,
revoking access or erasing the job prevents a new eligible instruction. Rules never
make a financial decision. Earlier preview-only revisions remain inert until the
owner and recipient make separate delivery choices.

Changing a recipient to a reader role withholds pending notices without consuming
their source steps. Restoring their applicable access permits a pending step once;
simultaneous Run now requests cannot reserve it twice. Opt-out, pause and recorded
acceptance also withhold fresh, never-attempted sources.
If a job is erased while its mail instruction is already at the provider, late
completion cannot recreate the job or authorize another notice. An archive retains
the rule, recipient preferences and attempt history, while the receiving installation
withholds future steps until its owner reviews the restored authority.

Remaining AUTO-001 work includes the complete NOTIFY-001 multi-channel and digest
routing, role defaults, delegated source recipients and real provider proof.
NOTIFY-001 retains configured mail, Twilio sender, APNs and FCM prerequisites.
INT-007 retains its hosted catch-all and signed webhook proof and its applicable
policy boundaries. AUTO-003 and AUTO-004 retain field approval and processor and
accounting reconciliation dependencies. The adopted owner-only configuration and
private-source recipient default stays PARTIAL under the standing scope policy;
no scoped delegation or full notification-channel completion is claimed.
