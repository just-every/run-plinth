# Accepted jobs CSV move-in kit

This first move-in kit accepts a documented CSV shape. Its committed examples
are synthetic fixtures, not exports verified against a live provider. There is
no connector, provider authorization, automatic source download or live-provider
compatibility claim.

The exact UTF-8 header is:

```csv
external_id,title,client_email,site_address,quote_cents,accepted_on
```

Each row represents one job. `external_id` is a stable, unique source identifier
(up to 200 characters); `title` is up to 200 characters; `client_email` is a valid
email up to 254 characters; `site_address` is optional, up to 500 characters.
`quote_cents` is a whole nonnegative amount in cents, up to 1,000,000,000,000.
`accepted_on` is a real calendar date in `YYYY-MM-DD` form. Header order is fixed. An optional seventh `currency` column accepts USD or historical AUD; omission means USD.
RFC 4180 quoted commas, escaped quotes and embedded newlines are supported;
UTF-8 BOM, LF and CRLF are accepted. Required fields cannot have surrounding
spaces. Duplicate identifiers and invalid rows reject the upload before writes.
The limit is 100 data rows and 256 KiB per CSV; the request body is separately
bounded to allow JSON escaping. File-name metadata is fixed to
`accepted-jobs.csv`; original CSV bytes remain exact.

## Review and adoption

Only a signed-in human owner may preview, commit, resume, reverse or inspect an
import. Agent credentials cannot approve an import. The route reuses native
sessions; Base also checks the current owner, session expiry, revocation and
operator version inside every atomic journal/native mutation.

Preview returns rows, diagnostics, counts, source coverage and a SHA-256 fingerprint. It writes
neither native jobs nor import custody. A person approves that exact fingerprint.
Commit parses and plans the submitted CSV again and refuses a changed
fingerprint before creating the job. Source declarations are included in that
fingerprint. An unsupported mapping revision is refused; a changed declaration
requires another preview and approval. The original bytes, normalized rows,
reviewed plan, named human reviewer, source evidence and journal persist through Base's D1 import APIs.

The source's acceptance date and amount are retained as **unverified source
evidence** in each native job. Every job starts at quoting with a draft quote.
It must pass the ordinary native acceptance action before active job work.
Importing sends no email, invitation, client access grant, financial export,
schedule booking or other lifecycle action. Source stamps identify the CSV and
its claimed acceptance date; they are not a native acceptance or approval.

Native job IDs derive from the format namespace and stable `external_id`.
Repeating the exact approved upload returns the same durable import. Another
export cannot silently overwrite an existing job or change an already claimed
source identity. Review changes in the native job instead.

## HTTP contract

All paths begin `/api/plinth/imports`. POST requests require the same Origin
header as native mutations. JSON responses are private and `no-store`.

| Method and suffix | Input | Result |
| --- | --- | --- |
| GET `/` | — | `{jobs}`; most recent 100 import journal summaries |
| POST `/preview` | `{csv,declaration?,history?}` | `{fingerprint,counts,diagnostics,rows,coverage,adoption:"draft",limits}` |
| POST `/commit` | `{csv,fingerprint,declaration?,mappingRevision?,history?}` | `{job}`; conflicts refuse new intake before any native row is adopted |
| GET `/:id` | — | `{job}` after retained-plan integrity checks |
| POST `/:id/resume` | — | `{job}` from the immutable retained plan |
| POST `/:id/undo` | — | `{job,report}`; completed import only |
| POST `/:id/rollback` | — | `{job,report}`; partial import reversal |
| GET `/:id/coverage` | — | `{coverage}` with reviewed source, actual dispositions and locations |
| GET `/:id/report` | — | `{report}` with retained/reversed dispositions |
| GET `/:id/originals` | — | `{originals}` with exact bytes or explicit erasure unavailability |
| GET `/erasure-journal` | — | `{entries}`; value-free erasure receipts |

A request applies at most ten native jobs, one atomic native entity per batch.
Call resume until the job state is completed. Interrupted requests leave the
last committed checkpoint; resume uses retained custody, without another upload
or parser run. Reversal is similarly restartable. Conflicts are explicit;
there are no automatic retries or replacement fallbacks.

## Source coverage

Move in shows a source coverage report for both the dry run and each retained
journal. The report is downloadable JSON. It records the original byte count and
SHA-256, the implementation mapping revision, one-based CSV record and column
coordinates, and physical line and character coordinates for each cell. Quoted
newlines do not change a record's identity. Locations identify source cells;
they do not certify the source's content.

The optional `declaration` contains `sourceSystem`, `extractionScope` and
`extractedAt` (a UTC timestamp, or an empty string). Each value is supplied by the
owner. `verified` is always false; a caller cannot mark an export verified.
Omitted or empty declarations display as not supplied. Use category and scope
descriptions, never credentials or personal details. The importer neither
contacts the named system nor verifies extraction scope or time. Revisions and
source declarations survive the ordinary private CLI archive round trip.

Each source row has one disposition, so disposition counts reconcile to the
report's total. Preview distinguishes proposed drafts, exact existing sources,
native or changed-source conflicts and erasure fences. The journal distinguishes
actually imported drafts from work not yet applied at its checkpoint. Later
native edits show as conflicts and remain intact; reversed rows are reported
separately. Duplicate identifiers, malformed quoting, invalid cells and unknown
columns carry locations in a refused preview or commit response. The whole
upload is refused: valid peers are not silently adopted. A new intake with a
known source or native conflict is also refused before creating its journal.
Repeating an already approved intake returns its original journal, including
after native editing or erasure; it never restores erased data.

The HTTP response for a structurally invalid CSV remains 400 and includes
`coverage`, without an approvable fingerprint or durable custody. Change of
review or mapping returns 409. The owner can inspect or download a retained
coverage report and original through Move in. Every read rechecks current owner
authority; clients, administrators and bearer credentials gain no import access.
Reports read current native snapshots behind the same authority fence.

Erasure removes the erased row's values and locations from reports. Affected
shared original bytes remain unavailable. Surviving peers retain only their
own reviewed coordinates and native work; reports never reconstruct a withdrawn
original. The source declaration is withheld from the whole journal after a
row erasure. Original checksum and aggregate counts are custody references,
not recoverable erased content.

This report covers only the documented Accepted jobs CSV. Unsupported attachment
references and historical signature or history columns are diagnosed and
refused. `accepted_on` remains unverified historical evidence and never becomes
native approval. Complete source-specific job mappings, missing attachment
relationships, historical signatures, broader history and continuing-job
adoption beyond this format remain owed by MOVE-001. MOVE-002 through MOVE-007
still require their owner-authorized source exports; coverage supplies neither
those accounts nor provider authority.

## Undo, erasure and restore

Undo uses Base's durable `preserve-conflicts` policy. An unchanged imported job
is removed; a changed job, accepted quote, added attachment or changed native
version is retained and reported. The adapter guards the entire job JSON,
version, import revision, attachment bytes and metadata, including same-version
edits. Native rows, attribution and checkpoint advance in one D1 batch. Undo
retains original CSV and audit custody; it is not privacy erasure.

Native job erasure calls `eraseJob` for imported and native-created jobs. It
commits exact native CAS/auth guards, attachment deletion, native deletion,
permanent job tombstone, Base import-custody retirement/redaction, the append-only
erasure journal and the real portability redaction checkpoint together. Affected
whole CSV originals become unavailable, including peers' raw bytes in the same
file; peer normalized jobs remain. Job erasure concerns that job's lineage; it
is not a request to erase every other job held by the same client.

If a personal identifier occupies an import header, Base retires that custody
and its dependent closure; those jobs can no longer resume or undo. The erasure
journal stores counts and receipt IDs, never selected personal values. The
portability checkpoint prevents an older archive from resurrecting the deleted
custody when checked with a later trusted journal. In-flight portability copies
are invalidated. Import ownership is the durable `role:owner` principal, so a
restored installation's newly created owner can resume and reverse retained
jobs while their actual current native session is checked afresh.

Migration `0021_import_kit.sql` contains the complete ordered Base D1 schema,
including preserved undo, custody revisions, original-byte storage, staging,
preparation, reversal fences and append-only retirement support. The Worker
imports the D1 entry point and requires `nodejs_compat`. The vendored runtime is
copied from the committed Base reference. Local integration checks establish
local behavior only; hosted upload, Worker resource and provider acceptance are
not claimed.

## Coded estimate workbooks

The owner can also upload UTF-8 CSV, BIFF8 XLS or XLSX under **Coded estimate workbook**.
This creates a separate quoting job with an inert coded estimate. It remains
visible only to the owner until the owner records native quote acceptance. It does not
replace a native job, accept a quote, post actual costs or adopt financial
opening balances. Dated catalog rates and native time and expense drafts use the
explicit import types described below. Supplier bills and reconciled SOV opening positions use the explicit flows below.

Inspect the file, choose one worksheet, and map column letters to source row id,
description, code, phase, category, quantity, measurement unit and selling rate
in whole cents. Rate unit and cost rate in whole cents are optional. Code and
unit mappings explicitly translate source values to native values. Choose USD
or historical AUD; no currency conversion is performed. Quantities remain exact
decimal strings. Native exact unit conversions and half-up line rounding apply.

The preview compares all source row amounts with the included draft totals.
Duplicate and explicitly excluded row amounts remain in the source total, with
their disposition shown. An unreviewed, unsupported or unavailable value makes
its source amount unknown. The draft totals include only valid included rows;
an unknown cost stays unknown. Resolve every diagnostic before adoption.

The supported XLSX formula vocabulary is cell references and decimal literals
combined with basic arithmetic, or SUM over cell references and ranges on the
selected sheet. Plinth never evaluates a formula. Every used formula must have
a saved cached value, and the owner must explicitly review those source values.
Missing caches, other formula types, Excel errors, macros, external links and
active content remain diagnostics. Remove unsupported active content from a
copy in the source application. No fallback invents a value. Dates, booleans and
scientific-notation quantities are not silently converted to measurements.

Duplicate source ids are rejected unless the owner chooses to omit identical
mapped rows. Conflicting duplicates need correction or explicit row exclusion.
Each exclusion requires its worksheet row number and a reason. An invalid code
must be mapped to a reviewed native code, corrected in the source, or excluded.
The review retains exact cell addresses, source values and cached formula text.
Raw provenance is owner-only and is absent from client job responses. Owner JSON
cost-code exports include the original mapping and provenance alongside native
line and code totals. CSV cost-code exports retain exact quantities and cents.

POST `/api/plinth/imports/workbook/inspect` takes `{name,base64}` and returns sheet
names and column labels. POST `/api/plinth/imports/workbook/preview` also takes
`title`, `client_email`, optional `address`, and `mapping`. The mapping contains
`sheet`, `columns`, `codes`, `units`, `currency`, `duplicates` (`reject` or
`skip-identical`), `reviewed_formulas`, and `excluded_rows`. Column keys are `id`,
`description`, `code`, `phase`, `category`, `quantity`, `unit`, `rate_unit`,
`unit_cents`, and `cost_unit_cents`. Map each key to a column letter; code and unit
maps use source values as keys. Exclusions map row numbers to reasons.

Commit uses the same input plus the preview `fingerprint` at
`/api/plinth/imports/workbook/commit`. It reparses and fingerprints everything.
Changed bytes, metadata, mapping, cache review or exclusions invalidate approval.
One original file has one adoption identity: repeating its approved request
returns the same journal; trying a different mapping after adoption is refused.
To import another sheet, export that sheet as a separate source file and review
it explicitly. Preview stores nothing. Adoption retains exact original bytes
under the existing journal, originals, undo, native-edit preservation, erasure
and portable recovery rules above. An erased import cannot be replayed into a
new native job. A restored journal grants no credentials or automatic execution.

Limits are 256 KiB of original file bytes, ten worksheets, 100 data rows per
worksheet, 100 columns, 200 package parts and 2 MB of declared expanded XLSX
content. Unsupported and encrypted packages are refused explicitly.

### Legacy Excel and dated catalog rates

Move in also accepts bounded BIFF8 XLS originals. Current worksheet cells include
shared strings, continued strings, numeric and compact numeric cells, and reviewed
numeric formula caches. Arithmetic and SUM expressions are recorded, never
recalculated. Unsupported versions, encrypted originals, macro sheets, external
links, unsupported formula tokens and absent numeric caches produce explicit
refusals or row diagnostics. Original downloads retain the uploaded compound file.

Choose **Dated catalog rates** to map source identifiers, descriptions, cost codes,
units, selling cents, cost cents, vendors, effective dates and source references.
Each row is one dated USD rate, so its unit and rate unit must agree. The preview
compares the sum of displayed rates; that sum is not an estimate. Approval creates
new rates for the ordinary native assembly and template estimator. Existing rate
revisions and accepted estimates remain fixed. Undo preserves a catalog group
once a native record depends on one of its rates, or a rate has been edited.

### Time and expense drafts

Choose **Time and expense drafts**, load accepted jobs and select the destination.
Map `id`, `description`, `code`, `quantity`, `unit`, `unit_cents`, `kind`,
`dated_on`, `period`, `reference` and `employee_reference`. `rate_unit` is optional.
Kinds are `time`, `expense` and `bill`. Map time units to `hour` or `minute`; the quantity
must resolve exactly to whole native minutes. Expenses use the exact extended
amount from the mapped decimal quantity and integer cent rate. Codes must already
exist in the destination's accepted budget. Source references cannot duplicate
native sources or other rows in the same upload.

Preview and approval bind the destination version as well as the original file,
mapping and row resolutions. Import prepares native sources without posting an
actual cost or changing accepted estimates, budgets, SOV or payments. Ordinary
Job costs approval still requires the configured reviewer separation and an open
posting period. All imported rows share one retained original; their original
links download identical bytes. Replay creates no second source or posting. Undo
preserves native work; job erasure retires the related source custody and prevents
replay from restoring it.

The workbook HTTP doors use the same inspect, preview and commit sequence above.
Set `mapping.purpose` to `catalog` or `costs`; the default remains `estimate`.
For costs also provide `job_id` and `expected_version`. Carry `reviewed_at` from
the preview response into commit, together with its fingerprint. A changed
mapping, source or destination requires another preview.

Importing draft cost sources does not adopt financial opening balances. The separate opening flow below requires a supplied ledger before adoption.


### Supplier bill drafts

A bill row also maps `vendor`, `due_on`, `tax_percent`, `tax_reference` and
`taxable` (the explicit text `true` or `false`). An exempt row also maps
`tax_exemption`. Review the source tax rate, taxable amount and exemption evidence
before previewing. `unit_cents` is the net rate: the source comparison remains net
before tax and the proposed native amount includes the exact reviewed tax.

Identical source rows may be omitted explicitly. Conflicting rows or an invoice
reference already captured for that supplier require resolution, including an
existing bill on another job. Imported bills remain drafts. Their ordinary
missing-receipt review, current designated reviewer, separate approval, limits
and accounting-period checks still govern posting. Import never creates a
supplier payment or provider instruction.

### Reconciled historical SOV and opening balances

Use **Opening balances and SOV** with an accepted USD job, its current priced SOV
and its reviewed retainage terms. Opening adoption requires no existing actual
costs, cost sources, bills, invoices, receipts or pay applications. Prepare those
native foundations before importing historical progress; the import does not
replace the accepted quote, budget, SOV definition or retainage terms.

Upload the source workbook and a separately supplied ledger snapshot. Map each
file independently to `id`, `description`, `code`, `native_line_id`,
`scheduled_cents`, `completed_cents`, `stored_cents`, `actual_cents`, `paid_cents`,
`retainage_cents`, `collected_cents`, `client_retainage_cents` and
`billed_tax_cents`. Amounts are exact whole USD cents. The two files may use
different columns, code names and source line identifiers. Native SOV line
mappings translate those source identifiers explicitly; the destination's
current line identifiers are shown beside the mapping controls. Optional
`order_ids` contains semicolon-separated native issued PO identifiers supporting
stored materials. Native receipt capacity and source scope checks still apply.

Review saved formula caches and resolve duplicate or rejected rows independently
for both files. Every included native line, cost code and financial amount must
match the supplied ledger. The source preview retains totals before exclusions,
so omitted values remain visible. Scheduled values must match the accepted
native SOV; billed tax and client retainage must match its reviewed tax and
retainage snapshots. Choose a source as-of date and an open posting period.

Approve the exact file pair, mappings, row resolutions, destination version and
reconciliation once. Actual costs and recorded supplier paid and retained values
become source-linked opening balances. Historical progress becomes an explicitly
labelled SOV opening position. It cannot be invoiced again. The next native draw
and invoice deduct prior gross billing, tax and withholding rather than charging
history twice. Customer collections are recorded historical facts; they are not
new executable receipts or evidence of provider settlement. No funds move.

Both originals, source-cell provenance, the current cost ledger and the historical
SOV sources remain downloadable. The opening comparison CSV contains each native
line and code with exact signed cents, as-of date, posting period and both original
checksums. Its columns let the owner independently reconcile actual, paid, retained
and billed balances against the supplied records. Replay adds no second balance or application.
Undo reverses an untouched opening; later native work is preserved. A job hold
blocks destructive undo, and erasure withdraws the source and ledger custody and
fences replay. Accounting connector grants and professional verification remain
outside this native import.

For the HTTP sequence use `mapping.purpose: "opening"`, `job_id`,
`expected_version`, `as_of`, `posting_period`, `ledger_reviewed: true`, and a
`ledger` object with its own `name`, `base64` and mapping. Carry the preview's
`reviewed_at` and fingerprint into commit. Opening mappings use `columns`, `codes`,
optional `line_ids`, `currency: "USD"`, duplicate handling, formula-cache review
and excluded-row reasons for each file.

## Optional historical source package

The same preview and commit doors accept an optional `history` string containing
the exact UTF-8 bytes of an owner-prepared JSON sidecar. Move in accepts that
file in **Historical source JSON (optional)**. It is a documented neutral
custody format, not an exporter or a verified mapping for any named provider.

The sidecar has `version: 1` and a `jobs` array. Each job names one existing CSV
`externalId`, a `files` array and a `records` array. Files contain `id`, `name`,
`mediaType` and canonical `base64` original bytes. Records contain `id`, `kind`,
`occurredAt` (a UTC timestamp), `description` and `fileIds`. JSON pointers preserve
each original relationship. The supported historical categories are `note`,
`schedule`, `signed-change`, `invoice`, `payment` and `approval`. Every category
is unverified historical evidence only. No category creates a native signature,
schedule, financial entry, approval or outbound action.

Coverage lists every occurrence. Exact repeated record IDs are duplicates;
different records claiming the same ID refuse the whole upload. Unknown kinds
are explicitly unsupported and retained for assisted capture. Absent referenced
files are explicitly missing; no bytes, signature or file relationship are
invented. Invalid structure, unknown fields, conflicting IDs or invalid bytes
refuse the whole intake before any peer is adopted. The sidecar allows at most
100 jobs, 100 records and 20 files per job, 128 KiB of JSON and 64 KiB of decoded
originals across the package.

The retained source plan holds the historical metadata; it grants no additional
job access. The owner can inspect records, download a present file from its
journal coverage, and retrieve the exact sidecar through the originals door.
Changing any sidecar byte or original requires fresh fingerprint approval.
Repeating approval retains the same journal and preserves subsequent native
work. CLI archives include this custody. Erasing any member job withdraws all
package originals, including the sidecar, so shared history cannot recover that
job's personal content. Surviving peers keep their own reviewed metadata.

Native continuation still requires the ordinary current quote approval and all
applicable source and financial reconciliation. This package neither reconciles
opening financial balances nor implements the source-specific full-job
continuation mappings owed by MOVE-001 and MOVE-002 through MOVE-007.
