import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveJob, createFixture } from './helpers.mjs'

test('US-001 — USD company setup, US address and phone, exact US/metric measures, IANA job calendars across daylight saving and separate historical AUD totals', async () => {
 const f = await createFixture()
 try {
  const agent = await f.agent(), client = await f.invite('us-client@example.com')
  const put = (body, credentials = { cookie: f.owner }) => f.json('/api/plinth/company', { method: 'PUT', ...credentials, body })
  const setup = { expected_version: 0, name: 'Hartley Remodeling LLC', time_zone: 'America/New_York', phone: '802.555.0142', address: { line1: '148 Pine Street', city: 'Burlington', state: 'vt', zip: '05401-2210' } }
  assert.equal((await put(setup, { token: agent })).status, 403, 'Agents cannot change company setup')
  assert.equal((await put(setup, { cookie: client })).status, 403, 'Clients cannot change company setup')
  for (const bad of [{ currency: 'AUD' }, { time_zone: 'Eastern' }, { phone: '555-0142' }, { phone: '+44 20 7946 0958' }, { address: { ...setup.address, state: 'NSW' } }, { address: { ...setup.address, zip: '2000' } }]) assert.equal((await put({ ...setup, ...bad })).status, 400, JSON.stringify(bad))
  let r = await put(setup); assert.equal(r.status, 200, JSON.stringify(r.value))
  assert.equal(r.value.company.currency, 'USD'); assert.equal(r.value.company.phone, '+18025550142'); assert.equal(r.value.company.phone_display, '(802) 555-0142'); assert.equal(r.value.company.address.state, 'VT')
  assert.equal((await put(setup)).status, 409, 'A stale company version is refused')
  assert.equal((await f.json('/api/plinth/company', { token: agent })).value.company.time_zone, 'America/New_York', 'Agents read setup to prepare drafts')
  assert.equal((await f.json('/api/plinth/company', { cookie: client })).status, 403)

  const create = body => f.json('/api/plinth/jobs', { method: 'POST', cookie: f.owner, body: { client_email: 'us-client@example.com', ...body } })
  assert.equal((await create({ name: 'Priced in AUD', currency: 'AUD' })).status, 400, 'New business is USD')
  assert.equal((await create({ name: 'Unknown zone', time_zone: 'Mars/Olympus' })).status, 400)
  const east = await createActiveJob(f, 'Burlington kitchen remodel', 'us-client@example.com')
  assert.equal(east.time_zone, 'America/New_York', 'A new job starts in the company time zone')
  r = await create({ name: 'Naperville bathroom remodel', time_zone: 'America/Chicago' }); assert.equal(r.status, 201); let west = r.value.job
  assert.equal(west.time_zone, 'America/Chicago')

  // Exact decimal measures and exact US/metric conversion, rounded half-up once per line.
  const coded = { cost_code: '09-300', phase: 'Finishes', category: 'material' }
  r = await f.json(`/api/plinth/jobs/${west.id}/quotes`, { method: 'POST', cookie: f.owner, body: { expected_version: west.version, lines: [
   { ...coded, description: 'Porcelain floor tile', quantity: '12.5', unit: 'sq ft', unit_cents: 837 },
   { ...coded, description: 'Imported wall tile measured in square metres', quantity: '2', unit: 'sq m', rate_unit: 'sq ft', unit_cents: 837 },
   { ...coded, description: 'Schluter edge trim measured in inches', quantity: '30', unit: 'in', rate_unit: 'ft', unit_cents: 1250 },
  ] } })
  assert.equal(r.status, 200, JSON.stringify(r.value)); west = r.value.job
  const [tile, metric, trim] = west.quotes[0].lines
  assert.equal(tile.total_cents, 10463, '12.5 sq ft x $8.37 = $104.625, half-up to $104.63')
  assert.deepEqual(metric.conversion, { numerator: '1', denominator: '0.09290304' }, 'The exact square-metre to square-foot factor is recorded on the line')
  assert.equal(metric.total_cents, 18019, '2 m² = 21.5278... sq ft x $8.37 = $180.1878..., half-up once')
  assert.equal(trim.total_cents, 3125, '30 in = 2.5 ft x $12.50')
  assert.equal(west.quotes[0].total_cents, 10463 + 18019 + 3125)
  r = await f.json(`/api/plinth/jobs/${west.id}/quotes/${west.quotes[0].id}/accept`, { method: 'POST', cookie: f.owner, body: { expected_version: west.version, method: 'signed', evidence: 'Signed quote returned by the client' } }); assert.equal(r.status, 200); west = r.value.job

  // Working hours are local in each job's zone, so a two-day task keeps 08:00-17:00 across each DST change.
  const calendar = { weekdays: [1, 2, 3, 4, 5], start_hour: 8, end_hour: 17, holidays: [] }
  const plan = async (job, start) => {
   const post = (path, body) => f.json(`/api/plinth/jobs/${job.id}${path}`, { method: 'POST', cookie: f.owner, body: { expected_version: job.version, ...body } })
   const tasks = [{ id: `${job.id}-framing`, trade: 'Framing crew', owner: 'Alex Rivera', description: 'Frame and sheathe the addition', start, duration_minutes: 2 * 9 * 60 }]
   let result = await post('/schedule/preview', { calendar, tasks }); assert.equal(result.status, 200, JSON.stringify(result.value))
   result = await post('/schedule/publish', { calendar, tasks: result.value.preview.tasks, digest: result.value.preview.digest }); assert.equal(result.status, 200, JSON.stringify(result.value))
   return result.value.job
  }
  const autumn = await plan(east, '2026-10-30T12:00:00Z')
  assert.equal(autumn.schedule_calendar.time_zone, 'America/New_York')
  assert.deepEqual([autumn.schedules[0].start, autumn.schedules[0].end], ['2026-10-30T12:00:00.000Z', '2026-11-02T22:00:00.000Z'], 'Friday 08:00 EDT through Monday 17:00 EST')
  const spring = await plan(west, '2027-03-12T14:00:00Z')
  assert.deepEqual([spring.schedules[0].start, spring.schedules[0].end], ['2027-03-12T14:00:00.000Z', '2027-03-15T22:00:00.000Z'], 'Friday 08:00 CST through Monday 17:00 CDT')
  assert.equal((await f.json(`/api/plinth/jobs/${west.id}`, { cookie: client })).value.job.time_zone, 'America/Chicago', 'The assigned client sees the job time zone with its schedule')

  // A historical AUD job keeps its currency and is never added into USD totals.
  const csv = 'external_id,title,client_email,site_address,quote_cents,accepted_on,currency\r\nSYD-2019-04,Bondi terrace (historical),aud-client@example.com,"12 Campbell Parade, Bondi NSW 2026",4500000,2019-04-02,AUD\r\nVT-2025-11,Stowe porch,us-client@example.com,"9 Main St, Stowe, VT 05672",250000,2025-11-03,USD\r\n'
  const imports = (suffix, body) => f.json('/api/plinth/imports' + suffix, { method: 'POST', cookie: f.owner, body })
  assert.equal((await imports('/preview', { csv: csv.replace(',AUD\r\n', ',EUR\r\n') })).status, 400, 'Only USD or historical AUD rows import')
  r = await imports('/preview', { csv }); assert.equal(r.status, 200, JSON.stringify(r.value))
  r = await imports('/commit', { csv, fingerprint: r.value.fingerprint }); assert.equal(r.status, 200, JSON.stringify(r.value))
  r = await f.json('/api/plinth/jobs', { cookie: f.owner })
  const aud = r.value.jobs.find(job => job.import_evidence?.external_id === 'SYD-2019-04'), porch = r.value.jobs.find(job => job.import_evidence?.external_id === 'VT-2025-11')
  assert.equal(aud.currency, 'AUD'); assert.equal(porch.currency, undefined, 'USD rows are ordinary USD jobs')
  assert.deepEqual(r.value.currency_totals, [
   { currency: 'USD', historical: false, jobs: 3, contract_cents: 1_000_000 + 31_607, quoted_cents: 250_000, billed_cents: 0 },
   { currency: 'AUD', historical: true, jobs: 1, contract_cents: 0, quoted_cents: 4_500_000, billed_cents: 0 },
  ])
  assert.equal((await f.json('/api/plinth/jobs', { cookie: client })).value.currency_totals, undefined, 'Clients receive no portfolio totals')
  r = await f.json(`/api/plinth/jobs/${aud.id}/quotes/${aud.quotes[0].id}/cost-codes.json`, { cookie: f.owner }); assert.equal(r.status, 200); assert.equal(r.value.currency, 'AUD')
  r = await f.json(`/api/plinth/jobs/${aud.id}/pricing/preview`, { method: 'POST', cookie: f.owner, body: { expected_version: aud.version } })
  assert.equal(r.status, 409); assert.equal(r.value.error, 'currency', 'USD rates and tax never price a historical AUD job')

  // US phone numbers on customer contacts gain E.164; other numbers stay exactly as written.
  r = await f.json('/api/plinth/customers', { method: 'POST', cookie: f.owner, body: { name: 'Rivera household', kind: 'household', contacts: [{ id: 'sam', name: 'Sam Rivera', email: 'sam@example.com', phone: '1 (802) 555-0199' }, { id: 'ana', name: 'Ana Rivera', email: 'ana@example.com', phone: '+44 20 7946 0958' }] } })
  assert.equal(r.status, 201, JSON.stringify(r.value))
  assert.equal(r.value.customer.contacts[0].phone_e164, '+18025550199'); assert.equal(r.value.customer.contacts[0].phone, '1 (802) 555-0199')
  assert.equal(r.value.customer.contacts[1].phone_e164, undefined); assert.equal(r.value.customer.contacts[1].phone, '+44 20 7946 0958')
 } finally { await f.close() }
})
