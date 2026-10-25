-- Standing receiver authority and its retry history remain installation-local.
ALTER TABLE pl_connector_subscriptions ADD COLUMN grant_id TEXT;
ALTER TABLE pl_connector_subscriptions ADD COLUMN grant_origin TEXT;
ALTER TABLE pl_connector_subscriptions ADD COLUMN grant_event_types TEXT;
ALTER TABLE pl_connector_subscriptions ADD COLUMN grant_payload_class TEXT;
ALTER TABLE pl_connector_subscriptions ADD COLUMN grant_rate_cap INTEGER;
ALTER TABLE pl_connector_subscriptions ADD COLUMN grant_expires_at TEXT;
ALTER TABLE pl_connector_subscriptions ADD COLUMN grant_revoked_at TEXT;
ALTER TABLE pl_connector_subscriptions ADD COLUMN grant_after INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pl_connector_subscriptions ADD COLUMN paused_at TEXT;
ALTER TABLE pl_connector_subscriptions ADD COLUMN pause_reason TEXT;
ALTER TABLE pl_connector_subscriptions ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pl_connector_deliveries ADD COLUMN consent_grant_id TEXT;
ALTER TABLE pl_connector_deliveries ADD COLUMN mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE pl_connector_deliveries ADD COLUMN retry_at TEXT;
CREATE INDEX pl_connector_event_attempts ON pl_connector_deliveries(subscription_id,event_id,started_at);
