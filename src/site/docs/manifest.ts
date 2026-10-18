import overview from '../../../docs/README.md?raw'
import gettingStarted from '../../../docs/GETTING-STARTED.md?raw'
import mainFlows from '../../../docs/MAIN-FLOWS.md?raw'
import moveIn from '../../../docs/MOVE-IN.md?raw'
import backupRestore from '../../../docs/BACKUP-RESTORE.md?raw'
import commands from '../../../docs/COMMANDS.md?raw'
import imports from '../../../docs/IMPORT.md?raw'

export interface Doc {
  path: string
  group: string
  source: string
  title: string
  description: string
  markdown: string
}

export const docs: Doc[] = [
  { path: '/docs', group: 'Start here', source: 'docs/README.md', title: 'Plinth guides', description: 'Run Plinth, take a job from accepted quote to reconciled pay app, move in your jobs and keep a private backup.', markdown: overview },
  { path: '/docs/getting-started', group: 'Start here', source: 'docs/GETTING-STARTED.md', title: 'Getting started', description: 'Run Plinth on your computer, confirm the owner and invite your team and clients.', markdown: gettingStarted },
  { path: '/docs/main-flows', group: 'Run a job', source: 'docs/MAIN-FLOWS.md', title: 'Run a job', description: 'Take a job from an accepted quote through client-approved change orders, trades, daily logs, purchasing and reconciled pay apps.', markdown: mainFlows },
  { path: '/docs/move-in', group: 'Keep your records', source: 'docs/MOVE-IN.md', title: 'Move in', description: 'Preview and approve an Accepted jobs CSV, then review the imported drafts.', markdown: moveIn },
  { path: '/docs/backup-restore', group: 'Keep your records', source: 'docs/BACKUP-RESTORE.md', title: 'Backup and restore', description: 'Export your jobs, photos and approvals, restore an empty installation and carry forward erasures.', markdown: backupRestore },
  { path: '/docs/agent-commands', group: 'Reference', source: 'docs/COMMANDS.md', title: 'Agent commands', description: 'Prepare job drafts through Plinth’s authenticated API while people retain approval authority.', markdown: commands },
  { path: '/docs/import-reference', group: 'Reference', source: 'docs/IMPORT.md', title: 'CSV and import reference', description: 'The Accepted jobs CSV format, validation limits, import journal and erasure rules.', markdown: imports },
]

export const repository = 'https://github.com/just-every/run-plinth'
