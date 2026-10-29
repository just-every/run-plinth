-- Consent is local to the reviewing installation and never restored as standing agent authority.
CREATE TABLE pl_recovery_evidence_grants (
 case_id TEXT PRIMARY KEY,
 packet_id TEXT NOT NULL,
 sponsor_id TEXT NOT NULL,
 sponsor_version INTEGER NOT NULL
);
CREATE TRIGGER pl_recovery_evidence_erased AFTER DELETE ON pl_jobs BEGIN
 DELETE FROM pl_recovery_evidence_grants WHERE case_id IN (SELECT json_extract(value,'$.id') FROM json_each(OLD.data,'$.recovery_evidence'));
END;
