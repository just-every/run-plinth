-- Durable run history travels; execution consent stays installation-local.
CREATE TABLE pl_agent_runs(
 id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL,
 version INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('ready','paused','complete','failed','cancelled','revoked')),
 expected_job_version INTEGER NOT NULL,
 next_sequence INTEGER NOT NULL DEFAULT 0,
 payload_bytes INTEGER NOT NULL DEFAULT 0,
 native_ms REAL NOT NULL DEFAULT 0,
 error TEXT,
 data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE TABLE pl_agent_run_steps(
 run_id TEXT NOT NULL REFERENCES pl_agent_runs(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data)),
 PRIMARY KEY(run_id,sequence)
);
CREATE TABLE pl_agent_run_consents(
 run_id TEXT PRIMARY KEY REFERENCES pl_agent_runs(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL,
 owner_version INTEGER NOT NULL,
 digest TEXT NOT NULL
);
CREATE TABLE pl_agent_schedules(
 id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL,
 version INTEGER NOT NULL,
 paused INTEGER NOT NULL DEFAULT 0,
 data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE TABLE pl_agent_schedule_consents(
 schedule_id TEXT PRIMARY KEY REFERENCES pl_agent_schedules(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL,
 owner_version INTEGER NOT NULL
);
CREATE TABLE pl_agent_tickets(
 id TEXT PRIMARY KEY,
 schedule_id TEXT NOT NULL REFERENCES pl_agent_schedules(id) ON DELETE CASCADE,
 due_at TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'review_required' CHECK(state='review_required'),
 UNIQUE(schedule_id,due_at)
);
CREATE TRIGGER pl_agent_run_erasure BEFORE DELETE ON pl_agent_runs BEGIN
 DELETE FROM agent_door_calls WHERE json_extract(outcome,'$.result.record.run.id')=OLD.id;
 DELETE FROM agent_door_approvals WHERE json_extract(saved,'$.args.run_id')=OLD.id;
 DELETE FROM agent_door_reviews WHERE json_extract(saved,'$.args.run_id')=OLD.id;
END;
CREATE TRIGGER pl_agent_run_erasure_journal AFTER INSERT ON pl_erased_jobs BEGIN
 DELETE FROM pl_agent_runs WHERE job_id=NEW.job_id;
 DELETE FROM pl_agent_schedules WHERE job_id=NEW.job_id;
END;
