// This edition's identity: what its installed Lobby and its run site say.
// The name and colour are the ones setup saves in src/branding.json; replace
// the purpose and tagline with the product's own when it has one.
import type { EditionIdentity } from './base/identity'
import branding from './branding.json'

export const identity: EditionIdentity = {
  product: branding.name,
  deployment: branding.name,
  purpose: '{deployment} keeps building jobs, site records and approved changes together.',
  tagline: 'From accepted quote to a reconciled progress-claim export.',
  signInPath: '/signin',
  // The run site `rer deploy --site` publishes (deploy-site.json).
  runSite: 'https://run-plinth.com',
  // An installed instance serves the Lobby at /.
  installedHome: 'lobby',
  theme: '/rer-theme.css',
  mark: '/brand/mark.svg',
  band: '/site/band-1536.webp',
  fonts: '/fonts/fonts.css',
  accentColor: branding.primaryColor,
}
