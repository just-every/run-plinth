import { need, object, text, type Input, type Job, type Stamp } from './model'

export interface MeetingShareRecipient {
 email: string; kind: 'office' | 'client' | 'sub'; subcontract_id?: string
 operator_id: string; operator_version: number; operator_role: 'owner' | 'admin' | 'member'
 team_version?: number; role_id?: string; role_version?: number
 /** Naming this person grants view of this extract only. Commenting is a separate explicit capability. */
 can_view: true; can_comment: boolean
}
export interface MeetingShareFeedback {
 id: string; operation_id: string; recipient_operator_id: string; body: string; by: Stamp
}
/** The reviewed excerpt and named grants never change. Revocation and feedback preserve their history. */
export interface MeetingShare {
 id: string; meeting_id: string; operation_id: string; title: string; body: string
 email_requests?: import('./meeting-share-mail').MeetingEmailRequest[]
 by: Stamp; recipients: MeetingShareRecipient[]; feedback: MeetingShareFeedback[]
 revocation?: { operation_id: string; reason: string; by: Stamp }
}
export type MeetingSharingJob = Job & { meeting_shares?: MeetingShare[] }
export interface PublicMeetingShare {
 id: string; title: string; body: string; by: { name: string; at: string }; can_comment: boolean
 email_copy?: { id: string; kind: string; status: string; label: string }
 feedback: { id: string; body: string; by: { name: string; at: string } }[]
}
export type MeetingShareRecipientInput = Pick<MeetingShareRecipient, 'email' | 'kind' | 'subcontract_id' | 'can_comment'>

export function shareRecipients(value: unknown): MeetingShareRecipientInput[] {
 need(Array.isArray(value) && value.length > 0 && value.length <= 100, 'Choose 1–100 named recipients')
 const recipients = value.map(raw => {
  const v = object(raw), email = text(v.email, 'Recipient email', 254).toLowerCase()
  need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Provide a recipient email')
  need(v.kind === 'office' || v.kind === 'client' || v.kind === 'sub', 'Choose an office, client or subcontractor recipient')
  need(typeof v.can_comment === 'boolean', 'Explicitly choose whether each recipient may comment')
  need(v.kind === 'sub' || v.subcontract_id === undefined, 'Only subcontractor recipients have a subcontract scope')
  return { email, kind: v.kind, can_comment: v.can_comment, ...(v.kind === 'sub' ? { subcontract_id: text(v.subcontract_id, 'Released subcontract scope', 100) } : {}) } as MeetingShareRecipientInput
 })
 need(new Set(recipients.map(r => r.email)).size === recipients.length, 'Choose each recipient once')
 return recipients
}
/** Keep the exact human-reviewed body, including whitespace, rather than copying a source record. */
export function shareText(value: unknown, label: string, max: number): string { text(value, label, max); return value as string }
export function shareOperation(job: MeetingSharingJob, input: Input): string {
 const operation = text(input.operation_id, 'Operation id', 100)
 need(!(job.meeting_shares ?? []).some(s => s.operation_id === operation || s.revocation?.operation_id === operation || s.feedback.some(f => f.operation_id === operation)), 'This meeting sharing operation is already recorded', 409, 'operation_conflict')
 return operation
}
/** An allowlist prevents private source identities, recipient grants or other feedback crossing this door. */
export function publicMeetingShare(share: MeetingShare, recipient: MeetingShareRecipient): PublicMeetingShare {
 return {
  id: share.id, title: share.title, body: share.body, by: { name: share.by.name, at: share.by.at }, can_comment: recipient.can_comment,
  ...(share.email_requests?.filter(r=>r.recipient_id===recipient.operator_id).at(-1)?{email_copy:(()=>{const r=share.email_requests!.filter(r=>r.recipient_id===recipient.operator_id).at(-1)!;return {id:r.id,kind:r.kind,status:r.status,label:r.label}})()}:{}),
  feedback: share.feedback.filter(f => f.recipient_operator_id === recipient.operator_id).map(f => ({ id: f.id, body: f.body, by: { name: f.by.name, at: f.by.at } })),
 }
}
