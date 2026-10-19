-- Subscription secrets are returned once; only their SHA-256 digests persist.
CREATE TABLE pl_calendar_tokens (
 token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash)=64),
 person_id TEXT NOT NULL REFERENCES oa_operators(id) ON DELETE CASCADE,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 UNIQUE(person_id,job_id)
);
CREATE INDEX pl_calendar_token_job ON pl_calendar_tokens(job_id);
