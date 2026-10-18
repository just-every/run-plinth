<img src="public/brand/mark.svg" alt="" width="54" height="60">

# Plinth

Construction management for a small US residential builder or remodeler: accepted quotes, a trade schedule, daily logs, client-approved change orders, supplier orders and reconciled pay app exports. MIT licensed; data lives in your own installation.

## Clone and run

Two lines, the same as the [Run page](https://run-plinth.com/run). Install `rer`, the Run Edit Run command (it brings its own Node if you have no Node 22 or later; if it prints an `export PATH=…` line, run that line first), then start Plinth:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
rer dev just-every/run-plinth
```

Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-plinth` does both in one line. It runs on macOS, Linux or Windows with WSL2, with git. To start it again later, run `cd run-plinth && rer dev`.

The first run installs the locked dependencies, selects Node 22.20.0 and pnpm 10.12.4, prepares D1 and creates your local owner. Open the printed `RER_OPEN` link to sign in, finish the short setup screen, then open **Jobs**. That link is a credential: keep it private. Setup and mail are local; no external messages are sent. A compatible repeated `rer dev` reuses the server. Stop it with `rer dev --stop` or Ctrl-C.

For an installation using your real mailbox, run `npx -y @runeditrun/rer install just-every/run-plinth`, then `rer setup` from the checkout and enter the owner's email at the prompt. `rer dev` opens signed in automatically, including with the legacy `--login` flag. Local mail is silently suppressed. A hosted installation sends client and manager invitations through its configured mail provider.

## Take a job through the first release

1. In **Jobs**, create a job with the client's email and site address. Open **Quote**, enter scope and total, then prepare the revision. Record the actual client acceptance method and reference. The accepted quote stays fixed.
2. In **Schedule**, book a subcontractor with start and end times; the chart shows every booking against today. The same trade cannot overlap another booking, even on another job. In **Daily logs**, publish notes and PNG/JPEG photos (up to 2 MB each).
3. In **People & access**, invite the job's client as **Client**. Prepare a change order in **Changes**. The client follows their invitation, opens their job and approves that exact amount and scope. A manager cannot approve on the client's behalf. For a local walkthrough, use `client@dev.localhost` on the job and run `rer dev --as client` to obtain a separate local client sign-in. Run `rer dev --as owner` to return to the builder.
4. In **Purchasing**, prepare and issue a PO. Send the approved details to the supplier through your usual channel, then record delivery references and received value. This records a commitment; it does not send an order or pay anyone.
5. In **Billing**, enter the work billed to date. Review the accepted quote, approved change orders, earlier pay apps and supplier totals. Approve, record the export, then download CSV and the full JSON reconciliation. Re-downloads keep the same approved record. Amounts include sales tax if your quote does; Plinth does not calculate tax or issue invoices. Exports are in USD.
6. **History** shows the exact records and people behind approvals. [Agent commands](docs/COMMANDS.md) allow draft preparation with a scoped credential; human approval remains required.

The owner can use **Move in** to dry-run and approve an [Accepted jobs CSV](docs/IMPORT.md). Documented-shape fixtures live under `tests/fixtures/`. Imported acceptance evidence is kept, but native jobs remain drafts until a manager confirms acceptance. The import journal supports resume and undo; native edits survive undo.

## Keep, restore or erase your data

Stop the app before command-line transfers:

```sh
rer dev --stop
rer export --output exports/plinth.rer
# In an empty destination checkout, with the same application version:
rer import --input /private/path/plinth.rer --yes
rer setup
rer dev
```

Archives contain jobs, approvals, diary photo bytes, import source custody and journals, and durable account metadata. Sessions, credentials, private settings and local outbox messages are excluded; set up the destination's owner and mail configuration again. A restore requires an empty destination. Protect archives as confidential building/client records. `rer reset --yes` destroys local state and settings; export first if you intend to keep them.

The owner can permanently erase a job in **History → Erase this job**. This also retires its import custody and photo bytes. Keep an archive made **after** erasure as the later journal. Copy that later archive into the destination checkout as private `after-erasure.rer` (the pinned CLI requires a checkout-relative journal path). On a fresh destination, `rer import --input old.rer --journal after-erasure.rer --yes` refuses an old archive that predates the erasure. An offline old backup cannot know about erasure without that later journal; securely remove obsolete backups under your retention policy.

## Deploy to your Cloudflare account

Use the RunEditRun account for fleet work. Your own fork can use your own account. The shared owner-account deploy kit provisions the Worker and D1, applies every migration and checks health and assets:

1. Run `rer setup` with your actual owner email. Configure a verified Resend sender in `deploy.json` (`MAIL_FROM`); the default example address must be replaced. Other Base mail providers require their corresponding configuration.
2. Supply `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `OWNER_EMAIL`, `SESSION_SECRET`, `SETUP_TOKEN` and `MAIL_API_KEY` through your private shell environment or secret manager. Use strong, distinct generated secrets. Never commit them or pass their values as command arguments.
3. Commit your configuration change. Run `rer deploy --dry-run` to build and validate without contacting a provider, then `rer deploy`. Open the printed deployed URL and use an email sign-in link. The production app has no local dev identity or outbox. No custom domain is required.

Worker `construction-plinth`, project `construction/plinth`, edition `plinth`, local D1 `foundation` and package `@construction/plinth` are stable identifiers; do not rename them during an update. Hosted mail delivery and deployment need your account credentials and are not exercised by this first-release seed build.

## Development

`rer describe` lists supported commands; `rer check` validates the command contract. `rer verify` builds and runs the integration tests and hosted-output checks; build and deploy do not run tests. CI has one **Verify** workflow per pushed commit, capped below 200 tests. See [ACCEPTANCE.md](ACCEPTANCE.md), [source reuse](docs/REUSE.md) and [the command contract](SEED-COMMAND-CONTRACT.md).

This edition started from committed Base `fc0e1041efa55771142bbb57c4ab4743147e264d` and pins published `@runeditrun/rer` **0.2.30**. The Base auth, installer, import kit, archive and deployment paths are reused. The run site wears the desk-approved look (the stepladder mark, Inter, chalk-line blue, oxblood and sea-glass; tokens in `public/site/theme.css`); setup and the workspace keep Albert Sans until their own round.

## Run site and guides

`rer build --site` builds the public homepage, `/run` instructions and `/docs` from the Markdown in `docs/`. The installed `/` remains the Lobby. `rer dev` prints a separate `RER_SITE` address for the public site. Start with [Getting started](docs/GETTING-STARTED.md), [the main flows](docs/MAIN-FLOWS.md), [Move in](docs/MOVE-IN.md) and [Backup and restore](docs/BACKUP-RESTORE.md).

The public site is at https://run-plinth.com. Updates to `main` publish it automatically through GitHub Actions. No deployment is needed to use the local copy.

## Try a fresh workspace

After setup, `rer demo` opens signed in to **Plinth Demo** with realistic job records. Stop with `rer demo --stop`; every start is isolated from your saved workspace. See [Demo mode](DEMO.md) for sample data, effects and hosting.
