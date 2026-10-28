import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture } from './helpers.mjs'

// Independent cent reconciliation from the exported decimal factors, through HTTP only.
const rational = value => {
 const [whole, fraction = ''] = String(value).split('.')
 return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)]
}
const rounded = (line, rate) => {
 const [q, qd] = rational(line.quantity), [n, nd] = rational(line.conversion?.numerator ?? '1'), [d, dd] = rational(line.conversion?.denominator ?? '1')
 const top = q * n * dd * BigInt(rate), bottom = qd * nd * d
 const whole = top / bottom, remainder = top % bottom
 return Number(whole + (remainder * 2n >= bottom ? 1n : 0n))
}
const csvRows = text => text.trim().split('\r\n').map(row => [...row.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"')))

test('EST-001 — exact coded multi-trade costs/sell, selected alternates, immutable revisions and reconciled exports', async () => {
 const f = await createFixture()
 try {
  const client = await f.invite('estimate-client@example.com'), foreign = await f.invite('other-estimate@example.com'), agent = await f.agent()
  let response = await f.json('/api/plinth/jobs', { method: 'POST', cookie: f.owner, body: { name: 'Measured kitchen and exterior remodel', client_email: 'estimate-client@example.com' } })
  assert.equal(response.status, 201); let job = response.value.job
  const root = `/api/plinth/jobs/${job.id}`
  const post = (path, body, credentials = { cookie: f.owner }) => f.json(root + path, { method: 'POST', ...credentials, body: { expected_version: job.version, ...body } })
  const line = (id, category, quantity, cost, sell, extra = {}) => ({ id, description: `${category} trade scope`, cost_code: category === 'labor' ? '06-100' : '09-200', phase: category === 'labor' ? 'Framing' : 'Finishes', category, quantity, unit: 'each', rate_unit: 'each', cost_unit_cents: cost, unit_cents: sell, ...extra })
  const lines = [
   line('labor', 'labor', '2.5', 2001, 3001, { unit: 'hour', rate_unit: 'hour' }),
   line('material', 'material', '18.125', 801, 1201, { description: 'Trim measured in inches', unit: 'inch', rate_unit: 'foot', conversion: { numerator: '1', denominator: '12' } }),
   line('equipment', 'equipment', '0.1', 15, 45, { unit: 'hour', rate_unit: 'day', conversion: { numerator: '1', denominator: '3' } }),
   line('subcontract', 'subcontract', '1.333333333333333333', 9001, 12001),
   line('other', 'other', '1', 25, 50),
   line('oak', 'material', '10.125', 225, 375, { description: 'Oak finish', alternate_group: 'Finish', alternate_option: 'Oak' }),
   line('tile', 'material', '10.125', 325, 525, { description: 'Tile finish', alternate_group: 'Finish', alternate_option: 'Tile' }),
  ]
  const body = { lines, alternate_selections: { Finish: 'Oak' }, inclusions: ['Install and protect finishes'], exclusions: ['Unforeseen concealed defects'], notes: 'Site measurement revision' }
  assert.equal((await post('/quotes', body, { cookie: client })).status, 403)
  assert.equal((await f.json(root + '/quotes', { method: 'POST', body })).status, 401)
  const invalids = [
   { quantity: 0.1 }, { quantity: '-1' }, { quantity: '0' }, { quantity: '1e2' }, { quantity: '0.1234567890123456789' },
   { conversion: { numerator: '1', denominator: '0' } }, { cost_unit_cents: 1.5 }, { unit_cents: -1 }, { unit_cents: 1_000_000_000_000, quantity: '2' },
   { category: 'unknown' }, { cost_code: '' }, { unit: 'inch', rate_unit: 'foot' },
  ]
  for (const invalid of invalids) assert.equal((await post('/quotes', { ...body, lines: [{ ...lines[0], ...invalid }] })).status, 400, JSON.stringify(invalid))
  assert.equal((await post('/quotes', { ...body, lines: [lines[0], lines[0]] })).status, 400)
  assert.equal((await post('/quotes', { ...body, alternate_selections: { Finish: 'Unknown' } })).status, 400)
  // Bearer agents retain existing draft preparation authority and cannot accept/export.
  response = await post('/quotes', body, { token: agent }); assert.equal(response.status, 200); job = response.value.job
  const first = structuredClone(job.quotes.at(-1))
  for (const actual of first.lines) {
   assert.equal(actual.total_cents, rounded(actual, actual.unit_cents))
   assert.equal(actual.cost_total_cents, rounded(actual, actual.cost_unit_cents))
  }
  assert.equal(first.lines.find(row => row.id === 'equipment').cost_total_cents, 1, 'A half-cent rounds up once after exact conversion')
  assert.equal(first.lines.find(row => row.id === 'tile').included, false)
  assert.equal(first.lines.find(row => row.id === 'oak').included, true)
  const totals = quote => quote.lines.filter(row => row.included).reduce((total, row) => ({ sell: total.sell + rounded(row, row.unit_cents), cost: total.cost + rounded(row, row.cost_unit_cents) }), { sell: 0, cost: 0 })
  assert.equal(first.total_cents, totals(first).sell); assert.equal(first.cost_total_cents, totals(first).cost)
  assert.equal((await post(`/quotes/${first.id}/accept`, { method: 'signed',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'}, evidence: 'Agent cannot record this decision' }, { token: agent })).status, 403)
  assert.equal((await f.json(root, { cookie: client })).value.job.quotes.length, 0, 'Draft estimate stays private')

  const revisedBody = { ...body, lines: first.lines.map(row => row.id === 'labor' ? { ...row, quantity: '3.75', phase: 'Framing revised' } : row), alternate_selections: { Finish: 'Tile' }, inclusions: [...body.inclusions, 'Additional framing bay'], exclusions: ['Existing electrical repairs'] }
  response = await post('/quotes', revisedBody); assert.equal(response.status, 200); job = response.value.job
  const second = structuredClone(job.quotes.at(-1))
  assert.equal(second.revision, first.revision + 1)
  assert.deepEqual(job.quotes[0], { ...first, status: 'superseded' }, 'Earlier measured scope and prices stay fixed')
  assert.equal(second.lines.find(row => row.id === 'labor').quantity, '3.75')
  assert.equal(second.lines.find(row => row.id === 'oak').included, false)
  assert.equal(second.lines.find(row => row.id === 'tile').included, true)
  assert.notEqual(second.total_cents, first.total_cents); assert.notEqual(second.cost_total_cents, first.cost_total_cents)
  assert.equal(second.total_cents, totals(second).sell); assert.equal(second.cost_total_cents, totals(second).cost)
  assert.deepEqual(second.inclusions, revisedBody.inclusions); assert.deepEqual(second.exclusions, revisedBody.exclusions)
  assert.equal((await post('/quotes', { ...body, expected_version: job.version - 1 })).status, 409)
  assert.equal((await post(`/quotes/${first.id}/accept`, { method: 'email',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'}, evidence: 'Old revision' })).status, 409)

  for (const quote of [first, second]) {
   const path = `${root}/quotes/${quote.id}/cost-codes`
   for (const credentials of [{}, { cookie: client }, { cookie: foreign }, { token: agent }]) {
    assert.ok([401, 403, 404].includes((await f.request(path + '.json', credentials)).status))
    assert.ok([401, 403, 404].includes((await f.request(path + '.csv', credentials)).status))
   }
   const exported = await f.json(path + '.json', { cookie: f.owner }); assert.equal(exported.status, 200)
   const report = exported.value
   assert.equal(report.total_cents, totals(quote).sell); assert.equal(report.cost_total_cents, totals(quote).cost)
   assert.equal(report.cost_codes.reduce((sum, code) => sum + code.total_cents, 0), report.total_cents)
   assert.equal(report.cost_codes.reduce((sum, code) => sum + code.cost_total_cents, 0), report.cost_total_cents)
   for (const code of report.cost_codes) {
    const selected = report.lines.filter(row => row.included && row.cost_code === code.cost_code && row.phase === code.phase && row.category === code.category)
    assert.equal(code.total_cents, selected.reduce((sum, row) => sum + rounded(row, row.unit_cents), 0))
    assert.equal(code.cost_total_cents, selected.reduce((sum, row) => sum + rounded(row, row.cost_unit_cents), 0))
   }
   const csvResponse = await f.request(path + '.csv', { cookie: f.owner }); assert.equal(csvResponse.status, 200)
   const [headings, ...rows] = csvRows(await csvResponse.text()), records = rows.map(row => Object.fromEntries(headings.map((key, index) => [key, row[index]])))
   const detail = records.filter(row => row.row_type === 'line')
   assert.equal(detail.length, quote.lines.length)
   for (const row of detail) {
    const actual = quote.lines.find(line => line.id === row.line_id)
    assert.equal(row.quantity, String(actual.quantity)); assert.equal(Number(row.total_cents), rounded(actual, actual.unit_cents)); assert.equal(Number(row.cost_total_cents), rounded(actual, actual.cost_unit_cents))
   }
   const codeRows=records.filter(row=>row.row_type==='code_total')
   assert.equal(codeRows.length,report.cost_codes.length)
   for(const row of codeRows){const code=report.cost_codes.find(code=>code.cost_code===row.cost_code&&code.phase===row.phase&&code.category===row.category);assert.ok(code);assert.equal(Number(row.total_cents),code.total_cents);assert.equal(Number(row.cost_total_cents),code.cost_total_cents)}
   assert.equal(Number(records.find(row => row.row_type === 'estimate_total').total_cents), report.total_cents)
   assert.equal(Number(records.find(row => row.row_type === 'estimate_total').cost_total_cents), report.cost_total_cents)
  }
  response = await post(`/quotes/${second.id}/accept`, { method: 'signed',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'}, evidence: 'Client signed the measured scope and Tile selection' }); assert.equal(response.status, 200); job = response.value.job
  const snapshot = job.approvals.find(row => row.kind === 'quote').snapshot
  assert.deepEqual(snapshot.lines, second.lines); assert.deepEqual(snapshot.inclusions, second.inclusions); assert.deepEqual(snapshot.exclusions, second.exclusions); assert.deepEqual(snapshot.alternate_selections, second.alternate_selections)
  assert.equal(snapshot.cost_total_cents, second.cost_total_cents)
  assert.equal((await post('/quotes', revisedBody)).status, 409)
  const visible = (await f.json(root, { cookie: client })).value.job
  assert.equal(visible.quotes[0].total_cents, second.total_cents)
  assert.equal(visible.quotes[0].lines.length, second.lines.filter(line => line.included).length)
  assert.ok(visible.quotes[0].lines.every(line => line.cost_code === undefined && line.phase === undefined && line.category === undefined))
  assert.deepEqual(visible.quotes[0].exclusions, second.exclusions)
  const listing=await f.json('/api/plinth/jobs',{cookie:client});assert.equal(listing.status,200)
  assert.deepEqual(listing.value.jobs.find(row=>row.id===job.id).quotes,visible.quotes,'List and detail use the same current client projection')
  const clientBytes = JSON.stringify(visible)
  assert.ok(!clientBytes.includes('cost_unit_cents') && !clientBytes.includes('cost_total_cents'), 'Client quote and approval snapshots expose selling terms without internal costs')
  assert.equal((await f.json(root, { cookie: foreign })).status, 404)
  assert.deepEqual((await f.json(root, { cookie: f.owner })).value.job.quotes.at(-1), { ...second, status: 'accepted', acceptance: job.quotes.at(-1).acceptance })

  // Real reviewed import supplies a historic uncoded quote; do not fabricate rates or costs.
  const csv = 'external_id,title,client_email,site_address,quote_cents,accepted_on\nEST-LEGACY,Historical uncoded job,legacy@example.com,,12345,2026-10-01\n'
  const preview = await f.json('/api/plinth/imports/preview', { method: 'POST', cookie: f.owner, body: { csv } }); assert.equal(preview.status, 200)
  assert.equal((await f.json('/api/plinth/imports/commit', { method: 'POST', cookie: f.owner, body: { csv, fingerprint: preview.value.fingerprint } })).status, 200)
  const legacy = (await f.json('/api/plinth/jobs', { cookie: f.owner })).value.jobs.find(row => row.import_evidence?.external_id === 'EST-LEGACY')
  assert.equal(legacy.quotes[0].total_cents, 12345)
  const legacyExport = await f.json(`/api/plinth/jobs/${legacy.id}/quotes/${legacy.quotes[0].id}/cost-codes.json`, { cookie: f.owner })
  assert.equal(legacyExport.status, 200); assert.equal(legacyExport.value.total_cents, legacy.quotes[0].total_cents); assert.equal(legacyExport.value.cost_total_cents, null)
  assert.equal(legacyExport.value.cost_codes[0].cost_code, null)
 } finally { await f.close() }
})

test('EST-002 — dated vendor catalogs, waste/productivity assemblies and dimensioned templates update only reviewed draft jobs', async () => {
 const f=await createFixture()
 try {
  const client=await f.invite('catalog-client@example.com'),agent=await f.agent()
  const post=(path,body,options={})=>f.json(path,{method:'POST',cookie:f.owner,body,...options})
  const catalog=async(kind,name,value)=>{const r=await post('/api/plinth/estimate-catalog',{kind,name,value,reason:'Estimator reviewed source rates and construction method'});assert.equal(r.status,201,JSON.stringify(r.value));return r.value.entry}
  const material=await catalog('rate','Cascade drywall board',{vendor:'Cascade Supply',effective_on:'2026-10-01',unit:'square feet',cost_cents:125,sell_cents:200,reference:'Supplier quote CS-1042'})
  const labor=await catalog('rate','Wall crew hourly',{vendor:'Northwest Interiors',effective_on:'2026-10-01',unit:'hour',cost_cents:6000,sell_cents:9000,reference:'Crew agreement NW-26'})
  const part=(id,rate_id,category,productivity,waste_percent)=>({id,rate_id,description:category==='labor'?'Hang and finish wall':'Drywall board',cost_code:category==='labor'?'09-L':'09-M',phase:'Interior walls',category,units_per_dimension:'1',productivity,waste_percent})
  const assembly=await catalog('assembly','Interior wall assembly',{unit:'square feet',parts:[part('board',material.id,'material','1','10'),part('crew',labor.id,'labor','40','0')]})
  const template=await catalog('template','Occupied remodel walls',{kind:'remodel',dimensions:{wall_area:'400'},items:[{id:'walls',assembly_id:assembly.id,dimension:'wall_area'}]})
  const house=await catalog('template','New house walls',{kind:'house',dimensions:{wall_area:'800'},items:[{id:'house-walls',assembly_id:assembly.id,dimension:'wall_area'}]})
  const newJob=async name=>{const r=await post('/api/plinth/jobs',{name,client_email:'catalog-client@example.com',address:'148 Maple Street, Portland, OR 97205'});assert.equal(r.status,201);return r.value.job}
  let a=await newJob('Chen occupied remodel'),b=await newJob('Rivera kitchen extension')
  const request={template_id:template.id,as_of:'2026-10-19',dimensions:{wall_area:'400'}}
  const preview=async(job,input=request,options={})=>{const r=await post(`/api/plinth/jobs/${job.id}/estimate-template/preview`,{expected_version:job.version,...input},options);assert.equal(r.status,200,JSON.stringify(r.value));return r.value.preview}
  const apply=async(job,review,input=request,options={})=>post(`/api/plinth/jobs/${job.id}/estimate-template/apply`,{...input,expected_version:job.version,digest:review.digest},options)
  const original=await preview(a)
  assert.equal(original.proposal.lines[0].cost_total_cents,55000);assert.equal(original.proposal.lines[0].total_cents,88000)
  assert.equal(original.proposal.lines[1].cost_total_cents,60000);assert.equal(original.proposal.lines[1].total_cents,90000)
  assert.deepEqual(original.proposal.lines.map(line=>[line.phase,line.category,line.cost_code]),[['Interior walls','material','09-M'],['Interior walls','labor','09-L']]);assert.equal(original.proposal.cost_catalog.template_version,1)
  assert.equal(original.proposal.cost_total_cents,115000);assert.equal(original.proposal.total_cents,178000)
  assert.equal((await f.json(`/api/plinth/jobs/${a.id}`,{cookie:f.owner})).value.job.quotes.length,0,'Preview never changes a job')
  assert.equal((await apply(a,{digest:'unreviewed'})).status,409)
  let r=await apply(a,original);assert.equal(r.status,200);a=r.value.job
  const secondInput={...request,dimensions:{wall_area:'250.5'}}
  let second=await preview(b,secondInput);r=await apply(b,second,secondInput);assert.equal(r.status,200);b=r.value.job
  assert.equal(b.quotes[0].lines[0].cost_total_cents,34444,'250.5 × 1.1 × 125 rounds once half-up')
  assert.equal(b.quotes[0].lines[1].cost_total_cents,37575,'Labor divides by exact production without rounding hours')
  const soldQuote=structuredClone(a.quotes[0]);r=await post(`/api/plinth/jobs/${a.id}/quotes/${soldQuote.id}/accept`,{expected_version:a.version,method:'email',schedule_choice:{kind:'none',reason:'Schedule will be planned separately'},evidence:'Chen accepted exact wall scope and price'});assert.equal(r.status,200);a=r.value.job
  const accepted=structuredClone(a.quotes[0]),acceptedApproval=structuredClone(a.approvals.find(row=>row.kind==='quote'))
  const stale=await preview(b,secondInput)
  r=await post('/api/plinth/estimate-catalog/'+material.id,{expected_version:1,name:material.name,reason:'Supplier price revision CS-1051',value:{...material.revisions[0].value,effective_on:'2026-10-15',cost_cents:150,sell_cents:240}});assert.equal(r.status,200);assert.equal(r.value.entry.revisions.length,2)
  assert.equal((await apply(b,stale,secondInput)).status,409,'A changed source rate invalidates the reviewed digest')
  second=await preview(b,secondInput);assert.equal(second.proposal.lines[0].cost_total_cents,41333);assert.equal(second.proposal.lines[0].total_cents,66132)
  assert.equal(second.total_delta_cents,11022)
  assert.equal((await f.json(`/api/plinth/jobs/${b.id}`,{cookie:f.owner})).value.job.quotes.length,1,'Rate save never rewrites job estimates')
  const historical=await preview(b,{...secondInput,as_of:'2026-10-10'});assert.equal(historical.proposal.total_cents,b.quotes[0].total_cents)
  const soldImpact=await preview(a);assert.equal(soldImpact.sold,true);assert.equal(soldImpact.total_delta_cents,17600)
  assert.equal((await apply(a,soldImpact)).status,409)
  assert.equal((await apply(b,second,secondInput,{cookie:undefined,token:agent})).status,403)
  assert.equal((await preview(b,secondInput,{cookie:undefined,token:agent})).digest,second.digest)
  r=await apply(b,second,secondInput);assert.equal(r.status,200);b=r.value.job
  assert.equal(b.quotes[0].status,'superseded');assert.equal(b.quotes[1].revision,2);assert.equal(b.quotes[1].cost_catalog.rates[0].version,2)
  assert.equal(b.approvals.at(-1).kind,'estimate.catalog');assert.equal(b.approvals.at(-1).approved_by.role,'owner')
  assert.deepEqual((await f.json(`/api/plinth/jobs/${a.id}`,{cookie:f.owner})).value.job.quotes[0],accepted)
  assert.deepEqual((await f.json(`/api/plinth/jobs/${a.id}`,{cookie:f.owner})).value.job.approvals.find(row=>row.kind==='quote'),acceptedApproval)
  const changedDimension=await preview(b,{...request,dimensions:{wall_area:'500'}});assert.equal(changedDimension.proposal.lines[1].cost_total_cents,75000)
  const housePreview=await preview(b,{template_id:house.id,as_of:'2026-10-19',dimensions:{wall_area:'800'}});assert.equal(housePreview.proposal.lines[1].cost_total_cents,120000)
  // Assembly revisions retain the prior production/waste method and require fresh review too.
  r=await post('/api/plinth/estimate-catalog/'+assembly.id,{expected_version:1,name:assembly.name,reason:'Updated production after estimator review',value:{unit:'square feet',parts:[part('board',material.id,'material','1','5'),part('crew',labor.id,'labor','50','0')]}});assert.equal(r.status,200)
  assert.equal((await apply(b,changedDimension,{...request,dimensions:{wall_area:'500'}})).status,409)
  r=await post('/api/plinth/estimate-catalog/'+template.id,{expected_version:1,name:template.name,reason:'Larger default room dimensions',value:{...template.revisions[0].value,dimensions:{wall_area:'600'}}});assert.equal(r.status,200)
  const newDefault=await preview(b,{template_id:template.id,as_of:'2026-10-19'});assert.equal(newDefault.proposal.lines[1].cost_total_cents,72000);assert.equal(newDefault.proposal.cost_catalog.template_version,2)
  assert.deepEqual((await f.json(`/api/plinth/jobs/${a.id}`,{cookie:f.owner})).value.job.quotes[0],accepted,'Template and assembly revisions never rewrite the sold copy')
  const listing=await f.json('/api/plinth/estimate-catalog',{cookie:f.owner});assert.equal(listing.status,200);assert.equal(listing.value.entries.find(e=>e.id===assembly.id).revisions.length,2)
  assert.equal((await f.json('/api/plinth/estimate-catalog',{cookie:client})).status,403)
  assert.equal((await f.json('/api/plinth/estimate-catalog')).status,401)
  assert.equal((await post('/api/plinth/estimate-catalog',{kind:'rate',name:'No authority',value:material.revisions[0].value,reason:'Attempted agent approval'},{cookie:undefined,token:agent})).status,403)
  assert.equal((await post(`/api/plinth/jobs/${a.id}/estimate-template/preview`,{...request,expected_version:a.version},{cookie:client})).status,403)
  const visible=JSON.stringify((await f.json(`/api/plinth/jobs/${a.id}`,{cookie:client})).value.job);assert.ok(!visible.includes('cost_catalog')&&!visible.includes('cost_total_cents'))
 } finally {await f.close()}
})

test('EST-005 — supplier captures form reviewed room boards and estimate drafts; refreshed prices require review and signed alternatives retain original sources', async()=>{
 const f=await createFixture()
 try {
  const client=await f.invite('product-client@example.com'),foreign=await f.invite('other-product-client@example.com'),agent=await f.agent()
  const root='/api/plinth';let r=await f.json(root+'/jobs',{method:'POST',cookie:f.owner,body:{name:'Mason kitchen and bath — supplier specification boards',client_email:'product-client@example.com',address:'4518 Alder Avenue, Portland, OR 97211'}});assert.equal(r.status,201);let job=r.value.job
  const post=async(path,body={},credentials={cookie:f.owner})=>{const result=await f.json(root+`/jobs/${job.id}`+path,{method:'POST',...credentials,body:{expected_version:job.version,...body}});if(result.status===200)job=(await f.json(root+`/jobs/${job.id}`,{cookie:f.owner})).value.job;return result}
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII='
  const captured_on=new Date(Date.now()-86400000).toISOString().slice(0,10),valid_until=new Date(Date.now()+86400000*30).toISOString().slice(0,10)
  const faucet={name:'Brushed nickel single-handle faucet',sku:'FAU-108-BN',supplier:'Cascade Plumbing Supply',source_url:'https://supplier.example.com/products/FAU-108-BN',dimensions:'8 inch reach, 15 inch height, single-hole mount',cost_quote_cents:28_450,lead_days:14,captured_on,valid_until,discontinued:false,evidence:'Dated supplier quote CSP-1048 and supplier product sheet, transcribed by estimator',image:{name:'faucet-original.png',mime:'image/png',base64:png}}
  assert.equal((await post('/products',faucet,{cookie:client})).status,403)
  assert.equal((await post('/products',{...faucet,source_url:'javascript:alert(1)'})).status,400)
  assert.equal((await post('/products',{...faucet,image:{...faucet.image,base64:Buffer.from('<html>bad upload</html>').toString('base64')}})).status,400)
  assert.equal((await post('/products',{...faucet,valid_until:'2020-01-01'})).status,400)
  r=await post('/products',faucet,{token:agent});assert.equal(r.status,200);const tap=job.products[0],tapV1=structuredClone(tap.revisions[0])
  assert.equal((await post(`/products/${tap.id}/estimate`,{revision_id:tapV1.id,cost_code:'22-400',unit_cents:35_000})).status,409)
  assert.equal((await post(`/products/${tap.id}/review`,{revision_id:tapV1.id,confirm:true},{token:agent})).status,403)
  assert.equal((await post(`/products/${tap.id}/review`,{revision_id:tapV1.id,confirm:true})).status,200)
  assert.equal((await post(`/products/${tap.id}/review`,{revision_id:tapV1.id,confirm:true})).status,409)
  r=await post(`/products/${tap.id}/estimate`,{revision_id:tapV1.id,cost_code:'22-400',unit_cents:35_000});assert.equal(r.status,200)
  assert.equal(job.quotes[0].lines[0].product_source.cost_quote_cents,28_450)
  assert.equal(job.quotes[0].lines[0].cost_total_cents,28_450);assert.equal(job.quotes[0].total_cents,35_000)
  const finishBody={...faucet,name:'Rift oak cabinet finish sample',sku:'CAB-OAK-12',supplier:'Columbia Cabinetry',source_url:'https://supplier.example.com/finishes/rift-oak',dimensions:'12 × 12 inch sample, clear matte finish',cost_quote_cents:4_000,lead_days:28,evidence:'Cabinet finish quote CC-57 and sample photograph'}
  assert.equal((await post('/products',finishBody)).status,200);const finish=job.products[1],finishV1=finish.revisions[0]
  assert.equal((await post(`/products/${finish.id}/review`,{revision_id:finishV1.id,confirm:true})).status,200)
  assert.equal((await post(`/products/${finish.id}/estimate`,{revision_id:finishV1.id,cost_code:'06-400',unit_cents:5_000})).status,200)
  assert.equal(job.quotes.at(-1).lines.length,2);const estimate=structuredClone(job.quotes.at(-1));assert.equal(estimate.total_cents,40_000)
  const quote=job.quotes.at(-1)
  assert.equal((await post(`/quotes/${quote.id}/accept`,{method:'email',evidence:'Client accepted kitchen scope and finish quote',schedule_choice:{kind:'none',reason:'Installation dates will be planned after product decisions'}})).status,200)
  assert.equal((await post('/products',{...faucet,name:'Chrome kitchen faucet alternative',sku:'FAU-220-CH',source_url:'https://supplier.example.com/products/FAU-220-CH',cost_quote_cents:22_000})).status,200);const alternative=job.products[2],alternativeV1=alternative.revisions[0]
  assert.equal((await post(`/products/${alternative.id}/review`,{revision_id:alternativeV1.id,confirm:true})).status,200)
  const option=(p,v,price)=>({name:v.name,specifications:v.dimensions,supplier:v.supplier,price_cents:price,product_id:p.id,product_revision_id:v.id})
  const board={room:'Kitchen',category:'Kitchen faucet alternatives',allowance_cents:40_000,cost_code:'22-400',decision_on:valid_until,lead_days:28,options:[option(tap,tapV1,35_000),option(alternative,alternativeV1,27_500)]}
  assert.equal((await post('/selections',board)).status,200);let selection=job.selections[0],boardV1=selection.revisions[0]
  assert.equal((await post(`/selections/${selection.id}/present`,{revision_id:boardV1.id})).status,200)
  r=await post(`/selections/${selection.id}/sign`,{revision_id:boardV1.id,option_id:boardV1.options[0].id,statement:'I approve the exact brushed nickel faucet specification and selling price',confirm:true},{cookie:client});assert.equal(r.status,200)
  const signed=structuredClone(job.selections[0].revisions[0]);assert.equal(signed.signature.option.product_source.source_url,faucet.source_url)
  let clientJob=(await f.json(root+`/jobs/${job.id}`,{cookie:client})).value.job
  assert.equal(clientJob.products,undefined);assert.ok(!JSON.stringify(clientJob).includes('cost_quote_cents'));assert.equal(clientJob.selections[0].revisions[0].options[0].product_source.sku,faucet.sku)
  const imagePath=root+`/jobs/${job.id}/product-images/${tapV1.image.id}`
  assert.deepEqual(await (await f.request(imagePath,{cookie:client})).arrayBuffer(),Uint8Array.from(Buffer.from(png,'base64')).buffer)
  assert.equal((await f.request(imagePath,{cookie:foreign})).status,404)
  const captureRefresh={...faucet,cost_quote_cents:31_900,valid_until:captured_on,discontinued:true};delete captureRefresh.image
  assert.equal((await post(`/products/${tap.id}/revise`,captureRefresh)).status,200);const tapV2=job.products[0].revisions[1]
  assert.equal(tapV2.image.id,tapV1.image.id,'Image custody retained on price-only refresh')
  assert.equal((await post('/selections',{...board,options:[option(tap,tapV2,38_000)]})).status,409,'Refreshed supplier values cannot enter a new board without exact human review')
  assert.equal((await post(`/products/${tap.id}/review`,{revision_id:tapV2.id,confirm:true})).status,200)
  assert.ok(job.selections[0].revisions[0].options[0].product_notices.some(n=>n.includes('Newer')))
  assert.ok(job.selections[0].revisions[0].options[0].product_notices.some(n=>n.includes('discontinued')))
  assert.deepEqual(job.quotes.find(q=>q.id===estimate.id),{...estimate,status:'accepted',acceptance:job.quotes.find(q=>q.id===estimate.id).acceptance},'Supplier refresh never reprices accepted estimate')
  assert.deepEqual(job.selections[0].revisions[0].signature,signed.signature,'Existing decision and supplier evidence are immutable')
  assert.equal((await post(`/selections/${selection.id}/revise`,{...board,options:[option(tap,tapV2,38_000),option(alternative,alternativeV1,27_500)]})).status,200)
  selection=job.selections[0];const replacement=selection.revisions[1]
  assert.ok(replacement.options[0].product_notices.some(n=>n.includes('stale')));assert.ok(replacement.options[0].product_notices.some(n=>n==='Discontinued'))
  assert.equal((await post(`/selections/${selection.id}/present`,{revision_id:replacement.id})).status,200)
  assert.equal((await post(`/selections/${selection.id}/sign`,{revision_id:replacement.id,option_id:replacement.options[1].id,statement:'I select the reviewed chrome faucet alternative with its original source specification',confirm:true},{cookie:client})).status,200)
  assert.equal((await post(`/selections/${selection.id}/order`,{revision_id:replacement.id})).status,200)
  assert.equal(job.orders.at(-1).supplier,'Cascade Plumbing Supply');assert.equal(job.orders.at(-1).amount_cents,27_500)
  assert.equal(job.selections[0].revisions[1].signature.option.product_source.id,alternativeV1.id)
  assert.equal(job.selections[0].revisions[0].signature.option.product_source.id,tapV1.id)
  assert.equal((await f.json(root+`/jobs/${job.id}`,{cookie:foreign})).status,404)
  const reloaded=(await f.json(root+`/jobs/${job.id}`,{cookie:f.owner})).value.job
  assert.equal(reloaded.products[0].revisions.length,2);assert.ok(reloaded.approvals.some(a=>a.kind==='product.review'&&a.subject_id===tapV2.id))
 } finally {await f.close()}
})

test('EST-004 — calibrated multi-sheet PDF lengths areas counts and deducted openings price reviewed assemblies; drawing revisions flag review and preserve sold scope', async()=>{
 const {takeoffPlan}=await import('../fixtures/takeoff-plan.mjs'),f=await createFixture()
 try{
  const client=await f.invite('takeoff-client@example.com'),foreign=await f.invite('takeoff-other@example.com'),agent=await f.agent(),pdf=takeoffPlan()
  let result=await f.json('/api/plinth/jobs',{method:'POST',cookie:f.owner,body:{name:'Calibrated kitchen and laundry remodel',client_email:'takeoff-client@example.com',address:'148 Maple Street, Burlington, VT 05401'}});assert.equal(result.status,201);let job=result.value.job
  const post=async(path,body={},credentials={cookie:f.owner})=>{const r=await f.json(`/api/plinth/jobs/${job.id}`+path,{method:'POST',...credentials,body:{expected_version:job.version,...body}});if(r.value.job)job=r.value.job;return r}
  const catalog=async(kind,name,value)=>{const r=await f.json('/api/plinth/estimate-catalog',{method:'POST',cookie:f.owner,body:{kind,name,reason:'Estimator reviewed drawings and supplier labor/material rates',value}});assert.equal(r.status,201);return r.value.entry}
  const dimensions={walls:'1',floors:'1',fixtures:'1'},units={walls:'ft',floors:'sq ft',fixtures:'each'},costs={walls:100,floors:200,fixtures:1000},sells={walls:200,floors:400,fixtures:2000},assemblies={}
  for(const key of Object.keys(dimensions)){const rate=await catalog('rate',key+' rate',{vendor:'Estimator reviewed rate',effective_on:'2026-01-01',unit:units[key],cost_cents:costs[key],sell_cents:sells[key],reference:'Supplier and production schedule R-1048'});assemblies[key]=await catalog('assembly',key+' assembly',{unit:units[key],parts:[{id:key,rate_id:rate.id,description:key+' from calibrated drawings',cost_code:key==='walls'?'06-100':key==='floors'?'09-600':'22-400',phase:'Remodel',category:'material',units_per_dimension:'1',productivity:'1',waste_percent:key==='floors'?'10':'0'}]})}
  const template=await catalog('template','Measured kitchen and laundry',{kind:'remodel',dimensions,items:Object.keys(dimensions).map(key=>({id:key,assembly_id:assemblies[key].id,dimension:key}))})
  const upload={name:'A1 Kitchen',page:1,width:400,height:400,document:{name:'kitchen-and-laundry.pdf',mime:'application/pdf',base64:pdf.toString('base64')}}
  assert.equal((await post('/takeoff',upload,{cookie:client})).status,403)
  assert.equal((await post('/takeoff',{...upload,document:{...upload.document,base64:Buffer.from('<script>unsafe</script>').toString('base64')}})).status,400)
  assert.equal((await post('/takeoff',upload)).status,200);let sheet=job.takeoff[0],revision=sheet.revisions[0]
  const filePath=`/api/plinth/jobs/${job.id}/takeoff-files/${revision.document.id}`
  assert.deepEqual(await (await f.request(filePath,{cookie:f.owner})).arrayBuffer(),Uint8Array.from(pdf).buffer)
  assert.equal((await f.request(filePath,{cookie:client})).status,403);assert.equal((await f.request(filePath,{cookie:foreign})).status,404)
  assert.equal((await post(`/takeoff/${sheet.id}/calibrate`,{revision_id:revision.id,points:[{x:50,y:350},{x:250,y:350}],length:'20',unit:'ft'})).status,200);const calibration=job.takeoff[0].calibrations[0]
  const measure=async(sheetId,rev,calibrationId,kind,points,name,dimension,deduct_from)=>{const r=await post(`/takeoff/${sheetId}/measure`,{revision_id:rev,calibration_id:calibrationId,kind,points,name,dimension,annotation:'Measured on exact drawing revision; openings and scale reviewed',...(deduct_from?{deduct_from}:{})});assert.equal(r.status,200);return r.value.record}
  const wall=await measure(sheet.id,revision.id,calibration.id,'length',[{x:50,y:250},{x:250,y:250}],'Kitchen walls','walls')
  const floor=await measure(sheet.id,revision.id,calibration.id,'area',[{x:50,y:250},{x:250,y:250},{x:250,y:350},{x:50,y:350}],'Kitchen floor','floors')
  await measure(sheet.id,revision.id,calibration.id,'area',[{x:50,y:250},{x:90,y:250},{x:90,y:300},{x:50,y:300}],'Stair opening','floors',floor.id)
  const before=job.version
  assert.equal((await post(`/takeoff/${sheet.id}/measure`,{revision_id:revision.id,calibration_id:calibration.id,kind:'area',points:[{x:0,y:0},{x:400,y:0},{x:400,y:400},{x:0,y:400}],name:'Outside opening',dimension:'floors',annotation:'Refused opening outside its parent',deduct_from:floor.id})).status,400);assert.equal(job.version,before)
  assert.equal((await post(`/takeoff/${sheet.id}/measure`,{revision_id:revision.id,calibration_id:calibration.id,kind:'area',points:[{x:50,y:250},{x:90,y:250},{x:90,y:300},{x:50,y:300}],name:'Duplicate stair opening',dimension:'floors',annotation:'Refused duplicate deduction',deduct_from:floor.id})).status,400)
  const fixtures=await measure(sheet.id,revision.id,undefined,'count',[{x:80,y:280},{x:170,y:280}],'Plumbing fixtures','fixtures')
  assert.equal((await post('/takeoff',{...upload,name:'A2 Laundry',page:2})).status,200);const laundry=job.takeoff[1],laundryRevision=laundry.revisions[0]
  assert.equal((await post(`/takeoff/${laundry.id}/calibrate`,{revision_id:laundryRevision.id,points:[{x:50,y:350},{x:150,y:350}],length:'10',unit:'ft'})).status,200);const laundryCalibration=job.takeoff[1].calibrations[0]
  const laundryFloor=await measure(laundry.id,laundryRevision.id,laundryCalibration.id,'area',[{x:50,y:250},{x:150,y:250},{x:150,y:350},{x:50,y:350}],'Laundry floor','floors')
  const input={template_id:template.id,as_of:'2026-10-20',measurement_ids:[wall.id,floor.id,fixtures.id,laundryFloor.id]}
  result=await post('/takeoff-estimate/preview',input);assert.equal(result.status,200);let preview=result.value.preview
  assert.deepEqual(preview.source.dimensions,{walls:'20.000000',floors:'280.000000',fixtures:'2.000000'})
  assert.equal(preview.source.measurements.find(m=>m.id===floor.id).gross_quantity,'200.000000');assert.equal(preview.source.measurements.find(m=>m.id===floor.id).net_quantity,'180.000000')
  assert.equal(preview.catalog.proposal.total_cents,131_200,'20 feet × $2 + (180 + 100) square feet × 110% × $4 + 2 fixtures × $20')
  assert.equal((await post('/takeoff-estimate/apply',{...input,digest:preview.digest},{token:agent})).status,403)
  assert.equal((await post('/takeoff-estimate/apply',{...input,digest:'unreviewed'})).status,409)
  assert.equal((await post('/takeoff-estimate/apply',{...input,digest:preview.digest})).status,200)
  let quote=structuredClone(job.quotes.at(-1));assert.equal(quote.takeoff_source.measurements[0].drawing.document.checksum,revision.document.checksum);assert.equal(quote.takeoff_source.assembly_snapshots.find(a=>a.id===assemblies.floors.id).revision.value.parts[0].waste_percent,'10')
  const replacement={...upload,document:{...upload.document,base64:takeoffPlan(true).toString('base64')}}
  assert.equal((await post(`/takeoff/${sheet.id}/revise`,replacement)).status,200);const revised=job.takeoff[0].revisions[1]
  assert.equal((await post('/takeoff-estimate/preview',input)).status,409,'A new drawing does not silently reuse prior calibration/measurements')
  assert.equal((await post(`/takeoff/${sheet.id}/measure`,{revision_id:revised.id,calibration_id:calibration.id,kind:'length',points:[{x:50,y:250},{x:290,y:250}],name:'Old calibration attempt',dimension:'walls',annotation:'Must be refused'})).status,400)
  assert.equal((await post(`/takeoff/${sheet.id}/calibrate`,{revision_id:revised.id,points:[{x:50,y:350},{x:250,y:350}],length:'20',unit:'ft'})).status,200);const calibration2=job.takeoff[0].calibrations.at(-1)
  const wall2=await measure(sheet.id,revised.id,calibration2.id,'length',[{x:50,y:250},{x:290,y:250}],'Revised kitchen walls','walls'),floor2=await measure(sheet.id,revised.id,calibration2.id,'area',[{x:50,y:250},{x:290,y:250},{x:290,y:350},{x:50,y:350}],'Revised kitchen floor','floors'),fixtures2=await measure(sheet.id,revised.id,undefined,'count',[{x:80,y:280},{x:170,y:280}],'Reconfirmed plumbing fixtures','fixtures')
  await measure(sheet.id,revised.id,calibration2.id,'area',[{x:50,y:250},{x:90,y:250},{x:90,y:300},{x:50,y:300}],'Reconfirmed stair opening','floors',floor2.id)
  const revisedInput={...input,measurement_ids:[wall2.id,floor2.id,fixtures2.id,laundryFloor.id]};result=await post('/takeoff-estimate/preview',revisedInput);assert.equal(result.status,200);preview=result.value.preview;assert.equal(preview.catalog.total_delta_cents,18_400);assert.deepEqual(preview.source.dimensions,{walls:'24.000000',floors:'320.000000',fixtures:'2.000000'});assert.deepEqual(preview.source.dimension_changes.find(c=>c.dimension==='floors'),{dimension:'floors',before:'280.000000',after:'320.000000',unit:'sq ft'})
  assert.equal((await post('/takeoff-estimate/apply',{...revisedInput,digest:preview.digest})).status,200)
  assert.deepEqual(job.quotes.find(q=>q.id===quote.id),{...quote,status:'superseded'})
  quote=job.quotes.at(-1);assert.equal((await post(`/quotes/${quote.id}/accept`,{method:'email',evidence:'Client accepted revised measured scope and exact quote',schedule_choice:{kind:'none',reason:'Schedule prepared separately'}})).status,200)
  const accepted=structuredClone(job.quotes.at(-1)),budget=structuredClone(job.budgets)
  assert.equal((await post(`/takeoff/${sheet.id}/revise`,upload)).status,200);const third=job.takeoff[0].revisions.at(-1)
  assert.equal((await post(`/takeoff/${sheet.id}/calibrate`,{revision_id:third.id,points:[{x:50,y:350},{x:250,y:350}],length:'20',unit:'ft'})).status,200);const calibration3=job.takeoff[0].calibrations.at(-1)
  const wall3=await measure(sheet.id,third.id,calibration3.id,'length',[{x:50,y:250},{x:250,y:250}],'Sold-job change walls','walls'),floor3=await measure(sheet.id,third.id,calibration3.id,'area',[{x:50,y:250},{x:250,y:250},{x:250,y:350},{x:50,y:350}],'Sold-job change floor','floors'),fixtures3=await measure(sheet.id,third.id,undefined,'count',[{x:80,y:280},{x:170,y:280}],'Sold-job fixtures','fixtures')
  const soldInput={...input,measurement_ids:[wall3.id,floor3.id,fixtures3.id,laundryFloor.id]};result=await post('/takeoff-estimate/preview',soldInput);assert.equal(result.status,200);assert.equal(result.value.preview.catalog.sold,true)
  assert.equal((await post('/takeoff-estimate/apply',{...soldInput,digest:result.value.preview.digest})).status,409)
  assert.deepEqual(job.quotes.at(-1),accepted);assert.deepEqual(job.budgets,budget);assert.equal(job.takeoff[0].revisions.length,3)
  const safe=(await f.json(`/api/plinth/jobs/${job.id}`,{cookie:client})).value.job;assert.equal(safe.takeoff,undefined);assert.ok(!JSON.stringify(safe).includes('takeoff_source'))
 }finally{await f.close()}
})

test('Reviewed completed-job lessons revise assemblies and templates only for new estimates and preserve historical costs',async()=>{
 const {performanceFixture,performanceAddress}=await import('./performance-support.mjs'),f=await createFixture({now:Date.parse('2026-10-27T15:00:00Z')})
 try{
  const c=await performanceFixture(f),first=c.jobs[0],second=c.jobs[1],history=structuredClone(first.job.quotes),before=(await c.call(`/jobs/${first.job.id}/costs`))
  const definition=structuredClone(c.assembly.revisions[0].value);definition.parts[0].productivity='4'
  const input={catalog_id:c.assembly.id,catalog_version:1,source_job_ids:[first.job.id,second.job.id],reason:'Two completed wall jobs support four feet per approved hour',value:definition}
  const proposed=await first.report('lessons',input),lesson=proposed.record
  assert.equal((await c.call('/estimate-catalog')).entries.find(e=>e.id===c.assembly.id).version,1)
  const approve=(body,cookie=f.owner)=>f.json(`/api/plinth/reports/performance/jobs/${first.job.id}/lessons/${lesson.id}/approve`,{method:'POST',cookie,body:{expected_version:first.job.version,...body}})
  assert.equal((await approve({confirm:false})).status,400)
  const agent=await f.agent();assert.equal((await f.json(`/api/plinth/reports/performance/jobs/${first.job.id}/lessons`,{method:'POST',token:agent,body:{expected_version:first.job.version,...input}})).status,403)
  const managerAddress=performanceAddress('lesson-manager'),manager=await f.invite(managerAddress,'Assigned lesson manager','admin'),managerId=(await c.call('/team')).team.find(p=>p.email===managerAddress).id;assert.equal((await f.json('/api/plinth/team/'+managerId,{method:'PUT',cookie:f.owner,body:{expected_version:0,role:'project_manager',job_ids:[first.job.id,second.job.id],po_limit_cents:0}})).status,200);assert.equal((await approve({confirm:true},manager)).status,403);const managerReport=await f.json('/api/plinth/reports/performance',{cookie:manager});assert.equal(managerReport.status,200);assert.deepEqual(managerReport.value.catalog,[]);assert.deepEqual(managerReport.value.lessons,[]);assert.equal(managerReport.value.can_propose,false);assert.equal((await f.json(`/api/plinth/reports/performance/jobs/${first.job.id}/lessons`,{method:'POST',cookie:manager,body:{expected_version:first.job.version,...input}})).status,403);assert.equal((await f.json(`/api/plinth/reports/performance/jobs/${first.job.id}/lessons/${lesson.id}/approve`,{method:'POST',token:agent,body:{expected_version:first.job.version,confirm:true}})).status,403);assert.equal((await c.call('/estimate-catalog')).entries.find(e=>e.id===c.assembly.id).version,1)
  const decisions=await Promise.all([approve({confirm:true}),approve({confirm:true})]);assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);const approved=decisions.find(r=>r.status===200);assert.equal(approved.status,200,JSON.stringify(approved.value));await first.read()
  assert.equal(approved.value.record.approved.catalog_version,2);assert.equal((await approve({confirm:true})).status,409)
  const catalog=(await c.call('/estimate-catalog')).entries.find(e=>e.id===c.assembly.id);assert.equal(catalog.revisions.length,2);assert.equal(catalog.revisions[0].value.parts[0].productivity,'5');assert.equal(catalog.revisions[1].value.parts[0].productivity,'4')
  assert.deepEqual(first.job.quotes,history);{const after=await c.call(`/jobs/${first.job.id}/costs`);assert.deepEqual(after,{...before,version:after.version})}
  const newer=c.jobs[3],request={template_id:c.template.id,as_of:'2026-10-20',dimensions:{walls:'10'}},preview=await newer.act('/estimate-template/preview',request)
  assert.equal(preview.preview.proposal.lines.find(l=>l.cost_code==='06-100').cost_total_cents,7500)
  const earlierDraft=structuredClone(newer.job.quotes.at(-1));await newer.act('/estimate-template/apply',{...request,digest:preview.preview.digest});assert.equal(newer.job.quotes.at(-1).cost_total_cents,8500);assert.deepEqual(newer.job.quotes.find(q=>q.id===earlierDraft.id),{...earlierDraft,status:'superseded'})
  assert.equal((await f.json(`/api/plinth/jobs/${first.job.id}/estimate-template/apply`,{method:'POST',cookie:f.owner,body:{expected_version:first.job.version,...request,digest:preview.preview.digest}})).status,409)
  const templateValue=structuredClone(c.template.revisions[0].value);templateValue.dimensions.walls='14'
  const templateLesson=(await first.report('lessons',{catalog_id:c.template.id,catalog_version:1,source_job_ids:[first.job.id,second.job.id],reason:'Reviewed default wall dimension for future estimates',value:templateValue})).record
  const staleVersion=first.job.version
  await second.act('/costs/sources',{kind:'time',reference:'synthetic-plinth-late-unapproved',employee_reference:'synthetic-plinth-worker-late',dated_on:'2026-10-24',period:'2026-10',cost_code:'06-100',minutes:10,hour_cents:3000,burden_bps:0},c.reviewer)
  const stale=await f.json(`/api/plinth/reports/performance/jobs/${first.job.id}/lessons/${templateLesson.id}/approve`,{method:'POST',cookie:f.owner,body:{expected_version:staleVersion,confirm:true}});assert.equal(stale.status,409)
  assert.equal((await c.call('/estimate-catalog')).entries.find(e=>e.id===c.template.id).version,1)
  const fresh=(await first.report('lessons',{catalog_id:c.template.id,catalog_version:1,source_job_ids:[first.job.id,second.job.id],reason:'Reviewed current completed source jobs',value:templateValue})).record
  const confirmed=await first.report(`lessons/${fresh.id}/approve`,{confirm:true});assert.equal(confirmed.record.approved.catalog_version,2)
  const revisedTemplate=(await c.call('/estimate-catalog')).entries.find(e=>e.id===c.template.id);assert.equal(revisedTemplate.revisions[1].value.dimensions.walls,'14');assert.equal(revisedTemplate.revisions[0].value.dimensions.walls,'10')
  const defaultPreview=await newer.act('/estimate-template/preview',{template_id:c.template.id,as_of:'2026-10-20'});assert.equal(defaultPreview.preview.proposal.cost_total_cents,11900)
  assert.deepEqual(first.job.quotes,history);{const after=await c.call(`/jobs/${first.job.id}/costs`);assert.deepEqual(after,{...before,version:after.version})}
  const audit=(await c.call(`/audit?job_id=${first.job.id}&q=estimate.performance.lessons.approve`)).events;assert.equal(audit.length,2);assert.ok(audit.every(e=>e.actor_role==='owner'&&e.subject_kind==='estimate_performance'));assert.ok(audit.some(e=>e.subject_id===lesson.id))
  const pending=(await first.report('lessons',{...input,catalog_version:2,reason:'Pending lesson awaiting a current catalog review'})).record;await c.call('/estimate-catalog/'+c.assembly.id,{expected_version:2,name:c.assembly.name,reason:'Separately reviewed catalog change',value:{...definition,parts:definition.parts.map((p,i)=>i===0?{...p,productivity:'3'}:p)}});const rejected=await f.json(`/api/plinth/reports/performance/jobs/${first.job.id}/lessons/${pending.id}/approve`,{method:'POST',cookie:f.owner,body:{expected_version:first.job.version,confirm:true}});assert.equal(rejected.status,409);assert.equal(rejected.value.error,'stale_catalog');assert.equal((await c.call('/estimate-catalog')).entries.find(e=>e.id===c.assembly.id).version,3)
 }finally{await f.close()}
})

test('Measured kitchen layouts retain sources and revisions, export dimensions and adopt reviewed drafts without changing signed economics',async()=>{
 const {seedRoomLayout,layoutEmail,layoutPng}=await import('./room-layout-support.mjs'),{createActiveJob}=await import('./helpers.mjs'),f=await createFixture({now:Date.parse('2026-10-28T15:00:00Z')})
 try{
  const client=await f.invite(layoutEmail('layout-client')),admin=await f.invite(layoutEmail('layout-admin'),'Layout administrator','admin'),agent=await f.agent()
  const c=await seedRoomLayout(f,await createActiveJob(f,'Measured kitchen contract',layoutEmail('layout-client'),100000),{client}),root=c.root+'/room-layouts/'+c.layout.id
  assert.equal(c.layout.revisions.length,1);const first=structuredClone(c.layout.revisions[0]),economics=structuredClone(c.job)
  const model=await f.json(root+'/'+first.id+'/model.json',{cookie:f.owner});assert.equal(model.status,200);assert.equal(model.value.measures.area_m2,12);assert.equal(model.value.measures.perimeter_m,14);assert.deepEqual(model.value.measures.walls.map(w=>w.net_run_m),[3.1,3,2.8,3])
  for(const [u,bytes] of c.layout.underlays.map((u,i)=>[u,i?layoutPng:c.original])){const download=await f.request(root+'/files/'+u.document.id,{cookie:f.owner});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes)}
  for(const cookie of [client,admin])for(const path of [root.split('/').slice(0,-1).join('/'),root+'/'+first.id+'/model.json',root+'/'+first.id+'/drawing.pdf',root+'/files/'+c.layout.underlays[0].document.id])assert.equal((await f.request(path,{cookie})).status,403)
  assert.equal((await f.request(root+'/'+first.id+'/model.json',{token:agent})).status,403)
  const snapshot=structuredClone(c.job)
  assert.equal((await c.act('/room-layouts/'+c.layout.id+'/revise',{...c.g,base_revision_id:first.id},{cookie:client})).status,403)
  assert.equal((await c.act('/room-layouts/'+c.layout.id+'/revise',{...c.g,base_revision_id:'synthetic-plinth-stale'})).status,409)
  assert.equal((await c.act('/room-layouts/'+c.layout.id+'/revise',{...c.g,base_revision_id:first.id,reconstructed:false})).status,400)
  const crossing=[{x:0,y:0},{x:4,y:3},{x:4,y:0},{x:0,y:3}];assert.equal((await c.act('/room-layouts/'+c.layout.id+'/revise',{...c.g,points:crossing,base_revision_id:first.id})).status,400)
  assert.equal((await c.act('/room-layouts/'+c.layout.id+'/revise',{...c.g,openings:[{...c.g.openings[0],width:9}],base_revision_id:first.id})).status,400)
  await c.read();assert.deepEqual(c.job,snapshot,'Refused edits leave job history and sources unchanged')
  const preview1=(await c.act('/room-layouts/'+c.layout.id+'/preview',{revision_id:first.id})).value
  const moved={...c.g,points:[{x:0,y:0},{x:5,y:0},{x:5,y:3},{x:0,y:3}],reason:'Move east wall one metre after field review'}
  await c.ok('/room-layouts/'+c.layout.id+'/revise',{...moved,base_revision_id:first.id});await c.refresh();const second=c.layout.revisions[1]
  assert.deepEqual(c.layout.revisions[0],first);const review=await c.act('/room-layouts/'+c.layout.id+'/preview',{revision_id:second.id});assert.equal(review.status,200)
  assert.equal(review.value.comparison.before.area_m2,12);assert.equal(review.value.comparison.after.area_m2,15);assert.equal(review.value.comparison.after.perimeter_m,16);assert.equal(review.value.comparison.area_change_m2,3);assert.deepEqual(review.value.comparison.wall_changes.map(w=>[w.before,w.after]),[[4,5],[3,3],[4,5],[3,3]])
  assert.equal(review.value.comparison.selection_changes[0].source_status,'signed')
  assert.equal((await c.act('/room-layouts/'+c.layout.id+'/adopt',{revision_id:second.id,digest:preview1.digest,confirm:true})).status,409)
  const pdfResponse=await f.request(root+'/'+second.id+'/drawing.pdf',{cookie:f.owner});assert.equal(pdfResponse.status,200);const pdfBytes=new Uint8Array(await pdfResponse.arrayBuffer());const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),pdf=await getDocument({data:pdfBytes,useSystemFonts:true}).promise;try{const page=await pdf.getPage(1),text=(await page.getTextContent()).items.map(i=>i.str).join(' ');assert.match(text,/Area 15 sq m; perimeter 16 m/);assert.match(text,/W1: 5 m/);assert.match(text,/door 0.9 x 2.1 m/);assert.match(text,/Oak base cabinet 0.9 x 0.6 m/);assert.ok((await page.getOperatorList()).fnArray.length>40,'Export contains actual vector drawing commands')}finally{await pdf.loadingTask.destroy()}
  const noEffects=structuredClone(c.job);await c.ok('/room-layouts/'+c.layout.id+'/adopt',{revision_id:second.id,digest:review.value.digest,confirm:true});await c.refresh()
  assert.deepEqual(c.job.quotes,economics.quotes);assert.deepEqual(c.job.budgets,economics.budgets);assert.deepEqual(c.job.selections[0],economics.selections[0]);assert.equal(c.job.selections.at(-1).revisions[0].status,'draft');assert.equal(c.job.takeoff.at(-1).measurements[0].kind,'area');assert.equal(c.layout.adoptions[0].selection_ids.length,1)
  assert.deepEqual(c.job.orders,noEffects.orders);assert.deepEqual(c.job.schedules,noEffects.schedules);assert.equal((await c.act('/room-layouts/'+c.layout.id+'/adopt',{revision_id:second.id,digest:review.value.digest,confirm:true})).status,409)
  const portable=(await f.json(root+'/'+second.id+'/model.json',{cookie:f.owner})).value
  await c.ok('/room-layouts/'+c.layout.id+'/import',{model:portable,base_revision_id:second.id,reason:'Owner reviewed portable round trip',reconstructed:true});await c.refresh();const third=c.layout.revisions[2];assert.deepEqual(third.points,second.points);assert.deepEqual(third.openings,second.openings);assert.deepEqual(third.placements,second.placements)
  const foreign=await createActiveJob(f,'Independent second job',layoutEmail('second-layout'));assert.equal((await f.request('/api/plinth/jobs/'+foreign.id+'/room-layouts/'+c.layout.id+'/'+third.id+'/model.json',{cookie:f.owner})).status,404)
  const clientJob=(await f.json(c.root,{cookie:client})).value.job;assert.ok(!JSON.stringify(clientJob).includes('room-layout'));assert.equal(clientJob.room_layouts,undefined)
  const revoked=await f.json('/api/plinth/agent-credentials',{cookie:f.owner});const credential=revoked.value.credentials[0];assert.equal((await f.json('/api/plinth/agent-credentials/'+credential.id+'/revoke',{method:'POST',cookie:f.owner,body:{}})).status,200);assert.equal((await f.request(root+'/'+third.id+'/drawing.pdf',{token:agent})).status,401)
  await c.read();const deleted=await f.request(c.root,{method:'DELETE',cookie:f.owner,body:{expected_version:c.job.version}});assert.equal(deleted.status,200);assert.equal((await f.request(root+'/'+third.id+'/model.json',{cookie:f.owner})).status,404);assert.equal((await f.request(root+'/files/'+c.layout.underlays[0].document.id,{cookie:f.owner})).status,404)
 }finally{await f.close()}
})
