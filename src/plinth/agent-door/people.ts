import { operatorAuthPeople, type PeopleAdapter, type Person } from '../../modules/agent-door/index.ts'
import { authConfig, operatorAuth, type Bindings } from '../../auth.server'

/** Keep Business policy roles distinct from local operator promotions. */
export function people(env:Bindings,paired:boolean):PeopleAdapter {
 const auth=operatorAuth(env),native=operatorAuthPeople({db:env.DB,allowList:authConfig(env).allowList,session:request=>auth.getSession(request)})
 const roles=new WeakMap<Person,'owner'|'editor'|null>()
 const current=async(person:Person|null)=>{
  if(person)roles.set(person,paired?(await native.businessMember!(person))?.role??null:person.role==='owner'?'owner':person.role==='admin'?'editor':null)
  return person
 }
 return {person:async id=>current(await native.person(id)),sponsor:async claims=>current(await native.sponsor(claims)),session:async request=>current(await native.session(request)),businessMember:person=>native.businessMember!(person),businessRole:person=>roles.get(person)??null}
}
