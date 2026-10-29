-- Recovery observations and comparisons must disappear with their source job,
-- including replayed assessments of earlier reviewed packets.
CREATE TRIGGER pl_recovery_evidence_payload_erased BEFORE DELETE ON pl_jobs BEGIN
 DELETE FROM agent_door_calls
 WHERE json_extract(outcome,'$.result.record.packet_id') IN (
  SELECT json_extract(packet.value,'$.id')
  FROM json_each(OLD.data,'$.recovery_evidence') AS recovery,
       json_each(recovery.value,'$.packets') AS packet
 ) OR json_extract(outcome,'$.result.record.packet.id') IN (
  SELECT json_extract(packet.value,'$.id')
  FROM json_each(OLD.data,'$.recovery_evidence') AS recovery,
       json_each(recovery.value,'$.packets') AS packet
 ) OR decision_id IN (
  SELECT json_extract(saved,'$.decision_id') FROM agent_door_approvals
  WHERE json_extract(saved,'$.tool') IN ('plinth.recovery.get','plinth.recovery.assess')
   AND json_extract(saved,'$.args.job_id')=OLD.id
 );
 DELETE FROM agent_door_approvals
 WHERE json_extract(saved,'$.tool') IN ('plinth.recovery.get','plinth.recovery.assess')
  AND json_extract(saved,'$.args.job_id')=OLD.id;
END;
