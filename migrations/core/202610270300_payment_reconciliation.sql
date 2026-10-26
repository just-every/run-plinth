-- Settlement facts and a durable, unresolved provider instruction survive delayed events.
ALTER TABLE pl_payment_attempts ADD COLUMN settlement_state TEXT NOT NULL DEFAULT 'initiated';
ALTER TABLE pl_payment_attempts ADD COLUMN request_json TEXT;
ALTER TABLE pl_payment_attempts ADD COLUMN reversed_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pl_payment_attempts ADD COLUMN reconciled_at TEXT;
ALTER TABLE pl_payment_attempts ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
UPDATE pl_payment_attempts SET settlement_state=CASE status WHEN 'paid' THEN 'settled' WHEN 'review' THEN 'settled' WHEN 'expired' THEN 'canceled' ELSE CASE WHEN status='open' THEN 'initiated' ELSE status END END;
CREATE UNIQUE INDEX pl_payment_intent ON pl_payment_attempts(payment_intent_id) WHERE payment_intent_id IS NOT NULL;
CREATE TABLE pl_payment_refunds (
 id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES pl_payment_attempts(id) ON DELETE CASCADE,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), reason TEXT NOT NULL, created_by TEXT NOT NULL,
 status TEXT NOT NULL, provider_id TEXT, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX pl_payment_refund_pending ON pl_payment_refunds(attempt_id) WHERE status='unresolved';
