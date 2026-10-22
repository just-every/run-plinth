import type { Stamp } from './model'

/** A grant belongs to one revision, never to the job or the reusable customer. */
export interface SelectionDelegation {
 id: string; revision_id: string; customer_id: string; contact_id: string
 delegated_by: Stamp; delegator_email: string; delegator_version: number
 delegate: Stamp; delegate_email: string; delegate_version: number
 statement: string; status: 'active' | 'used' | 'revoked' | 'void'
 revocation?: { by: Stamp; reason: string }
 voided?: { at: string; reason: string }
}
export interface DelegatedSignature {
 delegation_id: string; revision_id: string; delegated_by: Stamp; delegate: Stamp
}

export function delegationProof(grant:SelectionDelegation) {
 const {delegator_email,delegator_version,delegate_email,delegate_version,customer_id,contact_id,...proof}=grant
 return proof
}
