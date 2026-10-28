import type { Stamp } from './model'
export type FollowupKind = 'estimate' | 'selection' | 'collection'
export interface FollowupRevision {
 revision:number; by:Stamp; generation:number; mode:'event'|'scheduled'; starts_on:string; stop_on:string
 recipients:string[]; escalation_recipient:string; quiet_start:string; quiet_end:string; time_zone:string
 approval_limit_cents:number; steps:{id:string;label:string;after_days:number;escalate:boolean}[]
 paused:boolean; reason:string
}
export interface FollowupRule { id:string; kind:FollowupKind; revisions:FollowupRevision[] }
export interface FollowupConsent { kind:FollowupKind; person_id:string; allowed:boolean; by:Stamp }
export interface FollowupState { rules:FollowupRule[]; consents:FollowupConsent[] }
export interface FollowupSource { id:string; revision:string; kind:FollowupKind; title:string; event_on:string; scheduled_on:string; amount_cents:number; outstanding:boolean }
export interface FollowupAction {
 key:string; rule_id:string; rule_revision:number; source_id:string; source_revision:string; source_title:string
 step_id:string; step:string; due_on:string; recipient_id:string; recipient_name:string; escalation:boolean
 status:'eligible'|'withheld'; reason:string
}
