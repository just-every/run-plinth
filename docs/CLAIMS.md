# Plinth contract status

Generated from CONTRACT.md. These are implementation statuses for the contract clauses; a partial row remains limited by its Gap.

| Clause | Status | Gap |
| --- | --- | --- |
| NATIVE-001 | done |  |
| NATIVE-002 | done |  |
| NATIVE-003 | done |  |
| NATIVE-004 | done |  |
| NATIVE-005 | done |  |
| NATIVE-006 | done |  |
| NATIVE-007 | done |  |
| NATIVE-008 | done |  |
| NATIVE-009 | done |  |
| NATIVE-010 | done |  |
| NATIVE-011 | done |  |
| NATIVE-012 | done |  |
| NATIVE-013 | done |  |
| NATIVE-014 | done |  |
| US-001 | done |  |
| CRM-001 | done |  |
| CRM-002 | missing | No residential lead pipeline and follow-up workflow exists. |
| SET-001 | missing | No templates branding and team adoption workflow exists. |
| ROLE-001 | done |  |
| ROLE-002 | done |  |
| ROLE-003 | partial | Current client and subcontractor records, bill and compliance upload screens, current designated review status (without internal notes), search and export and originals and owner per-job external preset editor are implemented and asserted. Remaining: ct confirmation of the exact pre-award exception, conservative owner-only per-job feature default and same-job client precedence over overlapping subcontractor contacts; the cited ruling’s changes were not supplied, so policy approval keeps the clause partial. ROLE-006 inherits future installation-wide and custom roles; COST-002 and PAY-003 own later bill matching, approval and payment. Future document and mobile and notification doors inherit the same checks. |
| ROLE-004 | done |  |
| ROLE-005 | partial | Policy default ADOPTED, pending ct approval: only the owner places or releases a hold; a hold covers a job or a company record; erasure, import undo and rollback are refused while one is in force; retention is a date; erased records leave audit references only. Current job originals and invoice correspondence are protected together, with exact supplier bytes and invoice send outcomes retained during a hold and unavailable after its reasoned release and erasure. Local development and demo mail is suppressed without retaining an outbox; INT-007 inherits holds before adding retained correspondence outside these records. INT-001 to INT-003 inherit audited accounting sends. |
| ROLE-006 | partial | Policy default ADOPTED, pending ct approval: a custom role narrows its copied preset and never opens a door the preset keeps shut; only the owner assigns a role; administrator copies are not narrowed to jobs; client and subcontractor copies remain per-job under ROLE-003. Current search matches only projected job details and permitted record descriptions; hidden text cannot affect results or counts. Reports remove unavailable values, filter columns, source records and saved views before querying or exporting, and permitted edits preserve hidden stored values. Invoice and purchase order email require the sending person's approval and the recipient's current feature, financial and job grants at the send fence. FIELD-002, NOTIFY-001 and AGENT-007 inherit permission checks before adding time, notification channels or agent answers; ROLE-003 inherits external custom copies. No implementation gap remains for the current named doors. |
| EST-001 | done |  |
| EST-002 | done |  |
| EST-003 | done |  |
| EST-004 | done |  |
| EST-005 | done |  |
| EST-006 | partial | Manager-recorded acceptance exists; proposal delivery, signer workflow and client electronic contract execution are absent. |
| EST-007 | done |  |
| EST-008 | missing | No room design and client visualization handoff workflow exists. |
| BID-001 | partial | Exact changes in plinth-ruling-20261021-2235 were not supplied; ct confirmation of the implemented pre-award exception remains pending. Default ADOPTED: explicit owner and admin consent to a qualified active company contact and selected cost codes grants bid-only access before award; no subcontract, work access or outbound notice is created. Existing released-scope invitations remain supported. Every bid door rechecks the current contact, qualification, invitation and feature preset; assigned PMs read only assigned jobs. BID-002 and ROLE-003 inherit this boundary. All BID-001 acceptance behavior is asserted; policy approval keeps the clause partial. |
| BID-002 | done |  |
| BID-003 | done |  |
| SCH-001 | done |  |
| SCH-002 | done |  |
| SCH-003 | done | None for current native doors. SCH-004 and NOTIFY-001 inherit outbound delivery and escalation. |
| SCH-004 | missing | No published schedule changes and acknowledgments workflow exists. |
| SCH-005 | done |  |
| SCH-006 | done |  |
| DOC-001 | done |  |
| DOC-002 | missing | No drawing recognition hyperlinks and comparison workflow exists. |
| DOC-003 | done | None for current native RFI doors. DOC-001 and DOC-007 inherit broader sharing; CLIENT-004 and SCH-004 and NOTIFY-001 inherit electronic and date execution and outbound delivery. |
| DOC-004 | partial | Still owed: complete NOTIFY-001 channel preferences, routing and provider delivery reconciliation. An owner explicitly sends the current completed disposition, comments, annotations and original files (or their retained-original checksum manifest on managed mail) only to the existing PO supplier email; no review, approval or send itself releases procurement, and uncertain sends cannot be replayed. Adopted conservative default pending ct confirmation: only the owner registers, routes, sends supplier dispositions and selects the exact version for release; only the designated current internal job manager reviews it, with existing document, financial and job-assignment restrictions. External reviewer delegation is not established. INT-007 retains its existing hosted provider boundaries; its RL-101 suppression rider is honored by refusing all suppressed supplier mail and requiring an authorized alternative channel. |
| DOC-005 | partial | DOC-005 remains PARTIAL. CT ruling dated 26 October 2026 UTC at d9f2ba4f19033079779b714187d96d7f66ccbd53 verifies the meeting-email corrective round; the APPROVE WITH RIDERS ruling at 5f9eb897899375602961e8e086c14421080bcba0 for reviewed-extract sharing and recipient-requested manual email stands. The native original meeting, inbound-email, decision-search, action-completion and private-bid scenario is asserted. The six subsequently missing rider cases are now asserted through the named reviewed-extract HTTP test: pending email refuses both review and final send after extract revocation or recipient grant loss without provider calls; only the signed-in owner opens the email review; reminders require the current authorized office action owner; administrators can publish while non-current recipients are refused; client extract access ends with client authority; commenting custom recipients need document-create permission. Explicit reviewed supplied text now makes exercised image-only, protected, unsupported, failed and limited originals searchable with their original extraction state retained, immutable bytes and checksum-bound revision history. Gap: complete attached-file content search for image-only scans, protected PDFs, unsupported formats and limited or failed extraction without supplied text is not established; a reviewed transcription is a supplementary human record and is not proof of complete original extraction. The local browser assistant covers exercised English raster images and image-only PDFs, password-unlocked PDFs, all 201 pages of a PDF beyond the server extraction window, linked Word stories and raster pictures, spreadsheet strings, formulas, cached values, comments and pictures, and slide text, notes, comments, layouts, masters and pictures. These actual generated drafts become searchable only after explicit adoption and full human review. The same explicit review path now exercises two-page, tiled and JPEG-compressed TIFF OCR, RTF code pages, Unicode, headers, footers, field results and inline raster OCR, BOM UTF-16 text, inert HTML and SVG stored text, and genuine binary Word main text and declared supplementary stories, Excel cell values and current cell comments, and current PowerPoint slide text, notes and main, title, notes and handout master text. Classic modern Office chart titles, indexed labels, formulas and saved cache values, plus OpenDocument text, tables, formulas, notes, annotations, headers, footers, slides and embedded raster text, are exercised through the same full review and save path. External SVG resources are refused without fetching or saving. Remaining original-extraction limits include legacy Word pictures, field evaluation and tracked-change interpretation, unresolved binary chart formulas and generated labels, legacy slide comments and rendered inheritance, uncached or visual chart content, embedded objects, equations and threaded comments, BigTIFF, old JPEG, tiled JPEG and unsupported TIFF sample models, RTF objects and vectors, rendered markup and linked resources, unsupported or damaged and encrypted originals, PDF features, non-English OCR and recognition accuracy; displayed processing bounds still apply. Wider raw-meeting sharing and permissions, delegated action participation, wider distribution, communication-thread integration and automation remain DOC-005 Gaps because no receiving clause names them in both documents; per-event meeting channel preferences remain with NOTIFY-001, which names the meeting-email boundary in both documents. No automatic send, provider delivery, legal compliance or completion is claimed. |
| DOC-006 | missing | No model coordination and design-system connection workflow exists. |
| DOC-007 | missing | Job photos are stored as attachments only; job document folders, versioned miscellaneous files and per-folder client and sub sharing are absent. |
| FIELD-001 | partial | Published notes and original images ship; structured logs, comments, video and production linkage are absent. |
| FIELD-002 | partial | Policy approved by ct on 24 October 2026 at 21:12Z: owner-only reviewed rate and site configuration; independent owner or authorized administrator approval and payroll export; no employee, preparer or corrector approves that time; workers read only their own time without pay values; explicit revocable per-job location consent, with worker coordinates discarded and only audited consent, the latest inside state and reminder retained; no automatic time or outbound action. Native manual entry, breaks, append-only corrections, regular and overtime classification, exact approved labor and burden posting, payroll allocation export and consented geofence events are implemented through HTTP. Remaining: installed employee entry, crew review, supervisor approval, payroll download and visible location-consent and reminder screens with full journeys at 1440 and 390. FIELD-003, INT-010, NOTIFY-001 and AUTO-003 inherit the same current grants, consent and immutable source links. |
| FIELD-003 | missing | No offline mobile capture and conflict resolution workflow exists. |
| FIELD-004 | done |  |
| FIELD-005 | partial | Partial value receipts exist; quantity and stock, damage, return and equipment records are absent. |
| TODO-001 | partial | Native FIELD-003 iOS and Android offline completion remains unproved: Apple and Google signing and real-phone and native-app assets are unavailable to this run. NOTIFY-001 SMS and push and digest channels remain unavailable; only explicitly owner-approved, recipient-chosen email is implemented with network-edge proof. MOVE-002 to-do import needs an untouched authorized Buildertrend export containing checklist state and assignees (or an official export schema); public documentation supplies neither and this run holds no Buildertrend account/export. No substitute capture format is accepted. |
| CLIENT-001 | partial | Multiple authorized contacts share the client job view; conversations and the complete decision and payment portal remain absent. |
| CLIENT-002 | done |  |
| CLIENT-003 | done |  |
| CLIENT-004 | partial | Exact assigned-client price and scope approval exists; date impact, electronic document signatures and downstream budgets and invoices are absent. |
| CLIENT-005 | done | NOTIFY-001 delivery, CLIENT-004 electronic execution and AGENT-004 follow-through remain with their inheriting clauses. Delegated single-revision signing is CLIENT-006. |
| CLIENT-006 | partial | Native HTTP acceptance is implemented and proven under ct 2026-10-23. Missing: installed client delegation and create and revoke and separate delegate revision-only and signature screens, and their complete 1440/390 journeys. BLOCKED on 12ui design authorization from br and owner; this run is expressly forbidden to build new UI. Ordinary signing and dispute refusals remain unchanged. |
| SUB-001 | done |  |
| SUB-002 | missing | No subcontractor portal tasks photos and billing workflow exists. |
| SUB-003 | done |  |
| SUB-004 | done |  |
| SUB-005 | done |  |
| COST-001 | done |  |
| COST-002 | done |  |
| COST-003 | done |  |
| COST-004 | done |  |
| COST-005 | done |  |
| COST-006 | done |  |
| COST-007 | missing | No receipt capture, OCR proposals or card and bank feed matching exists. |
| RPT-001 | done |  |
| RPT-002 | done |  |
| RPT-003 | done |  |
| RPT-004 | done |  |
| BILL-001 | done |  |
| BILL-002 | done |  |
| BILL-003 | done |  |
| BILL-004 | done | None for current native cost billing. BILL-005 and BILL-006 inherit broader correction, refund, reconciliation and collection duties. |
| BILL-005 | done | None for the native BILL-005 doors. External correction and refund posting, stable external identities, accounting conflict reconciliation and uncertain-write recovery remain unproved and are explicitly inherited from BILL-005 by INT-001, INT-002, INT-003 and INT-013 in both documents; their full existing accounting targets remain owed. BILL-006 retains wider remittance allocation, overpayment, disputed balances, collection ownership and receipt delivery. ROLE-005 and NATIVE-012 retain broader retention, legal holds and erasure. NATIVE-011, NATIVE-013 and MOVE-010 retain complete target archive recovery beyond the exercised correction documents, write-offs, payment identities and durable refund reservations. INT-007, NOTIFY-001 and AUTO-004 retain wider receipt communication and follow-through. PAY-003, PAY-004 and BOUND-001 retain their separate payable, financing and professional-boundary obligations. Historical provider receipts and statements of provider responsibility do not prove those receiving duties. |
| BILL-006 | partial | Staff-recorded job-local bank and check remittances allocate across issued milestone invoices, retain unapplied cash and append full-return reversals; current-balance aging separates unreleased retainage. Direct invoice and deposit receipts support original-linked partial or remaining-full returns with dated evidence, case-insensitive job-unique return references and a private reason; allocated deposit funds stay protected. Provider reconciliation, partial remittance returns and returns consuming allocated deposit liability, disputed balances, collection ownership and receipt delivery and interface remain absent. |
| PAY-001 | partial | Policy defaults ADOPTED, pending ct approval: (1) only the client starts a payment, for the full balance, after confirming the exact authorization; (2) the client is never charged a surcharge and the builder bears Stripe's fee, shown to the office only; (3) the builder connects their own Stripe account by key and signing secret rather than a Connect platform; (4) a payment arriving after the balance changed is recorded and flagged for office review, never refused. Sandbox receipt docs/receipts/pay-001-sandbox.json: a real Stripe test-mode card payment and a real test bank transfer (processing, then settled) through the real Worker, each credited once from the real Stripe event. Not exercised: the controlled authorized live low-value transaction, which needs the owner's authorization and live keys that no run uses; and a wallet payment on a real device, since eligibility is the device's and the proof here is the wallet type Stripe reports in a signed event. |
| PAY-002 | partial | Policy defaults ADOPTED pending ct approval, inherited from PAY-001: client-only exact full-balance authorization, no client surcharge and builder-paid fee, the builder’s own Stripe keys, and late payments recorded with office review. PAY-002 — CT 2026-10-26: The inherited policy defaults above are APPROVED WITH RIDERS by the additive PAY-002 ruling. This supersedes their pending CT approval wording only; implementation status remains partial and all original evidence obligations and Gaps retain their existing owners. |
| PAY-003 | missing | No subcontractor payable approval and payment handoff workflow exists. |
| PAY-004 | missing | No financing partner connection, consented referral or funding reconciliation exists. |
| INT-001 | missing | No two-way quickbooks online job accounting workflow exists. |
| INT-002 | missing | No two-way xero and partner adapter choice workflow exists. |
| INT-003 | missing | No accounting sync control and reconciliation queue workflow exists. |
| INT-013 | missing | No QuickBooks Desktop Web Connector endpoint, company-file binding, qbXML mapping or reconciliation exists. |
| INT-004 | missing | No google calendar schedule connection workflow exists. |
| INT-005 | missing | No microsoft outlook schedule connection workflow exists. |
| INT-006 | done |  |
| INT-007 | partial | Policy defaults ADOPTED, pending ct approval: (1) inbound replies are authenticated by the per-message reply address plus the recipient's own mailbox, current client access and no failed SPF, DKIM or DMARC verdict, never by a bare From header; (2) unsubscribe, complaint and hard bounce suppress optional notices to that mailbox only, forever until an owner-built re-subscribe exists, while required transactional mail continues; (3) correspondence is retained and held with the job and erased with it, leaving only the suppressed address. Hosted proof not exercised: a real signed SendGrid event and a real routed Cloudflare reply need the owner to point the domain's catch-all (today drop) at this Worker and set the event webhook; docs/receipts/int-007-sandbox.json records the held-key SendGrid sandbox send and the read-only Email Routing state. Receipts have no sender yet: PAY-001 adds the receipt notice as required mail on this thread. |
| INT-008 | missing | No twilio sms consent and trade reminders workflow exists. |
| INT-009 | done | Approved native slice: version 1 job summaries, replay-safe change drafts, signed reference-only event delivery and audited owner receiver controls meet the six ct assertions. Machine schema coverage remains limited to the documented version 1 surface; complete machine schemas for other native records, reports and import and export doors remain absent. Named Gap — INT-014, Unattended signed delivery: the owner grants a standing, revocable, expiring grant per receiver (origin, event types, payload class, rate cap), which is the explicit consent; signed deliveries with rotation of keys, retry with backoff, a delivery log, pause on repeated failure. |
| INT-014 | done | None. |
| INT-010 | missing | No gusto time and payroll actuals workflow exists. |
| INT-011 | missing | No zapier and owner workflow integrations workflow exists. |
| INT-012 | missing | No autodesk docs and bim collaborate handoff workflow exists. |
| AUTO-001 | partial | Actual notice delivery, once-only dispatch history, per-recipient NOTIFY-001 channel choices and required-notice routing, provider outcomes, and bid, RFI, confirmation and warranty rule integrations remain owed. Adopted conservative default under the standing scope policy: owner-only configuration and preview, recipient-owned preview consent off by default, escalation only to the configuring owner, no automatic outbound or financial action; scoped delegation and provider boundaries remain unproved. NOTIFY-001 retains configured mail, Twilio sender, APNs and FCM prerequisites; INT-007 retains its current policy and hosted catch-all and webhook requirements. AUTO-003 retains FIELD-002 approval-screen prerequisites; AUTO-004 retains PAY-001 receipt notice and BILL-006 processor and accounting reconciliation prerequisites. |
| AUTO-002 | done |  |
| AUTO-003 | missing | No field actuals forecast and billing refresh workflow exists. |
| AUTO-004 | missing | No receipts and collection closure workflow exists. |
| NOTIFY-001 | missing | Native sign-in, invitations, job correspondence, selected manual notices and recipient-requested reviewed meeting email exist. Per-person per-event channel choices across all events, required-notice routing, digest, SMS and native push remain unbuilt; the bounded meeting-email quiet-hours and current-grant checks do not complete them. |
| NOTIFY-002 | missing | No native apps, APNs and FCM device registration, push delivery or deep links exist. |
| CARE-001 | done |  |
| CARE-002 | partial | Policy ratified by ct 2026-10-23 with changes. Company isolation, directory privacy, hidden-case and disabled-account native HTTP checks now pass. Unbuilt: dedicated installed client request and status and acknowledgment, trade repair-inbox and evidence and builder ownership and routing and booking and review screens, with every required 1440/390 journey and permission failure; ownership, assignment, booking, review and acknowledgment statements must be labelled as shared where entered on those screens. HTTP entry sharing is documented in docs/WARRANTY-SERVICE.md; private coverage sources remain office-only. The office Warranty screen still offers Close on open service cases the server refuses. BLOCKED on required 12ui design authorization. NOTIFY-001 and AUTO-001 inherit service notices and escalation; CARE-004 inherits surveys. Native HTTP no-repair closure is implemented by CARE-005, whose screens remain unbuilt. |
| CARE-003 | done |  |
| CARE-004 | done |  |
| CARE-005 | partial | Native HTTP closure and sharing and isolation acceptance is proven. Missing: installed client and builder withdrawal and not-covered resolution and acknowledgment screens and both complete 1440/390 journeys, including permission failures. BLOCKED on 12ui design authorization from br and owner; this run is expressly forbidden to build new UI. CARE-002 entry-screen sharing labels remain required. |
| DESIGN-001 | missing | No measured floor plans and editable room layouts workflow exists. |
| MOVE-001 | partial | Accepted-job CSV custody exists; source-specific full-job maps and comprehensive coverage reports are absent. |
| MOVE-002 | missing | No buildertrend live-job migration workflow exists. |
| MOVE-003 | missing | No procore project and financial migration workflow exists. |
| MOVE-004 | missing | No houzz pro project design and procurement migration workflow exists. |
| MOVE-005 | missing | No jobtread live-job migration workflow exists. |
| MOVE-006 | missing | No ressio budget schedule and approvals migration workflow exists. |
| MOVE-007 | missing | No autodesk archive and document-history migration workflow exists. |
| MOVE-008 | partial | Only accepted-job CSV total imports exist; workbooks, coded lines and costs and financial opening balances do not. |
| MOVE-009 | partial | Journaled deduplication and undo and native-edit preservation ship; live delta cutover, shadow reconciliation and connector ownership do not. |
| MOVE-010 | partial | Native archives carry ledger, original photos, import custody, costs, invoice corrections and write-offs, payment instructions and durable refund reservations, meetings, reviewed extracts, consent, correspondence and original files. Complete target-wide export and restoration, including future plan and external accounting entities and receiving-owner reconciliation, remain unproved; restored authority and pending sends remain inert. |
| OPS-001 | partial | Responsive existing forms and styles exist; full target journeys, accessibility conformance and measured loading behavior are unproven. |
| OPS-002 | partial | Current auth, bounded input, resumable CSV imports and backup instructions ship. Native receiver origin and scope bindings now survive CLI recovery as inert metadata; full endpoint paths, query strings, credentials, signing keys and standing consent do not. The destination owner re-enters the endpoint, supplies a fresh credential and explicitly reapproves the exact binding with a new key; scheduled work requires separate future-only consent. Remaining: credential rotation during large drawing or import work, broader resumable bounded background processing with observable progress and failures, and external provider connector recovery. |
| OPS-003 | missing | The interface is English only; no locale selection, Spanish strings or locale-aware notifications exist. |
| BOUND-001 | missing | No funds tax payroll and accounting responsibilities workflow exists. |
| BOUND-002 | missing | No licensed design insurance and legal decisions workflow exists. |
| BOUND-003 | partial | Owner installation and backup paths exist; target external connectors and granular grants are absent. |
| AGENT-001 | missing | No job-forecast agent or maintained cost and schedule forecast exists. |
| AGENT-002 | missing | No recovery planning or cross-record decision workflow exists. |
| AGENT-003 | missing | No outcome-tracking recovery cases or verification exist. |
| AGENT-004 | missing | No decision dependency graph, substitute preparation or delivery follow-through exists. |
| AGENT-005 | missing | No cost-match agent or actual-cost correction packets exist. |
| AGENT-006 | missing | No handover and warranty agent or closure workflow exists. |
| AGENT-007 | missing | Draft bearer commands exist, but no grounded AI question answering, risk summaries or AI action preparation exists. |
| AGENT-008 | missing | No scheduled AI runner, source grants or outcome and budget controls exist. |
| AGENT-009 | missing | No completed-job learning, replay or catalog proposal agent exists. |
