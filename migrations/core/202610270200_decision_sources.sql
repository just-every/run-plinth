-- Job-owned source annotations and original email custody follow the job's erasure and archive boundary.
CREATE TABLE pl_decision_metadata (
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 source TEXT NOT NULL,
 data TEXT NOT NULL,
 PRIMARY KEY(job_id,source)
);
CREATE TABLE pl_mail_originals (
 message_id TEXT PRIMARY KEY REFERENCES pl_mail_messages(id) ON DELETE CASCADE,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 checksum TEXT NOT NULL,
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 10485760),
 bytes BLOB NOT NULL CHECK(length(bytes)=size),
 UNIQUE(job_id,checksum)
);
