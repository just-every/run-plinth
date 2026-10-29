# Foundation operations

Run all first-party operations from the composed, runnable edition checkout
with `rer`. To get a runnable checkout, run `npx -y @runeditrun/rer dev just-every/run-plinth` (set up only: `npx -y @runeditrun/rer setup just-every/run-plinth`; without Node: `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-plinth`). Inside that checkout, `rer dev` alone launches it for review. The detailed flags and effects are in
`RUN-LOCALLY.md` and `SEED-COMMAND-CONTRACT.md`.

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Use the setup prompt instead of the owner-email flag when entering the real
mailbox. Follow the newest ordinary sign-in message in the printed local
outbox; no external email is sent. Stop `dev` with
`rer dev --stop` or Ctrl-C, and stop `preview` with
`rer preview --stop` before build or verification.

```sh
rer verify
rer reset --yes
rer export --output exports/installation.rer
rer import --input exports/installation.rer --yes
rer deploy
rer describe
```

Use `rer describe` to inspect the checkout's actual
capabilities. `rer check --profile first-party` validates the
declared command contract; it does not run application journeys or contact a
provider.

## Local data and recovery

Setup and development use explicit owner identity and real local migrations.
Dev and preview use the same owner and canonical `.wrangler/state`; the local
development outbox is available only on loopback. Any process with access to
the machine can read that outbox and sign in as the owner. Private settings are
kept in `.dev.vars` with mode 0600 and are not copied into build output.

Local export creates a private archive with an integrity receipt and explicit
exclusions. The foundation has no product-domain tables or background jobs; an
edition's archive contains the supported domain tables and resources that its
adapter declares. Owner and authentication, outbox, bookkeeping, private settings and
transient runtime state are excluded. Import validates and restores atomically
into an empty destination; confirmed reset preserves export archives. Run setup
after restore to establish a fresh owner. Each first-party seed verifies local
export, import and re-export equivalence across its supported resources. Remote transfer
is available only when the adapter declares complete resource coverage.

Preserve ambiguous state and applied migration history. Never place a remote
credential, owner secret or local resource ID in source. A schema change needs
a forward migration and verified transition/recovery.

## Native connector recovery

The private archive retains receiver origin and scope metadata as an inert
checklist, including revocation markers. Full endpoint paths, query strings,
credentials, signing keys and standing consent remain installation-local.
After restore, the destination owner follows
[the connector recovery procedure](docs/NATIVE-API.md#restoring-connector-configuration),
re-enters the endpoint and creates a fresh credential before explicitly
reconnecting. A new standing grant is separate and covers only future events.
This native recovery does not configure external accounting connectors or
resume provider work that those future clauses have not implemented.

## Deployment

`rer deploy --dry-run` validates the real owner-account
deployment declaration and builds locally without provider requests. Real
deployment requires privately supplied `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`, the declared owner, session and setup secrets, and a real
verified mail sender in `deploy.json`. Follow the owner-account deploy-kit
instructions in the pinned rer package; account scope,
resource ownership, migrations, receipt and health checks are defined there.
Local validation does not prove hosted acceptance, provider delivery or remote
health.

## Hosted delivery package

`packaging.json` declares Plinth's Cloudflare Worker, its existing DB migrations,
setup manifest, recovery procedure and exact trusted build workflow. Run the
real `pnpm run build` first, then `pnpm delivery:spec` to regenerate the committed
import specification. `pnpm check:deployment-spec` checks freshness against the
build and policy. Package with `node scripts/delivery/base/cli.mjs package
--config packaging.json --output rer-package`; the output folder must be fresh.
The artifact command is `node scripts/delivery/base/cli.mjs artifact --config packaging.json`.
Generated packages and payloads stay outside source control.

Hosted sign-in and invitations need a configured sender. Managed hosting assigns
the RER mail provider, sender, HTTPS relay URL and private installation credential.
Assisted hosting offers RER mail, Resend, SendGrid and Cloudflare Email Sending;
enter the chosen provider's verified sender and private key, and the Cloudflare
account identifier when applicable. Local development suppresses external mail.
These declarations and local provider-edge checks do not prove live delivery.

Hosted deployment reads MAIL_FROM from the owner’s private deployment input and accepts only a verified sender. MAIL_PROVIDER selects Resend by default; MAIL_RELAY_URL is required for managed mail, and MAIL_ACCOUNT_ID is required for Cloudflare mail. The setup manifest labels every required private field. The supported targets are Workers and container hosting.


## Durable native report exports

The owner opens Reports, saves a scoped view, then requests CSV or XLSX under
Report export work. This captures the exact query revision, authorized source
identities and versions, selected values and a capture digest. Later source or
view edits do not rewrite that capture. Existing immediate exports remain available.

Requests capture at most 10,000 records and two million UTF-8 snapshot bytes.
Each Resume next chunk processes at most 25 captured rows and atomically saves
its checkpoint. It pauses after each chunk: closing the page, restarting the
Worker or losing a response never starts automatic work. Refresh shows durable
progress; a repeated or concurrent continuation of the same revision cannot
append rows twice. After a lost response, refresh before continuing.

CSV retains the native scope, filter and currency annotations. XLSX uses native
inline-string cells and retains the capture date. Final packaging is bounded to
eight million bytes. Size failures retain the last checkpoint and display the
reason; retry remains explicit, and an oversized capture needs a narrower new
view. A network failure is displayed without claiming that unsaved progress
completed. Cancel permanently removes captured rows and output chunks and
disables every continuation and download.

Only the current owner session may request, inspect, continue, cancel, review or
download this work. The continuation and download doors recheck current source
access. Erasing any captured source removes its task, checkpoints and final
output in the same database operation. A final download is recomputed from the
stored output chunks and must match its stored SHA-256 checksum; responses are
private and no-store. The checksum is shown beside the download.

Private archives carry snapshots and checkpoints, but exclude local work
approvals. After restore, every non-cancelled task is inactive until the
destination owner explicitly approves its exact capture digest under Report
export work. Neither restore nor review makes provider calls; review also
rechecks current source access. Cancelled work cannot be approved or restarted.
Follow the existing later-erasure journal instructions when restoring an older
backup. Credentials and standing connector authority remain excluded.

This native export workflow does not qualify credential rotation during large
drawing or import work, background AI or other drawing and import processing,
or external provider connector recovery.
