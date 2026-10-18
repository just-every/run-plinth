# Plinth demo

Run `rer demo` after setup, then open its private `RER_OPEN` link. The workspace
opens signed in as Erik Lindgren, owner of Minnehaha Design-Build, a Minneapolis
remodeler, named **Plinth Demo**, with five Minneapolis-area jobs. The first is
Job 2214, Ana Alvarez's second story in Linden Hills, run by project manager
Rosa Delgado, with the run site's records: the contract carried over from
Buildertrend at the move-in with change orders 1–6 and pay apps 1–3, change
order 7 (the skylight over the primary bedroom, signed by Ana at 7:48 pm) for a
$433,460.00 contract, the window slip in its daily logs, a siding booking the
Plinth agent drafted for approval, Northfield Window Supply's PO and pay app 4
for $62,790.00. Sam Becker's three other accepted jobs carry bookings, daily
logs, change orders, POs, receipts and pay apps; Hannah Olson's Lindqvist
kitchen quote awaits acceptance.

Each job is a timeline of steps in Minneapolis time, counted from the Monday of
the week the demo starts (a weekend start rolls to the coming Monday): on the
run site's calendar that Monday is Oct 19, 2026, the move-in is Fri Oct 9 and
change order 7 is Mon Oct 12. The steps run in time order through Plinth's own
domain commands, each record stamped with its step's time, and only the steps
up to now are played, so every daily log is published on the day it records,
approvals follow what they approve, a pay app bills only work done by its
period's end, and every booking and log falls on a weekday. These are real
editable Plinth records, persisted with fixed IDs and insert-only writes.
The hook completes first run and never fetches.

Stop with `rer demo --stop`. Each start gets a fresh `.rer/demo/` database;
the owner's `.wrangler/state` is unchanged. No demo bar, timer or outbox is
injected. Ordinary local dev is labelled Plinth Dev.

The runtime is published `@runeditrun/rer` 0.2.30 in package mode. All vendored
Base modules, the byte-equal runtime and installer files and
`.github/workflows/run-demo.yml` are copied together from `rer-v0.2.30`, commit
`d434ea67989fe10b6ddff01daba8bb350975e54a`, recorded through Base's
`edition-authoring/cli.mjs refresh-base` and `record-base` in `base-copies.json`.
The legacy composition record retains the original foundation and applied
migrations; its superseded module entries are replaced by that current copy
record.

Plinth sends only authentication mail: invitations, sign-in and step-up links,
and account/owner notices through Base operator-auth. `operatorMail` selects
Base’s development mail sender under `RER_DEMO`; it validates and silently
suppresses delivery. Base operator-auth accepts that result for invitations
and sign-in links. Local development mail validates and is silently suppressed. There is no capture UI. Production uses its real
configured mail provider. Plinth has no public URL checker, external bookkeeping
connector, AI feature, SMS, web push, payments or webhook delivery. Pay apps and
purchase orders are local working records, and exporting downloads a file.
File-based Accepted jobs CSV import never calls an external provider.

Hosted demos run on Base's native Worker demo host: each visitor gets their
own Worker Loader isolate with a SQLite copy of the `DB` database, signed in
through the existing owner claim route. Copies end after 60 minutes or 15 idle
minutes, and their storage is erased. `deploy-demo.json` declares only public
demo settings, including the Minnehaha Design-Build owner `erik@minnehahabuild.example`.
`.github/workflows/run-demo.yml` (Base's template) reads the `run-demo`
environment and is manually dispatched. Its `test_only` mode deploys
`demo.test.run-plinth.com` with Cloudflare's published Turnstile test keys and
admits only starts carrying the private measurement token; production uses the
real environment keys. Dispatch with `test_only` and `remove` to delete the test
host and read back that its resources are gone. The workflow never enables
repository deployment variables.
