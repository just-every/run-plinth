-- Erasure removes private forecast copies retained by transport replay and review receipts.
CREATE TRIGGER pl_agent_forecast_erasure BEFORE DELETE ON pl_jobs BEGIN
 DELETE FROM agent_door_calls
 WHERE json_extract(outcome,'$.result.record.packet.format')='plinth-agent-forecast-v1'
   AND json_extract(outcome,'$.result.record.packet.job_id')=OLD.id;
 DELETE FROM agent_door_approvals
 WHERE json_extract(saved,'$.tool') IN ('plinth.forecast.read','plinth.forecast.prepare')
   AND json_extract(saved,'$.args.job_id')=OLD.id;
 DELETE FROM agent_door_reviews
 WHERE json_extract(saved,'$.tool') IN ('plinth.forecast.read','plinth.forecast.prepare')
   AND json_extract(saved,'$.args.job_id')=OLD.id;
END;
