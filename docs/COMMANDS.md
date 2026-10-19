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

## Calendar subscriptions (INT-006)

A signed-in person opens a job's Schedule and creates a private calendar link, then pastes it into their calendar client's subscription field. It contains approved trade names, work descriptions and dates for that job only. Treat the URL as a credential. Rotation invalidates the previous URL; revoke removes access. Current account/job grants are checked on every fetch, and restoring a private archive requires a new link.

`POST /api/plinth/jobs/:id/calendar` with `expected_version` and `action: "rotate"` returns `urlPath` once; `action: "revoke"` revokes your subscription. Owners/admins and the assigned client manage their own link; bearer agents cannot. The URL serves read-only RFC 5545 iCalendar, with UTC instants, stable UIDs, incrementing sequences and cancellation tombstones. It contains no internal financial fields. A manager moves booked work through `/schedules/:id/move` with explicit-offset `start`/`end`, or cancels through `/schedules/:id/cancel`; both require `expected_version` and retain the previous decision in History. Moving still checks cross-job conflicts.

## Reusable customers and sites (CRM-001)

Owners and project managers use **Customers** to maintain household, business or person records, contacts, billing/owner roles, property addresses and contact history notes. In Jobs, **Use an existing customer and property** fills the site from its reusable record. The job's **Customer** tab shows current billing contacts and lets a manager change authorized contacts. Each authorized email receives the existing client-safe job access, including photos, change decisions and its own calendar feed. The original client email remains authorized. Removing an additional contact closes its access on the next request. Clients cannot browse the customer directory.

`GET/POST /api/plinth/customers` lists or creates customers; `GET/POST /api/plinth/customers/:id` reads or edits one. Records have `kind` (`household`, `person`, `business`), `name`, `external_id`, `owner_contact_ids` and `billing_contact_ids`. `POST /customers/:id/contacts` adds a contact (`name`, `email`, `phone`, `preferences`, `external_id`), and `/contacts/:contactId` edits it. `/contacts/:contactId/notes` appends an attributed `note`. `/properties` adds a `label` and `address`, and `/properties/:propertyId` edits them. Every edit supplies the current customer `expected_version`; stale writes fail atomically.

A job create or `POST /api/plinth/jobs/:id/customer` accepts `customer_id`, `property_id`, `client_contact_ids` and the job's `expected_version` for edits. `GET /jobs/:id/customer` returns the linked customer to managers. A new property link copies its address; later edits to that property preserve the existing job's site snapshot and the customer's before/after history. Directory records and job links travel in private archives; calendar credentials do not.
