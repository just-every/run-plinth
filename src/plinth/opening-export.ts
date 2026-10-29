import {openingAmounts} from './workbook-opening-rows'
import {reportCsvCell} from './report-query'
import type {OpeningBalance} from './workbook-opening'
/** Numeric signed cents remain numeric; all textual cells use the shared formula-injection fence. */
export function openingCsv(opening:OpeningBalance){
 const fields=['source_id','description','cost_code','native_line_id',...openingAmounts,'as_of','posting_period','source_sha256','ledger_sha256']
 const rows:unknown[][]=[fields,...opening.rows.map(row=>[row.id,row.description,row.cost_code,row.native_line_id,...openingAmounts.map(k=>row[k]),opening.as_of,opening.posting_period,opening.source_sha256,opening.ledger_sha256])]
 return rows.map(row=>row.map(value=>typeof value==='number'?`"${value}"`:reportCsvCell(value)).join(',')).join('\r\n')+'\r\n'
}
