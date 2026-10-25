-- Native connector metadata is installation-local; credentials never enter portable archives.
CREATE TABLE pl_api_requests (
 operator_id TEXT NOT NULL,
 operation_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 record_id TEXT NOT NULL,
 PRIMARY KEY(operator_id, operation_key)
);
CREATE TABLE pl_api_limits (
 principal TEXT PRIMARY KEY,
 window INTEGER NOT NULL,
 count INTEGER NOT NULL
);
CREATE TABLE pl_connector_events (
 id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 job_version INTEGER NOT NULL,
 type TEXT NOT NULL,
 subject_id TEXT,
 created_at TEXT NOT NULL,
 UNIQUE(job_id,job_version,type)
);
CREATE TABLE pl_connector_subscriptions (
 id TEXT PRIMARY KEY,
 operator_id TEXT NOT NULL,
 operator_version INTEGER NOT NULL,
 credential_id TEXT NOT NULL,
 receiver TEXT NOT NULL,
 job_ids TEXT NOT NULL,
 event_types TEXT NOT NULL,
 secret TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 1,
 revoked_at TEXT,
 created_at TEXT NOT NULL
);
CREATE TABLE pl_connector_deliveries (
 id TEXT PRIMARY KEY,
 subscription_id TEXT NOT NULL REFERENCES pl_connector_subscriptions(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL REFERENCES pl_connector_events(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,
 started_at TEXT NOT NULL,
 finished_at TEXT,
 status TEXT NOT NULL,
 http_status INTEGER
);
CREATE UNIQUE INDEX pl_connector_delivery_lease ON pl_connector_deliveries(subscription_id) WHERE status='sending';
