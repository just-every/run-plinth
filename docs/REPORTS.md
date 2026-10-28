# Portfolio sources and historical captures

Open **Custom fields and saved views** in the workspace. **Capture a portfolio
as of now** retains each current job version, the UTC capture time and assigned
project managers in one audited transaction. Capture before a reporting close
and choose that capture under **Portfolio sources and as-of capture** when
saving a historical view. Captures record what the installation knew then; they
do not reconstruct an earlier state that was never captured.

A saved view retains its capture, project manager, scheduled trade, cost code
and inclusive source date range. Manager assignment comes from the capture
when one is selected, otherwise from the current team. Scheduled trade selects
jobs with that non-cancelled scheduled trade, case-insensitively; this is a job
subset, not an allocation of all job cost to that trade. Combine a cost code
with that subset to select the relevant coded sources. Source dates select
the dates on procurement, posted actuals, earned billings and receipts.
Budget stock uses its recorded source date and forecast stock its as-of date;
an absent or out-of-window budget or forecast remains unknown. Undated legacy
sources are excluded from a date window.

Sold revenue and budgets reconcile to selected budget codes. Earned billing
keeps gross earned value, including retained amounts, and collections use
recorded receipts rather than claiming independently verified funds. Forecasts
retain their freshness flag. Open decisions include presented selections,
draft changes and unresolved RFIs. Schedule slippage is elapsed UTC minutes
against the original baseline.

**Source records** downloads the same capture and source selection as the view.
CSV, PDF and XLSX carry the selection and authorized record scope. Currency
totals remain separate. Current report permissions and project-manager job
assignments apply on every query and download, including old captures. Job
erasure removes its captured copies. Capturing is restricted to owners and
administrators with report creation and full financial source visibility.
Historical views cannot mix captured native fields with current custom values.

Unknown budgets and forecasts show **Not set**; money totals show how many
records contributed. A job name opens the job. Financial source downloads
exclude supplier document bytes and employee rate details. XLSX uses literal
text cells, and CSV neutralizes formula-like text. Export actions are audited.

## Scheduled reports

The owner opens **People & access → Scheduled report settings**, chooses a job, a named active account, an audience and a weekly or monthly date, then explicitly authorizes recurring delivery and access. Invite the recipient through the native account flow first. An assigned manager receives that job's dashboard values. A current client receives a draw packet. A lender must first have the ROLE-004 Reader preset assigned to that job, or an authorized ROLE-006 custom copy. A schedule cannot widen that grant. Every custom role, including an administrator copy, must include the scheduled job in its current assignment.

The recipient opens **Jobs → Scheduled report downloads** after signing in. Each packet contains the current schedule of values, issued application amounts and line reconciliation, issued invoice amounts and balances, published progress photos, recorded inspection documents and signed waiver originals. The screen and downloaded JSON use the same allowlist. Private bids, labor rates, internal cost sources and pricing snapshots are excluded. Original evidence is not content-redacted: the owner must review the published photos and inspection and waiver originals before granting recurring access. Recorded evidence is not professional certification or a licensed billing form.

Reports become due at 09:00 UTC. Weekly dates repeat every seven days. Monthly dates derive from the original chosen date, clamping to the last day of shorter months. Missed dates collapse to the latest due occurrence. The hourly scheduler processes bounded deliveries; the owner can also generate currently due reports from settings. Each schedule retains up to 100 occurrences within the job's existing history size limit. Pause a full schedule and explicitly create another when needed.

Every occurrence is reserved durably before contacting the configured Base mail provider. Email contains a protected download link and uses optional-notice suppression and unsubscribe rules. A refused send remains refused; an uncertain response remains unknown. Neither is automatically resent. Provider acceptance means acceptance only, with recipient delivery unconfirmed. The packet remains available through its signed-in download door even if email failed.

Only the owner manages schedules. Current native identity, assignment, installation authority and client portal features are checked before generation, immediately before the provider call and again before each download. A changed native identity or manager assignment requires a fresh owner grant. Pausing immediately revokes downloads. A packet is private job history and disappears with job erasure; ordinary job responses never disclose its delivery grants or stored snapshots.

These conservative recipient, consent and delivery defaults are adopted pending CT approval under RPT-003. They supply implemented behavior, not a DONE policy ruling.
