import { Field } from './shared'
import type { ReportColumn, ReportFieldDefinition, ReportFieldValue } from '../plinth/report-field-model'
export function fieldInput(column: ReportColumn, value: ReportFieldValue | undefined) {
 if(column.type==='boolean')return <label>{column.name}<select name={column.id} defaultValue={value===undefined||value===null?'':String(value)}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select></label>
 return <Field label={column.name+(column.type==='money'?' (integer cents)':'')} name={column.id} type={column.type==='date'?'date':column.type==='number'||column.type==='money'?'number':'text'} step={column.type==='number'?'any':undefined} required={false} defaultValue={value===undefined||value===null?'':typeof value==='object'?String(value.amount_cents):String(value)} />
}
export function fieldFormValue(column: ReportColumn, raw: FormDataEntryValue|null, currency='USD'): ReportFieldValue {
 const value=String(raw??'');if(!value)return null
 if(column.type==='boolean'){if(value!=='true'&&value!=='false')throw new Error('Use true or false for a yes/no filter.');return value==='true'}
 if(column.type==='number')return Number(value)
 if(column.type==='money')return {amount_cents:Number(value),currency:currency as 'USD'|'AUD'}
 return value
}
export function CustomValueFields({fields,values}:{fields:ReportFieldDefinition[];values:Record<string,ReportFieldValue>}){return <div className="fields">{fields.map(f=><div key={f.id}>{fieldInput(f,values[f.id])}{f.required_at_stages.length>0&&<p className="muted">Required at: {f.required_at_stages.join(', ')}</p>}</div>)}</div>}
