import { rejectedResponse } from './base/rejected-response'
import { createDependencies } from './modules/dependencies/index.mjs'
import { createIdpOwnerClaimHandler, createOwnerClaimHandler } from './modules/owner-claim/index.mjs'
import { firstRunResponse } from './base/setup'
import { fontDocumentResponse } from './base/font-response'
import { createOperatorAuth, createAuthHandler, createSignInHandler, type AuthConfig } from './modules/operator-auth/index.mjs'
import { operatorMail } from './mail.server.mjs'
import branding from './branding.json'

// The edition's declared theme (public/rer-theme.css), as Base frames link it.
const theme = { href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor }

export interface Bindings {
 DB: D1Database
 /** Built browser files; hosted deploys run the Worker first (staticAssetResponse). */
 ASSETS?: Fetcher
 RER_DEMO?: string
 RER_OWNER_CLAIM_PUBLIC_KEYS?: string
 RER_OWNER_CLAIM_ISSUER?: string
 RER_OWNER_CLAIM_INSTALLATION_ID?: string
 RER_DEPLOY_SOURCE?: string
 RER_DEPLOY_FINGERPRINT?: string
 RER_VERSION?: { id: string }
 IDENTITY_PROVIDER?: string
 AUTH_ORIGIN: string
 AUTH_LOCAL?: string
 RER_DEV_ORIGIN?: string
 /** Local runtimes only: the checkout's key gate and dev identity switch. Deploy refuses both. */
 RER_MODELS_SERVICE?: string
 RER_MODELS_KEY?: string
 RER_DEV_KEY?: string
 RER_DEV_IDENTITY?: string
 RER_INSTALLATION_ID?: string
 RER_MANAGEMENT_ORIGIN?: string
 OWNER_EMAIL: string
 SESSION_SECRET: string
 INSTALLATION_KEY?: string
 INSTALLATION_KEY_PREVIOUS?: string
 SETUP_TOKEN?: string
 MAIL_PROVIDER?: 'development' | 'resend' | 'sendgrid' | 'cloudflare'
 MAIL_FROM?: string
 MAIL_API_KEY?: string
 MAIL_ACCOUNT_ID?: string
}

export const runtimeBindings = (env: Bindings): Bindings => env.RER_DEV_ORIGIN && env.AUTH_LOCAL === 'true' ? { ...env, AUTH_ORIGIN: env.RER_DEV_ORIGIN } : env
export const authConfig = (env: Bindings): AuthConfig => ({ dependencies: true, origin: env.AUTH_ORIGIN, local: env.AUTH_LOCAL === 'true', OWNER_EMAIL: env.OWNER_EMAIL, SESSION_SECRET: env.SESSION_SECRET, INSTALLATION_KEY: env.INSTALLATION_KEY, INSTALLATION_KEY_PREVIOUS: env.INSTALLATION_KEY_PREVIOUS, SETUP_TOKEN: env.SETUP_TOKEN, MAIL_FROM: env.MAIL_FROM, branding: { productName: branding.name, accentColor: branding.primaryColor, signInPath: '/signin', theme: theme.href } })
export function operatorAuth(env: Bindings) {
 return createOperatorAuth({ db: env.DB, config: authConfig(env), mailSender: operatorMail(env), clientIp: request => request.headers.get('CF-Connecting-IP') ?? '' })
}

const privateHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' }
/** ROLE-001: a project manager is a Base administrator narrowed by Plinth, so Base's people and access routes refuse them. */
const peopleRoutes = ['/auth/invite', '/auth/invite/cancel', '/auth/operators', '/auth/operator/status', '/auth/operator/role']
async function projectManager(request: Request, env: Bindings) {
 const session = await operatorAuth(env).getSession(request)
 return session?.operator.role === 'admin' && !!await env.DB.prepare('SELECT 1 AS ok FROM pl_team WHERE operator_id=?').bind(session.operator.id).first()
}
async function handleAuthResponse(request: Request, original: Bindings): Promise<Response | null> {
 const env = runtimeBindings(original), url = new URL(request.url)
 if (url.pathname.startsWith('/.well-known/rer-') || url.pathname.startsWith('/auth/dependencies/')) {
  const linked = await createDependencies({ db: env.DB, origin: env.AUTH_ORIGIN, name: branding.name, provider: env.IDENTITY_PROVIDER, local: env.AUTH_LOCAL === 'true', INSTALLATION_KEY: env.INSTALLATION_KEY, INSTALLATION_KEY_PREVIOUS: env.INSTALLATION_KEY_PREVIOUS, auth: operatorAuth(env), claimOwner: token => createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:()=>request.headers.get('CF-Connecting-IP')??''})(new Request(env.AUTH_ORIGIN+'/auth/owner-claim',{method:'POST',headers:{Host:new URL(env.AUTH_ORIGIN).host,Origin:env.AUTH_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({token})})) }).handle(request)
  if (linked) return linked
 }
 if (url.pathname === '/auth/owner-claim' && env.RER_OWNER_CLAIM_PUBLIC_KEYS) return createOwnerClaimHandler({ db: env.DB, authConfig: authConfig(env), clientIp: req => req.headers.get('CF-Connecting-IP') ?? '', issuer: env.RER_OWNER_CLAIM_ISSUER ?? '', installationId: env.RER_OWNER_CLAIM_INSTALLATION_ID ?? '', appOrigin: env.AUTH_ORIGIN, expectedEmail: env.OWNER_EMAIL, publicKeys: JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS) })(request)
 if (url.pathname === '/auth/owner-claim') return createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:req=>req.headers.get('CF-Connecting-IP')??''})(request)
 // The shared server-rendered sign-in page: plain forms that work before any script.
 if (url.pathname === '/signin') {
  const page = await createSignInHandler(operatorAuth(env), {
   defaultReturnTo: '/setup',
  })(request)
  if (page) return fontDocumentResponse(page)
 }
 if (peopleRoutes.includes(url.pathname) && await projectManager(request, env)) return Response.json({ error: 'forbidden', message: 'Project managers do not manage people or access' }, { status: 403, headers: privateHeaders })
 if (url.pathname.startsWith('/auth/')) return fontDocumentResponse(await createAuthHandler(operatorAuth(env))(request))
 if (url.pathname === '/setup' || url.pathname === '/app' || url.pathname.startsWith('/app/')) {
  const setup = await firstRunResponse(request, env, operatorAuth(env), { theme })
  if (setup) return setup
 }
 if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
  const session = await operatorAuth(env).getSession(request)
  if (!session) return new Response(null, { status: 303, headers: { ...privateHeaders, location: '/signin' } })
 }
 return null
}

export async function authResponse(request: Request, original: Bindings): Promise<Response | null> {
 const response = await handleAuthResponse(request, original)
 return response ? rejectedResponse(request, response) : null
}
