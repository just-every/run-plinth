import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { landingHtml } from './landing/Landing'
import { docPages } from './docs'
import run from './run.json'

export function sitePages({ styles = [] }: Partial<SiteContext> = {}): SiteBuild {
  const data: RunData = run
  return {
    pages: [
      { path: '/', html: landingHtml(styles) },
      { path: '/run', html: runPageHtml(identity, data) },
      ...docPages(),
      { path: '/404', html: siteNotFoundHtml(identity, data) },
    ],
    assets: ['rer-theme.css', 'fonts', 'brand'],
  }
}
