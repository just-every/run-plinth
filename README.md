# Plinth

Contractor project management for a small residential builder: accepted quotes, scheduled trades, site diaries, client-approved variations, supplier orders and reconciled progress-claim exports. MIT licensed; data lives in your own installation.

## Clone and run

Install Git and Node 22 or newer. Install the shared command once if you don't have `rer`:

```sh
npx -y @runeditrun/rer cli install
export PATH="$HOME/.local/bin:$PATH"
git clone https://github.com/just-every/run-plinth.git
cd run-plinth
rer dev
```

The first run installs the locked dependencies, selects Node 22.20.0 and pnpm 10.12.4, prepares D1 and creates your local owner. Open the printed `RER_OPEN` link to sign in, finish the short setup screen, then open **Jobs**. That link is a credential: keep it private. Setup and mail are local; no external messages are sent. A compatible repeated `rer dev` reuses the server. Stop it with `rer dev --stop` or Ctrl-C.

Known launcher issue in RER 0.2.15: on a busy macOS host, the three-second process-inspection timeout can report “Another process answered” even when the application owns its port. Setup fails closed. Check actual port ownership before retrying; the upstream fix must distinguish an inspection timeout from a collision. Linux uses a different inspection path.

For an installation using your real mailbox, run `rer install`, then `rer setup` and enter the owner's email at the prompt. `rer dev --login` uses ordinary email-link authentication: open the printed local outbox, choose the latest message and confirm sign-in. The app's **People & access** page sends client and manager invitations to that outbox locally.

## Take a job through the first release

1. In **Jobs**, create a job with the client's email and site address. Open **Quote**, enter scope and total in AUD, then prepare the revision. Record the actual client acceptance method and reference. The accepted quote stays fixed.
2. In **Trades**, book a subcontractor with start and end times. The same trade cannot overlap another booking, even on another job. In **Site diary**, publish notes and PNG/JPEG photos (up to 2 MB each).
3. In **People & access**, invite the job's client as **Client**. Prepare a change in **Variations**. The client follows their invitation, opens their job and approves that exact amount and scope. A manager cannot approve on the client's behalf. For a local walkthrough, use `client@dev.localhost` on the job and run `rer dev --as client` to obtain a separate local client sign-in. Run `rer dev --as owner` to return to the builder.
4. In **Purchasing**, prepare and issue a PO. Send the approved details to the supplier through your usual channel, then record delivery references and received value. This records a commitment; it does not send an order or pay anyone.
5. In **Claims**, enter the cumulative work value to date. Review the accepted quote, approved variations, earlier claims and supplier totals. Approve, record the export, then download CSV and the full JSON reconciliation. Re-downloads keep the same approved record. Amounts include GST if your quote does; Plinth does not calculate tax or prepare statutory payment claims.
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

This edition started from committed Base `fc0e1041efa55771142bbb57c4ab4743147e264d` and pins published `@runeditrun/rer` **0.2.15**. The Base theme, auth, installer, import kit, archive and deployment paths are reused; a distinct visual design comes later.
