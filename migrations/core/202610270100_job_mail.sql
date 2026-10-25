-- INT-007 job correspondence: one row per message and recipient, replies with their files, and the suppression list for optional notices.
CREATE TABLE pl_mail_messages (
 id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 direction TEXT NOT NULL CHECK(direction IN ('out','in','note')),
 visibility TEXT NOT NULL CHECK(visibility IN ('client','private')),
 kind TEXT NOT NULL,
 required INTEGER NOT NULL CHECK(required IN (0,1)),
 counterparty TEXT NOT NULL,
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 status TEXT NOT NULL,
 label TEXT NOT NULL,
 provider_message_id TEXT,
 message_id TEXT,
 in_reply_to TEXT,
 reply_to_id TEXT,
 sender_check TEXT,
 by_id TEXT NOT NULL,
 by_name TEXT NOT NULL,
 created_at TEXT NOT NULL,
 status_at TEXT NOT NULL
);
CREATE INDEX pl_mail_job ON pl_mail_messages(job_id, created_at);
CREATE UNIQUE INDEX pl_mail_inbound_once ON pl_mail_messages(job_id, message_id) WHERE message_id IS NOT NULL AND direction = 'in';
CREATE TABLE pl_mail_files (
 id TEXT PRIMARY KEY,
 message_id TEXT NOT NULL REFERENCES pl_mail_messages(id) ON DELETE CASCADE,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 mime TEXT NOT NULL,
 checksum TEXT NOT NULL,
 size INTEGER NOT NULL CHECK(size BETWEEN 0 AND 2097152),
 bytes BLOB NOT NULL CHECK(length(bytes) = size)
);
CREATE INDEX pl_mail_file_job ON pl_mail_files(job_id);
CREATE TABLE pl_mail_suppressions (
 email TEXT PRIMARY KEY,
 reason TEXT NOT NULL CHECK(reason IN ('unsubscribed','complained','bounced')),
 source TEXT NOT NULL,
 at TEXT NOT NULL
);
-- Base mail module's verified delivery-event intake (modules/mail/src/events/d1-schema.sql), unchanged.
CREATE TABLE IF NOT EXISTS rer_mail_event_receipts (
  provider TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  event_namespace TEXT NOT NULL,
  event_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  event_json TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  conflict INTEGER NOT NULL DEFAULT 0 CONSTRAINT rer_mail_event_identity_conflict CHECK (conflict = 0),
  PRIMARY KEY (provider, tenant_id, event_namespace, event_id)
);
CREATE TABLE IF NOT EXISTS rer_mail_event_states (
  provider TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  event_namespace TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  terminal INTEGER NOT NULL CHECK (terminal IN (0, 1)),
  PRIMARY KEY (provider, tenant_id, event_namespace, provider_message_id, recipient)
);
