import { requireManager } from './auth'
import { need, object, stamp, text, type Actor, type Input, type Stamp } from './model'
import { readClock, transaction } from './store'
import { timeZone } from './time-zone'
import { displayPhone, usAddress, usPhone, type UsAddress } from './us-conventions'

/** Company setup. New business is always USD; the time zone is the default for new jobs. */
export interface Company { version: number; name: string; currency: 'USD'; time_zone: string; address: UsAddress; phone: string; phone_display: string; updated_by: Stamp }
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
export async function company(db: D1Database): Promise<Company | null> {
 const row = await db.prepare('SELECT data FROM pl_company WHERE id=1').first<{ data: string }>()
 return row ? JSON.parse(row.data) as Company : null
}
/** Owners and administrators edit the setup; agents and clients cannot. Agents may read it to prepare drafts. */
export async function companyResponse(request: Request, db: D1Database, actor: Actor, parts: string[], readBody: (request: Request) => Promise<Input>): Promise<Response | null> {
 if (parts[0] !== 'company') return null
 need(parts.length === 1, 'Unknown company route', 404, 'not_found')
 if (request.method === 'GET') { requireManager(actor, true); return Response.json({ company: await company(db) }, { headers }) }
 need(request.method === 'PUT', 'Method not allowed', 405, 'method_not_allowed'); requireManager(actor)
 const input = object(await readBody(request)), clock = await readClock(db), previous = await company(db)
 need(input.expected_version === (previous?.version ?? 0), 'Company setup changed; reload before saving', 409, 'stale_version')
 need(input.currency === undefined || input.currency === 'USD', 'New business is priced in USD', 400, 'currency')
 const phone = usPhone(input.phone)
 const next: Company = { version: (previous?.version ?? 0) + 1, name: text(input.name, 'company name', 200), currency: 'USD', time_zone: timeZone(input.time_zone), address: usAddress(input.address), phone, phone_display: displayPhone(phone), updated_by: stamp(actor) }
 const data = JSON.stringify(next)
 await transaction(db, actor, null, [previous
  ? db.prepare('UPDATE pl_company SET version=?,data=? WHERE id=1 AND version=?').bind(next.version, data, previous.version)
  : db.prepare('INSERT INTO pl_company(id,version,data) VALUES(1,?,?)').bind(next.version, data)], clock)
 return Response.json({ company: next }, { headers })
}
