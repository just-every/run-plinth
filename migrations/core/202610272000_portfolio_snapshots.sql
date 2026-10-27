-- Explicit report captures retain source versions; current grants and erasure still apply.
CREATE TABLE pl_portfolio_snapshots (
 snapshot_id TEXT NOT NULL,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 captured_at TEXT NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data)),
 PRIMARY KEY(snapshot_id,job_id)
);
