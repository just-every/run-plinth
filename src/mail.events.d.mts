import type { Bindings } from './auth.server'
export interface DeliveryEvent { eventId: string; providerMessageId: string; type: string; status: string | null; occurredAt: number; recipients: string[]; deliveryId: string | null }
export function createD1EventStore(options: { db: D1Database }): unknown
export function createDeliveryEventIntake(options: { provider: NonNullable<Bindings['MAIL_PROVIDER']>; tenantId: string; eventNamespace: string; key: string; store: unknown; authorize(event: DeliveryEvent): Promise<boolean> }): { ingestWebhook(input: { rawBody: Uint8Array; headers: Headers }): Promise<{ eventId: string; outcome: string }[]> }
export interface InboundMail { from: string; to: string[]; subject: string; messageId: string | null; inReplyTo: string | null; text: string | null; html: string | null; attachments: { filename: string; contentType: string; content: Uint8Array }[] }
export function normalizeInbound(input: { provider: 'cloudflare'; message: unknown }, limits: Record<string, number>): Promise<InboundMail>
