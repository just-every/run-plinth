# Plinth demo

Run `rer demo` after setup, then open its private `RER_OPEN` link. The workspace
opens signed in as Alex Morgan of Banksia Build, named **Plinth Demo**, with
four realistic Brisbane jobs.
Three accepted jobs have booked trades, published site diaries, client-approved
and pending variations, supplier orders, partial receipts and reconciled claims.
The fourth job has a revised quote awaiting acceptance. Dates are relative to
the start. These are real editable Plinth records, created with the same domain
commands as ordinary work and persisted with fixed IDs and insert-only writes.
The hook completes first run and never fetches.

Stop with `rer demo --stop`. Each start gets a fresh `.rer/demo/` database;
the owner's `.wrangler/state` is unchanged. No demo bar, timer or outbox is
injected. Ordinary local dev is labelled Plinth Dev.

The runtime is published `@runeditrun/rer` 0.2.24 in package mode. All vendored
Base modules are copied together from `rer-v0.2.24`, commit
`1ee378e41142c673a9098f60af21664c6d8477d1`, recorded through Base's
`edition-authoring/cli.mjs refresh-base` in `base-copies.json`. The legacy
composition record retains the original foundation and applied migrations;
its superseded module entries are replaced by that current copy record.

Plinth sends only authentication mail: invitations, sign-in and step-up links,
and account/owner notices through Base operator-auth. `operatorMail` selects
Base’s development mail sender under `RER_DEMO`; it validates and silently
suppresses delivery. Base operator-auth accepts that result for invitations
and sign-in links. Local development mail validates and is silently suppressed. There is no capture UI. Production uses its real
configured mail provider. Plinth has no public URL checker, external bookkeeping
connector, AI feature, SMS, web push, payments or webhook delivery. Claims and
purchase orders are local working records, and exporting downloads a file.
File-based Accepted jobs CSV import never calls an external provider.

Hosted demos use Base's per-visitor Container, existing signed owner claim
route, 60-minute lifetime and 15-minute idle expiry. `deploy-demo.json` declares
only public demo settings, including the Banksia Build owner
`alex@banksiabuild.example` and the basic instance type.
`.github/workflows/run-demo.yml` reads the `run-demo` environment and is manually dispatched. Its `test_only` mode deploys
`demo.test.run-plinth.com` with Cloudflare's published Turnstile test keys;
production uses the real environment keys. Dispatch with `test_only` and
`remove` to delete the test host and read back that its resources are gone.
The workflow never enables repository deployment variables.

For a hosted start cohort, the test-only workflow first observes 15 minutes
with no admissions, then keeps its tail open for seven minutes while the
harness runs. Start the harness once **Observe quiet test-host window** passes.
The `demo-observations` artifact contains only demo events and observation
times; credentials, request headers, cookies and bodies are never retained.
