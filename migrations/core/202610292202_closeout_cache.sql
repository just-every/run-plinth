-- Closeout source changes invalidate cached draft results and held packet reads.
-- Packet and draft history remain in the job; no human service decision changes.
CREATE TRIGGER pl_closeout_source_cache AFTER UPDATE OF data ON pl_jobs
WHEN json_array_length(json_extract(OLD.data,'$.agent_closeout')) > 0 AND (
 json_extract(OLD.data,'$.handover') IS NOT json_extract(NEW.data,'$.handover') OR
 json_extract(OLD.data,'$.selections') IS NOT json_extract(NEW.data,'$.selections') OR
 json_extract(OLD.data,'$.punch') IS NOT json_extract(NEW.data,'$.punch') OR
 json_extract(OLD.data,'$.warranties') IS NOT json_extract(NEW.data,'$.warranties') OR
 json_extract(OLD.data,'$.diary') IS NOT json_extract(NEW.data,'$.diary'))
BEGIN
 DELETE FROM agent_door_calls WHERE json_extract(outcome,'$.result.record.job_id')=OLD.id
  OR json_extract(outcome,'$.approval.id') IN (SELECT id FROM agent_door_approvals
   WHERE json_extract(saved,'$.tool') IN ('plinth.closeout.read','plinth.closeout.followup') AND json_extract(saved,'$.args.job_id')=OLD.id);
 DELETE FROM agent_door_approvals WHERE json_extract(saved,'$.tool') IN ('plinth.closeout.read','plinth.closeout.followup') AND json_extract(saved,'$.args.job_id')=OLD.id;
END;

-- A native owner role change also fences Business-token replay of private results.
CREATE TRIGGER pl_closeout_owner_cache AFTER UPDATE OF role,status,version ON oa_operators
WHEN OLD.role='owner' AND (OLD.role IS NOT NEW.role OR OLD.status IS NOT NEW.status OR OLD.version IS NOT NEW.version)
BEGIN
 DELETE FROM agent_door_calls WHERE decision_id IN (SELECT id FROM agent_door_audit WHERE json_extract(row,'$.tool') IN ('plinth.closeout.read','plinth.closeout.followup'));
 DELETE FROM agent_door_approvals WHERE json_extract(saved,'$.tool') IN ('plinth.closeout.read','plinth.closeout.followup');
END;

CREATE TRIGGER pl_closeout_generation_cache AFTER UPDATE OF generation ON oa_auth_settings
WHEN OLD.generation IS NOT NEW.generation
BEGIN
 DELETE FROM agent_door_calls WHERE decision_id IN (SELECT id FROM agent_door_audit WHERE json_extract(row,'$.tool') IN ('plinth.closeout.read','plinth.closeout.followup'));
 DELETE FROM agent_door_approvals WHERE json_extract(saved,'$.tool') IN ('plinth.closeout.read','plinth.closeout.followup');
END;
