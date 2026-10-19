CREATE TABLE pl_schedule_constraint_files (
 id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 bytes BLOB NOT NULL
);
