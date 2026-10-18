// The run site's one document frame: favicons, the share card, the self-hosted
// fonts, the tokens (public/site/theme.css) and the compiled site styles.
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import site from '../../../deploy-site.json'

const SHARE = `https://${site.domain}/site/share.jpg`

export function documentHtml({ title, description, styles, body, script = '' }: { title: string; description: string; styles: string[]; body: ReactElement; script?: string }): string {
  return '<!doctype html>' + renderToStaticMarkup(<html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="theme-color" content="#ffffff" />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Plinth" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={SHARE} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta name="twitter:card" content="summary_large_image" />
      <link rel="icon" href="/favicon.ico" sizes="32x32" />
      <link rel="icon" type="image/svg+xml" href="/brand/favicon-32.svg" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <link rel="preload" href="/fonts/inter/inter-latin-opsz-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <link rel="stylesheet" href="/site/theme.css" />
      {styles.map(href => <link key={href} rel="stylesheet" href={href} />)}
    </head>
    <body className="pl">{body}{script ? <script dangerouslySetInnerHTML={{ __html: script }} /> : null}</body>
  </html>)
}
