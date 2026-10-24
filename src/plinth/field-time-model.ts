import type { Stamp } from './model'
export interface TimeRevision { dated_on:string; cost_code:string; activity:string; minutes:number; break_minutes:number; classification:'regular'|'overtime'; reason:string; by:Stamp }
export interface FieldTime { id:string; employee_id:string; entered_by:Stamp; revisions:TimeRevision[]; approval?:{by:Stamp;source_id:string;hour_cents:number;burden_bps:number;amount_cents:number;base_cents:number;burden_cents:number} }
export interface TimeRate { employee_id:string; hour_cents:number; burden_bps:number; overtime_bps:number; reference:string; by:Stamp }
export interface FieldTimeState { site?:import('./field-geofence').TimeFence; location_choices?:import('./field-geofence').LocationChoice[]; entries:FieldTime[]; rates:TimeRate[] }
