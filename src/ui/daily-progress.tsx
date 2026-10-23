import type { Schedule } from '../plinth/model'
import type { ScheduleActual } from '../plinth/schedule-baseline-model'
import type { JobProps } from './job'
import { Field, Form } from './shared'

const local = (iso?: string) => { const d = iso ? new Date(iso) : new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) }
export type Forecast = { completion_before: string | null; completion_after: string | null }
/** SCH-005: a field worker records actual start, finish and installed quantity for one task; the office forecast comes back with the answer. */
export function ProgressForm({ task, actual, mutate, onForecast }: { task: Schedule; actual?: ScheduleActual; mutate: JobProps['mutate']; onForecast: (forecast: Forecast) => void }) {
 return <details><summary>Record progress on {task.description}</summary>
  <Form reset={false} submit="Save progress" action={async f => {
   const finished = f.get('finished') === 'on', quantity = String(f.get('quantity') ?? '').trim()
   const result = await mutate('/schedule-actuals', { task_id: task.id, actual_start: new Date(String(f.get('start'))).toISOString(), ...(finished ? { actual_finish: new Date(String(f.get('finish'))).toISOString() } : {}), ...(quantity ? { installed: { quantity, unit: f.get('unit'), ...(f.get('cost_code') ? { cost_code: f.get('cost_code') } : {}) } } : {}), evidence: f.get('evidence'), ...(actual ? { reason: f.get('evidence') } : {}) })
   onForecast(result.record.forecast)
  }}>
   <Field label="Actual start" name="start" type="datetime-local" defaultValue={local(actual?.actual_start ?? task.start)} />
   <label><input name="finished" type="checkbox" defaultChecked={!!actual?.actual_finish} />Work on this task is finished</label>
   <Field label="Actual finish" name="finish" type="datetime-local" required={false} defaultValue={local(actual?.actual_finish)} />
   <div className="fields"><Field label="Installed quantity so far" name="quantity" required={false} inputMode="decimal" defaultValue={actual?.installed?.quantity ?? ''} /><Field label="Unit" name="unit" required={false} defaultValue={actual?.installed?.unit ?? ''} maxLength={20} /><Field label="Cost code" name="cost_code" required={false} defaultValue={actual?.installed?.cost_code ?? ''} maxLength={40} /></div>
   <label>Evidence: what was done and seen<textarea name="evidence" required rows={3} /></label>
  </Form></details>
}
