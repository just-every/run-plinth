// Diagnostics retain failure types and locations, never credentials or URLs.
export function diagnostic(value, bindings = {}) {
 let text = String(value)
 for (const key of ['SESSION_SECRET', 'SETUP_TOKEN', 'MAIL_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
  if (bindings[key]) text = text.replaceAll(bindings[key], '[credential withheld]')
 }
 return text.replace(/https?:\/\/[^\s"'<>]+/g, '[URL withheld]')
  .replace(/(?:pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, '[credential withheld]')
  .replace(/(["']?(?:token|authorization|cookie|set-cookie)["']?\s*[:=]\s*)[^\n,;}]+/gi, '$1[credential withheld]')
  .slice(0, 1800)
}

export async function requireStatus(response, expected, label, worker) {
 const status = response.status()
 if (status !== expected) {
  const body = diagnostic(await response.text(), worker.bindings)
  const errors = worker.diagnostics().join('\n')
  throw new Error(`${label}: HTTP ${status}, expected ${expected}; body=${body || '[empty]'}${errors ? '\nWorker: ' + errors : ''}`)
 }
}
