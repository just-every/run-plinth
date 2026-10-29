-- Reviewed forecast contents are portable history; execution authority is installation-local.
CREATE TABLE pl_agent_forecast_reviews(
 request_id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL,
 digest TEXT NOT NULL
);
