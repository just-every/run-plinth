-- A refund retains its reviewed source date and open-period booking across delayed reconciliation.
ALTER TABLE pl_payment_refunds ADD COLUMN posting_json TEXT;
