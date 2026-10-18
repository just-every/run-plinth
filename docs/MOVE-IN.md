# Move in

Bring accepted jobs from a spreadsheet into Plinth with the Accepted jobs CSV kit. Preview the exact file, approve it and review each imported draft before starting work.

## Prepare your CSV

Use UTF-8 CSV with these exact column names in this order:

```csv
external_id,title,client_email,site_address,quote_cents,accepted_on
```

Each row represents one job:

| Field | What to enter |
| --- | --- |
| `external_id` | A stable, unique identifier from your source, up to 200 characters. |
| `title` | The job's name, up to 200 characters. |
| `client_email` | The client's valid email, up to 254 characters. |
| `site_address` | An optional site address, up to 500 characters. |
| `quote_cents` | A whole, nonnegative amount in cents. $48,000.00 is `4800000`. |
| `accepted_on` | The source acceptance date as `YYYY-MM-DD`. |

Keep required values free of leading or trailing spaces. Quote fields containing commas or newlines using normal CSV quoting. The file may contain at most 100 data rows and must be no larger than 256 KiB. Duplicate identifiers and invalid rows reject the upload before writes.

The [CSV and import reference](IMPORT.md) gives the complete validation limits. This is a documented CSV format, without a live connector or a claim that a provider's unmodified export will match it.

## Preview and approve

1. Sign in as the owner and open **Move in**.
2. Under **Preview your file**, choose the CSV and press **Dry run CSV**.
3. Review every job in **Dry-run result**. Expand **Counts and diagnostics** to inspect the result.
4. Correct the source file and dry-run it again if anything is wrong.
5. When the exact file is right, press **Approve and import drafts**.

The dry run writes no jobs or retained source custody. Your approval applies to the reviewed file's fingerprint. Plinth checks it again when importing and refuses a changed file.

Import creates draft jobs and quotes. It retains the source's acceptance date and amount as unverified evidence; it does not make that acceptance a native approval. It sends no invitations or emails and grants no client access.

## Finish adopting the jobs

Open **Jobs**, inspect each imported job and open **Quote**. Review the retained source evidence and quote. Record the client's actual acceptance method and reference through **Record client acceptance** before proceeding with active job work.

Invite the client separately through **People & access**, using the email on their job. Follow [Run a job](MAIN-FLOWS.md) for variations, trade bookings and claims.

## Resume an interrupted import

Open **Move in → Import journal**, then press **Load journal** or **Refresh journal**. If the import is incomplete and offers **Resume import**, press it and refresh the journal. Repeat as needed until the state is completed.

Each request applies at most ten native jobs. Resuming uses the retained, approved plan, so you do not need to upload the file again. Repeating the same approved upload returns the same durable import. A new file cannot silently overwrite a job already claimed by the source identifier.

## Undo an import

For a completed import, press **Undo import** in the journal. Refresh and expand **Journal details** to inspect its state.

Undo removes unchanged imported jobs. It preserves jobs changed in Plinth, including jobs with a newly accepted quote or added attachment, and reports those conflicts. Undo is restartable through the import API; the [reference](IMPORT.md#http-contract) documents undo, partial rollback and reversal reports.

Undo retains the original CSV and audit custody. For permanent job erasure, use **History → Erase this job** and follow the [erasure and backup guidance](BACKUP-RESTORE.md#erase-a-job-and-carry-the-erasure-forward).
