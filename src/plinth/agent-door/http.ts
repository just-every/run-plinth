/** Legacy versioned SDK credentials retain their explicit connector purpose.
 * Business and local agent calls use the single MCP policy pipeline. */
export function agentHttpBoundary(request:Request):Response|null {
 const path=new URL(request.url).pathname
 if(!path.startsWith('/api/plinth/')||path.startsWith('/api/plinth/v1/')||!/^Bearer\s/i.test(request.headers.get('authorization')??''))return null
 return Response.json({code:'agent_door_required',resource:'/mcp'},{status:401,headers:{'cache-control':'no-store','www-authenticate':`Bearer resource_metadata="${new URL(request.url).origin}/.well-known/oauth-protected-resource/mcp"`}})
}
