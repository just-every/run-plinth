# Plinth guides

Take a building job from an accepted quote to a reconciled pay app. Your jobs, photos and approval records live in your own installation.

## Start here

- [Getting started](GETTING-STARTED.md): run Plinth, finish setup and invite your team and clients.
- [Run a job](MAIN-FLOWS.md): quotes, the trade schedule, daily logs, change orders, purchasing and pay apps.
- [Move in](MOVE-IN.md): review an Accepted jobs CSV and bring the jobs in as drafts.
- [Backup and restore](BACKUP-RESTORE.md): keep a private archive, restore it and carry forward erasures.

## Reference

- [Agent commands](COMMANDS.md): allow an agent to prepare drafts while people keep approval authority.
- [CSV and import reference](IMPORT.md): exact fields, limits, journal operations and custody rules.
- [Project README](../README.md): installation, development and deployment to your own Cloudflare account.
- [Source reuse](REUSE.md): the foundations and modules used by Plinth.

## Who does what

The owner and project managers manage jobs. A client signs in with the email assigned to their job and approves their own change orders. The owner manages project-manager access, imports and permanent job erasure. Agent credentials prepare drafts; human sign-in is required for approval and other final actions.

Plinth keeps the accepted quote fixed and retains each approval with its exact terms and the people involved. Purchasing records supplier commitments and deliveries. Pay app downloads are working records for your books, in USD; Plinth does not send supplier orders, make payments, calculate tax or issue invoices.
