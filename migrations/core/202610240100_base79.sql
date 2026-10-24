-- Additive Base rer-v0.2.79 schema adoption; preserve previously applied migrations.

-- Apply as a NEW numbered migration. Authority and audit are durable, not sessions.
CREATE TABLE IF NOT EXISTS oa_policy_approvals (
 id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, version_hash TEXT NOT NULL,
 definition TEXT NOT NULL, actions TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES oa_operators(id), owner_version INTEGER NOT NULL,
 approved_at INTEGER NOT NULL, revoked_at INTEGER,
 session_kind TEXT NOT NULL, revoke_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS oa_policy_live ON oa_policy_approvals(policy_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS oa_policy_runs (
 id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, version_hash TEXT,
 approval_id TEXT REFERENCES oa_policy_approvals(id), approved_by TEXT,
 started_at INTEGER NOT NULL, finished_at INTEGER,
 status TEXT NOT NULL CHECK(status IN ('running','completed','refused','failed')), error TEXT,
 admitted INTEGER NOT NULL DEFAULT 0, repeats INTEGER NOT NULL DEFAULT 1, last_seen_at INTEGER
);
CREATE INDEX IF NOT EXISTS oa_policy_runs_time ON oa_policy_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS oa_policy_action_run ON oa_auth_audit(CASE WHEN json_valid(value) THEN json_extract(value,'$.runId') END,action);

-- Apply as a NEW numbered migration after any oa_sessions rebuild.
-- Never infer inactivity from missing credentials: older sessions may have been
-- pruned. Existing operators receive a full inactivity window from this upgrade.
ALTER TABLE oa_operators ADD COLUMN last_signin_at INTEGER;
UPDATE oa_operators SET last_signin_at=MAX(
 created_at, CAST(strftime('%s','now') AS INTEGER)*1000+999,
 COALESCE((SELECT MAX(created_at) FROM oa_sessions WHERE operator_id=oa_operators.id),0)
);
CREATE TRIGGER oa_record_last_signin AFTER INSERT ON oa_sessions
 BEGIN UPDATE oa_operators SET last_signin_at=NEW.created_at
 WHERE id=NEW.operator_id AND (last_signin_at IS NULL OR last_signin_at<NEW.created_at); END;

ALTER TABLE rer_dependency_installation ADD COLUMN keys_sealed INTEGER NOT NULL DEFAULT 0 CHECK(keys_sealed IN (0,1));
-- Nonsecret version history lets restored rows name an unavailable retired key
-- without confusing ciphertext tampering or a wrong current secret with restore.
ALTER TABLE rer_dependency_installation ADD COLUMN key_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(key_ids) AND json_type(key_ids)='array');
