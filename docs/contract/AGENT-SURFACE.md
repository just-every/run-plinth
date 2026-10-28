# Plinth Agent surface (draft)

Draft Agent surface for Plinth, written by ct on 28 October 2026 to the contract standard's section 13. It maps every Core clause of `CONTRACT.md` at main `78fb85dc3764b3462e2a4ef593fd23fae946cf16` (137 Core clauses). It is not part of CONTRACT.md yet: the seed's contract cleanup folds the `### Agent surface` area below into CONTRACT.md as the last area under Target clauses, and the rows under "Status rows" into its Status table. Old clauses whose text fixes what happens to an agent's step: NATIVE-005, NATIVE-008, US-001, CRM-001, ROLE-005, EST-001, EST-002, EST-003, EST-004, EST-005, SCH-002, SCH-006, CLIENT-002, CLIENT-006, SUB-001, SUB-004, SUB-005, RPT-004, BILL-001, BILL-005, PAY-001, PAY-002, PAY-003, INT-006, INT-007, INT-009, INT-011, CARE-002, CARE-005, AGENT-002, AGENT-004, AGENT-005, AGENT-006, AGENT-008, AGENT-009; the cleanup rewords them as the class the step carries.

### Agent surface

**Specialist: Construction project coordinator.** It carries a residential builder's jobs from estimate through procurement, site delivery, reconciled draws and warranty, and follows evidence until promised dates and margin recover.

Inherits BASE-AGENT-001 to BASE-AGENT-013. The company's policy decides every call.

**How Plinth computes each class.**

- **standard:** reading within current grants and reversible internal work, including estimates, takeoff, forecasts, draft documents, corrections with a reversing entry and internal messages; facts are affected item counts. Proposed prices, cash forecasts and recorded supplier quotes do not move money.
- **external:** a send or publication exposes content to a client, subcontractor, vendor, lender or public audience outside the business; facts are recipient count and counterparty known for a current customer/vendor or trusted business domain, new otherwise, public for an open link. Internal recipients do not add external. Item sharing is distinguished from changing standing authority.
- **money:** issuing or changing an actual customer charge, credit or write-off, accepting a payable, changing a live payable's amount, or instructing checkout, refund or payment; facts are exact integer amount, currency, direction and counterparty. Draft estimates and forecasts alone do not add money.
- **commitment:** accepting exact contract/change/selection terms, issuing or amending a purchase commitment, recording a relied-on award, release, schedule, bill, draw, waiver, coverage, inspection or closeout decision; facts are source revision, stated value/currency where present and counterparty. Merely preparing or comparing those records is standard.
- **access:** invitations, roles, assignments, portal features, delegation, device registration, feed grants, receiver subscriptions and agent/source grants change standing authority; facts are affected people and widens or narrows, calculated against the native target and current permissions.
- **security:** creating, rotating or retiring credentials, feed secrets or signing keys, changing protective settings or legal holds; facts name the setting, never a secret value in discovery or events.
- **destructive:** permanent custom-role deletion, job erasure or original deletion cannot be undone in Plinth; facts are affected record/file counts, with erasure retirement dependencies included. Drafts and reversible corrections stay standard.
- **sensitive:** actual content read, stored, processed or sent contains health information, personal ID numbers, bank/card numbers or individual payroll numbers; facts are record count and data kind. A private bid, price or margin alone does not add sensitive, and a masked identifier adds none when the protected content is absent.
- **gated:** an outside provider returns a step reserved to a person, such as Stripe's hosted card entry or bank verification; facts name provider and step. A provider response that needs no such step adds no gated class; Plinth offers no password, 2FA or CAPTCHA tool.

Plinth uses no accounts or live class: opening outside service accounts and deploying or provisioning the installation are installation facts, outside these business-record tools. The server computes classes from arguments and current records, not caller classifications, confirmation booleans or imported text. In the table, `a or b` selects per call, `a · b` always carries both, and `(+ c)` adds c when its content or provider test holds. Today names native actions, not an existing MCP implementation; `none` means that job has no native implementation, and a named partial slice claims only that slice.

| Tool | Does | Core clauses | Risk class | Today |
| --- | --- | --- | --- | --- |
| `plinth.jobs.list` | List currently visible jobs | NATIVE-002, ROLE-002, CLIENT-001 | standard | `GET /api/plinth/jobs` |
| `plinth.jobs.get` | Read one job timeline | NATIVE-002, CLIENT-001 | standard (+ sensitive) | `GET /api/plinth/jobs/:id` |
| `plinth.jobs.create` | Create a quoting job | NATIVE-002 | standard | `POST /api/plinth/jobs` |
| `plinth.company.get` | Read US company conventions | US-001 | standard | `companyResponse in src/plinth/company.ts` |
| `plinth.company.update` | Record company conventions | US-001 | standard | `companyResponse in src/plinth/company.ts` |
| `plinth.customers.get` | Read a customer and its contact history | CRM-001 | standard (+ sensitive) | `customersResponse in src/plinth/customers.ts` |
| `plinth.customers.save` | Save reusable customer contacts and notes | CRM-001 | standard (+ sensitive) | `customersResponse in src/plinth/customers.ts` |
| `plinth.properties.save` | Save a property and site address | CRM-001 | standard | `customersResponse in src/plinth/customers.ts` |
| `plinth.jobs.link_customer` | Link a customer and snapshot the site | CRM-001 | standard | `linkCustomer in src/plinth/job-customers.ts` |
| `plinth.leads.list` | List opportunities and next actions | CRM-002 | standard | none |
| `plinth.leads.create` | Capture a sourced lead | CRM-002 | standard | none |
| `plinth.leads.update` | Record lead stage, visit or lost reason | CRM-002 | standard | none |
| `plinth.leads.convert` | Convert a won lead to its linked job | CRM-002 | standard | none |
| `plinth.templates.get` | Read job and to-do templates | SET-001, TODO-001 | standard | `todosResponse in src/plinth/todos.ts (to-do templates only)` |
| `plinth.templates.save` | Save a reusable job or checklist template | SET-001, TODO-001 | standard | `todosResponse in src/plinth/todos.ts (to-do templates only)` |
| `plinth.branding.update` | Set proposal and invoice branding | SET-001 | standard | none |
| `plinth.people.invite` | Invite an internal person or external contact | ROLE-001, ROLE-003, SET-001 | access (+ external) | `operatorAuth native invitation action` |
| `plinth.team.assign` | Change a person's role and job assignments | ROLE-001, ROLE-002, ROLE-004 | access | `teamResponse in src/plinth/team.ts` |
| `plinth.roles.save` | Create or edit a custom role | ROLE-006 | access | `rolesResponse in src/plinth/roles.ts` |
| `plinth.roles.delete` | Delete an unassigned custom role | ROLE-006 | access · destructive | `DELETE /api/plinth/roles/:id via rolesResponse` |
| `plinth.portal.configure` | Change client or subcontractor feature grants | ROLE-003 | access | `portalPolicy in src/plinth/portal-policy.ts` |
| `plinth.accountants.designate` | Designate the job's accountant reviewer | ROLE-004 | access | `accountingWrite in src/plinth/accounting-authority.ts` |
| `plinth.audit.search` | Search attributed job and authority events | ROLE-005, NATIVE-013 | standard | `auditResponse in src/plinth/audit-http.ts` |
| `plinth.audit.export` | Export the filtered audit references | ROLE-005 | standard | `auditResponse in src/plinth/audit-http.ts` |
| `plinth.holds.set` | Place a reasoned retention or legal hold | ROLE-005 | security | `holdsResponse in src/plinth/holds.ts` |
| `plinth.holds.release` | Release a hold with its reason | ROLE-005 | security | `holdsResponse in src/plinth/holds.ts` |
| `plinth.quotes.get` | Read exact estimate revisions and source lines | NATIVE-002, EST-001 | standard | `GET /api/plinth/jobs/:id` |
| `plinth.quotes.prepare` | Prepare a coded estimate revision | NATIVE-002, EST-001 | standard | `prepareQuote in src/plinth/quotes.ts` |
| `plinth.quotes.compare` | Compare quantities, alternates and cents | EST-001 | standard | `src/plinth/estimate-compare.ts` |
| `plinth.quotes.export` | Export scoped cost-code totals | EST-001 | standard | `costCodeReport and costCodeCsv in src/plinth/estimate-report.ts` |
| `plinth.quotes.accept` | Record exact acceptance and freeze sale baselines | NATIVE-002, EST-007 | money · commitment | `acceptQuote and freezeOriginalBudget` |
| `plinth.catalogs.get` | Read rates, assemblies and templates | EST-002 | standard | `catalogResponse in src/plinth/estimate-catalog.ts` |
| `plinth.catalogs.save` | Save a new catalog or assembly revision | EST-002, AGENT-009 | standard | `catalogResponse in src/plinth/estimate-catalog.ts` |
| `plinth.catalogs.preview` | Price dimensions against exact rate revisions | EST-002 | standard | `catalogPreview in src/plinth/catalog-quote.ts` |
| `plinth.catalogs.apply` | Copy a priced assembly into a draft quote | EST-002 | standard | `applyCatalog in src/plinth/catalog-quote.ts` |
| `plinth.pricing.preview` | Compute ordered markup, discount and tax | EST-003 | standard | `previewPricing in src/plinth/estimate-pricing.ts` |
| `plinth.pricing.apply` | Create a priced draft revision | EST-003 | standard | `applyPricing in src/plinth/estimate-pricing.ts` |
| `plinth.tax_rates.save` | Record dated tax rates and exemptions | EST-003 | standard | `pricingResponse in src/plinth/estimate-pricing.ts` |
| `plinth.takeoff.get` | Read exact sheets, calibration and geometry | EST-004 | standard | `GET /api/plinth/jobs/:id` |
| `plinth.sheets.upload` | Retain an original drawing revision | EST-004, DOC-001 | standard (+ sensitive) | `takeoffAction in src/plinth/takeoff-documents.ts` |
| `plinth.takeoff.calibrate` | Record a sheet scale | EST-004 | standard | `takeoffAction in src/plinth/takeoff-documents.ts` |
| `plinth.takeoff.measure` | Record length, area, count or opening geometry | EST-004 | standard | `takeoffAction in src/plinth/takeoff-documents.ts` |
| `plinth.takeoff.preview` | Compare measured quantities and draft prices | EST-004 | standard | `previewTakeoff in src/plinth/takeoff-estimate.ts` |
| `plinth.takeoff.apply` | Populate a draft estimate from measured sources | EST-004 | standard | `applyTakeoff in src/plinth/takeoff-estimate.ts` |
| `plinth.products.get` | Read captured products and stale-source warnings | EST-005 | standard | `GET /api/plinth/jobs/:id` |
| `plinth.products.capture` | Retain a dated supplier product and original image | EST-005 | standard | `productAction in src/plinth/products.ts` |
| `plinth.products.refresh` | Append refreshed product evidence | EST-005 | standard | `productAction in src/plinth/products.ts` |
| `plinth.products.present` | Publish an exact product option to a room board | EST-005, CLIENT-002 | standard or external | `selectionAction and productAction (native room-board slice)` |
| `plinth.proposals.prepare` | Prepare an exact branded contract document | EST-006 | standard | none |
| `plinth.proposals.send` | Send a proposal to named signers | EST-006 | external (+ sensitive) | none |
| `plinth.proposals.sign` | Sign exact proposal terms for the named sponsor | EST-006 | money · commitment | none |
| `plinth.designs.get` | Read room layouts and linked visualization revisions | EST-008, DESIGN-001 | standard | none |
| `plinth.designs.save` | Save measured room geometry or a design artifact | EST-008, DESIGN-001 | standard | none |
| `plinth.designs.present` | Share a revisioned room presentation | EST-008, DESIGN-001 | standard or external | none |
| `plinth.bids.get` | Read scoped packages and original responses | BID-001, BID-002 | standard | `bidsResponse and bidComparisonResponse` |
| `plinth.bids.prepare` | Prepare a cost-coded bid package | BID-001 | standard | `bidsResponse in src/plinth/bids.ts` |
| `plinth.bids.invite` | Grant a company contact its bid package | BID-001 | access · external | `bidsResponse (native inbox; no mail)` |
| `plinth.bids.respond` | Submit a bid response or decline | BID-001 | external · commitment | `bidsResponse in src/plinth/bids.ts` |
| `plinth.bids.level` | Record source-backed comparison adjustments | BID-002 | standard | `bidComparisonResponse in src/plinth/bid-comparison-http.ts` |
| `plinth.bids.award` | Record an exact award and linked budget delta | BID-002, SUB-001 | commitment | `bidComparisonResponse in src/plinth/bid-comparison-http.ts` |
| `plinth.bids.chase` | Send the next eligible missing-response notice | BID-003 | external | `src/plinth/bid-follow-up.ts (qualified native email slice)` |
| `plinth.schedule.get` | Read assigned dates, capacity and constraints | NATIVE-003, SCH-001, SCH-003, SCH-005 | standard | `GET jobs/:id/capacity and jobs/:id/forecast` |
| `plinth.schedule.preview` | Compute dependent dates and resource conflicts | NATIVE-003, SCH-001, SCH-003 | standard | `previewSchedule in src/plinth/schedule-plan.ts` |
| `plinth.schedule.publish` | Commit an exact schedule revision to its audience | NATIVE-003, SCH-001, SCH-004 | commitment (+ external) | `publishSchedule (native schedule only; channel notices absent)` |
| `plinth.schedule.record_baseline` | Record a named immutable promised baseline | SCH-002 | commitment | `scheduleBaselineAction in src/plinth/schedule-baselines.ts` |
| `plinth.schedule.record_actual` | Append attributed actuals and installed quantities | SCH-002, SCH-005 | standard | `scheduleBaselineAction (native actuals)` |
| `plinth.schedule.move` | Commit a versioned date move with conflict checks | NATIVE-003, SCH-003, SCH-004 | commitment (+ external) | `changeSchedule in src/plinth/schedule-changes.ts` |
| `plinth.schedule.cancel` | Cancel a published task preserving its history | SCH-001, SCH-004 | commitment (+ external) | `changeSchedule in src/plinth/schedule-changes.ts` |
| `plinth.schedule.acknowledge` | Record receipt of an exact changed schedule | SCH-004 | commitment | none |
| `plinth.resources.save` | Set crew/equipment capacity, leave and travel | SCH-003 | standard | `resourceResponse in src/plinth/schedule-resources.ts` |
| `plinth.trades.invite` | Grant the exact booking to its company contact | SCH-003 | access · external | `inviteTrade in src/plinth/trade-confirmations.ts` |
| `plinth.trades.confirm` | Record attendance or alternative dates for the sponsor | SCH-003 | external · commitment | `tradePortalResponse in src/plinth/trade-confirmations.ts` |
| `plinth.constraints.record` | Record a permit, inspection or site hold | SCH-006, BOUND-002 | standard (+ sensitive) | `constraintAction in src/plinth/schedule-constraints.ts` |
| `plinth.constraints.clear` | Record the accountable sponsor's clearance evidence | SCH-006, BOUND-002 | commitment | `constraintAction (records evidence; no certification)` |
| `plinth.plans.get` | Read plan sets and pinned originals | DOC-001 | standard (+ sensitive) | `planResponse in src/plinth/plan-http.ts` |
| `plinth.plans.approve` | Record the exact current set as the working set | DOC-001 | commitment | `planResponse in src/plinth/plan-http.ts` |
| `plinth.plans.distribute` | Publish exact sheets to named recipients | DOC-001 | standard or external (+ sensitive) | `planResponse in src/plinth/plan-http.ts` |
| `plinth.plans.acknowledge` | Record receipt of a sheet revision | DOC-001 | commitment | `planResponse in src/plinth/plan-http.ts` |
| `plinth.drawings.recognize` | Propose sheet names and detail links | DOC-002 | standard | none |
| `plinth.drawings.annotate` | Save revision-specific markup or corrected links | DOC-001, DOC-002 | standard | `planResponse (markup slice; recognition absent)` |
| `plinth.drawings.compare` | Compare exact drawing revisions | DOC-002 | standard | none |
| `plinth.rfis.get` | Read permitted questions and response revisions | DOC-003 | standard (+ sensitive) | `rfiInboxResponse in src/plinth/rfi-inbox.ts` |
| `plinth.rfis.raise` | Record a sourced question and exact attachments | DOC-003 | standard (+ sensitive) | `rfiAction in src/plinth/rfis.ts` |
| `plinth.rfis.route` | Grant an RFI inbox and its named sheets | DOC-003 | access (+ external) | `rfiAction in src/plinth/rfis.ts` |
| `plinth.rfis.respond` | Record an exact technical response | DOC-003 | commitment | `rfiAction in src/plinth/rfis.ts` |
| `plinth.rfis.publish` | Distribute a versioned response and proposed impacts | DOC-003 | commitment (+ external) (+ sensitive) | `rfiAction in src/plinth/rfis.ts` |
| `plinth.rfis.acknowledge` | Record receipt of a response revision | DOC-003 | commitment | `rfiAction in src/plinth/rfis.ts` |
| `plinth.rfis.resolve` | Close or reopen the evidence-backed question | DOC-003 | commitment | `rfiAction in src/plinth/rfis.ts` |
| `plinth.submittals.get` | Read the register and exact originals | DOC-004 | standard (+ sensitive) | `GET jobs/:id/submittals` |
| `plinth.submittals.submit` | Retain a supplier's original package | DOC-004 | standard (+ sensitive) | `submittalAction in src/plinth/submittals.ts` |
| `plinth.submittals.route` | Assign the package's current reviewer authority | DOC-004 | access | `submittalAction in src/plinth/submittals.ts` |
| `plinth.submittals.decide` | Record a version-bound disposition | DOC-004 | commitment | `submittalAction in src/plinth/submittals.ts` |
| `plinth.submittals.notify` | Send the exact disposition and package to the supplier | DOC-004 | external (+ sensitive) | none |
| `plinth.meetings.get` | Read permitted minutes and action history | DOC-005 | standard (+ sensitive) | `GET jobs/:id/meetings` |
| `plinth.meetings.save` | Record private minutes and action assignments | DOC-005 | standard (+ sensitive) | `meetingAction in src/plinth/meetings.ts` |
| `plinth.meeting_actions.complete` | Record an assigned action's outcome | DOC-005 | standard | `meetingAction in src/plinth/meetings.ts` |
| `plinth.extracts.publish` | Publish audience-scoped meeting text | DOC-005 | standard or external (+ sensitive) | `publishMeetingShare in src/plinth/meeting-sharing.ts` |
| `plinth.extracts.revoke` | Retire an extract's audience grant | DOC-005 | access | `revokeMeetingShare in src/plinth/meeting-sharing.ts` |
| `plinth.extracts.send` | Send one requested exact meeting extract | DOC-005 | standard or external (+ sensitive) | `sendMeetingEmail in src/plinth/meeting-share-mail.ts` |
| `plinth.search.query` | Search permitted decisions and correspondence | DOC-005 | standard (+ sensitive) | `decisionSearch in src/plinth/decision-search.ts` |
| `plinth.transcriptions.save` | Retain a sourced transcription revision | DOC-005 | standard (+ sensitive) | `saveTranscription in src/plinth/file-transcriptions.ts` |
| `plinth.folders.create` | Create a private job or company document folder | DOC-007 | standard | none |
| `plinth.files.upload` | Retain an original miscellaneous file revision | DOC-007 | standard or external (+ sensitive) | none |
| `plinth.files.share` | Set an item's internal or external audience | DOC-007 | standard or external (+ sensitive) | none |
| `plinth.files.delete` | Permanently remove an original with retention checks | DOC-007 | destructive | none |
| `plinth.diary.get` | Read permitted logs and original photos | NATIVE-004, FIELD-001 | standard (+ sensitive) | `GET jobs/:id and serveAttachment` |
| `plinth.diary.prepare` | Record a log with source weather and photos | NATIVE-004, FIELD-001 | standard (+ sensitive) | `prepareDiary (notes/photos; structured weather absent)` |
| `plinth.diary.publish` | Publish a client-safe log revision | NATIVE-004, FIELD-001 | standard or external (+ sensitive) | `approveDiary in src/plinth/attachments.ts` |
| `plinth.diary.comment` | Add a scoped comment to a log | FIELD-001 | standard or external (+ sensitive) | none |
| `plinth.time.get` | Read own time or permitted payroll allocations | FIELD-002, COST-003 | standard (+ sensitive) | `fieldTimeResponse in src/plinth/field-time.ts` |
| `plinth.time.enter` | Record time by job/code, break and activity | FIELD-002 | standard | `fieldTimeResponse in src/plinth/field-time.ts` |
| `plinth.time.correct` | Append a reasoned time correction | FIELD-002 | standard | `fieldTimeResponse in src/plinth/field-time.ts` |
| `plinth.time.approve` | Record a supervisor decision and labor actual | FIELD-002, COST-003 | commitment (+ sensitive) | `fieldTimeResponse in src/plinth/field-time.ts` |
| `plinth.time.set_rate` | Record a prospective employee pay-rate revision | FIELD-002 | money (+ sensitive) | `fieldTimeResponse (native rate configuration)` |
| `plinth.time.export` | Export permitted payroll allocation rows | FIELD-002 | standard (+ sensitive) | `GET jobs/:id/time/payroll.csv` |
| `plinth.punch.get` | Read assigned observations and form revisions | FIELD-004 | standard (+ sensitive) | `punchResponse in src/plinth/punch-http.ts` |
| `plinth.punch.capture` | Create an observation with original photo/form | FIELD-004 | standard (+ sensitive) | `punchResponse in src/plinth/punch-http.ts` |
| `plinth.punch.assign` | Grant an issue to its qualified trade contact | FIELD-004 | access · external | `punchResponse in src/plinth/punch-http.ts` |
| `plinth.punch.repair` | Submit the assigned company's repair evidence | FIELD-004 | external · commitment | `punchResponse in src/plinth/punch-http.ts` |
| `plinth.punch.decide` | Record the sponsor's exact repair disposition | FIELD-004 | commitment | `punchResponse in src/plinth/punch-http.ts` |
| `plinth.inventory.get` | Read job stock and equipment movements | FIELD-005 | standard | none |
| `plinth.inventory.receive` | Record quantities, damage and delivery evidence | FIELD-005 | standard | `none (order value/line receipts are separate)` |
| `plinth.inventory.transfer` | Transfer good stock between job locations | FIELD-005 | standard | none |
| `plinth.inventory.install` | Record installed stock and equipment usage | FIELD-005 | standard | none |
| `plinth.todos.list` | List own checklist items or granted overdue work | TODO-001, SCH-005 | standard | `todosResponse in src/plinth/todos.ts` |
| `plinth.todos.create` | Create a job or company checklist | TODO-001 | standard (+ sensitive) | `todosResponse in src/plinth/todos.ts` |
| `plinth.todos.assign` | Grant a checklist item to its assignee | TODO-001 | access (+ external) | `todosResponse in src/plinth/todos.ts` |
| `plinth.todos.complete` | Record one checklist completion | TODO-001 | standard | `todosResponse in src/plinth/todos.ts` |
| `plinth.todos.reopen` | Reopen a completed checklist item with history | TODO-001 | standard | `todosResponse in src/plinth/todos.ts` |
| `plinth.todos.comment` | Publish a comment to its current item audience | TODO-001 | standard or external (+ sensitive) | `todosResponse (native comment slice)` |
| `plinth.conversations.send` | Send a scoped portal conversation message | CLIENT-001 | standard or external (+ sensitive) | `none (native correspondence is a separate slice)` |
| `plinth.selections.get` | Read exact presented choices and procurement status | CLIENT-002, CLIENT-005 | standard | `selectionProjection in src/plinth/selections.ts` |
| `plinth.selections.prepare` | Prepare a room/category choice revision | CLIENT-002 | standard | `selectionAction in src/plinth/selections.ts` |
| `plinth.selections.present` | Publish exact options and deadline to the client | CLIENT-002 | external | `selectionAction in src/plinth/selections.ts` |
| `plinth.selections.sign` | Record the sponsor's exact choice | CLIENT-002, CLIENT-006 | commitment | `selectionAction and selectionDelegationsResponse` |
| `plinth.selections.dispute` | Record a dispute without erasing signatures | CLIENT-005 | commitment | `selectionDecision in src/plinth/selection-decisions.ts` |
| `plinth.selections.substitute` | Prepare a sourced substitute comparison | CLIENT-005 | standard | `selectionDecision in src/plinth/selection-decisions.ts` |
| `plinth.selections.withdraw` | Withdraw a decision while retaining history | CLIENT-005 | commitment | `selectionDecision in src/plinth/selection-decisions.ts` |
| `plinth.delegations.create` | Grant one eligible contact one revision's signing scope | CLIENT-006 | access | `selectionDelegationsResponse in src/plinth/selection-delegations.ts` |
| `plinth.delegations.revoke` | Retire an unused signing delegation | CLIENT-006 | access | `selectionDelegationsResponse in src/plinth/selection-delegations.ts` |
| `plinth.allowances.preview` | Compute exact incremental overage or credit | CLIENT-003 | standard | `previewAllowanceChange in src/plinth/allowance-changes.ts` |
| `plinth.allowances.prepare` | Prepare a sourced allowance variation | CLIENT-003 | standard | `applyAllowanceChange in src/plinth/allowance-changes.ts` |
| `plinth.changes.prepare` | Prepare price and calendar-day impact terms | NATIVE-005, CLIENT-004 | standard | `prepareVariation (native priced change; electronic execution absent)` |
| `plinth.changes.sign` | Record the exact change decision for its sponsor | NATIVE-005, CLIENT-003, CLIENT-004 | money · commitment | `approveVariation (recorded decision, no e-signature)` |
| `plinth.vendors.get` | Read permitted companies and qualification records | SUB-001 | standard (+ sensitive) | `vendorsResponse in src/plinth/vendors.ts` |
| `plinth.vendors.save` | Save company, scope, rate or W-9 evidence | SUB-001 | standard (+ sensitive) | `vendorsResponse in src/plinth/vendors.ts` |
| `plinth.vendors.qualify` | Record the accountable sponsor's trade qualification | SUB-001 | commitment | `vendorsResponse in src/plinth/vendors.ts` |
| `plinth.subcontracts.award` | Commit the exact qualified company scope | SUB-001 | commitment | `awardSubcontract in src/plinth/subcontracts.ts` |
| `plinth.subcontracts.grant` | Change the awarded company's contact scope | SUB-001, ROLE-003 | access | `subcontractAccess in src/plinth/subcontracts.ts` |
| `plinth.subcontracts.release` | Record the scope's qualified work release | SUB-003, BOUND-002 | commitment | `releaseSubcontract in src/plinth/subcontracts.ts` |
| `plinth.sub_portal.submit` | Submit one scoped subcontractor invoice | SUB-002 | external · commitment (+ sensitive) | `subcontractorPortalResponse (bill-upload slice)` |
| `plinth.compliance.upload` | Retain an original insurance or license document | SUB-003, BOUND-002 | standard (+ sensitive) | `vendorsResponse and subcontractorPortalResponse` |
| `plinth.compliance.set_rules` | Set coverage requirements and reviewer scope | SUB-003 | access | `rulesResponse in src/plinth/compliance.ts` |
| `plinth.compliance.decide` | Record an exact qualified coverage decision | SUB-003, BOUND-002 | commitment | `vendorsResponse in src/plinth/vendors.ts` |
| `plinth.waivers.prepare` | Prepare exact waiver terms and amount | SUB-004 | standard | `lienAction in src/plinth/lien-waivers.ts` |
| `plinth.waivers.record` | Record the sponsor's exact received release | SUB-004 | commitment (+ sensitive) | `lienAction and releaseFile in src/plinth/lien-waivers.ts` |
| `plinth.orders.get` | Read permitted PO terms and fulfillment | NATIVE-006, SUB-005 | standard | `orderResponse in src/plinth/purchase-orders.ts` |
| `plinth.orders.prepare` | Prepare an itemized PO from a native source | NATIVE-006, SUB-005 | standard | `prepareOrder in src/plinth/operations.ts` |
| `plinth.orders.issue` | Issue the exact purchase commitment | NATIVE-006, SUB-005 | commitment | `issueOrder in src/plinth/operations.ts` |
| `plinth.orders.send` | Send one issued revision to its vendor | SUB-005 | external · commitment | `sendOrder in src/plinth/purchase-order-send.ts` |
| `plinth.orders.amend` | Prepare an amendment and its date/budget impact | SUB-005 | standard | `orderAction in src/plinth/purchase-orders.ts` |
| `plinth.orders.accept_amendment` | Commit an exact amendment preserving receipts | SUB-005 | commitment | `orderAction in src/plinth/purchase-orders.ts` |
| `plinth.orders.receive` | Append a sourced partial value/quantity receipt | NATIVE-006, SUB-005 | standard | `receiveOrder and orderAction` |
| `plinth.orders.return` | Append a bounded return with source reference | SUB-005 | standard | `orderAction in src/plinth/purchase-orders.ts` |
| `plinth.orders.acknowledge` | Record vendor acknowledgment evidence | SUB-005 | commitment | `orderAction in src/plinth/purchase-orders.ts` |
| `plinth.orders.promise` | Record a changed promised arrival and reason | SUB-005 | commitment | `orderAction in src/plinth/purchase-orders.ts` |
| `plinth.orders.ship` | Record shipment, carrier and tracking evidence | SUB-005 | standard | `orderAction in src/plinth/purchase-orders.ts` |
| `plinth.orders.cancel` | Cancel unreceived commitment with retained history | SUB-005 | commitment | `orderAction in src/plinth/purchase-orders.ts` |
| `plinth.ledger.get` | Read reconciled code totals and exact sources | COST-001 | standard | `costLedger via src/plinth/cost-http.ts` |
| `plinth.bills.get` | Read bills and immutable original bytes | COST-002 | standard (+ sensitive) | `costResponse in src/plinth/cost-http.ts` |
| `plinth.bills.capture` | Retain a coded bill and source original | COST-002 | standard (+ sensitive) | `billAction in src/plinth/cost-bills.ts` |
| `plinth.bills.recode` | Correct draft coding or append a posted correction | COST-002 | standard | `billAction in src/plinth/cost-bills.ts` |
| `plinth.bills.post` | Accept the exact payable and post it once | COST-002 | money · commitment | `billAction in src/plinth/cost-bills.ts` |
| `plinth.cost_sources.prepare` | Record labor, equipment or expense evidence | COST-003 | standard (+ sensitive) | `sourceAction in src/plinth/cost-labor.ts` |
| `plinth.cost_sources.post` | Record a source decision without duplicate actuals | COST-003 | commitment (+ sensitive) | `sourceAction in src/plinth/cost-labor.ts` |
| `plinth.costs.transfer` | Append a balanced cost reassignment | COST-003 | standard | `transferCost in src/plinth/cost-transfer.ts` |
| `plinth.costs.reimburse` | Record an observed reimbursement without reposting expense | COST-003 | standard (+ sensitive) | `sourceAction (staff-recorded reimbursement only)` |
| `plinth.forecasts.get` | Read preserved cost and margin snapshots | COST-004, AGENT-001 | standard | `GET jobs/:id/costs/forecasts` |
| `plinth.forecasts.calculate` | Save source-cited cost-to-complete assumptions | COST-004 | standard | `forecastAction in src/plinth/cost-forecast.ts` |
| `plinth.cash.forecast` | Compute dated cash exposure and WIP | COST-005 | standard | `cashReport in src/plinth/cost-periods.ts` |
| `plinth.periods.review` | Record the sponsor's exact accountant decision | COST-005, ROLE-004 | commitment | `accountingWrite in src/plinth/accounting-authority.ts` |
| `plinth.periods.close` | Freeze the reviewed accounting period | COST-005 | commitment | `nativePeriodClose and periodAction` |
| `plinth.exceptions.refresh` | Compute assigned variance and stale-source exceptions | COST-006 | standard | `refreshExceptions in src/plinth/cost-exceptions.ts` |
| `plinth.exceptions.resolve` | Record a reconciled source correction outcome | COST-006 | commitment | `exceptionAction in src/plinth/cost-exceptions.ts` |
| `plinth.receipts.capture` | Retain a receipt and proposed OCR fields | COST-007 | standard (+ sensitive) | none |
| `plinth.receipts.match` | Match an authorized feed transaction to its source | COST-007 | standard (+ sensitive) | none |
| `plinth.reports.query` | Run a permission-scoped portfolio or productivity view | RPT-001, RPT-002, RPT-004 | standard (+ sensitive) | `reportsResponse and estimate-performance.ts` |
| `plinth.reports.export` | Export an annotated scoped report | RPT-001, RPT-002, RPT-004 | standard (+ sensitive) | `reportsResponse in src/plinth/reports.ts` |
| `plinth.reports.schedule` | Save a recipient-scoped report schedule | RPT-003 | standard | `reportScheduleResponse in src/plinth/report-schedule.ts` |
| `plinth.reports.send` | Send the next exact authorized digest or draw packet | RPT-003 | standard or external (+ sensitive) | `dispatchReportSchedules in src/plinth/report-schedule.ts` |
| `plinth.fields.define` | Create or revise a typed custom field definition | RPT-004 | standard | `reportsResponse in src/plinth/reports.ts` |
| `plinth.fields.set` | Set an authorized record's typed values | RPT-004 | standard (+ sensitive) | `reportsResponse in src/plinth/reports.ts` |
| `plinth.views.save` | Save exact filters, columns and record scope | RPT-004 | standard | `reportsResponse in src/plinth/reports.ts` |
| `plinth.applications.prepare` | Prepare a source-linked cumulative SOV draw | NATIVE-007, BILL-001 | standard | `prepareClaim and prepareSov` |
| `plinth.applications.approve` | Record exact earned values and reconciliation | NATIVE-007, BILL-001 | commitment | `approveClaim in src/plinth/claims.ts` |
| `plinth.applications.issue` | Freeze an immutable application and waiver packet | NATIVE-007, BILL-001 | commitment | `exportClaim in src/plinth/claims.ts` |
| `plinth.applications.export` | Download the exact issued application | NATIVE-007 | standard | `GET jobs/:id/claims/:claim/application.json (CSV/HTML also)` |
| `plinth.retainage.configure` | Record separate client or supplier contract rates | BILL-003 | commitment | `configureRetainage and configureSupplierRetainage` |
| `plinth.retainage.release` | Release exact held value against milestone evidence | BILL-003, CARE-001 | money · commitment | `releaseRetainage and releaseSupplierRetainage` |
| `plinth.invoices.preview` | Compute deposit, milestone or cost-plus billing | BILL-002, BILL-004 | standard | `costBilling in src/plinth/cost-billing.ts (cost-plus preview)` |
| `plinth.invoices.issue` | Issue an exact numbered charge or source credit | BILL-002, BILL-004 | money · commitment | `invoiceAction in src/plinth/invoices.ts` |
| `plinth.invoices.send` | Send the exact issued document to its billing client | BILL-002 | external (+ sensitive) | `sendInvoice in src/plinth/invoice-send.ts` |
| `plinth.invoices.acknowledge` | Record the sponsor's invoice acknowledgment | BILL-002 | commitment | `invoiceAction in src/plinth/invoices.ts` |
| `plinth.invoices.correct` | Append a linked credit, debit or permitted void | BILL-005 | money · commitment | `correctInvoice in src/plinth/invoice-corrections.ts` |
| `plinth.invoices.write_off` | Record a reasoned residual write-off | BILL-005 | money · commitment | `correctInvoice in src/plinth/invoice-corrections.ts` |
| `plinth.receivables.get` | Read aging, retainage and unapplied cash | BILL-006 | standard | `receivables in src/plinth/remittances.ts` |
| `plinth.remittances.record` | Record dated external receipt evidence and allocations | BILL-006 | standard | `remittanceAction in src/plinth/remittances.ts` |
| `plinth.remittances.return` | Append source-linked receipt reversals | BILL-006 | standard | `remittanceAction and invoiceAction (native return slice)` |
| `plinth.payments.get` | Read exact processor attempts and settlement facts | PAY-001, PAY-002 | standard | `GET jobs/:id/payments` |
| `plinth.payments.checkout` | Instruct checkout of the exact issued balance | PAY-001 | money · external (+ gated) | `startCheckout in src/plinth/pay-checkout.ts` |
| `plinth.payments.reconcile` | Query an existing instruction's provider evidence | PAY-002 | external | `reconcilePayment in src/plinth/pay-reconcile.ts` |
| `plinth.payments.refund` | Instruct a separate exact available-funds refund | BILL-005, PAY-002 | money · external | `refundPayment in src/plinth/pay-refunds.ts` |
| `plinth.payables.release` | Instruct an exact authorized vendor payment | PAY-003 | money · external | none |
| `plinth.feeds.create` | Create a scoped calendar credential | INT-006 | access · security | `manageCalendar in src/plinth/calendar.ts` |
| `plinth.feeds.rotate` | Replace a scoped feed secret | INT-006 | access · security | `manageCalendar in src/plinth/calendar.ts` |
| `plinth.feeds.revoke` | Retire a calendar credential | INT-006 | access · security | `manageCalendar in src/plinth/calendar.ts` |
| `plinth.mail.get` | Read permitted job correspondence and originals | INT-007 | standard (+ sensitive) | `jobMailResponse in src/plinth/mail-http.ts` |
| `plinth.mail.prepare` | Prepare exact message text and recipient scope | INT-007 | standard (+ sensitive) | `native draft composition; persisted preparation absent` |
| `plinth.mail.send` | Send exact job correspondence with suppression checks | INT-007 | standard or external (+ sensitive) | `jobMailResponse (current client-only send)` |
| `plinth.receivers.create` | Bind a native reference-event subscription | INT-009 | access · security | `connectorsResponse in src/plinth/connectors.ts` |
| `plinth.receivers.grant` | Change a receiver's future event authority | INT-014 | access | `grantReceiver in src/plinth/connector-grants.ts` |
| `plinth.receivers.revoke` | Retire receiver and future event authority | INT-009, INT-014 | access · security | `connectorsResponse and revokeGrant` |
| `plinth.receivers.rotate` | Replace the native receiver signing key | INT-009, OPS-002 | security | `connectorsResponse in src/plinth/connectors.ts` |
| `plinth.receivers.deliver` | Send one signed reference event | INT-009, INT-014 | external | `sendReferences and connector-dispatch.ts` |
| `plinth.receivers.list_deliveries` | Read accepted, failed and uncertain attempts | INT-009, INT-014 | standard | `GET connections/:id/deliveries` |
| `plinth.background.get_status` | Read bounded native background-work progress | OPS-002 | standard | `recoveryBindings and native delivery logs (slice only)` |
| `plinth.rules.preview` | Preview dated follow-up eligibility and recipients | AUTO-001 | standard | `followupResponse in src/plinth/followup-rules.ts` |
| `plinth.rules.save` | Save a follow-up sequence revision | AUTO-001 | standard | `followupResponse (native preview configuration only)` |
| `plinth.rules.dispatch` | Send one eligible sequence step | AUTO-001 | standard or external (+ sensitive) | `none (bid chasing has its own native action)` |
| `plinth.continuations.resume` | Resume a source-keyed downstream draft | AUTO-002 | standard | `resumeContinuity in src/plinth/continuity.ts` |
| `plinth.continuations.notify` | Send the event's exact authorized notice | AUTO-002 | standard or external (+ sensitive) | `sendContinuityNotice in src/plinth/continuity-notice.ts` |
| `plinth.actuals.refresh` | Refresh forecasts and draw previews from posted sources | AUTO-003 | standard | none |
| `plinth.collections.refresh` | Reconcile payment evidence and collection exceptions | AUTO-004 | standard | none |
| `plinth.notifications.set_preferences` | Save per-event channels, consent and quiet hours | NOTIFY-001 | standard | `none (bounded meeting-email choices only)` |
| `plinth.notifications.send` | Deliver one eligible event on its selected channel | NOTIFY-001 | standard or external (+ sensitive) | `none (individual native email actions only)` |
| `plinth.devices.register` | Bind a signed-in person's native push device | NOTIFY-002 | access · security | none |
| `plinth.devices.revoke` | Retire the native push token and device grant | NOTIFY-002 | access · security | none |
| `plinth.push.send` | Deliver a scoped push with its exact record link | NOTIFY-002 | standard or external (+ sensitive) | none |
| `plinth.handover.assemble` | Prepare a source-linked closeout package | CARE-001, AGENT-006 | standard (+ sensitive) | `handoverResponse in src/plinth/handover.ts (native assembly)` |
| `plinth.handover.publish` | Publish an exact client-safe handover revision | CARE-001 | external (+ sensitive) | `handoverResponse in src/plinth/handover.ts` |
| `plinth.handover.accept` | Record separate builder or client completion terms | CARE-001 | commitment | `handoverResponse in src/plinth/handover.ts` |
| `plinth.service.get` | Read currently assigned warranty cases and originals | CARE-002, CARE-005 | standard (+ sensitive) | `warrantyServiceResponse in src/plinth/warranty-service.ts` |
| `plinth.service.request` | Submit a component request, photos and availability | CARE-002 | external (+ sensitive) | `warrantyServiceResponse in src/plinth/warranty-service.ts` |
| `plinth.service.assign` | Grant one qualified company contact the repair case | CARE-002 | access · external | `warrantyServiceResponse in src/plinth/warranty-service.ts` |
| `plinth.service.book` | Commit an exact qualified repair visit to its participants | CARE-002 | commitment · external | `warrantyServiceResponse in src/plinth/warranty-service.ts` |
| `plinth.service.repair` | Submit the assigned company's repair evidence | CARE-002 | external · commitment | `warrantyServiceResponse in src/plinth/warranty-service.ts` |
| `plinth.service.decide` | Record the builder's exact repair disposition | CARE-002 | commitment | `warrantyServiceResponse in src/plinth/warranty-service.ts` |
| `plinth.service.acknowledge` | Record the assigned client's exact acknowledgment | CARE-002, CARE-005 | commitment | `warrantyServiceResponse in src/plinth/warranty-service.ts` |
| `plinth.service.withdraw` | Record the sponsor's reasoned request withdrawal | CARE-005 | commitment | `src/plinth/warranty-no-repair.ts` |
| `plinth.service.resolve` | Record a reasoned builder resolution without repair | CARE-005 | commitment | `src/plinth/warranty-no-repair.ts` |
| `plinth.service.close` | Close the case against exact retained decisions | CARE-002, CARE-005 | commitment | `src/plinth/warranty-service.ts and warranty-no-repair.ts` |
| `plinth.warranties.record_terms` | Record immutable signed component-term evidence | CARE-003 | commitment | `warrantyAction in src/plinth/warranties.ts` |
| `plinth.warranties.decide` | Record a qualified coverage decision with source | CARE-003, BOUND-002 | commitment | `warrantyAction in src/plinth/warranties.ts` |
| `plinth.warranties.promise` | Record or revise an agreed maintenance occurrence | CARE-003 | commitment | `warrantyAction in src/plinth/warranties.ts` |
| `plinth.warranties.remind` | Send one eligible agreed maintenance reminder | CARE-003 | standard or external | `dispatchWarrantyReminders in src/plinth/warranty-reminders.ts` |
| `plinth.surveys.send` | Send a configured satisfaction survey or permitted review link | CARE-004 | external | `src/plinth/satisfaction-mail.ts` |
| `plinth.surveys.respond` | Record the sponsor's exact survey answers | CARE-004 | standard (+ sensitive) | `satisfactionResponse in src/plinth/satisfaction.ts` |
| `plinth.surveys.report` | Read scoped results and assigned low-score follow-ups | CARE-004 | standard | `satisfactionReport in src/plinth/satisfaction-report.ts` |
| `plinth.recovery.forecast` | Prepare a cited combined finish and margin snapshot | AGENT-001 | standard | `none (native cost/schedule forecasts are separate)` |
| `plinth.recovery.propose` | Prepare feasible date/margin recovery alternatives | AGENT-002 | standard | none |
| `plinth.recovery.verify` | Compare promised recovery against observed sources | AGENT-003 | standard | none |
| `plinth.decisions.track` | Track latest safe decision dates through delivery evidence | AGENT-004 | standard | none |
| `plinth.costs.reconcile` | Prepare missing/duplicate-cost correction evidence | AGENT-005 | standard (+ sensitive) | `none (native ledger matching is a separate slice)` |
| `plinth.answers.ask` | Answer project questions from exact permitted citations | AGENT-007 | standard (+ sensitive) | none |
| `plinth.runs.schedule` | Schedule a specialist job using its current source grant | AGENT-008 | standard | none |
| `plinth.runs.grant` | Change a specialist's source and action authority | AGENT-008 | access | none |
| `plinth.runs.preview` | Preview a scheduled specialist's sourced work | AGENT-008 | standard | none |
| `plinth.learning.propose` | Replay completed jobs and propose estimating changes | AGENT-009 | standard | none |
| `plinth.erasure.run` | Permanently erase a job and retire its source custody | NATIVE-012 | destructive | `src/plinth/import-erasure.ts and import-retirement.ts` |
| `plinth.events.list` | Read a scoped replay page of typed native events | INT-009 | standard | `GET connections/:id/events (native reference-event slice)` |

**Resources.** `plinth://budgets/{id}`, `plinth://plan_sets/{id}`, `plinth://assemblies/{id}`, `plinth://tax_rates/{id}`, `plinth://compliance/{id}`, `plinth://transcriptions/{id}`, `plinth://notifications/{id}`, `plinth://signatures/{id}`, `plinth://fields/{id}`, `plinth://report_schedules/{id}`, `plinth://jobs/{id}`, `plinth://company/{id}`, `plinth://customers/{id}`, `plinth://properties/{id}`, `plinth://contacts/{id}`, `plinth://leads/{id}`, `plinth://templates/{id}`, `plinth://people/{id}`, `plinth://roles/{id}`, `plinth://quotes/{id}`, `plinth://catalogs/{id}`, `plinth://products/{id}`, `plinth://designs/{id}`, `plinth://sheets/{id}`, `plinth://bids/{id}`, `plinth://tasks/{id}`, `plinth://resources/{id}`, `plinth://constraints/{id}`, `plinth://rfis/{id}`, `plinth://submittals/{id}`, `plinth://meetings/{id}`, `plinth://extracts/{id}`, `plinth://folders/{id}`, `plinth://files/{id}`, `plinth://logs/{id}`, `plinth://time/{id}`, `plinth://punch/{id}`, `plinth://inventory/{id}`, `plinth://todos/{id}`, `plinth://selections/{id}`, `plinth://delegations/{id}`, `plinth://changes/{id}`, `plinth://vendors/{id}`, `plinth://subcontracts/{id}`, `plinth://waivers/{id}`, `plinth://orders/{id}`, `plinth://bills/{id}`, `plinth://cost_sources/{id}`, `plinth://forecasts/{id}`, `plinth://periods/{id}`, `plinth://exceptions/{id}`, `plinth://receipts/{id}`, `plinth://reports/{id}`, `plinth://views/{id}`, `plinth://applications/{id}`, `plinth://retainage/{id}`, `plinth://invoices/{id}`, `plinth://remittances/{id}`, `plinth://payments/{id}`, `plinth://feeds/{id}`, `plinth://messages/{id}`, `plinth://receivers/{id}`, `plinth://deliveries/{id}`, `plinth://rules/{id}`, `plinth://continuations/{id}`, `plinth://devices/{id}`, `plinth://handover/{id}`, `plinth://service/{id}`, `plinth://warranties/{id}`, `plinth://surveys/{id}`, `plinth://recovery/{id}`, `plinth://runs/{id}`, `plinth://audit/{id}`, `plinth://holds/{id}`, `plinth://erasures/{id}`. Each follows native record visibility, including client-safe pricing and company-isolated repair originals. Customer, vendor, external, imported and log text is untrusted; source bytes and extracted text retain their source revision.

**Events.** `job.created`, `quote.accepted`, `budget.revised`, `bid.responded`, `bid.awarded`, `schedule.published`, `trade.responded`, `constraint.changed`, `plan.published`, `rfi.responded`, `submittal.decided`, `meeting.changed`, `extract.published`, `log.published`, `time.posted`, `punch.changed`, `todo.changed`, `selection.decided`, `change.decided`, `order.issued`, `order.received`, `bill.posted`, `forecast.changed`, `application.issued`, `invoice.issued`, `payment.changed`, `receiver.changed`, `notice.changed`, `service.changed`, `warranty.due`, `survey.responded`, `recovery.changed`, `run.changed`, `authority.changed`, `job.erased`. These are target registry event types; today's reference-event subset does not assert the full list exists.

**Prompts.** Estimate a sourced remodel (EST-001–EST-007, BID-001–BID-003); coordinate a site week (SCH-001–SCH-006, DOC-001–DOC-005, FIELD-001–FIELD-005, TODO-001); resolve a selection and procure it (CLIENT-002–CLIENT-006, SUB-001–SUB-005); reconcile a draw and collection (COST-001–COST-007, BILL-001–BILL-006, PAY-001–PAY-003); recover and verify date and margin (AGENT-001–AGENT-005, AGENT-007–AGENT-009); finish handover and warranty promises (CARE-001–CARE-005, AGENT-006).

**Not tools, and why.**

- A person's interactive screen: NATIVE-001's native email-link sign-in, password entry, 2FA, provider consent, hosted card entry and CAPTCHA interaction are screens, not business actions; payment-instruction preparation and provider handoff remain in the table. No additional Core id is assigned here.
- Device-only: FIELD-003's offline cache, camera queue, reconnection UI and native phone interaction stay on the device; their online business mutations use the table. Push delivery and device authority are tools, while opening a deep link and device consent screens stay on the device.
- The import door: NATIVE-010, MOVE-001, MOVE-002, MOVE-003, MOVE-004, MOVE-005, MOVE-006, MOVE-007, MOVE-008, MOVE-009 cover reviewed source intake, cutover and rollback through Move in, not parallel MCP importers.
- Operation or installation fact: NATIVE-011 and MOVE-010's complete portable archive, empty-installation restore and erasure-journal fencing remain CLI portability operations; native scoped record/report downloads are tools.
- A connector: INT-001, INT-002, INT-003, INT-013, INT-004, INT-005, INT-008, INT-010, INT-011, INT-012, DOC-006, PAY-004 and BOUND-001 belong to the named accounting, calendar, SMS, payroll, workflow, design and lending adapters and provider responsibilities. Their native input records are tools; adapter transport, outside authorization screens and signed provider outcomes use those connectors, not duplicate tools. Native receiver controls are separately mapped in the table.
- Operation or installation fact: NATIVE-014, OPS-001, OPS-003 and BOUND-003 describe public/installed presentation, accessible and localized screens, product separation and owner installation/deployment rather than a business mutation. Choosing a personal screen language, push consent, or provisioning a custom domain remains an interactive or installation step; Business templates, branding and invitations are tools.
- Served by the surface itself: NATIVE-008's class-based replacement is specified by SURFACE-001 and SURFACE-010; NATIVE-009's checked cents and atomic revisions are exercised by SURFACE-003 and SURFACE-008. These are properties of every applicable action, not separate executors.

**Limits.** Capacity limits bound individual requests, pages and background chunks and are discoverable with their native error codes: current diary originals are at most 2 MB each and five per entry, an itemized order has 1–200 lines, inbound correspondence has at most ten attachments of 2 MB each and 8 MB total, native reference-event pages have fifty entries, and time-entry bodies have a 20,000-byte ceiling. Future records declare their own capacity in the registry. Business limits and spend caps are the company's policy.

**Handoffs.** Listen for authorized ledger actuals, payroll allocations, payment settlement/return, calendar proposals, design revisions, financing funding, inbound correspondence and person revocation. Correlate provider identity and source revision to native records; a webhook or email is evidence, not a signature or physical completion. Emit the typed native events above after committed changes. The business orchestrator routes proposal signatures, provider effects and specialist follow-up to their own doors; Plinth retains job/source identities and unresolved outcomes. Sibling event names are not assumed until their connectors declare them.

#### SURFACE-001 — The registry equals Plinth's Agent surface

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-013

**Requirement.** Plinth's action registry describes exactly this table, the listed resources, events, specialist prompts and non-tool reasons. The construction coordinator and outside agents use the same native actions as the installed workspace, including actions currently unavailable to legacy draft-only credentials once this area is adopted.

**Acceptance.**
1. Discovery returns exactly the table's three-segment tool names, Core mappings and possible classes, with no extra executor or undocumented omission.
2. The discovered Core mapping covers the cloned contract's complete 137-clause set, with each non-tool reason served verbatim and no clause assigned both ways.
3. Every tool schema names typed job arguments and result records; reads and mutations remain separate, and native resource links resolve the returned record revisions.
4. Registry-generated `/docs/agents` explains each Plinth class computation and carries the corresponding conformance journey; the manifest and documentation agree with discovery.
5. On Plinth's fixtures, each implemented native job leaves the same business state through MCP and the workspace action, including exact cents, originals and recorded provider outcomes.
6. The Base harness passes on Plinth's fixtures under both the All-classes and Held company policies defined in SURFACE-013; a legacy credential's current draft-only restriction is not represented as a class disposition in the adopted registry.

#### SURFACE-002 — Read exact job evidence and classify protected content

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-003, BASE-AGENT-005, BASE-AGENT-006

**Requirement.** The coordinator reads exact job, financial, field and service sources through native role projections. Content classification distinguishes regulated data from ordinary private construction records across reads, uploads, saved text, answers and sends.

**Acceptance.**
1. An office sponsor reads quote costs, bills and reconciliation; the same job's client sponsor receives accepted selling terms without private bids, costs, hidden counts or private-source matches.
2. Each trade company on a warranty case receives only its own evidence/originals. Prior-company visits show only permitted dates and builder outcomes; attribution omits directory emails and award IDs.
3. Every `(+ sensitive)` row uses paired permitted fixtures differing only in protected content. Ordinary content declares the other classes without sensitive; personal ID, bank/card, health or individual payroll numbers add sensitive with kind/count. Reads, exports and answers classify projected results; storage and sends classify accepted content.
4. Returning a W-9 original containing a personal SSN adds sensitive; returning only its masked identifier without protected bytes does not. Private margin alone adds none.
5. Search, views, answers and downloads retain native permitted revisions. Restricted text affects neither matches nor totals; external/imported/log text retains untrusted provenance.
6. Standard reads declare item counts. Revoking the job grant ends subsequent record chunks and original links.

#### SURFACE-003 — Estimate from measured sources without changing sold work

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-008, BASE-AGENT-012

**Requirement.** Plinth tools preserve the estimate's exact dimensional arithmetic, source revisions and original-versus-revised budget boundary. Forecast prices and supplier quotes remain proposals until a separate commercial action changes the business's charge or obligation.

**Acceptance.**
1. A quote with fractional measurements, explicit unit conversion, waste, productivity and an alternate reconciles independently to rounded line/code totals; a source change leaves every accepted revision fixed.
2. Catalog, tax, takeoff and pricing previews and applications declare standard, create at most one sourced draft per idempotency key, and retain the exact original drawing, geometry and rate revisions.
3. Accepting the same exact quote through `plinth.quotes.accept` declares money and commitment with USD cents and its customer, and produces one original budget, billing baseline and selected schedule proposal on replay.
4. `plinth.proposals.sign` declares money and commitment for the exact commercial terms; its artifact identifies the agent acting for the named signer and does not assert that the person personally signed.
5. A refreshed supplier capture retains its earlier bytes, date and validity warning; it changes neither a presented option's fixed source nor a sold estimate.
6. A stale quote, calibration or tax snapshot produces a native revision conflict with no partial draft or changed sold total; historical AUD sources remain separate from USD totals.

#### SURFACE-004 — Commit feasible schedules and retain field evidence

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-008, BASE-AGENT-012

**Requirement.** Schedule tools use Plinth's dependency, calendar, resource, travel and clearance calculations. Drafts, observations and relied-on decisions remain distinct; generated text cannot assert unobserved physical work or certification.

**Acceptance.**
1. A demolition-to-inspection-to-drywall preview declares standard, reports the planner's critical path, holds and cross-job travel/resource conflicts, and changes no published date.
2. For publish, move and cancel, the same schedule with an office-only audience declares commitment without external; adding an outside trade/client adds external with known counterparty and recipient count. Feed UIDs and sequences retain native identity.
3. Baseline publication, trade confirmation and clearance declare commitment with source revision/counterparty. Alternative dates reserve no slot.
4. Actuals and quantity corrections declare standard and preserve source statements, actors and earlier evidence. Generated narratives are not site observations.
5. Time entry/correction declares standard; the separate supervisor decision declares commitment and posts one exact labor source. Employee, preparer and supervisor separation still applies.
6. Stock receipts, returns, moves and equipment allocations reconcile quantities separately from commitments, payables and installed work; partial evidence certifies nothing further.
7. A prerequisite changed before publication causes a native conflict without a write; client reads retain their current schedule projection.

#### SURFACE-005 — Publish exact documents to computed audiences

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-006, BASE-AGENT-010

**Requirement.** Plinth distinguishes internal drafts from disclosure through boards, drawings, files, extracts, logs and conversations. Publication binds exact bytes/revisions; refreshed or imported text cannot redefine its audience or class.

**Acceptance.**
1. For products.present, designs.present, plans.distribute, extracts.publish, files.upload, files.share, diary.publish, diary.comment, todos.comment and conversations.send, paired fixtures use identical content/action: internal-only declares standard; outside visibility declares external with recipients. Upload into an already vendor-visible folder is external without a new share.
2. Outside counterparties are known for recorded vendors/customers or trusted domains, new for unknown addresses, public for open links. Caller flags lower no class.
3. Exact plan decisions/acknowledgments declare commitment. Pinned old sheets retain their superseded label and original checksum.
4. RFI/submittal decisions declare commitment. The same RFI publication is commitment internally, adding external with known counterparty and one recipient for its outside designer. Proposed impacts prepare only a separate sourced change draft.
5. Protected versus ordinary RFI/submittal attachments follow SURFACE-002. Sheet access discloses no unrelated source.
6. Extract publication reveals neither raw minutes nor others' feedback; revocation ends the next read/send eligibility and retains attribution.
7. Permanent file deletion declares destructive and native hold results. Adding versions, transcriptions or internal comparisons declares standard.

#### SURFACE-006 — Carry exact client and procurement commitments

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-008, BASE-AGENT-012

**Requirement.** Selection, change, award, order, qualification and release tools retain distinct source decisions. Each action stays within its named sponsor's current role and attributes agent action truthfully.

**Acceptance.**
1. Selection signature, dispute and withdrawal declare commitment with exact revision/sponsor statement. Silence, notice receipt and deadlines create no signature.
2. A choice alone changes no charge. Allowance preview declares standard; signing its incremental change declares money and commitment, appending one USD/customer budget delta.
3. Bid response and trade confirmation declare external and commitment; award, release and qualification decisions declare commitment with actual scope/counterparty and original comparisons.
4. PO/amendment preparation declares standard; issue, amendment acceptance, promise, acknowledgment and cancellation declare commitment. Vendor send declares external and commitment. Ordered, received, returned and outstanding quantities reconcile separately.
5. Replaying a selection PO or amendment leaves one commitment and unchanged source signatures; a newer selection invalidates older pending terms.
6. A waiver's received signature, through-date and amount declare commitment; agent-entered evidence claims no independent insurance, legal or physical verification.
7. Concurrent client/delegate signatures commit one revision. Revoked/superseded delegation yields no signature and conveys no general job or variation authority.

#### SURFACE-007 — Reconcile actual costs and permissioned reporting

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-006, BASE-AGENT-012

**Requirement.** Cost tools reconcile receipts, payroll allocations and reports against native identities/periods. Forecast exposure remains a proposal; payables, reimbursements and live pay-rate changes carry their actual economics.

**Acceptance.**
1. Bill posting declares money and commitment with payable cents/vendor. A PO, two receipts and one bill reconcile without doubled consumption or actuals.
2. Recoding, OCR proposals, matching, balanced transfers and forecasts declare standard. Uncertain extraction retains its original without inventing a posting.
3. Labor/equipment source posting declares commitment. Recording observed reimbursement declares standard without moving funds; prospective pay-rate changes declare money with employee/amount/basis. Payroll content adds sensitive under SURFACE-002.
4. Accountant decisions and period close declare commitment, retaining actual agent attribution. Later corrections cannot rewrite closed snapshots.
5. Stale sources, duplicate vendor references and closed-period writes return native reasons without partial entries; corrections reference originals in an open period.
6. Portfolio/productivity query and export reconcile permitted sources, dates, currencies and filter scope. Hidden jobs/pay affect neither counts nor totals. Learning proposals change no historical catalog or sold job.
7. Fields obey stage validation, preserve hidden values and distinguish false/zero from absent; exported CSV formulas remain inert.

#### SURFACE-008 — Separate charges, funds instructions and provider gates

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-008, BASE-AGENT-012

**Requirement.** Financial tools separate charges, applications, receipt evidence, retainage and provider instructions, preserving native economics and exact source identities.

**Acceptance.**
1. SOV preparation declares standard; decision/issue declares commitment and freezes reconciled prior/current/cumulative values, tax and waiver packet. Downloads create no charge.
2. Invoice issue declares money and commitment with customer/USD/source. Recording observed bank/check receipt allocations declares standard, truthfully labeled staff-recorded, without moving funds.
3. Credit/debit/void, write-off and retainage release declare money and commitment with exact changed amount, retaining original invoice/tax/history. Supplier and client balances stay separate.
4. Checkout, refund and payable instructions declare money and external with amount/direction/counterparty. Reconciliation declares external without another instruction.
5. On one checkout fixture, a provider response using an authorized existing mandate adds no gated class; hosted card entry or bank verification adds gated with provider Stripe and step. The handoff never enters a person's card/password/2FA or solves a CAPTCHA.
6. Refunds recheck settled funds/customer credit. Reservations and stable identities survive lost responses; existing instructions are queried before further effects.
7. Delayed, duplicate, forged and out-of-order signed events reconcile without false settlement. Browser returns and absent events prove no payment.
8. Changed economics return a conflict without an instruction. Observed late payments remain recorded facts, creating no automatic refund.

#### SURFACE-009 — Deliver scoped notices and resume business continuity

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-009, BASE-AGENT-010, BASE-AGENT-012

**Requirement.** Sends use native follow-up, report, correspondence, push, continuity and maintenance actions. Delivery, consent, provider acceptance and business decisions retain separate outcomes/identities.

**Acceptance.**
1. For extracts.send, reports.send, mail.send, rules.dispatch, continuations.notify, notifications.send and push.send, identical content sent internally declares standard; outside delivery declares external with recipients/counterparty. Protected outgoing content adds sensitive under SURFACE-002.
2. The same maintenance occurrence sent internally declares standard; warranties.remind to its outside client declares external, known. Neither changes contractual terms.
3. Proposal send, submittal notice, bid chase, invoice send, survey/review-link send, selection presentation and handover publication declare fixed external. Recipient and immutable outgoing revision remain inspectable.
4. Grants, consent, quiet hours, suppression and required-notice routing resolve before contact. Accepted, refused, unconfigured, development and unknown remain distinct without implying acknowledgment.
5. Failed/uncertain sends retain attempts, body revisions and source identities. Replay creates no duplicate effect; restored work revives no sending authority.
6. Sale/change replay resumes one linked schedule, purchasing and billing draft, asserting no progress, signature, invoice or settlement.
7. Receiver delivery declares external, sends scoped references to configured public HTTPS, follows no redirect, preserves signed identity through retry and exposes failure without record bodies.

#### SURFACE-010 — Compute authority direction and protect the sponsor boundary

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-008, BASE-AGENT-009

**Requirement.** Authority classes follow native targets, not caller intent. Every family below refuses widening the sponsor's or agent's own authority under every company policy, including All-classes.

**Acceptance.**
1. People invitations, team assignments, custom-role create/edit/delete, portal features and accountant designation declare access with people/direction; each family's self-widening fixture is refused. Permanent role deletion also declares destructive with its item count.
2. One invitation fixture carries access internally, adding external for an outside recorded client (known) or unknown contact (new), with one recipient; confirmation flags lower nothing.
3. Bid/trade/RFI inboxes, submittal/compliance reviewers, checklist/punch/service assignments, subcontract contacts, extract revocation and delegations declare access/direction and refuse self-widening. Fixed external rows declare external. On the same RFI/to-do fixture, internal assignment omits external; outside assignment adds it.
4. Specialist grants declare access: added sources widen, removed sources narrow; self-widening is refused. Schedule edits declare standard without granting sources.
5. Feed creation/rotation/revocation and device registration/revocation declare access/security and refuse self-widening; retired secrets stop working. Discovery/events reveal no secrets.
6. Receiver create/revoke declares access/security, grant declares access, rotation declares security. Every family refuses self-widening; delivery uses current generation/scope/credentials.
7. Hold placement/release declares security naming the setting and preserves native retention/audit. Each refuses self-widening under every policy.
8. Revoked sponsor role, job or delegation scope stops the next corresponding call/download/send without rewriting earlier attribution.

#### SURFACE-011 — Erase with retirement fences and report bounded work

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-009, BASE-AGENT-011

**Requirement.** Permanent erasure uses Plinth's dependency-aware retirement door, and long work exposes native progress rather than a false healthy empty result. MCP does not introduce another archive, restore or migration implementation.

**Acceptance.**
1. Job erasure declares destructive and its full affected record/original count before the effect; a retained hold returns its native reason with no erasure regardless of company policy.
2. Erasing a job retires its photo bytes and dependent/shared import custody, leaves only the permitted audit references and erasure receipt, and the retired source cannot recreate the job.
3. Permanent miscellaneous-original deletion declares destructive; a new file version, reversible draft change or balanced accounting correction does not acquire that class solely because history is append-only.
4. Background status identifies the exact native operation, checkpoint, progress and failure; it cannot turn an unimplemented connector or import format into a completed operation.
5. An oversized photo, excessive PO line count, over-limit mail attachment or oversized time request returns the documented capacity error with no partial action. Discovery documents those capacities without promising business-volume or spend-cap enforcement.
6. Pausing an agent during bounded drawing or delivery work prevents its next effect; the status retains the last committed checkpoint, and resumption still uses current job/source authority.

#### SURFACE-012 — Follow promised recovery and closeout to observed outcomes

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-006, BASE-AGENT-008, BASE-AGENT-010

**Requirement.** Recovery and aftercare link construction promises to evidence, affected records and unresolved exceptions. Proposals use the same decision, financial and procurement tools as other work.

**Acceptance.**
1. Forecasts, recovery alternatives, decision tracking, cost packets, answers and learning proposals declare standard, citing source revisions, assumptions and freshness without invented progress.
2. Delayed windows and poor framing yield two feasible date/margin alternatives with cash, resource and decision dependencies. Applying one uses separate schedule/change/order/charge classes.
3. Acknowledgment without delivery leaves recovery open. Observed delivery/progress and reconciled actuals establish its target; a later cost return reopens the same case with its original promise.
4. Handover assembly declares standard, publication external. Builder/client completion, repair decisions, request withdrawal/resolution/acknowledgment/closure, component terms, coverage and maintenance promises declare commitment with sponsor/revision/counterparty.
5. Reassigned companies cannot retrieve predecessors' private evidence. Missing current decisions leave requests open; closure preserves originals, terms and visits, pausing only linked reminders.
6. Survey response declares standard, preserves high/low answers and opens assigned low-score follow-up. Public review links use separate client permission without score filtering.
7. Ledger, payroll, design, financing and payment handoffs retain provider/source identities. Missing/revoked sources expose uncertainty rather than false payment, compliance or completion.

#### SURFACE-013 — A stranger coordinator runs a seeded construction week

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-007, BASE-AGENT-009, BASE-AGENT-013

**Requirement.** A stranger agent discovers Plinth and runs a seeded construction week through MCP. People set two named company policies: All-classes makes every fleet class autonomous; Held makes standard review and every other class approval. These fixture policies preset nothing in Plinth. Providers are already provisioned; checkout uses a non-gated mandate, with personal-step responses exercised separately in SURFACE-008.

**Acceptance.**
1. Given only URL and seeded office/client sponsors' current consent, the stranger discovers prompts, records, scope and policy revision without installation instructions.
2. Under All-classes, with no person, it prices measured work, chases a bid, publishes a feasible schedule/log, signs a selection/change for its eligible sponsor, issues/sends a PO, posts a bill and issues/sends a draw/invoice.
3. Under All-classes, with no person, it reconciles payment/refund, sends maintenance, completes scoped handover work, verifies date/margin recovery and erases an unheld duplicate, within each sponsor's role.
4. Under Held, standard steps enter the review feed; other steps await named-person approval without effects. After approval the week completes with identical business totals/source identities and no replayed send/charge.
5. Under Held, declining money/commitment approval leaves that work unresolved without fabricated decisions or evidence.
6. Both policies refuse self-widening and stop revoked-grant effects; document instructions change no class.
7. Both weeks independently reconcile quantities, costs, draws and settlements; attribution and decisions match actual sponsors and policy revisions.
8. Interrupted replay resumes the same case from stable permitted event sequences and exact originals.

## Status rows

| Clause | Title | Kind | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| `SURFACE-001` | The registry equals Plinth's Agent surface | target | missing | | The registry-backed MCP capability and its Plinth conformance evidence are not built yet. |
| `SURFACE-002` | Read exact job evidence and classify protected content | target | missing | | The registry-backed MCP capability and its Plinth conformance evidence are not built yet. |
| `SURFACE-003` | Estimate from measured sources without changing sold work | target | missing | | The registry-backed MCP capability and its Plinth conformance evidence are not built yet. |
| `SURFACE-004` | Commit feasible schedules and retain field evidence | target | missing | | The registry-backed MCP capability and its Plinth conformance evidence are not built yet. |
| `SURFACE-005` | Publish exact documents to computed audiences | target | missing | | The registry-backed MCP capability and its Plinth conformance evidence are not built yet. |
| `SURFACE-006` | Carry exact client and procurement commitments | target | missing | | The registry-backed MCP capability and its Plinth conformance evidence are not built yet. |
| `SURFACE-007` | Reconcile actual costs and permissioned reporting | target | missing | | The registry-backed MCP capability and its Plinth conformance evidence are not built yet. |
| `SURFACE-008` | Separate charges, funds instructions and provider gates | target | missing | | The registry-backed MCP capability and its Plinth conformance evidence are not built yet. |
| `SURFACE-009` | Deliver scoped notices and resume business continuity | target | missing | | The registry-backed MCP capability and its Plinth conformance evidence are not built yet. |
| `SURFACE-010` | Compute authority direction and protect the sponsor boundary | target | missing | | The registry-backed MCP capability and its Plinth conformance evidence are not built yet. |
| `SURFACE-011` | Erase with retirement fences and report bounded work | target | missing | | The registry-backed MCP capability and its Plinth conformance evidence are not built yet. |
| `SURFACE-012` | Follow promised recovery and closeout to observed outcomes | target | missing | | The registry-backed MCP capability and its Plinth conformance evidence are not built yet. |
| `SURFACE-013` | A stranger coordinator runs a seeded construction week | target | missing | | The registry-backed MCP capability and its Plinth conformance evidence are not built yet. |
