// Base's no-JavaScript documents (first-run /setup, the foundation sign-in)
// wear a seed's theme by linking its served rer-theme.css, whose --rer-* tokens
// this frame style maps onto the document; each token falls back to a readable
// neutral if the file cannot load. Without a theme nothing is added.
// Plinth entry cards share the app palette and terrazzo lower edge.
/** `accentColor` (#rrggbb) colours buttons when the theme declares no --rer-accent. */
export interface FrameTheme { href: string; productName?: string; accentColor?: string }
export interface Frame { htmlClass: string; head: string; brand: string; policy: string }

const FRAME_STYLE = `
.rer-themed body{box-sizing:border-box;margin:0;min-height:100vh;min-height:100dvh;padding:64px 20px;display:grid;place-items:center;background:var(--paper);color:var(--ink);font-family:var(--rer-font-body);font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
.rer-themed main{position:relative;box-sizing:border-box;width:100%;max-width:580px;margin:0 auto;padding:40px 28px 72px;background:var(--card);border:1px solid var(--rule);border-radius:14px;box-shadow:var(--card-shadow);overflow:hidden;overflow-wrap:anywhere}
.rer-themed main::after{content:"";position:absolute;inset:auto 0 0;height:40px;background:url('/brand/terrazzo.webp') center/512px;box-shadow:inset 0 -8px 0 #0000000F;pointer-events:none}
.rer-themed h1{font-family:var(--rer-font-heading);font-size:40px;font-weight:800;line-height:1.12;letter-spacing:-.03em;margin:0 0 16px;text-align:center;text-wrap:balance}
.rer-themed p,.rer-themed dt{color:var(--muted)}.rer-themed p{margin:0 0 24px}.rer-themed h1+p{text-align:center}
.rer-themed dl{display:grid;grid-template-columns:100px minmax(0,1fr);gap:0;margin:28px 0;padding:0 20px;border:1px solid var(--rule);border-radius:10px}.rer-themed dt,.rer-themed dd{padding:16px 0}.rer-themed dt:not(:first-of-type),.rer-themed dd:not(:first-of-type){border-top:1px solid var(--rule)}.rer-themed dd{margin:0;color:var(--ink)}
.rer-themed form{display:grid;gap:24px;margin:0}.rer-themed form p{margin:0}
.rer-themed label{display:grid;gap:8px;color:var(--ink);font-size:15px;font-weight:500}.rer-themed label:has(input[type=checkbox]){display:flex;gap:14px;align-items:flex-start;font-size:16px;font-weight:400}
.rer-themed input:not([type=checkbox]):not([type=hidden]){box-sizing:border-box;width:100%;min-height:48px;padding:10px 14px;border:1px solid var(--rer-border);border-radius:10px;background:var(--card);color:var(--ink);font:inherit}
.rer-themed input[type=checkbox]{flex:none;width:22px;height:22px;margin:1px 0 0;accent-color:var(--jade)}
.rer-themed button{display:block;width:100%;min-height:48px;padding:12px 20px;border:0;border-radius:999px;background:var(--jade);color:var(--card);font:inherit;font-weight:600;cursor:pointer}
.rer-themed a{color:var(--jade-ink)}.rer-themed :focus-visible{outline:2px solid var(--ink);outline-offset:3px}
.rer-themed .rer-brand{display:flex;flex-direction:column;align-items:center;gap:10px;margin:0 0 36px;color:var(--ink);font-family:var(--rer-font-heading);font-size:30px;font-weight:800;line-height:1;letter-spacing:-.03em}
.rer-themed .rer-brand::before{content:"";display:block;flex:none;width:54px;height:36px;background:url('/brand/mark.svg') center/contain no-repeat}
@media(max-width:600px){.rer-themed body{padding:40px 16px}.rer-themed main{padding:32px 20px 68px}.rer-themed h1{font-size:30px}.rer-themed .rer-brand{font-size:26px;margin-bottom:32px}.rer-themed .rer-brand::before{width:44px;height:32px}.rer-themed dl{grid-template-columns:68px minmax(0,1fr);padding:0 12px}.rer-themed dd{text-align:right}.rer-themed label:has(input[type=checkbox]){gap:12px}}
`

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
const hashes = new Map<string, Promise<string>>()
// WCAG relative luminance picks readable button text for the branding accent.
export const ink = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0) > 0.179 ? '#000000' : '#ffffff'
const digest = async (text: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))))

/** `policy` is the document's style/font/image CSP: the hashed frame style plus same-origin theme files. */
export async function themeFrame(theme?: FrameTheme): Promise<Frame> {
  if (!theme) return { htmlClass: '', head: '', brand: '', policy: "style-src 'self'; font-src 'self'" }
  if (!/^\/(?!\/)[A-Za-z0-9._~/-]{1,200}\.css$/.test(theme.href) || theme.href.includes('/.')) throw new Error('Declare the seed theme as a same-origin path to its served .css file.')
  if (theme.accentColor !== undefined && !/^#[0-9a-f]{6}$/i.test(theme.accentColor)) throw new Error('A frame accent colour is #rrggbb.')
  const style = (theme.accentColor ? `.rer-themed{--rer-brand-accent:${theme.accentColor};--rer-brand-accent-text:${ink(theme.accentColor)}}` : '') + FRAME_STYLE
  if (!hashes.has(style)) hashes.set(style, digest(style))
  return {
    htmlClass: ' class="rer-themed"',
    head: `<link rel="stylesheet" href="${theme.href}"><style>${style}</style>`,
    brand: theme.productName ? `<p class="rer-brand">${escape(theme.productName)}</p>` : '',
    policy: `style-src 'self' 'sha256-${await hashes.get(style)}'; font-src 'self'; img-src 'self'`,
  }
}
