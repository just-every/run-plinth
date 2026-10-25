// INT-007 held-key sandbox receipt. Run as: python3 briefs/_od08-env.py TWILIO_SENDGRID_API_KEY=TWILIO_SENDGRID_API_KEY TWILIO_SENDGRID_FROM_EMAIL=TWILIO_SENDGRID_FROM_EMAIL CF_TOKEN=CLOUDFLARE_RER_EMAIL_ROUTING_TOKEN -- node scripts/live-proof/mail-sandbox.mjs
// It prints booleans and HTTP statuses only: no key, address or message content. SendGrid runs in its sandbox mode, which validates and never delivers; Cloudflare Email Routing is read only.
import { applyUnsubscribeHeaders } from '../../src/modules/mail/index.mjs'
import { serializeSendGridMessage } from '../../src/modules/mail/index.mjs'
const { TWILIO_SENDGRID_API_KEY: key, TWILIO_SENDGRID_FROM_EMAIL: from, CF_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env
if (!key || !from || !token || !account) throw new Error('Run through the held-key injector')
const id = crypto.randomUUID(), reply = `r.${id.replaceAll('-', '')}.${'a'.repeat(20)}@${from.split('@')[1]}`
const message = applyUnsubscribeHeaders({ deliveryId: id, from, to: [from], replyTo: reply, subject: 'Selection needed: Kitchen / Tile finish by 2026-11-04', text: 'Synthetic Plinth selection request.\n\n--\nTo stop optional notices like this one, open the link.', headers: {}, unsubscribe: { url: `https://example.com/api/plinth/mail/unsubscribe/synthetic-plinth-1`, oneClick: true } }, 'sendgrid')
const wire = JSON.parse(serializeSendGridMessage(message))
wire.mail_settings = { sandbox_mode: { enable: true } }
const send = await fetch('https://api.sendgrid.com/v3/mail/send', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(wire) })
const cf = path => fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json())
const zones = await cf(`/zones?account.id=${account}&per_page=50`), zone = zones.result?.[0]
const routing = zone ? await cf(`/zones/${zone.id}/email/routing`) : {}, catchAll = zone ? await cf(`/zones/${zone.id}/email/routing/rules/catch_all`) : {}
console.log(JSON.stringify({
 sendgrid_sandbox_send: { status: send.status, validated_not_delivered: send.status === 200, carried: ['reply_to', 'custom_args', 'list_unsubscribe', 'one_click'].filter(k => k === 'reply_to' ? !!wire.reply_to : k === 'custom_args' ? wire.custom_args?.rer_delivery_id === id : k === 'list_unsubscribe' ? !!wire.headers?.['List-Unsubscribe'] : !!wire.headers?.['List-Unsubscribe-Post']) },
 cloudflare_email_routing: { zone_visible: !!zone, routing_api_ok: routing.success === true, routing_enabled: routing.result?.enabled === true, catch_all_api_ok: catchAll.success === true, catch_all_rule_present: !!catchAll.result, catch_all_actions: (catchAll.result?.actions ?? []).map(a => a.type) },
}, null, 1))
