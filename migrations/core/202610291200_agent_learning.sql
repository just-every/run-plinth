-- Historical analysis is portable; permission to expose it to an agent is installation-local.
CREATE TABLE pl_learning_packets(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE pl_learning_sources(packet_id TEXT NOT NULL REFERENCES pl_learning_packets(id) ON DELETE CASCADE, job_id TEXT NOT NULL, PRIMARY KEY(packet_id,job_id));
CREATE TABLE pl_learning_consents(packet_id TEXT PRIMARY KEY REFERENCES pl_learning_packets(id) ON DELETE CASCADE, owner_id TEXT NOT NULL, owner_version INTEGER NOT NULL);
CREATE TABLE pl_learning_drafts(id TEXT PRIMARY KEY, packet_id TEXT NOT NULL REFERENCES pl_learning_packets(id) ON DELETE CASCADE, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE pl_learning_decisions(draft_id TEXT PRIMARY KEY REFERENCES pl_learning_drafts(id) ON DELETE CASCADE, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TRIGGER pl_learning_job_erasure BEFORE DELETE ON pl_jobs BEGIN
 SELECT RAISE(ABORT,'CHECK constraint failed: held_learning_source') WHERE EXISTS(
  SELECT 1 FROM pl_learning_sources source JOIN pl_holds held ON held.subject_kind='job' AND held.subject_id=source.job_id
  WHERE source.packet_id IN (SELECT packet_id FROM pl_learning_sources WHERE job_id=OLD.id)
   AND held.released_at IS NULL AND (held.kind='legal_hold' OR held.until>=date('now'))
 );
 DELETE FROM pl_learning_packets WHERE id IN (SELECT packet_id FROM pl_learning_sources WHERE job_id=OLD.id);
END;

-- Erasure removes replay payloads as well as the product's source packet.
CREATE TRIGGER pl_learning_packet_erasure BEFORE DELETE ON pl_learning_packets BEGIN
 DELETE FROM agent_door_calls WHERE json_extract(outcome,'$.result.record.packet_id')=OLD.id OR json_extract(outcome,'$.result.record.packet.id')=OLD.id;
 DELETE FROM agent_door_approvals WHERE json_extract(saved,'$.args.packet_id')=OLD.id;
 DELETE FROM agent_door_reviews WHERE json_extract(saved,'$.args.packet_id')=OLD.id;
END;
CREATE TRIGGER pl_learning_erasure_journal AFTER INSERT ON pl_erased_jobs BEGIN
 DELETE FROM pl_learning_packets WHERE id IN (SELECT packet_id FROM pl_learning_sources WHERE job_id=NEW.job_id);
END;
