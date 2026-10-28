import type { Stamp } from './model'
export type FollowupKind = 'estimate' | 'selection' | 'collection' | 'bid' | 'rfi' | 'confirmation' | 'warranty'
export interface FollowupRevision {
 revision:number; by:Stamp; generation:number; authority_version?:number; mode:'event'|'scheduled'; starts_on:string; stop_on:string
 recipients:string[]; escalation_recipient:string; quiet_start:string; quiet_end:string; time_zone:string
 approval_limit_cents:number; steps:{id:string;label:string;after_days:number;escalate:boolean}[]
 paused:boolean; reason:string; delivery?:boolean; required?:boolean; required_reason?:string
}
export interface FollowupRule { id:string; kind:FollowupKind; revisions:FollowupRevision[] }
export interface FollowupConsent { kind:FollowupKind; person_id:string; allowed:boolean; by:Stamp; channel?:'email'|'off'; quiet_start?:string; quiet_end?:string; time_zone?:string }
export interface FollowupAttempt {
 id:string; key:string; rule_id:string; rule_revision:number; source_id:string; source_revision:string; step_id:string
 recipient_id:string; preference_revision:number; channel:'email'|'owner_followup'; required:boolean; required_reason?:string
 reserved_at:string; status:'unknown'|'accepted'|'refused'|'development'|'unconfigured'|'cancelled'|'owner_followup'; label:string
 completed_at?:string; provider_message_id?:string; owner_id:string
}
export interface FollowupState { rules:FollowupRule[]; consents:FollowupConsent[]; attempts?:FollowupAttempt[] }
export interface FollowupSource { id:string; revision:string; kind:FollowupKind; title:string; event_on:string; scheduled_on:string; amount_cents:number; outstanding:boolean }
export interface FollowupAction {
 key:string; rule_id:string; rule_revision:number; source_id:string; source_revision:string; source_title:string
 step_id:string; step:string; due_on:string; recipient_id:string; recipient_name:string; escalation:boolean
 status:'eligible'|'withheld'; reason:string
}
