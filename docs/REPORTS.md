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
