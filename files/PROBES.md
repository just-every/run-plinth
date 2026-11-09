# Public-door probes for the native AUTO-003 slice

These probes execute in the committed integration support and installed journey,
using native HTTP handlers, native sign-in and migrated D1. No application responses
are replaced. Money expectations are explicit independent integer-cent values.

PROBE AUTO-003 1: owner GET current sources, then confirmed POST with their digest -> receipt IDs, original bill checksum, recorded dates and human review states are retained; mismatched source review refuses.
PROBE AUTO-003 2: receive two more packs -> received value increases by 20000 cents; actual cost and open commitment do not change.
PROBE AUTO-003 3: review and post the native bill at its existing human door -> framing actual 33000, open commitment 60000, remaining cost 127000; native job final 180000 and margin 120000 cents. The stale 100000 commitment assumption refuses.
PROBE AUTO-003 4: post the supplier correction at its existing human door -> framing actual drops by 11000 and open commitment rises by 10000; native final 179000 and margin 121000 cents.
PROBE AUTO-003 5: stored-only prospective SOV -> approved completed work remains 30000, stored value 20000, prospective current 20000, cumulative withheld 4000 and current net 19000 cents. An 80000 stored allocation is unavailable; supplied new completed work is refused as unavailable.
PROBE AUTO-003 6: missing assumptions and allocations -> null forecast and null SOV with explicit reasons. Native discrepancies remain unresolved; missing receipt originals and external accounting stay labelled.
PROBE AUTO-003 7: replay the operation, then change its input or source -> exact replay returns the original ID without a write; changed review and changed-source replay refuse. Human correction to a native forecast source invalidates the prior review.
PROBE AUTO-003 8: administrator, client, bearer, anonymous and wrong-job requests -> refused; no partial write. A revoked bearer returns 401. Job erasure removes the preview door and local review rows.
PROBE AUTO-003 9: add an unapproved daily note -> native accepted completion and issued application remain identical; no forecast approval, date publication, exception clearance or provider call occurs.
PROBE AUTO-003 10: installed Billing owner form -> save explicit assumptions and stored allocations, inspect saved review inputs and retained previews, independently inspect native receipt and posted-bill deltas; screens captured at 1440 and 390, with no horizontal overflow and existing icon tooltips.
PROBE AUTO-003 11: CLI archive recovery -> history must retain exact source revisions while excluding local review authority; source-session replay cannot reactivate it. Execution status is recorded in REPORT.md and the actual portability logs.
