import assert from 'node:assert/strict'
import {handoverDocument} from '../fixtures/handover-document.mjs'

export async function portfolioAward(f,c){
 const api=async(path,body,cookie=f.owner)=>{
  const result=await f.json('/api/plinth'+path,{cookie,...(body===undefined?{}:{method:'POST',body})})
  assert.ok(result.status===200||result.status===201,`${path}: ${JSON.stringify(result.value)}`)
  return result.value
 }
 const contacts=[]
 // Comparisons require two genuine responses; each contact has its own released scope.
 for(let n=0;n<2;n++){
  const contactId=`synthetic-plinth-portfolio-${n}`
  const email=contactId+'@example.com',cookie=await f.invite(email,'Synthetic framing bidder')
  const {vendor}=await api('/vendors',{kind:'subcontractor',name:contactId,trades:['Framing'],contacts:[{id:contactId,name:'Synthetic framing bidder',email}]})
  await api(`/vendors/${vendor.id}/qualifications`,{expected_version:vendor.version,trade:'Framing',status:'qualified',evidence:'Synthetic reviewed framing qualification'})
  const {record:scope}=await c.ok('/subcontracts',{vendor_id:vendor.id,trade:'Framing',scope:'Synthetic existing contact scope',contact_ids:[contactId],awarded_on:'2026-10-28'})
  await c.ok(`/subcontracts/${scope.id}/release`)
  contacts.push({contactId,cookie,vendorId:vendor.id,scopeId:scope.id})
 }
 let bidSource=(await api(`/bids/${c.job.id}`)).source
 const bidAct=async(path,body,cookie=f.owner)=>{
  const result=await api(`/bids/${c.job.id}${path}`,{expected_version:bidSource.version,...body},cookie)
  bidSource=result.source
  return result
 }
 const pdf={name:'synthetic-plinth-portfolio.pdf',base64:handoverDocument('Synthetic portfolio framing plan').toString('base64')}
 const created=await bidAct('',{title:'Synthetic portfolio framing package',trade:'Framing',scope:'Coded framing package',mode:'unpriced',lines:[{cost_code:'06-100',description:'Framing package'}],note:'Reviewed framing plan',due_on:'2099-12-31',plans:[pdf]})
 const packageId=created.record_id,revisionId=bidSource.bids.find(b=>b.id===packageId).revisions[0].id
 await bidAct(`/${packageId}/publish`,{revision_id:revisionId,confirm:true})
 for(const [n,contact] of contacts.entries()){
  await bidAct(`/${packageId}/invite`,{vendor_id:contact.vendorId,contact_id:contact.contactId,subcontract_id:contact.scopeId,cost_codes:['06-100'],confirm:true})
  await bidAct(`/${packageId}/acknowledge`,{revision_id:revisionId},contact.cookie)
  await bidAct(`/${packageId}/respond`,{revision_id:revisionId,items:[{cost_code:'06-100',description:'Complete framing package',amount_cents:120000+n*10000}],exclusions:'None',attachments:[pdf]},contact.cookie)
 }
 let source=(await api(`/bid-comparisons/${c.job.id}`)).source
 const comparisonAct=async(path,body)=>{
  const result=await api(`/bid-comparisons/${c.job.id}${path}`,{expected_version:source.version,...body})
  source=result.source
  await c.read()
  return result
 }
 const comparisonId=(await comparisonAct('',{package_id:packageId,title:'Synthetic portfolio cost comparison'})).record_id
 const comparison=source.comparisons.find(row=>row.id===comparisonId)
 for(const candidate of comparison.candidates){
  await comparisonAct(`/${comparisonId}/review`,{
   candidate_id:candidate.id,response_id:candidate.response.id,confirm:true,
   lines:[{cost_code:'06-100',quantity:'1',unit:'lot',allowance_cents:0,tax_cents:0,scope:'included',original_note:'Complete original framing price',normalized_cents:candidate.response.total_cents,normalization_note:'Original scope directly comparable',evidence:[{kind:'price_line',cost_code:'06-100'}]}],
   duration_days:5,alternates:[],exclusions:'None',note:'Human reviewed original price line'
  })
 }
 const reviewed=source.comparisons.find(row=>row.id===comparisonId)
 const candidate=reviewed.candidates.find(row=>row.response.total_cents===120000)
 const review=reviewed.reviews.find(row=>row.candidate_id===candidate.id)
 await comparisonAct(`/${comparisonId}/award`,{
  candidate_id:candidate.id,review_id:review.id,amount_cents:120000,confirm:true,acknowledge_missing_scope:true,
  decision:'Reviewed original framing scope replaces planned allocation',terms_reference:'Reviewed original bid price line',award_scope:'Synthetic portfolio framing award',awarded_on:'2026-10-28',
  budget_allocations:[{cost_code:'06-100',amount_cents:80000,expected_cost_cents:100000}]
 })
 const award=source.awards.find(row=>row.comparison_id===comparisonId&&!row.cancelled)
 return {cancel:async()=>{
  source=(await api(`/bid-comparisons/${c.job.id}`)).source
  await comparisonAct(`/${comparisonId}/cancel`,{award_id:award.id,subcontract_id:award.subcontract_id,confirm:true,reason:'Reviewed cancellation before release'})
 }}
}
