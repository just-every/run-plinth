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
| POST `/preview` | `{csv,declaration?}` | `{fingerprint,counts,diagnostics,rows,coverage,adoption:"draft",limits}` |
| POST `/commit` | `{csv,fingerprint,declaration?,mappingRevision?}` | `{job}`; conflicts refuse new intake before any native row is adopted |
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

The owner can also upload a UTF-8 CSV or an XLSX under **Coded estimate workbook**.
This creates a separate quoting job with an inert coded estimate. It remains
visible only to the owner until the owner records native quote acceptance. It does not
replace a native job, accept a quote, post actual costs or adopt financial
opening balances. Legacy XLS, catalogs, time and expense costs, supplier bill
matching, SOV and opening balances remain outside this import door.

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
