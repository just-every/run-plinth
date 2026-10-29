-- Historical analysis is portable; permission to expose it to an agent is installation-local.
CREATE TABLE pl_learning_packets(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE pl_learning_sources(packet_id TEXT NOT NULL REFERENCES pl_learning_packets(id) ON DELETE CASCADE, job_id TEXT NOT NULL, PRIMARY KEY(packet_id,job_id));
CREATE TABLE pl_learning_consents(packet_id TEXT PRIMARY KEY REFERENCES pl_learning_packets(id) ON DELETE CASCADE, owner_id TEXT NOT NULL, owner_version INTEGER NOT NULL);
CREATE TABLE pl_learning_drafts(id TEXT PRIMARY KEY, packet_id TEXT NOT NULL REFERENCES pl_learning_packets(id) ON DELETE CASCADE, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE pl_learning_decisions(draft_id TEXT PRIMARY KEY REFERENCES pl_learning_drafts(id) ON DELETE CASCADE, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TRIGGER pl_learning_job_erasure BEFORE DELETE ON pl_jobs BEGIN
 DELETE FROM pl_learning_packets WHERE id IN (SELECT packet_id FROM pl_learning_sources WHERE job_id=OLD.id);
END;
