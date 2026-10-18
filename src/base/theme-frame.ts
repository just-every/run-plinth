// Base's no-JavaScript documents (first-run /setup, the foundation sign-in)
// wear a seed's theme by linking its served rer-theme.css, whose --rer-* tokens
// this frame style maps onto the document; each token falls back to a readable
// neutral if the file cannot load. Without a theme nothing is added.
// Plinth's entry cards sit on the drafting grid above the chalk-line
// elevation's ground strip, with the oxblood action.
/** `accentColor` (#rrggbb) colours buttons when the theme declares no --rer-accent. */
export interface FrameTheme { href: string; productName?: string; accentColor?: string }
export interface Frame { htmlClass: string; head: string; brand: string; policy: string }

const FRAME_STYLE = `
.rer-themed body{position:relative;box-sizing:border-box;margin:0;min-height:100vh;min-height:100dvh;padding:64px 20px 240px;display:grid;place-items:center;isolation:isolate;background:var(--grid-paper),var(--paper);color:var(--ink);font-family:var(--rer-font-body);font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
.rer-themed body::after{content:"";position:absolute;z-index:-1;left:0;right:0;bottom:0;height:220px;background:url('/site/band-1536.webp') center 88%/cover no-repeat;-webkit-mask-image:linear-gradient(to bottom,transparent,#000 30%);mask-image:linear-gradient(to bottom,transparent,#000 30%);pointer-events:none}
.rer-themed main{position:relative;box-sizing:border-box;width:100%;max-width:540px;margin:0 auto;padding:40px 36px 36px;background:var(--paper);border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow-float);overflow-wrap:anywhere}
.rer-themed h1{font-family:var(--rer-font-heading);font-size:38px;font-weight:800;line-height:1.1;letter-spacing:-.045em;margin:0 0 12px;text-align:center;text-wrap:balance}
.rer-themed p,.rer-themed dt{color:var(--body)}.rer-themed p{margin:0 0 24px}.rer-themed h1+p{text-align:center}
.rer-themed dl{display:grid;grid-template-columns:100px minmax(0,1fr);gap:0;margin:24px 0;padding:0 18px;border:1px solid var(--line);border-radius:var(--radius)}.rer-themed dt,.rer-themed dd{padding:14px 0}.rer-themed dt:not(:first-of-type),.rer-themed dd:not(:first-of-type){border-top:1px solid var(--line-soft)}.rer-themed dd{margin:0;color:var(--ink);font-weight:600}
.rer-themed form{display:grid;gap:22px;margin:0}.rer-themed form p{margin:0}
.rer-themed label{display:grid;gap:6px;color:var(--text);font-size:14px;font-weight:600}.rer-themed label:has(input[type=checkbox]){display:flex;gap:12px;align-items:flex-start;font-size:15.5px;font-weight:400;color:var(--text)}
.rer-themed input:not([type=checkbox]):not([type=hidden]){box-sizing:border-box;width:100%;min-height:46px;padding:10px 12px;border:1px solid var(--rer-border);border-radius:var(--radius);background:var(--paper);color:var(--ink);font:inherit}.rer-themed input:not([type=checkbox]):not([type=hidden]):focus-visible{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px color-mix(in srgb,var(--blue) 22%,transparent)}
.rer-themed input[type=checkbox]{flex:none;width:20px;height:20px;margin:2px 0 0;accent-color:var(--ox)}
.rer-themed button{display:block;width:100%;min-height:50px;padding:12px 20px;border:0;border-radius:var(--radius);background:var(--ox);color:#fff;font:inherit;font-size:17px;font-weight:650;cursor:pointer;box-shadow:0 1px 0 rgba(255,255,255,.14) inset,0 12px 24px -14px rgba(128,16,48,.85)}.rer-themed button:hover{background:var(--ox-hover)}
.rer-themed a{color:var(--blue)}.rer-themed :focus-visible{outline:2px solid var(--blue);outline-offset:3px}
.rer-themed .rer-brand{display:flex;align-items:center;justify-content:center;gap:12px;margin:0 0 32px;color:var(--ink);font-family:var(--rer-font-heading);font-size:34px;font-weight:800;line-height:1;letter-spacing:-.045em}
.rer-themed .rer-brand::before{content:"";display:block;flex:none;width:34px;height:38px;background:url('/brand/mark.svg') center/contain no-repeat}
@media(max-width:600px){.rer-themed body{padding:40px 16px 190px}.rer-themed body::after{height:170px}.rer-themed main{padding:32px 20px 28px}.rer-themed h1{font-size:30px}.rer-themed .rer-brand{font-size:29px;margin-bottom:26px}.rer-themed .rer-brand::before{width:29px;height:32px}.rer-themed dl{grid-template-columns:64px minmax(0,1fr);padding:0 12px}.rer-themed dd{text-align:right}}
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
