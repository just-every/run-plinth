import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { personActor } from '../auth'
import { nativeVendors } from '../vendors'
import { nativePlinth } from '../http'
import { DomainError, need, type Actor } from '../model'
import { roleGate } from '../role-gate'
import { ToolRefusal, type Person, type ToolContext } from '../../modules/agent-door/index.ts'

/** A door principal is a current native person, never a manufactured session. */
export async function actor(env: Bindings, person: Person, path: string, method = 'GET', ctx?: ToolContext): Promise<Actor> {
 const row = await env.DB.prepare("SELECT id,email,display_name AS displayName,role,version FROM oa_operators WHERE id=? AND status='active'").bind(person.id).first<{id:string;email:string;displayName:string;role:string;version:number}>()
 if (!row) throw new ToolRefusal('unauthenticated')
 const request = new Request(env.AUTH_ORIGIN + '/api/plinth/' + path, { method })
 const native = await personActor(env.DB, row, { method, path: new URL(request.url).pathname }, undefined, request)
 roleGate(native, request)
 if (method !== 'GET' && !['owner','admin','project_manager','estimator','superintendent'].includes(native.role)) throw new ToolRefusal('forbidden')
 const state = await env.DB.prepare('SELECT envelope,local_document FROM agent_door_state WHERE id=1 AND local_paused=0').first<{envelope:string|null;local_document:string|null}>()
 const settings = await env.DB.prepare('SELECT rev FROM bs_settings WHERE singleton=1 AND stopped=0').first<{rev:number}>()
 return { ...native, agent_native_role:native.role, role: native.role === 'member' ? 'member' : 'agent', ...(ctx ? { agent_door: { agent:ctx.agent, sponsor_role:native.role, operator_role:row.role, envelope:state?.envelope??null, local_document:state?.local_document??null, business_revision:env.RER_BUSINESS_TRUST ? settings?.rev??0 : null } } : {}) }
}

export async function nativeCall(env: Bindings, person: Person, path: string, method = 'GET', input?: Record<string,unknown>, ctx?: ToolContext) {
 try {
  const current = await actor(env,person,path,method,ctx)
  const request = new Request(env.AUTH_ORIGIN + '/api/plinth/' + path, {method,headers:{Origin:env.AUTH_ORIGIN,'Content-Type':'application/json'}, ...(method==='GET'?{}:{body:JSON.stringify(input??{})})})
  const response = path==='vendors'||path.startsWith('vendors/') ? await nativeVendors(request,env,current) : await nativePlinth(request,env,current)
  const value = await response.json() as Record<string,unknown>
  if (!response.ok) throw new ToolRefusal(String(value.error??'refused'))
  return value
 } catch (error) {
  if (error instanceof DomainError) throw new ToolRefusal(error.code,error.message)
  throw error
 }
}

/** No installation, connector or provider credential is part of a business record result. */
export function safe(value: unknown): unknown {
 if(Array.isArray(value)) return value.map(safe)
 if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([key])=>!/(?:password|secret|bearer|credential|token|signing_key|private_key)/i.test(key)).map(([key,item])=>[key,safe(item)]))
 if(typeof value==='string') return value.replace(/\bBearer\s+\S+/gi,'[credential removed]').replace(/https?:\/\/[^\s<>"']+/g,raw=>{try{const u=new URL(raw);u.username='';u.password='';u.search='';u.hash='';return u.href}catch{return '[link removed]'}})
 return value
}
export async function nativeVersion(env: Bindings, person: Person, id: string) {
 const value=await nativeCall(env,person,'jobs/'+encodeURIComponent(id))
 return (value.job as {version:number}).version
}
