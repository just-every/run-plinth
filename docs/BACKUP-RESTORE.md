# Backup and restore

Export a private archive before moving installations or removing local state. It carries your jobs, approval records, diary photos and retained import history.

## Make a local backup

Run from your Plinth checkout and stop the app before transferring data:

```sh
rer dev --stop
rer export --output exports/plinth.rer
```

If you are running a preview server, stop it with `rer preview --stop` as well. Keep the archive in the checkout's private `exports` folder or at an absolute path outside the checkout. Do not put archives in public assets or build output.

The archive contains:

- Jobs, quotes, variations, schedules, diary entries, purchase orders, receipts, claims and approval snapshots.
- Diary photo bytes.
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

Check **Jobs**, accepted quotes, approvals and downloaded diary photos. Open **Move in → Import journal** to inspect retained imports. Use the destination's new owner session to manage retained imports.

## Erase a job and carry the erasure forward

Only the owner can permanently erase a job. In that job, open **History → Erase this job**, choose **Erase job permanently** and confirm.

Erasure removes the job and its photo bytes, retires its imported source custody and records durable erasure history. If the job shared an imported CSV with other jobs, the whole original CSV becomes unavailable; the other jobs' normalised records remain. Undoing an import is different: undo retains its source custody.

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
