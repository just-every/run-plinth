import { rejectedResponse } from './rejected-response'
// The Lobby: what an installed instance serves at / when its edition identity
// says installedHome: 'lobby'. A centred lockup, one line, one button and the
// seed's floor art. Claimed, the button is Sign in; before the owner's claim it
// is Finish setup. It reveals nothing but that state, is the same for every
// visitor and works without JavaScript. Visual authority: the 12ui Lobby.
// Plinth supplies the entry card and low terrazzo floor band.
import { checkIdentity, deploymentLine, type EditionIdentity } from './identity'
import { admitted, baseFirstRun, setupState, type ClaimRead, type SetupState } from './setup-state'
import { ink } from './theme-frame'

interface LobbyBindings { DB: D1Database; AUTH_ORIGIN: string }

// Every colour, face and radius is the seed's declared --rer-* token, each with
// a readable neutral when the theme cannot load.
const STYLE = `
*,*::before,*::after{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{background:var(--paper);color:var(--ink);font-family:var(--rer-font-body);font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
.door{position:relative;min-height:100vh;min-height:100dvh;isolation:isolate;display:grid;place-items:center;padding:64px 20px 180px}
.door-art{position:absolute;left:24px;right:24px;bottom:48px;height:80px;max-width:1240px;margin:0 auto;overflow:hidden;border-radius:10px;pointer-events:none;z-index:-1;box-shadow:0 24px 48px -24px #00000033}.door-art img{width:100%;height:100%;display:block;object-fit:cover;object-position:center bottom}.door-art::after{content:"";position:absolute;inset:0;box-shadow:inset 0 -10px 0 #0000000F}
.door-card{display:flex;flex-direction:column;align-items:center;text-align:center;width:100%;max-width:580px;background:var(--card);border:1px solid var(--rule);border-radius:14px;padding:40px 32px;box-shadow:var(--card-shadow)}
h1{margin:0;font-size:30px;font-weight:800;line-height:1}.lockup{display:inline-flex;flex-direction:column;align-items:center;gap:10px;max-width:100%;color:var(--ink);text-decoration:none}.mark{width:54px;height:36px;display:block}.word{font-family:var(--rer-font-heading);font-weight:800;letter-spacing:-.03em}
.line{margin:32px 0 0;font-size:16px;line-height:1.5;max-width:42ch;color:var(--muted)}
.btn{margin-top:28px;display:inline-flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:48px;padding:12px 24px;border-radius:999px;background:var(--jade);color:var(--card);text-decoration:none;font-size:16px;font-weight:600}.btn svg{width:19px;height:19px}
.credit{margin:24px 0 0;font-size:15px;color:var(--muted)}.credit a{color:inherit;text-decoration:underline;text-underline-offset:4px;text-decoration-thickness:1.5px}:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
@media(max-width:600px){.door{padding:40px 16px 156px}.door-card{padding:32px 20px}.door-art{left:16px;right:16px;bottom:32px;height:64px}h1{font-size:26px}.mark{width:44px;height:32px}}
`

const ARROW = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5"/></svg>'
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
const hashes = new Map<string, Promise<string>>()
const digest = async (text: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))))

const accentStyle = (identity: EditionIdentity) => identity.accentColor ? `:root{--rer-brand-accent:${identity.accentColor};--rer-brand-accent-text:${ink(identity.accentColor)}}` : ''

/** The Lobby document for one state. Only identity and state shape it. */
export function lobbyHtml(identity: EditionIdentity, state: SetupState): string {
  checkIdentity(identity)
  const claimed = state === 'claimed', product = escape(identity.product)
  const line = claimed ? escape(deploymentLine(identity)) : `This ${product} is waiting for its owner.`
  const action = claimed ? `<a class="btn" href="${escape(identity.signInPath)}">Sign in${ARROW}</a>` : `<a class="btn" href="/setup">Finish setup${ARROW}</a>`
  const credit = claimed
    ? `<p class="credit">Powered by <a href="${escape(identity.runSite)}">${product}</a>, free and open source</p>`
    : identity.manualSetupTokenClaim ? '<p class="credit">You’ll need the setup token from your install.</p>' : ''
  const title = claimed ? `${escape(identity.deployment)} · ${product}` : `Finish setup · ${product}`
  const art = identity.band ? `<div class="door-art" aria-hidden="true"><img src="${escape(identity.band)}" alt=""></div>` : ''
  return `<!doctype html><html lang="en" data-state="${state}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>`
    + `<link rel="icon" href="${escape(identity.mark)}">${identity.fonts ? `<link rel="stylesheet" href="${escape(identity.fonts)}">` : ''}<link rel="stylesheet" href="${escape(identity.theme)}"><style>${accentStyle(identity)}${STYLE}</style></head>`
    + `<body><main class="door">${art}<section class="door-card"><h1><a class="lockup" href="/"><img class="mark" src="${escape(identity.mark)}" alt=""><span class="word">${product}</span></a></h1>`
    + `<p class="line">${line}</p>${action}${credit}</section></main></body></html>`
}

/**
 * Answer GET or HEAD / with the Lobby, rendered on the server from the stored
 * claim state (`claimed`: the same read the seed gives setupStateResponse).
 * Returns null for every other path and when the edition keeps its own page
 * at / (installedHome: 'page').
 */
export async function lobbyResponse(request: Request, bindings: LobbyBindings, identity: EditionIdentity, claimed: ClaimRead = baseFirstRun): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/' || identity.installedHome !== 'lobby') return null
  const base = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-rer-document': 'lobby' }
  // Another origin or Host gets the app's ordinary document 404.
  if (!admitted(request, bindings.AUTH_ORIGIN)) return rejectedResponse(request, new Response('Not found', { status: 404, headers: base }))
  if (request.method !== 'GET' && request.method !== 'HEAD') return rejectedResponse(request, new Response(null, { status: 405, headers: { ...base, allow: 'GET, HEAD' } }))
  let state: SetupState
  try { state = await setupState(bindings.DB, claimed) } catch { return Response.json({ error: 'setup_unavailable' }, { status: 503, headers: base }) }
  const style = accentStyle(identity) + STYLE
  if (!hashes.has(style)) hashes.set(style, digest(style))
  const policy = `default-src 'none'; style-src 'self' 'sha256-${await hashes.get(style)}'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  return new Response(request.method === 'HEAD' ? null : lobbyHtml(identity, state), { headers: { ...base, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': policy } })
}
