import type { Attachment, Job, Stamp } from './model'

export interface WeatherSite { latitude: number; longitude: number; label: string; by: Stamp }
export interface DailyWeather {
 source: 'US National Weather Service'; site: string; date: string; retrieved_at: string;
 status: 'available' | 'unavailable'; reason?: string; station?: string; url?: string;
 observations: { at: string; description: string; temperature_c: number | null }[];
}
export interface DailyQuantity {
 id: string; task_id: string; task_revision: number; task: string; cost_code: string; quantity: string; unit: string;
}
export interface DailyRevision {
 id: string; revision: number; work: string; headcounts: { trade: string; count: number }[];
 delays: string; equipment: string; deliveries: string; quantities: DailyQuantity[];
 weather_correction: string; reason: string; by: Stamp;
 review?: { by: Stamp; reason: string };
}
export interface DailyLog {
 id: string; date: string; site: string; weather: DailyWeather; attachments: Attachment[];
 revisions: DailyRevision[];
 comments: { id: string; text: string; by: Stamp }[];
 annotations: { id: string; revision_id: string; file_id: string; checksum: string; x: number; y: number; text: string; by: Stamp }[];
}
export interface DailyProduction extends DailyQuantity {
 log_id: string; revision_id: string; date: string; reviewed_by: Stamp;
}
/** Only the latest reviewed revision is a current input. Superseded reviews stay in the daily record. */
export function dailyProduction(job: Job): DailyProduction[] {
 return (job.daily_logs ?? []).flatMap(log => {
  const revision = log.revisions.at(-1)!
  return revision.review ? revision.quantities.filter(q => job.schedules.some(task => task.id === q.task_id && task.status !== 'cancelled' && (task.revision ?? 0) === q.task_revision)).map(q => ({ ...q, log_id: log.id, revision_id: revision.id, date: log.date, reviewed_by: revision.review!.by })) : []
 })
}
export interface DailyLogView {
 job_id: string; version: number; create: boolean; write: boolean; review: boolean; configure: boolean;
 logs: DailyLog[]; settings: WeatherSite | null; production: DailyProduction[];
 tasks: { id: string; description: string }[]; cost_codes: string[];
}
