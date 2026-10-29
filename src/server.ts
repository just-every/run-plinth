import { agentHttpBoundary } from './plinth/agent-door/http'
import { plinthAgentDoor } from './plinth/agent-door/index'
import { plinthScheduled } from './plinth/scheduled'
import { withDemo } from './modules/demo/index.mjs'
import { seedDemo } from './demo'
import { rejectedResponse } from './base/rejected-response'
import start from '@tanstack/react-start/server-entry'
import { Hono } from 'hono'
import { dispatch } from './base/dispatch'
import { staticAssetResponse } from './base/static-assets'
import { deploymentHealth } from './base/deployment-health'
import { lobbyResponse } from './base/lobby'
import { setupStateResponse } from './base/setup-state'
import { authResponse, businessSettings, runtimeBindings, type Bindings } from './auth.server'
import { identity } from './identity'
import { plinthResponse } from './plinth/http'
import { importResponse } from './plinth/imports'
import { plinthEmail } from './plinth/mail-inbound'

const api = new Hono<{ Bindings: Bindings }>()
api.get('/health', (context) => context.json({ status: 'ok', ...deploymentHealth(context.env) }))

// Start documents keep their own cache policy and add no-transform, so no proxy
// rewrites the HTML React hydrates (Cloudflare's email address obfuscation
// honours it; src/base/hydration/README.md).
function noTransform(response: Response): Response {
  const headers = new Headers(response.headers), policy = headers.get('cache-control')
  headers.set('cache-control', policy ? `${policy}, no-transform` : 'no-transform')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

async function response(request: Request, env: Bindings, execution: ExecutionContext): Promise<Response> {
  const door = await plinthAgentDoor(env).handle(request)
  if (door) return door
  const business = await businessSettings(runtimeBindings(env)).handle(request)
  if (business) return business
  const asset = await staticAssetResponse(request, env)
  if (asset) return asset
  const auth = await authResponse(request, env)
  if (auth) return auth
  const agentBoundary = agentHttpBoundary(request)
  if (agentBoundary) return agentBoundary
  const imports = await importResponse(request, runtimeBindings(env))
  if (imports) return imports
  const product = await plinthResponse(request, runtimeBindings(env))
  if (product) return product
  // The installed variant: the Lobby at / and the public claim state it reads.
  // Local dev serves the saved origin's data at its own port (RER_DEV_ORIGIN).
  const state = await setupStateResponse(request, runtimeBindings(env))
  if (state) return state
  const lobby = await lobbyResponse(request, runtimeBindings(env), identity)
  if (lobby) return lobby
  return dispatch(request, () => api.fetch(request, env, execution), async () => noTransform(await start.fetch(request)))
}

export default withDemo({
  scheduled: plinthScheduled,
  // Cloudflare Email Routing delivers a client's reply here; the handler stores only replies to a message it sent.
  email: (message, env) => plinthEmail(message, runtimeBindings(env)),
  async fetch(request, env, execution) {
    // All routes can refuse before reading an upload, including agent and
    // product doors. Finish it before workerd releases the HTTP connection.
    return rejectedResponse(request, await response(request, env, execution))
  },
} satisfies ExportedHandler<Bindings>, { seed: seedDemo })
