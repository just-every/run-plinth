-- Portable previews remain history. Current review authority never restores from an archive.
CREATE TABLE pl_actuals_refresh_reviews(
 preview_id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL,
 digest TEXT NOT NULL
);
