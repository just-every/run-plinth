import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { unstable_splitSqlQuery } from 'wrangler'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
const root=fileURLToPath(new URL('../../',import.meta.url))
let bundle
async function worker(){return bundle??=build({stdin:{contents:`import {authResponse} from './src/auth.server.ts'; import {plinthResponse} from './src/plinth/http.ts'; import {importResponse} from './src/plinth/imports.ts'; export default {async fetch(request,env){return await authResponse(request,env) ?? await importResponse(request,env) ?? await plinthResponse(request,env) ?? new Response('Not found',{status:404})}}`,resolveDir:root,sourcefile:'plinth-integration.ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:*','cloudflare:*'],logLevel:'silent'}).then(r=>r.outputFiles[0].text)}
/** Real Worker, native authentication, provider-edge mail and migrated D1; no application fakes. */
export async function createFixture({persistTo,ownerCookie}={}){
 const messages=[]
 const outboundService=async request=>{assert.equal(request.url,'https://api.resend.com/emails');messages.push(await request.json());return Response.json({id:crypto.randomUUID()})}
 const savedPort=/^operator_session_local_(\d+)=/.exec(ownerCookie??'')?.[1]
 let port=savedPort?Number(savedPort):undefined
 if(!port){const socket=createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve)});port=socket.address().port;await new Promise((resolve,reject)=>socket.close(error=>error?reject(error):resolve()))}
 const origin=`http://127.0.0.1:${port}`,mf=new Miniflare({...convertV4MiniflareOptions({outboundService,host:'127.0.0.1',port,modules:true,script:await worker(),compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:persistTo?{DB:'local-foundation-only'}:['DB'],...(persistTo?{d1Persist:join(persistTo,'.wrangler/state/v3/d1')}:{}),bindings:{AUTH_ORIGIN:origin,AUTH_LOCAL:'true',OWNER_EMAIL:'builder@example.com',SESSION_SECRET:'test-session-secret-for-plinth-integration-only-2026',SETUP_TOKEN:'synthetic-fixture-bootstrap-token-for-integration-only',MAIL_PROVIDER:'resend',MAIL_API_KEY:'test-provider-edge-only',MAIL_FROM:'noreply@example.com'}}),...(persistTo?{resourcePersistencePath:join(persistTo,'.wrangler/state/v3')}:{})})
 try {
 const db=await mf.getD1Database('DB')
 if(!persistTo)for(const file of (await readdir(new URL('../../migrations/core/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){const statements=unstable_splitSqlQuery(await readFile(new URL('../../migrations/core/'+file,import.meta.url),'utf8')).filter(sql=>sql.replace(/--[^\n]*/g,'').trim());if(statements.length)await db.batch(statements.map(sql=>db.prepare(sql)))}
 await mf.ready
 const request=async(path,{method='GET',body,cookie,token,headers={}}={})=>fetch(origin+path,{method,redirect:'manual',headers:{host:new URL(origin).host,'cf-connecting-ip':'127.0.0.1',...(method!=='GET'?{origin,'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(token?{authorization:'Bearer '+token}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})})
 let owner=ownerCookie
 if(!owner){const bootstrap=await request('/auth/bootstrap',{method:'POST',body:{token:'synthetic-fixture-bootstrap-token-for-integration-only',displayName:'Builder',returnTo:'/app'}});const diagnostic=bootstrap.status===303?'':(await bootstrap.clone().json()).error;assert.equal(bootstrap.status,303,`Native fixture bootstrap succeeds (${diagnostic})`);owner=bootstrap.headers.get('set-cookie').split(';')[0]}
 async function mailToken(email){const message=[...messages].reverse().find(m=>m.to.includes(email));assert.ok(message,'Provider edge receives the sign-in email');const match=message.text.match(/https?:\/\/[^\s<>]+/g)?.map(x=>{try{return new URL(x)}catch{return null}}).find(u=>u?.pathname==='/auth/confirm');assert.ok(match,'Native email contains confirmation link');return match.searchParams.get('token')}
 async function invite(email,name='Client'){const response=await request('/auth/invite',{method:'POST',cookie:owner,body:{email,displayName:name,role:'member',returnTo:'/app'}});assert.equal(response.status,202,'Native invitation succeeds');const token=await mailToken(email);const confirmation=await request('/auth/confirm',{method:'POST',body:{token}});assert.equal(confirmation.status,303,'Native invitation confirmation succeeds');return confirmation.headers.get('set-cookie').split(';')[0]}
 async function agent(){let response=await request('/auth/step-up',{method:'POST',cookie:owner,body:{action:'credentials:mint',returnTo:'/app'}});assert.equal(response.status,202,'Native step-up starts');const token=await mailToken('builder@example.com');response=await request('/auth/confirm',{method:'POST',cookie:owner,body:{token}});assert.equal(response.status,303,'Native step-up completes');response=await request('/api/plinth/agent-credentials',{method:'POST',cookie:owner,body:{expires_in_seconds:3600}});assert.equal(response.status,201,'Native credential mint succeeds');return (await response.json()).credential.token}
 async function json(path,options={}){const response=await request(path,options);const value=await response.json();return {status:response.status,value}}
 return {mf,db,origin,request,json,owner,invite,agent,close:()=>mf.dispose()}
 } catch(error) { await mf.dispose();throw error }
}
export async function createActiveJob(f,name='Kitchen renovation',client_email='client@example.com',total=1_000_000){let r=await f.json('/api/plinth/jobs',{method:'POST',cookie:f.owner,body:{name,client_email,address:'22 Example Street'}});assert.equal(r.status,201);let job=r.value.job;r=await f.json(`/api/plinth/jobs/${job.id}/quotes`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,lines:[{description:'Agreed renovation works including GST',quantity:1,unit_cents:total}]}});assert.equal(r.status,200);job=r.value.job;r=await f.json(`/api/plinth/jobs/${job.id}/quotes/${job.quotes[0].id}/accept`,{method:'POST',cookie:f.owner,body:{expected_version:job.version,method:'signed',evidence:'Signed quote returned by the client'}});assert.equal(r.status,200);return r.value.job}
