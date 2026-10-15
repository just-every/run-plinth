import { createMailSender } from './modules/mail/index.mjs'
import { demoEffect } from './modules/demo/index.mjs'

export function operatorMail(env) {
 if (env.RER_DEMO !== '1' && (!env.MAIL_PROVIDER || (env.MAIL_PROVIDER === 'development' && env.AUTH_LOCAL !== 'true'))) return undefined
 return { send: message => demoEffect(() => {
  const sender = env.MAIL_PROVIDER === 'development'
   ? env.AUTH_LOCAL === 'true' ? createMailSender({ provider: 'development', mode: 'development' }) : undefined
   : env.MAIL_PROVIDER ? createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY, ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) }) : undefined
  if (!sender) throw new Error('Mail provider is not configured')
  return sender.send(message)
 }, () => ({ provider: 'resend', status: 'accepted', providerMessageId: crypto.randomUUID() })) }
}
