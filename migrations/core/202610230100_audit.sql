-- ROLE-005: one append-only history of financial mutations, permission changes, exports, sends, imports and automated actions.
-- Rows carry references (versions and digests), never record content, so they survive the erasure they describe.
CREATE TABLE pl_audit (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 at TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('financial','permission','export','send','import','automation','record','hold','erasure')),
 action TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 actor_name TEXT NOT NULL,
 actor_role TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('session','agent','automation')),
 credential_id TEXT,
 subject_kind TEXT,
 subject_id TEXT,
 job_id TEXT,
 version_before INTEGER,
 version_after INTEGER,
 before_ref TEXT,
 after_ref TEXT,
 detail TEXT CHECK(detail IS NULL OR json_valid(detail))
);
CREATE INDEX pl_audit_job ON pl_audit(job_id, seq);
CREATE INDEX pl_audit_actor ON pl_audit(actor_id, seq);
CREATE INDEX pl_audit_kind ON pl_audit(kind, seq);
CREATE TRIGGER pl_audit_no_update BEFORE UPDATE ON pl_audit BEGIN SELECT RAISE(ABORT, 'audit_append_only'); END;
CREATE TRIGGER pl_audit_no_delete BEFORE DELETE ON pl_audit BEGIN SELECT RAISE(ABORT, 'audit_append_only'); END;
-- ROLE-005: owner legal holds and retention periods stop the erasure of a job or company record, with a recorded reason.
CREATE TABLE pl_holds (
 id TEXT PRIMARY KEY,
 subject_kind TEXT NOT NULL CHECK(subject_kind IN ('job','vendor')),
 subject_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('legal_hold','retention')),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 until TEXT CHECK(until IS NULL OR until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 placed_by TEXT NOT NULL CHECK(json_valid(placed_by)),
 placed_at TEXT NOT NULL,
 released_by TEXT CHECK(released_by IS NULL OR json_valid(released_by)),
 released_at TEXT,
 release_reason TEXT,
 CHECK((kind='retention')=(until IS NOT NULL))
);
CREATE INDEX pl_hold_subject ON pl_holds(subject_kind, subject_id);
