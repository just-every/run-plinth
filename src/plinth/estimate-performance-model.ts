import type { Stamp } from './model'
import type { Assembly, EstimateTemplate } from './catalog-model'
export type SalesStage = 'qualified'|'estimating'|'submitted'|'negotiating'|'lost'
export interface PerformanceLesson {
 id:string; catalog_id:string; catalog_version:number; kind:'assembly'|'template'; name:string; reason:string
 value:Assembly|EstimateTemplate; sources:{id:string;version:number}[]; proposed_by:Stamp
 approved?:{by:Stamp;catalog_version:number}
}
export interface EstimatePerformance {
 completion?:{completed_on:string;evidence:string;by:Stamp}
 sales:{id:string;stage:SalesStage;quote_id:string;reason:string;evidence:string;by:Stamp}[]
 lessons:PerformanceLesson[]
}
