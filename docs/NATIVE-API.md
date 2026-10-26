# Native API version 1

INT-009 covers the native slice approved by ct on 25 October 2026 at 10:10Z. The current versioned surface covers job summaries, change drafts and native webhook controls. Full machine schemas for the other existing records, reports and import and export doors remain pending; their current human commands and authorization are documented in [Commands](COMMANDS.md), [Costs](COSTS.md), [Operations](../OPERATIONS.md) and [Local operation](../RUN-LOCALLY.md). Those doors retain their existing permission checks. Bearer credentials cannot import, export, erase, approve, issue, send or manage receivers.

## Schema and client

[OpenAPI 3.1 schema](../src/plinth/api-schema.json) is also returned by authenticated `GET /api/plinth/v1/openapi.json`. Regenerate the checked-in JavaScript client with `node scripts/generate-api-client.mjs`. Import `createClient` from `./src/plinth/api-client.mjs`. Pass the installation origin and bearer token privately; browser callers can omit the token and use their current same-origin session. A Node caller using a human session also passes its private cookie. Never put either in a URL or commit them.

`pageJobs({limit: 50, after})` returns authorized job summaries and an opaque `next` cursor. Pass that cursor as `after` until it is null. The maximum page is 100. IDs order the traversal; concurrent creation can require a new traversal. `readJob({job_id})` returns the current summary or 404 for an unavailable job. Client reads recheck current job contacts; internal team and custom-role doors keep their existing deny-by-default checks.

`prepareChange({job_id, 'Idempotency-Key': operationKey, body: {expected_version, description, amount_cents}})` prepares a native draft on an active job. Amounts are integer cents and must be nonzero. The key is 1 to 128 ASCII letters, digits, dots, underscores or hyphens. Its identity is scoped to the authenticated person, so replacing that person's credential preserves the same draft. Concurrent identical requests return one draft; changing the request under an existing key returns 409. A new request needs the current optimistic job version. Replay reads current authority and current draft state, and cannot revive an erased job. Request identities travel with the private job archive; live credentials do not.

The generated `approveChange` operation exists to expose the human boundary. Only the current assigned client session can approve through it. Every bearer credential is refused, including an owner's credential. The operation delegates to the existing immutable native approval door and never creates an agent final-action exception.

Versioned operations and connection controls share a fixed-window limit of 60 requests per authenticated person per UTC minute. Replacement credentials share that limit. A refusal returns 429 and `Retry-After: 60`; other invalid input, sign-in, permission, unavailable record and concurrency failures use 400, 401, 403, 404 and 409 respectively. Read responses are private and uncached. The schema documents the current supported fields, responses and controls; it does not claim to cover the remaining native command surface.

## Receiver consent and custody

Policy approved by ct on 25 October 2026 at 10:10Z for this native slice: only an owner session with a matching Origin may create, rotate, revoke or deliver a subscription. Manual outbound attempts require `confirm: true`. INT-014 also allows unattended delivery under an explicit standing grant, approved by that owner session. Each subscription binds a current owner credential, that owner's current operator version, selected job IDs, event types and one exact receiver URL. Only event references are disclosed, never job content, amounts, emails, originals or private notes. INT-011, AGENT-007, AGENT-008 and BOUND-003 inherit configured HTTPS origins with public addresses, reference-only payloads, current grants and installation-local signing. Per-attempt consent is each clause’s current slice default. INT-014 uses the standing grant as that explicit consent.

The installation owner must configure `PLINTH_WEBHOOK_ORIGINS` with comma-separated exact HTTPS origins before any receiver can be registered. It is empty by default. Receiver URLs cannot contain embedded credentials or fragments. Use origins under the installation owner's control, including their DNS and network configuration. Private, loopback, link-local and special-purpose addresses are refused even when configured. Registration and each delivery resolve both address families through Cloudflare DNS over HTTPS and require exclusively public addresses; a failed lookup denies delivery. Redirects are refused, so no later hop can receive a signed payload. The application neither discovers receiver credentials nor sends to an unconfigured origin.

The versioned `/api/plinth/v1/connections` collection and its native `/api/plinth/connections` alias provide identical owner controls. The generated client uses the versioned paths:

- `createConnection({body: {credential_id, receiver, job_ids, event_types, confirm: true}})` records audited consent and returns a subscription and a random 256-bit `signing_key` once. Choose up to 100 jobs and the supported `job.updated`, `financial.updated`, `decision.approved` or `change.approved` types. Subscription lists never return signing keys.
- `pageEvents({connection_id, after})` returns up to 50 eligible event references and a numeric next sequence. The event is recorded in the same transaction as the job change. A native approved variation produces `change.approved` with its exact `subject_id`. Repeated delivery retains its original event ID, timestamp, job version and subject. `job.updated` covers native job saves; job creation and erasure are not currently webhook event types.
- `deliverEvent({connection_id, event_id, body: {confirm: true}})` makes an explicit attempt. The receiver and credential are rechecked before sending; a missing job, different job scope, revoked credential, changed operator version or revoked subscription cannot authorize it. An in-flight request cannot be recalled retroactively. Each attempt has a distinct ID, linked to a committed audit row naming the consenting owner before the receiver is called. One active attempt per subscription prevents simultaneous sends; interrupted leases become Unknown after 60 seconds when the next attempt is requested. Manual attempts do not automatically retry.
- `pageDeliveries({connection_id, after})` returns up to 50 retained attempts with next cursor, including after grant expiry or subscription revocation. A 2xx response means Accepted by receiver, not completed business work. Other HTTP responses are Failed; timeouts, interrupted responses and indeterminate sends are Unknown. Response bodies are not retained.
- `rotateConnection({connection_id, body: {credential_id}})` replaces the signing key, increments its generation and binds an active replacement owner credential. First mint that bearer through the existing owner step-up door, rotate each affected connection, and then revoke the old bearer at the existing native credential control. The old signing key is never returned again. Stale subscriptions cannot be revived by rotation; revoke and explicitly consent to a new one.
- `revokeConnection({connection_id, body: {}})` removes live delivery authority and clears the stored signing key. Historical audit references remain. Existing bearer minting, listing and revocation stay under `/api/plinth/agent-credentials` with native owner and step-up checks described in [Commands](COMMANDS.md).

## Unattended signed delivery

In **People & access → Connections**, add a receiver, then open **Set standing grant**. Only the owner session may approve, renew or revoke it. The native and versioned doors also expose `POST /connections/{connection_id}/grant` (generated `grantConnection`) with `{confirm: true, origin, event_types, payload_class: "references", rate_cap, expires_at}`. The origin must exactly match the receiver. Event types must be a nonempty subset of the receiver's existing scope; the rate cap is 1 to 1000 attempts per rolling hour, including failed attempts and retries. Expiry is an explicit future ISO instant. Omitted consent, a different origin, another payload class, an unsupported event type or an invalid cap or expiry is refused.

Only events committed after grant approval are eligible. The grant neither sweeps prior history nor authorizes record content. An installation's existing hourly Worker scheduler dispatches due events without a human session. Each attempt commits a log and audit entry naming the standing grant and consenting owner before the receiver is contacted; the audit source names the delivery automation. Current owner status and version, credential validity, receiver and event scope, job existence, key generation and public HTTPS configuration are checked at the send boundary. Revoked or expired grants, paused receivers and exhausted rolling caps cannot start a request. An already in-flight request cannot be recalled.

Successful attempts stop automatic delivery of that event to that receiver. Failed HTTP responses and indeterminate sends retry with the original event body and ID, after one minute and then two minutes; the next hourly scheduler run at or after that due time performs the retry. The cap also applies to retries. Three consecutive failures pause delivery for the receiver, including later events. The owner can inspect the pause reason, expiry, next retry and delivery history. After correcting the receiver, approve a fresh standing grant to resume future events; rotation alone does not clear pause. Renewal does not replay events accumulated before the renewed grant.

`POST /connections/{connection_id}/grant/revoke` (generated `revokeConnectionGrant`) revokes standing consent immediately while preserving history. Explicit manual consent remains separate. Revoking the receiver stops both paths and clears its signing key. Rotation under a still-current credential keeps the standing grant and future retry identity while replacing the installation signing key. A stale credential cannot be revived by rotation: create and explicitly grant a new receiver under current authority. Standing grants, their live rate counters and signing keys remain installation-local and are excluded from archives. Restoring an archive cannot resume unattended delivery.

The delivery log includes `mode`, `consent_grant_id`, event ID, key generation, HTTP status, attempt timestamps and `retry_at`. The receiver must verify signatures and deduplicate completed work using the event ID, including when its acceptance response is lost. The controlled network-edge receiver in the scheduled retry test proves recovery after a transient failure and response loss without duplicate final work. Delivery never approves a change, issues an invoice or performs a financial final action; those native doors still require their authorized human sessions.

Signing uses HMAC-SHA256 over the ASCII Unix timestamp, a literal dot and the exact UTF-8 request body. `plinth-signature` contains `t=<timestamp>,v1=<lowercase hex digest>`; `plinth-event-id` repeats the body ID. The schema's Webhook record names all disclosed fields. Verify the signature with the current key, compare in constant time, reject timestamps outside a five-minute tolerance and deduplicate by event ID. A deliberate replay is signed at its new attempt time with the current key while retaining the same event body and ID. Event IDs are independent for different job versions; attempt IDs do not replace event IDs.

Subscriptions, signing material, delivery leases and rate counters are excluded from private portability. Receiving installations must mint credentials and explicitly consent again. Content-free event references and draft idempotency records travel with the job and are removed by its erasure. There is no new retention schedule; ROLE-005 remains responsible for future retention policy. Delivery history is retained on the source installation while its subscription and job exist. No live receiver or paid provider proof is claimed: automated integration proofs use a controlled receiver at the network edge, as ACCEPTANCE.md permits.

## Restoring connector configuration

OPS-002 recovery retains an inert binding with its ID, public receiver origin,
job IDs, event types and revocation marker. Endpoint paths and query strings
are omitted because they can contain provider credentials. Signing keys, source
credentials, standing grants, delivery leases and rate counters are excluded.
Older archives made before this metadata existed still require manual receiver
configuration. No restored binding can send an event.

After restoring and signing in as the destination owner, use the generated
`listConnectionRecovery` operation. It pages up to 100 bindings, with `next`
passed back as `after` until null. This is also available at
`GET /api/plinth/connections/recovery`. Active receivers are omitted; revoked
bindings remain visible as revoked and cannot be reactivated through recovery.
Ordinary administrators and bearer credentials cannot read this checklist.

Reconfigure the destination's permitted public HTTPS origins and mint a fresh
owner credential through the existing identity-confirmation door. Re-enter the
full receiver URL privately. Call generated `createConnection` with its ordinary
consent body plus `recovery_id` from the checklist. The origin, job IDs and event
types must match the recovered binding exactly; each job must still exist.
Explicit `confirm: true` and a valid destination credential are required.
The source credential cannot authorize recovery. The new subscription retains
the binding ID and returns a new signing key once; configure that key at the
receiver privately. Repeating recovery cannot create another subscription.

The receiver initially has no standing grant. Manual delivery still requires
consent per attempt. If scheduled delivery is wanted, approve a fresh expiring
standing grant through the existing owner controls; it authorizes only future
events. Recovery never resumes a source installation's unattended work.
