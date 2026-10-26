-- Recovery carries scope references, never endpoint paths, signing keys or consent.
CREATE TABLE pl_connector_bindings (
 id TEXT PRIMARY KEY,
 receiver_origin TEXT NOT NULL,
 job_ids TEXT NOT NULL,
 event_types TEXT NOT NULL,
 revoked_at TEXT
);
INSERT INTO pl_connector_bindings(id,receiver_origin,job_ids,event_types,revoked_at)
 SELECT id,substr(receiver,1,7+instr(substr(receiver,9),'/')),job_ids,event_types,revoked_at
 FROM pl_connector_subscriptions;
