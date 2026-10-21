# Working on Plinth

## Launch for review

When asked to launch, run or review the app, run `rer dev` from this checkout and nothing else. It installs and sets up a fresh checkout; give the command at least ten minutes, and resume a timed-out call with the same command. Give the owner the printed `RER_READY` address and `RER_OPEN` sign-in link, which is a private credential. Do not ask for an email, port or password. Stop with `rer dev --stop`; on refusal follow the command it names.

Without `rer`, install it once using `npx -y @runeditrun/rer cli install` and add `$HOME/.local/bin` to PATH.

## Product and commands

Read README.md and ACCEPTANCE.md. This is contractor job management, with human approvals and external bookkeeping. The run site's tokens live in public/site/theme.css (Inter, chalk-line blue, oxblood, sea-glass; the stepladder mark in public/brand/mark.svg). The installed app's tokens live in public/fonts/fonts.css; public/rer-theme.css holds only Base's --rer-* tokens and the faces, which the installer reads with Base's theme grammar.

For a real owner installation use `rer install`, `rer setup` (enter the owner's email privately), then `rer dev`. Local mail is silently suppressed. `rer dev` opens signed in automatically, including with the legacy `--login` flag; the `client` persona uses `client@dev.localhost`. Never send a dev sign-in link outside the owner's private session.

Run `rer check` for command contract inspection and `rer verify` for CI-equivalent integration checks. While iterating, test only what you touched. The suite is capped at 200 and tests public HTTP or CLI doors with real D1; no pin tests or mocked application behavior. Build and deploy never run tests. Stop your dev/preview server before verification.

`rer export --output exports/installation.rer` makes a private archive. `rer import --input /private/path/installation.rer --yes` restores into an empty destination. Use a later archive as `--journal` when erasures must fence an old backup. `rer reset --yes` destroys local data and private settings; export first if retention is needed. `rer deploy --dry-run` has no provider effects; `rer deploy` requires the account, verified sender and private credentials described in README.md. `rer describe` lists all verbs.

## Change boundaries

- Every server handler authenticates independently. Owner/admin manage; member accounts are clients scoped by job email. A bearer credential always means draft-only agent authority, even when minted by an owner.
- Keep cents integer, approvals immutable, and optimistic versions checked inside the D1 batch. Never allow an agent to approve, receive, export, import or erase.
- Import creates inert drafts using Base import-kit. Preserve its exact original bytes, journal, native-edit conflicts and erasure retirement. CLI portability must include jobs, photos, import custody and erasure journals while excluding credentials and sessions.
- Use small modules, remove superseded paths, and preserve applied migration names. Do not rename project, package, Worker, edition or D1 ids.
- Pin `@runeditrun/rer` exactly and keep package mode; no local CLI copies. Keep copied Base auth byte-exact to its recorded revision. Source attribution is in docs/REUSE.md.
- Before a public push, run Base's full publication scan on the exact tree with zero findings and no exclusions. Research and private evidence stay outside this repository. Never print secrets or commit private settings.
