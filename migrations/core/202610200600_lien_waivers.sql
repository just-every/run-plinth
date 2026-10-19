-- SUB-004 owner waiver wording per state (optionally per job) and the signed release originals of each job.
CREATE TABLE pl_lien_waiver_templates(id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE pl_lien_waiver_files (
 id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 bytes BLOB NOT NULL
);
