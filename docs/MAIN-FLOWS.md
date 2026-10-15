# Run a job

Start with the client's accepted quote. Add approved changes, keep site records and prepare a progress claim that reconciles with the work already claimed.

## Agree the quote

1. In **Jobs**, create a job with its name, client email and site address.
2. Open **Quote**. Enter **Scope of work**, **Quote total (AUD, including GST if applicable)** and any **Terms and inclusions**.
3. Press **Prepare quote revision**. You can prepare a new revision before acceptance; only the latest draft can be accepted.
4. After the client agrees, select the actual **Acceptance method** and enter a **Client acceptance reference** identifying that agreement.
5. Press **Record client acceptance**.

The job becomes active. The accepted quote and its recorded acceptance stay fixed. Use a variation for later scope or price changes. Quote acceptance records agreement you obtained outside Plinth; the client approves variations through their own Plinth sign-in.

## Get a variation approved

1. In **Variations**, describe the exact change in **Change and agreed scope** and enter the **Additional amount (AUD)**.
2. Press **Prepare variation for client**.
3. Invite the client through **People & access**, using the email on the job. They follow their invitation, sign in and open the job's **Variations** tab.
4. The client reviews the scope and amount, then presses **Approve this variation for…**.

Only the signed-in client assigned to that job can approve. The approved contract increases only after approval. A negative amount records a credit; a credit cannot reduce the contract below amounts already approved for claiming. Approval history retains the exact scope, amount and approver.

For example, a $48,000.00 accepted quote and an approved $3,200.00 variation give a current contract of $51,200.00.

## Book trades

In **Trades**, enter the trade or subcontractor, start and end in your local time, and the work to complete. Press **Book trade**.

A manager's booking is published directly. Plinth refuses overlapping bookings for the same trade across jobs. Keep the trade's name consistent across bookings. An agent-prepared draft waits for a manager to press **Approve trade booking**.

## Publish a site day

In **Site diary**, select the site date and record the work, conditions and decisions. Add up to five PNG or JPEG photos, each no larger than 2 MB. Press **Publish diary entry**.

Published entries and their photos are available to the job's authorised people. Open a photo to retrieve it. An agent can prepare an entry, but a manager must publish that draft. Photo bytes are included in the installation's [backup archive](BACKUP-RESTORE.md).

## Record supplier commitments and deliveries

1. In **Purchasing**, enter the supplier, goods or services and order amount. Press **Prepare purchase order**.
2. Review the draft and press **Approve and issue PO**.
3. Send the approved details to the supplier through your usual channel.
4. As deliveries arrive, enter the **Received value (AUD)** and **Delivery docket or receipt reference**, then press **Record supplier receipt**.

Issuing records a commitment in Plinth; it does not send an order or pay the supplier. A receipt adds the delivered value against the issued order. The claim reconciliation shows supplier commitments, receipts and the outstanding balance.

## Prepare and export a progress claim

1. In **Claims**, enter a milestone in **Claim description or milestone**.
2. Enter **Cumulative work claimed (AUD)**: the total work claimed to date, including earlier claims.
3. Press **Prepare reconciled claim**.
4. Review the accepted quote, approved variations, earlier claims, supplier commitments and receipts. Check **This claim** and **Contract remaining**.
5. Press **Approve reconciled claim**, then **Record claim export**.
6. Download **Download claim CSV** and **Download full reconciliation** for the external books.

With a current contract of $51,200.00, an earlier exported claim of $14,400.00 and cumulative work of $27,800.00, the reconciliation is:

| Record | Amount |
| --- | ---: |
| Accepted quote | $48,000.00 |
| Approved variations | $3,200.00 |
| Current contract | $51,200.00 |
| Previously exported | $14,400.00 |
| Cumulative work claimed | $27,800.00 |
| This claim | $13,400.00 |
| Contract remaining | $23,400.00 |

An approved claim reserves its cumulative position even before export. Complete earlier approved exports in order before exporting a later claim. The cumulative value must exceed earlier approved claims and stay within the approved contract.

If the contract, earlier claims or PO receipts change after preparation, approval asks you to prepare a fresh claim. Approved records stay fixed. Once exported, download the same approved record again whenever needed.

Use the same GST basis as the accepted quote. Plinth does not calculate tax, issue invoices, collect payments or prepare statutory payment claims.

## Inspect the history

Open **History** to see each approval, its preparer, approver and revision. Expand **Approved record** to see the snapshot the person approved.

The owner can permanently erase a job from this tab. Read [Backup and restore](BACKUP-RESTORE.md#erase-a-job-and-carry-the-erasure-forward) before doing so.

For automated preparation, see [Agent commands](COMMANDS.md). An agent credential can prepare drafts; people retain approval, receipt, export, import and erasure authority.
