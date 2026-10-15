/** Warm paper and ink chrome; the landing's jade stays in its product drawings. */
export const docCss = `
*,*::before,*::after{box-sizing:border-box}
html{scroll-padding-top:32px;-webkit-text-size-adjust:100%}
.docs-site{margin:0;background:var(--paper);color:var(--ink);font:400 18px/1.65 'Albert Sans',sans-serif;-webkit-font-smoothing:antialiased}
.docs-site a{color:inherit;text-underline-offset:4px;text-decoration-thickness:1px}
.docs-site a:hover{text-decoration-thickness:2px}
.docs-site a:focus-visible,.docs-site summary:focus-visible,.docs-table:focus-visible{outline:2px solid var(--focus);outline-offset:4px}
.docs-site main:focus{outline:none}
.docs-skip{position:fixed;z-index:10;top:8px;left:16px;transform:translateY(-150%);background:var(--ink);color:var(--paper)!important;padding:10px 16px;border-radius:10px}
.docs-skip:focus{transform:translateY(0)}
.docs-header{max-width:1288px;margin:0 auto;padding:32px 24px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.docs-brand{display:flex;align-items:center;gap:12px;font-size:29px;font-weight:800;letter-spacing:-.04em;text-decoration:none}
.docs-brand img{display:block;width:28px;height:24px}
.docs-header nav{display:flex;align-items:center;gap:32px;font-size:16px;font-weight:500}
.docs-header nav a{text-decoration:none}
.docs-header nav a:hover{text-decoration:underline}
.docs-header nav .docs-run{padding:10px 21px;background:var(--ink);color:var(--paper);border-radius:999px;font-weight:600}
.docs-layout{display:grid;grid-template-columns:196px minmax(0,1fr) 168px;gap:40px;max-width:1288px;margin:0 auto;padding:56px 24px 96px;align-items:start}
.docs-sidebar,.docs-toc{position:sticky;top:32px}
.docs-label,.docs-eyebrow{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 18px}
.docs-sidebar ul,.docs-toc ul,.docs-mobile-nav ul{list-style:none;padding:0;margin:0;display:grid;gap:5px}
.docs-sidebar li a{display:block;padding:9px 12px;font-size:15px;line-height:1.4;text-decoration:none;border-radius:8px}
.docs-sidebar li a:hover{background:var(--card-inset)}
.docs-sidebar li a[aria-current]{font-weight:700;background:var(--ink);color:var(--paper)}
.docs-toc a{display:block;font-size:13px;line-height:1.5;text-decoration:none;padding:6px 0;color:var(--muted)}
.docs-toc a:hover{color:var(--ink);text-decoration:underline}
.docs-eyebrow{margin-bottom:14px}
.docs-article h1,.docs-article h2,.docs-article h3{font-weight:800;letter-spacing:-.035em;line-height:1.15;text-wrap:balance;scroll-margin-top:32px}
.docs-article h1{font-size:52px;margin:0 0 26px;line-height:1.05;letter-spacing:-.04em}
.docs-article h1+p{font-size:21px;line-height:1.55;margin-bottom:36px}
.docs-article h2{font-size:30px;margin:48px 0 18px}
.docs-article h3{font-size:23px;margin:32px 0 16px}
.docs-article p{margin:0 0 20px;text-wrap:pretty}
.docs-article ul,.docs-article ol{margin:0 0 24px;padding-left:25px}
.docs-article li{margin:0 0 12px;padding-left:4px}
.docs-article li:last-child{margin-bottom:0}
.docs-article strong{font-weight:700}
.docs-article code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.82em;overflow-wrap:anywhere;background:var(--card-inset);padding:2px 5px;border-radius:4px}
.docs-article pre{padding:22px 24px;margin:24px 0 28px;border-radius:14px;background:var(--ink);color:var(--paper);overflow-x:auto;line-height:1.8}
.docs-article pre code{padding:0;border-radius:0;background:none;color:inherit;overflow-wrap:normal;white-space:pre}
.docs-article blockquote{margin:24px 0;padding:4px 0 4px 24px;border-left:3px solid var(--ink)}
.docs-article blockquote p:last-child{margin-bottom:0}
.docs-table{overflow:auto;max-width:100%;margin:24px 0 32px;border:1px solid var(--rule);border-radius:10px}
.docs-table table{width:100%;border-collapse:collapse;font-size:15px;line-height:1.6;font-variant-numeric:tabular-nums}
.docs-table th{background:var(--card-inset);font-weight:700;text-align:left}
.docs-table th,.docs-table td{padding:12px 16px;border-bottom:1px solid var(--rule);vertical-align:top;min-width:110px}
.docs-table tr:last-child td{border-bottom:0}
.docs-table code{font-size:.83em}.docs-table table:has(th:nth-child(3)){min-width:600px}
.docs-pager{display:flex;justify-content:space-between;gap:24px;margin-top:56px;padding-top:28px;border-top:1px solid var(--rule)}
.docs-pager a{display:grid;gap:3px;max-width:48%;text-decoration:none;line-height:1.4}
.docs-pager a:last-child{text-align:right;margin-left:auto}
.docs-pager a span{font-size:13px;color:var(--muted)}
.docs-pager a strong{font-size:17px;font-weight:700}
.docs-source{margin:32px 0 0;font-size:13px;color:var(--muted)}
.docs-footer{max-width:1240px;margin:0 auto;padding:32px 0 40px;display:flex;align-items:center;gap:32px;border-top:1px solid var(--rule);font-size:14px;color:var(--muted)}
.docs-footer p{margin:0;flex:1}
.docs-footer-brand{font-size:22px;font-weight:800;color:var(--ink)!important;text-decoration:none;letter-spacing:-.04em}
.docs-mobile-nav{display:none}
@media(max-width:1100px){.docs-layout{grid-template-columns:180px minmax(0,1fr);gap:32px;max-width:1000px}.docs-toc{display:none}.docs-footer{margin-inline:24px}.docs-article h1{font-size:48px}}
@media(max-width:700px){.docs-header{padding:22px 16px;gap:16px}.docs-brand{font-size:26px;gap:8px}.docs-brand img{width:24px}.docs-header nav{gap:18px;font-size:14px}.docs-header nav .docs-run{display:none}.docs-layout{display:block;padding:16px 16px 64px}.docs-sidebar{display:none}.docs-mobile-nav{display:block;border-bottom:1px solid var(--rule);margin-bottom:36px;padding-bottom:16px;font-size:15px}.docs-mobile-nav summary{cursor:pointer;font-weight:600;padding:8px 0}.docs-mobile-nav ul{padding:12px 0 0;gap:0}.docs-mobile-nav a{display:block;padding:8px 0;text-decoration:none}.docs-mobile-nav a[aria-current]{font-weight:800}.docs-eyebrow{font-size:11px}.docs-article{font-size:17px}.docs-article h1{font-size:40px;margin-bottom:22px}.docs-article h1+p{font-size:19px;margin-bottom:28px}.docs-article h2{font-size:28px;margin-top:40px}.docs-article h3{font-size:22px}.docs-article pre{padding:18px 16px;font-size:15px}.docs-table th,.docs-table td{padding:10px 12px}.docs-pager{margin-top:40px;gap:16px}.docs-pager a strong{font-size:15px}.docs-footer{margin-inline:16px;flex-wrap:wrap;gap:12px 24px;padding:24px 0 32px}.docs-footer p{flex-basis:100%;order:2}}
`
