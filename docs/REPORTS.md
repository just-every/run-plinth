# Current portfolio reports

Open **Jobs → Custom fields and saved views**. Choose Jobs, select the current portfolio columns, and save a personal or shared view. Each reader sees only jobs permitted by their current assignment and feature permissions. Removing an assignment takes effect on the next read or download.

The columns include sold contract revenue, original and revised cost budgets, commitments, posted actual costs, the latest reviewed forecast and margin, earned billings, collections, unbilled sold revenue, maximum schedule slippage and open decisions. Unknown budgets and forecasts show **Not set**. A forecast that predates the current job version is marked as requiring review. Monetary totals remain separate by currency and show how many records contributed.

The report date is the current UTC date. These views describe current committed records; historical snapshots and slicing by manager, trade, source date or cost code are not yet available. RPT-001 remains partial.

A job name opens that job. **Source records** downloads the authorized job's code ledger, including its budget references, procurement records, posted cost entries, billing records and forecast code totals. It excludes supplier document bytes and employee rate details. Financial source downloads require all contributing financial feature permissions.

**Download scoped CSV**, **Download scoped PDF** and **Download scoped XLSX** repeat the same saved filters and current job scope. XLSX is an Office Open XML workbook with literal text cells, so user-entered values are not spreadsheet formulas. Money is labelled with currency and integer cents. Export actions are audited.

## Scheduled reports

The owner opens **People & access → Scheduled report settings**, chooses a job, a named active account, an audience and a weekly or monthly date, then explicitly authorizes recurring delivery and access. Invite the recipient through the native account flow first. An assigned manager receives that job's dashboard values. A current client receives a draw packet. A lender must first have the ROLE-004 Reader preset assigned to that job, or an authorized ROLE-006 custom copy. A schedule cannot widen that grant.

The recipient opens **Jobs → Scheduled report downloads** after signing in. Each packet contains the current schedule of values, issued application amounts and line reconciliation, issued invoice amounts and balances, published progress photos, recorded inspection documents and signed waiver originals. The screen and downloaded JSON use the same allowlist. Private bids, labor rates, internal cost sources and pricing snapshots are excluded. Original evidence is not content-redacted: the owner must review the published photos and inspection and waiver originals before granting recurring access. Recorded evidence is not professional certification or a licensed billing form.

Reports become due at 09:00 UTC. Weekly dates repeat every seven days. Monthly dates derive from the original chosen date, clamping to the last day of shorter months. Missed dates collapse to the latest due occurrence. The hourly scheduler processes bounded deliveries; the owner can also generate currently due reports from settings. Each schedule retains up to 100 occurrences within the job's existing history size limit. Pause a full schedule and explicitly create another when needed.

Every occurrence is reserved durably before contacting the configured Base mail provider. Email contains a protected download link and uses optional-notice suppression and unsubscribe rules. A refused send remains refused; an uncertain response remains unknown. Neither is automatically resent. Provider acceptance means acceptance only, with recipient delivery unconfirmed. The packet remains available through its signed-in download door even if email failed.

Only the owner manages schedules. Current native identity, assignment, installation authority and client portal features are checked before generation, immediately before the provider call and again before each download. A changed native identity or manager assignment requires a fresh owner grant. Pausing immediately revokes downloads. A packet is private job history and disappears with job erasure; ordinary job responses never disclose its delivery grants or stored snapshots.

These conservative recipient, consent and delivery defaults are adopted pending CT approval under RPT-003. They supply implemented behavior, not a DONE policy ruling.
