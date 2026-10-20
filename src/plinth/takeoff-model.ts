import type { Attachment, Stamp } from './model'
export interface Point { x:number; y:number }
export interface DrawingRevision { id:string; revision:number; document:Attachment; page:number; width:number; height:number; uploaded_by:Stamp }
export interface Calibration { id:string; revision_id:string; points:Point[]; length:string; unit:'ft'|'m'; by:Stamp }
export interface TakeoffMeasurement { id:string; revision_id:string; calibration_id?:string; kind:'length'|'area'|'count'; points:Point[]; name:string; dimension:string; annotation:string; by:Stamp; deduct_from?:string }
export interface TakeoffSheet { id:string; name:string; revisions:DrawingRevision[]; calibrations:Calibration[]; measurements:TakeoffMeasurement[] }
export interface MeasuredQuantity { id:string; sheet_id:string; sheet_name:string; name:string; kind:TakeoffMeasurement['kind']; dimension:string; gross_quantity:string; net_quantity:string; unit:string; measurement:TakeoffMeasurement; calibration?:Calibration; drawing:DrawingRevision; deductions:TakeoffMeasurement[] }
export interface TakeoffSource { measurements:MeasuredQuantity[]; dimensions:Record<string,string>; precision:string }
