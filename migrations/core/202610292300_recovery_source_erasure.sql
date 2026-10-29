-- Recovery comparisons copy other jobs' private bookings into immutable packets.
-- Retire the whole affected packet, its report captures and agent replay payloads.
CREATE VIEW pl_recovery_packets AS
 SELECT jobs.id AS host_job_id, packet.value AS packet
 FROM pl_jobs AS jobs, json_each(jobs.data,'$.recovery_requests') AS packet
 UNION ALL
 SELECT snapshots.job_id, packet.value
 FROM pl_portfolio_snapshots AS snapshots, json_each(snapshots.data,'$.job.recovery_requests') AS packet
 UNION ALL
 SELECT json_extract(saved,'$.args.job_id'), json_extract(result,'$.result.record')
 FROM agent_door_approvals
 WHERE json_extract(saved,'$.tool')='plinth.recovery.read' AND json_type(result,'$.result.record.sources')='object'
 UNION ALL
 SELECT json_extract(outcome,'$.result.record.sources.job_id'), json_extract(outcome,'$.result.record')
 FROM agent_door_calls WHERE json_type(outcome,'$.result.record.sources')='object';
CREATE VIEW pl_recovery_packet_sources AS
 SELECT host_job_id, json_extract(packet,'$.id') AS request_id, host_job_id AS source_id FROM pl_recovery_packets
 UNION
 SELECT host_job_id, json_extract(packet,'$.id'), json_extract(booking.value,'$.job_id')
 FROM pl_recovery_packets, json_each(packet,'$.sources.facts.bookings') AS booking;
-- Check every held source before withdrawing shared historical evidence.
CREATE TRIGGER pl_recovery_source_erasure BEFORE DELETE ON pl_jobs BEGIN
 SELECT RAISE(ABORT,'CHECK constraint failed: held_recovery_source') WHERE EXISTS(
  SELECT 1 FROM pl_recovery_packet_sources AS peer JOIN pl_holds AS held ON held.subject_kind='job' AND held.subject_id=peer.source_id
  WHERE peer.request_id IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id=OLD.id)
   AND held.released_at IS NULL AND (held.kind='legal_hold' OR held.until>=date('now'))
 );
 DELETE FROM agent_door_calls
 WHERE json_extract(outcome,'$.result.record.id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (OLD.id))
  OR json_extract(outcome,'$.result.record.request_id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (OLD.id))
  OR decision_id IN (SELECT json_extract(saved,'$.decision_id') FROM agent_door_approvals
   WHERE json_extract(saved,'$.tool') IN ('plinth.recovery.read','plinth.recovery.compare')
    AND json_extract(saved,'$.args.request_id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (OLD.id)));
 DELETE FROM agent_door_reviews
 WHERE json_extract(saved,'$.tool') IN ('plinth.recovery.read','plinth.recovery.compare')
  AND json_extract(saved,'$.args.request_id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (OLD.id));
 DELETE FROM agent_door_approvals
 WHERE json_extract(saved,'$.tool') IN ('plinth.recovery.read','plinth.recovery.compare')
  AND json_extract(saved,'$.args.request_id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (OLD.id));
 DELETE FROM pl_portfolio_snapshots WHERE EXISTS(
  SELECT 1 FROM json_each(pl_portfolio_snapshots.data,'$.job.recovery_requests') AS packet
  WHERE json_extract(packet.value,'$.id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (OLD.id))
 );
 UPDATE pl_jobs SET data=json_set(data,'$.recovery_requests',json((
  SELECT json_group_array(json(packet.value)) FROM json_each(pl_jobs.data,'$.recovery_requests') AS packet
  WHERE json_extract(packet.value,'$.id') NOT IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (OLD.id))
  )),'$.version',version+1), version=version+1
 WHERE EXISTS(SELECT 1 FROM json_each(pl_jobs.data,'$.recovery_requests') AS packet
  WHERE json_extract(packet.value,'$.id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (OLD.id)));
END;
CREATE TRIGGER pl_recovery_source_journal AFTER INSERT ON pl_erased_jobs BEGIN
 DELETE FROM agent_door_calls
 WHERE json_extract(outcome,'$.result.record.id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (NEW.job_id))
  OR json_extract(outcome,'$.result.record.request_id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (NEW.job_id))
  OR decision_id IN (SELECT json_extract(saved,'$.decision_id') FROM agent_door_approvals
   WHERE json_extract(saved,'$.tool') IN ('plinth.recovery.read','plinth.recovery.compare')
    AND json_extract(saved,'$.args.request_id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (NEW.job_id)));
 DELETE FROM agent_door_reviews
 WHERE json_extract(saved,'$.tool') IN ('plinth.recovery.read','plinth.recovery.compare')
  AND json_extract(saved,'$.args.request_id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (NEW.job_id));
 DELETE FROM agent_door_approvals
 WHERE json_extract(saved,'$.tool') IN ('plinth.recovery.read','plinth.recovery.compare')
  AND json_extract(saved,'$.args.request_id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (NEW.job_id));
 DELETE FROM pl_portfolio_snapshots WHERE EXISTS(
  SELECT 1 FROM json_each(pl_portfolio_snapshots.data,'$.job.recovery_requests') AS packet
  WHERE json_extract(packet.value,'$.id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (NEW.job_id))
 );
 UPDATE pl_jobs SET data=json_set(data,'$.recovery_requests',json((
  SELECT json_group_array(json(packet.value)) FROM json_each(pl_jobs.data,'$.recovery_requests') AS packet
  WHERE json_extract(packet.value,'$.id') NOT IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (NEW.job_id))
  )),'$.version',version+1), version=version+1
 WHERE EXISTS(SELECT 1 FROM json_each(pl_jobs.data,'$.recovery_requests') AS packet
  WHERE json_extract(packet.value,'$.id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (NEW.job_id)));
END;
-- Apply the same retirement to installations upgrading after an earlier erasure.
 DELETE FROM agent_door_calls
 WHERE json_extract(outcome,'$.result.record.id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (SELECT job_id FROM pl_erased_jobs))
  OR json_extract(outcome,'$.result.record.request_id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (SELECT job_id FROM pl_erased_jobs))
  OR decision_id IN (SELECT json_extract(saved,'$.decision_id') FROM agent_door_approvals
   WHERE json_extract(saved,'$.tool') IN ('plinth.recovery.read','plinth.recovery.compare')
    AND json_extract(saved,'$.args.request_id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (SELECT job_id FROM pl_erased_jobs)));
 DELETE FROM agent_door_reviews
 WHERE json_extract(saved,'$.tool') IN ('plinth.recovery.read','plinth.recovery.compare')
  AND json_extract(saved,'$.args.request_id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (SELECT job_id FROM pl_erased_jobs));
 DELETE FROM agent_door_approvals
 WHERE json_extract(saved,'$.tool') IN ('plinth.recovery.read','plinth.recovery.compare')
  AND json_extract(saved,'$.args.request_id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (SELECT job_id FROM pl_erased_jobs));
 DELETE FROM pl_portfolio_snapshots WHERE EXISTS(
  SELECT 1 FROM json_each(pl_portfolio_snapshots.data,'$.job.recovery_requests') AS packet
  WHERE json_extract(packet.value,'$.id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (SELECT job_id FROM pl_erased_jobs))
 );
 UPDATE pl_jobs SET data=json_set(data,'$.recovery_requests',json((
  SELECT json_group_array(json(packet.value)) FROM json_each(pl_jobs.data,'$.recovery_requests') AS packet
  WHERE json_extract(packet.value,'$.id') NOT IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (SELECT job_id FROM pl_erased_jobs))
  )),'$.version',version+1), version=version+1
 WHERE EXISTS(SELECT 1 FROM json_each(pl_jobs.data,'$.recovery_requests') AS packet
  WHERE json_extract(packet.value,'$.id') IN (SELECT request_id FROM pl_recovery_packet_sources WHERE source_id IN (SELECT job_id FROM pl_erased_jobs)));
CREATE TRIGGER pl_jobs_recovery_retired_insert BEFORE INSERT ON pl_jobs BEGIN
 SELECT RAISE(ABORT,'CHECK constraint failed: recovery_source_erased') WHERE EXISTS(
  SELECT 1 FROM json_each(NEW.data,'$.recovery_requests') AS packet,
   json_each(packet.value,'$.sources.facts.bookings') AS booking JOIN pl_erased_jobs AS erased
    ON erased.job_id=json_extract(booking.value,'$.job_id')
 );
END;
CREATE TRIGGER pl_jobs_recovery_retired_update BEFORE UPDATE ON pl_jobs BEGIN
 SELECT RAISE(ABORT,'CHECK constraint failed: recovery_source_erased') WHERE EXISTS(
  SELECT 1 FROM json_each(NEW.data,'$.recovery_requests') AS packet,
   json_each(packet.value,'$.sources.facts.bookings') AS booking JOIN pl_erased_jobs AS erased
    ON erased.job_id=json_extract(booking.value,'$.job_id')
 );
END;
CREATE TRIGGER pl_portfolio_snapshots_recovery_retired_insert BEFORE INSERT ON pl_portfolio_snapshots BEGIN
 SELECT RAISE(ABORT,'CHECK constraint failed: recovery_source_erased') WHERE EXISTS(
  SELECT 1 FROM json_each(NEW.data,'$.job.recovery_requests') AS packet,
   json_each(packet.value,'$.sources.facts.bookings') AS booking JOIN pl_erased_jobs AS erased
    ON erased.job_id=json_extract(booking.value,'$.job_id')
 );
END;
CREATE TRIGGER pl_portfolio_snapshots_recovery_retired_update BEFORE UPDATE ON pl_portfolio_snapshots BEGIN
 SELECT RAISE(ABORT,'CHECK constraint failed: recovery_source_erased') WHERE EXISTS(
  SELECT 1 FROM json_each(NEW.data,'$.job.recovery_requests') AS packet,
   json_each(packet.value,'$.sources.facts.bookings') AS booking JOIN pl_erased_jobs AS erased
    ON erased.job_id=json_extract(booking.value,'$.job_id')
 );
END;
