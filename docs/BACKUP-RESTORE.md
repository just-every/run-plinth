# Backup and restore

Export a private archive before moving installations or removing local state. It carries your jobs, approval records, daily-log photos and retained import history.

## Make a local backup

Run from your Plinth checkout and stop the app before transferring data:

```sh
rer dev --stop
rer export --output exports/plinth.rer
```

If you are running a preview server, stop it with `rer preview --stop` as well. Keep the archive in the checkout's private `exports` folder or at an absolute path outside the checkout. Do not put archives in public assets or build output.

The archive contains:

- Jobs, quotes, change orders, schedules, daily logs, purchase orders, receipts, pay apps and approval snapshots.
- Daily-log photo bytes.
- Import original-byte custody, plans and journals, including erasure history.
- Durable account metadata.

It excludes sessions, credentials, private settings and local outbox messages. Protect the archive as confidential building and client records. Copy it to your own secure storage before relying on it as your backup. You can restart the app with `rer dev` after export.

## Restore into an empty installation

Use a fresh checkout of the same application version. An import restores into an empty destination; it does not merge with existing jobs.

From the destination checkout, run:

```sh
rer import --input /private/path/plinth.rer --yes
rer setup
rer dev
```

Replace `/private/path/plinth.rer` with the archive's actual private path. Enter the destination owner's email privately during setup. Configure its mail and private settings again; the archive does not carry them. Open the newly printed private sign-in link and complete the setup screen if prompted.

Check **Jobs**, accepted quotes, approvals and downloaded daily-log photos. Open **Move in → Import journal** to inspect retained imports. Use the destination's new owner session to manage retained imports.

## Compare a native recovery inventory

As the signed-in owner, open **People & access → Settings → Backup recovery comparison**.
Choose **Download recovery manifest** before stopping the app for the CLI export.
Keep that JSON file with the private archive. It contains record identities, revision
references, original-file byte sizes and SHA-256 checksums, table coverage and
financial control totals. The JSON manifest is confidential and does not contain the original
record bodies or file bytes. It cannot restore data or grant access.

After the existing CLI import into an empty installation and owner setup, open
the same Settings control, choose the source JSON file and select **Compare recovery
manifest**. The report lists missing, extra and changed records and originals,
source and current financial totals, and any changed coverage or exclusions.
A supplied manifest is an unverified claim; a match does not establish its origin.
Compare immediately after restoration: later edits, downloads that add audit
events, erasures or other native activity can produce legitimate differences.

The same Settings panel offers **PDF**, **CSV** and **XLSX** inventory reports.
These include every inventoried native record identity, revision and digest;
original-file integrity metadata; table coverage; exclusions; control totals;
and readable native field paths and values. Original payload bytes are replaced
by their measured size and checksum. Keep the CLI archive and the original
native downloads when you need the actual files. Spreadsheet text remains text,
including values beginning with formula operators; financial values stay numeric
and currencies remain separate.

After comparison, choose **Comparison report format** and **Download comparison
report**. Each format includes the missing, extra and changed identities, source
and current controls, and the receiving installation's current field inventory.
The report evaluates current records when downloaded. Later edits can therefore
change it from the comparison displayed earlier. These reports are confidential
and require a current signed-in owner; administrator, client and bearer access
are refused. Downloading a report changes no record or sending authority.

Control totals group each currency separately. Issued gross, signed corrections,
net receipts including reversals, deposit applications, write-offs and posted
cost entries are added from their native source facts independently of the
ordinary report and balance projections. These totals are controls, not a current
receivable balance or independent external accounting verification. Draft invoices
and unposted costs contribute no issued or posted amount. File checksums are
calculated from retained bytes, including inline originals and assembled chunks.

The owner can also download `./api/plinth/recovery/manifest.json` with a session
and submit that JSON as the `manifest` field to
`./api/plinth/recovery/reconcile`. The comparison changes no data or authority,
performs no provider operation, reconnects no receiver and resumes no pending send.
Clients, administrators and bearer credentials are refused. An old manifest cannot
restore erased content or bypass the CLI's later-journal refusal described below.

The semantic inventory covers currently implemented native product and import
custody records. Its exclusions explicitly retain Base account and bootstrap
metadata, provider state, live connector grants and queues, credentials, sessions,
private settings and standing consent outside comparison. The existing CLI remains
the archive and restore door; its account custody and ownership rules are unchanged.
Complete target-wide recovery, entities not yet implemented, external accounting
reconciliation and complete target-wide human reporting remain owed. Native D1
field inventories and comparison reports do not establish those wider outcomes.
Restored tasks still need explicit destination-owner review.

## Explicitly hand ownership to the receiving owner

Restoring an archive preserves its durable accounts and recorded approval
identities. Changing the configured owner mailbox does not transfer these
accounts or let an unrelated person bootstrap over them. The source's sessions
and credentials are absent from the destination.

Use the existing native account doors for an intentional handoff after restore:

1. Sign in to the destination as the archived owner with a new native email link.
2. Request and complete an **owner:transfer** confirmation through
   `POST /auth/step-up`. Invite the receiving mailbox as an owner through
   `POST /auth/invite`, with explicit owner authority and fresh confirmation.
3. The receiving person accepts that invitation and signs in separately. They
   complete their own fresh **owner:transfer** confirmation, then use
   `POST /auth/operator/role` to remove owner authority from the source account.
4. Compare the original manifest and download native originals as the receiving
   owner. The old owner session is invalid immediately after the role change;
   historical source identities, approvals and financial facts remain intact.

This is a separate, explicit account-administration ceremony. Importing or
comparing a manifest never performs it. If the archived owner cannot authorize
the handoff, retain the archive privately and obtain that authorization; changing
bootstrap rules or editing stored account identities is not a recovery step.
Reconnecting providers and reviewing restored work remain separate actions.

## Reconnect native receivers

Backups retain an inert checklist of receiver origins, job IDs, event types and
revocations. They omit full endpoint paths, query strings, signing keys, provider
credentials and standing consent. A restored checklist cannot send anything.
Follow [Restoring connector configuration](NATIVE-API.md#restoring-connector-configuration)
to inspect it as the destination owner, re-enter each endpoint privately and
reconnect with a newly minted credential and explicit approval. Configure the
new signing key at the receiver. Scheduled delivery needs a separate fresh
standing grant and never replays pre-grant events automatically. Older archives
without a checklist require manual receiver configuration.

## Erase a job and carry the erasure forward

Only the owner can permanently erase a job. In that job, open **History → Erase this job**, choose **Erase job permanently** and confirm.

Erasure removes the job and its photo bytes, retires its imported source custody and records durable erasure history. If the job shared an imported CSV with other jobs, the whole original CSV becomes unavailable; the other jobs' normalized records remain. Undoing an import is different: undo retains its source custody.

An older offline backup cannot learn about a later erasure by itself. Keep a new archive made after erasure as a trusted later journal:

```sh
rer dev --stop
rer export --output exports/after-erasure.rer
```

Before attempting to restore an older backup, copy this later archive into the empty destination checkout as the private file `after-erasure.rer`. The pinned CLI requires the `--journal` path to be relative to the checkout. Then run:

```sh
rer import --input /private/path/old.rer --journal after-erasure.rer --yes
```

Plinth refuses the old archive when it predates the erasure. This is a refusal, rather than a restore with the erased job silently removed. Restore a current archive instead. Keep journal archives private and securely remove obsolete backups under your retention policy.

## Reset local state

`rer reset --yes` destroys the checkout's local data, accounts, sessions and generated private settings. Export first if you intend to retain them. Stop the app before reset.

Reset keeps source code and owner export archives; it is not a backup command. After reset, setup creates a fresh installation. To recover retained records, restore your archive into that empty destination and run setup again.

For supported transfer flags, run `rer import --help` or `rer export --help`. The [project README](../README.md) covers installation and deployment; the [CSV reference](IMPORT.md#undo-erasure-and-restore) explains import custody and erasure in detail.
