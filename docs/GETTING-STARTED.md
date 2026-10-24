# Getting started

Run Plinth on your computer, confirm the owner and open your first job. It runs on macOS, Linux or Windows with WSL2. Git is required; rer brings Node and pnpm. `rer` also installs the project's pinned dependencies.

## Run Plinth

One line, the same as on the [Run page](https://run-plinth.com/run):

```sh
curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-plinth
```

It installs `rer`, the Run Edit Run command, for you alone, with its own Node if you have no Node 22 or later, then gets Plinth into `run-plinth`, installs everything, makes you the owner and prints a link that opens Plinth signed in. Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-plinth` does the same. If the installer prints an `export PATH=…` line, run that line too. To start it again later, run the same line from the same folder, or `cd run-plinth && rer dev`.

The first launch installs dependencies, prepares the local database and creates your local owner. Allow it to finish. The terminal prints the application address as `RER_READY` and a sign-in link as `RER_OPEN`.

Open `RER_OPEN` in your browser. It is a private credential: keep it on this computer and do not share it. On **Finish setup**, review the owner's name and email, confirm the account is ready, then press **Finish setup**. Open **Jobs** to begin.

Local sign-in mail and invitations go to the development outbox. No external email is sent by a local installation. Your job records persist when you stop and restart the app.

## Use your own owner email

For an installation using your actual owner mailbox, run `npx -y @runeditrun/rer install just-every/run-plinth`, then these commands from the checkout:

```sh
rer setup
rer dev
```

Enter the owner's email privately at the setup prompt. Re-running setup keeps an existing claimed owner and data.

To exercise ordinary email-link sign-in locally:

```sh
rer dev --login
```

Open the printed local outbox, choose the latest sign-in message, then follow the link and confirm on the same device. A hosted installation uses its configured mail provider instead. The [project README](../README.md#deploy-to-your-cloudflare-account) explains production mail and Cloudflare deployment.

## Invite a manager or client

In **People & access**, enter their full name and email, choose **Client** or **Project manager**, then press **Send invitation**. Only the owner can invite a project manager. A client must use the same email as the client email on their job.

The invitation gives the person a sign-in path to this installation. A client sees only their own published job records and can approve their own change orders. A manager handles job records, supplier commitments and pay apps.

For a local client walkthrough, create a job using the development client email `client@dev.localhost`, then run:

```sh
rer dev --as client
```

Open the new private sign-in link. To return to the owner, run `rer dev --as owner` and open that link. These personas are local development tools.

## Create your first job

In **Jobs**, enter the job name, the client's email and the site address, then press **Create job**. Open **Quote**, prepare the scope and amount, and record acceptance only after the client has actually agreed. Follow [Run a job](MAIN-FLOWS.md) for the complete workflow.

If your accepted jobs already exist in a spreadsheet, use [Move in](MOVE-IN.md) to preview and import the documented CSV format.

## Stop and come back

```sh
rer dev --stop
```

You can also stop a foreground run with Ctrl-C. Start again with `rer dev` from the same checkout. A compatible repeated launch reuses the running server.

If launch reports another process on its port, check port ownership before retrying. Do not reset your data to resolve a launch problem.

Keep a [backup](BACKUP-RESTORE.md) before moving installations or erasing local state. `rer describe` lists the supported commands.
