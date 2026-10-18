# Run a job

Start with the client's accepted quote. Book the trades on the schedule, keep daily logs, add client-approved change orders and prepare a pay app that reconciles with what you have already billed.

## Agree the quote

1. In **Jobs**, create a job with its name, client email and site address (or press **New job** in the top bar).
2. Open **Quote**. Enter **Scope of work**, **Quote total (including sales tax if applicable)** and any **Terms and inclusions**.
3. Press **Prepare quote revision**. You can prepare a new revision before acceptance; only the latest draft can be accepted.
4. After the client agrees, select the actual **Acceptance method** and enter a **Client acceptance reference** identifying that agreement.
5. Press **Record client acceptance**.

The job becomes active and opens on its **Schedule**. The accepted quote and its recorded acceptance stay fixed. Use a change order for later scope or price changes. Quote acceptance records agreement you obtained outside Plinth; the client approves change orders through their own Plinth sign-in.

## Book trades on the schedule

In **Schedule**, use **Book a trade**: enter the trade or subcontractor, the work to complete, and the start and end in your local time. Press **Book trade**.

The chart shows every booking as a bar on a weekly grid, with today's line and the job's daily logs as milestones. Select a row to see its dates, who prepared and approved it, and the other trades on the job. A manager's booking is booked directly. Plinth refuses overlapping bookings for the same trade across all jobs ("This trade is already scheduled during this time"). Keep the trade's name consistent across bookings.

An agent-prepared booking appears as a dashed draft on an oxblood-edged row, and the strip under the tabs says what the agent prepared and what waits on you. Select it and press **Approve trade booking**.

## Publish a daily log

In **Daily logs**, select the **Log date** and record the work, conditions and decisions. Add up to five PNG or JPEG photos, each no larger than 2 MB. Press **Publish daily log**.

Published logs and their photos are available to the job's authorized people. Open a photo to retrieve it. An agent can prepare a log, but a manager must publish that draft. Photo bytes are included in the installation's [backup archive](BACKUP-RESTORE.md).

## Get a change order approved

1. In **Changes**, describe the exact change in **Change and agreed scope** and enter the **Additional amount**.
2. Press **Prepare change order for client**.
3. Invite the client through **People & access**, using the email on the job. They follow their invitation, sign in and open the job's **Changes** tab.
4. The client reviews the scope and amount, then presses **Approve this change order for…**.

Only the signed-in client assigned to that job can approve. The contract increases only after approval. A negative amount records a credit; a credit cannot reduce the contract below what has already been billed. Approval history retains the exact scope, amount and approver.

For example, a $418,600.00 accepted quote and an approved $3,240.00 change order give a current contract of $421,840.00.

## Record supplier commitments and deliveries

1. In **Purchasing**, enter the supplier, goods or services and order amount. Press **Prepare purchase order**.
2. Review the draft and press **Approve and issue PO**.
3. Send the approved details to the supplier through your usual channel.
4. As deliveries arrive, enter the **Received value** and **Delivery ticket or receipt reference**, then press **Record supplier receipt**.

Issuing records a commitment in Plinth; it does not send an order or pay the supplier. A receipt adds the delivered value against the issued order. The pay app reconciliation shows supplier commitments, receipts and the outstanding balance.

## Prepare and export a pay app

1. In **Billing**, enter a milestone in **Pay app description or milestone**.
2. Enter **Billed to date**: the total work billed to date, including earlier pay apps.
3. Press **Prepare pay app**.
4. Review the accepted quote, approved change orders, earlier billing, supplier commitments and receipts. Check **This pay app** and **Balance to finish**.
5. Press **Approve pay app**, then **Record export to your books**.
6. Press **Download pay app CSV** and **Download full reconciliation** for your books. Amounts are in USD.

With a current contract of $421,840.00, earlier exported pay apps of $96,410.00 and $142,350.00 billed to date, the reconciliation is:

| Record | Amount |
| --- | ---: |
| Accepted quote | $418,600.00 |
| Approved change orders | $3,240.00 |
| Current contract | $421,840.00 |
| Previously billed | $96,410.00 |
| Billed to date | $142,350.00 |
| This pay app | $45,940.00 |
| Balance to finish | $279,490.00 |

An approved pay app reserves its billed-to-date position even before export. Complete earlier approved exports in order before exporting a later pay app. The billed-to-date value must exceed earlier approved pay apps and stay within the approved contract.

If the contract, earlier pay apps or PO receipts change after preparation, approval asks you to prepare a fresh pay app. Approved records stay fixed. Once exported, download the same approved record again whenever needed.

Use the same sales tax basis as the accepted quote. Plinth does not calculate tax, issue invoices or collect payments.

## Inspect the history

Open **History** to see each approval, its preparer, approver and revision. Expand **Approved record** to see the snapshot the person approved. The **Job log** under the schedule shows the latest four.

The owner can permanently erase a job from this tab. Read [Backup and restore](BACKUP-RESTORE.md#erase-a-job-and-carry-the-erasure-forward) before doing so.

For automated preparation, see [Agent commands](COMMANDS.md). An agent credential can prepare drafts; people retain approval, receipt, export, import and erasure authority.
