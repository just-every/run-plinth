# Draft preparation for agents

The HTTP API is the agent command surface. Every call uses native authenticated authority, and every edit supplies the job's current `expected_version`. Read `GET /api/plinth/jobs/:id` before preparing a draft; a stale version returns 409 with no write. Integer amounts are cents. An agent credential can read manager-visible jobs and prepare drafts; it cannot create jobs, approve, issue, receive, export, import or erase.

A signed-in owner first completes Base's credential step-up (`POST /auth/step-up`, body `{"action":"credentials:mint","returnTo":"/app"}`), follows the ordinary email confirmation, then calls `POST /api/plinth/agent-credentials` with `{"expires_in_seconds":3600}` and a same-origin session. Its `credential.token` is shown once. Store it privately; send it as `Authorization: Bearer …`, never in a URL. `GET /api/plinth/agent-credentials` lists metadata; `POST /api/plinth/agent-credentials/:id/revoke` revokes one immediately. Suspension, role changes and expired or revoked native credentials remove access.

| Command (POST relative to `/api/plinth/jobs/:id`) | Draft input in addition to `expected_version` | Person's next step |
| --- | --- | --- |
| `/quotes` | `lines:[{description,quantity,unit_cents}], notes?` | Builder records actual client agreement in Quote, `/quotes/:id/accept` with `method` and `evidence` |
| `/schedules` | `trade,start,end,description` (ISO timestamps) | Builder approves the trade booking, `/schedules/:id/approve` |
| `/diary` | `date,note,attachments?:[{name,mime,base64}]` | Builder publishes the daily log, `/diary/:id/approve` |
| `/variations` | `description,amount_cents` (a change order) | Matching signed-in client approves the change order, `/variations/:id/approve` |
| `/orders` | `supplier,description,amount_cents` | Builder issues `/orders/:id/issue` |
| `/claims` | `description,cumulative_cents` (a pay app) | Builder reviews and approves the pay app, `/claims/:id/approve`, then records `/claims/:id/export` |

Dates use `YYYY-MM-DD`. Photos are PNG or JPEG, five maximum per entry and 2 MB each. Quantities are whole positive numbers. Negative change-order cents are allowed as credits when they do not reduce the contract below amounts already approved for billing.

Managers using a human session publish their own trade bookings and daily logs directly; agent-prepared versions wait for explicit approval. Approval history records preparer, approver, time and the exact snapshot. A client only sees published job records for their own email. Every mutation and file retrieval checks authority on the server, independently of the screen.

Purchase receipts use `/orders/:id/receive` with `amount_cents` and `reference`. Pay-app exports return an immutable `report`; repeating export returns the same report with no new approval or economic effect. The UI downloads CSV and full JSON. No provider is contacted by these product commands.
