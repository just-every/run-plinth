-- PAY-001 hosted Stripe checkout: one durable attempt per client payment instruction, and the signed processor events already applied.
CREATE TABLE pl_payment_attempts (
 id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 invoice_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 currency TEXT NOT NULL CHECK(currency = 'usd'),
 status TEXT NOT NULL CHECK(status IN ('open','processing','paid','failed','expired','review')),
 label TEXT NOT NULL,
 client_email TEXT NOT NULL,
 session_id TEXT,
 checkout_url TEXT,
 payment_intent_id TEXT,
 method TEXT,
 wallet TEXT,
 fee_cents INTEGER,
 livemode INTEGER,
 receipt_id TEXT,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX pl_payment_job ON pl_payment_attempts(job_id, created_at);
CREATE UNIQUE INDEX pl_payment_one_open ON pl_payment_attempts(invoice_id) WHERE status IN ('open','processing');
CREATE UNIQUE INDEX pl_payment_session ON pl_payment_attempts(session_id) WHERE session_id IS NOT NULL;
CREATE TABLE pl_payment_events (
 id TEXT PRIMARY KEY,
 type TEXT NOT NULL,
 attempt_id TEXT,
 digest TEXT NOT NULL,
 received_at TEXT NOT NULL
);
