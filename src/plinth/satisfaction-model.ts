import type { Stamp } from './model'

export interface SurveySettings {
 title: string; questions: string[]; low_score: number; review_url: string; by: Stamp
}
export interface SurveyConsent {
 person_id: string; email: string; email_surveys: boolean; generation: number; by: Stamp
}
export interface SurveyDelivery {
 id: string; status: 'unknown'|'accepted'|'refused'|'development'|'unconfigured'|'cancelled'
 label: string; by: Stamp; completed_at?: string; provider_message_id?: string
}
export interface SatisfactionSurvey {
 id: string; generation: number; source: {kind:'handover'|'warranty';id:string;title:string}
 recipient: {id:string;email:string}; settings: SurveySettings; by: Stamp
 context: {
  managers: {id:string;name:string}[]; crew: {id:string;name:string}[]
  subs: {id:string;name:string;trade:string}[]
 }
 follow_up_owner: {id:string;email:string;name:string}
 invitation: SurveyDelivery
 response?: {score:number;answers:string[];comment:string;by:Stamp}
 review_permission?: {allowed:boolean;url:string;by:Stamp}
 permission_history: {allowed:boolean;url:string;by:Stamp}[]
 review_request?: SurveyDelivery
 follow_up?: {todo_id:string;assignee_id:string;assignee_name:string}
}
export interface SatisfactionState {
 settings?: SurveySettings; settings_history: SurveySettings[]; consents: SurveyConsent[]; surveys: SatisfactionSurvey[]
}
