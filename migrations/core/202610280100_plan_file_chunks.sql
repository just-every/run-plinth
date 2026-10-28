-- Large plan originals are kept in bounded rows under the same job custody.
CREATE TABLE pl_plan_file_chunks (
 file_id TEXT NOT NULL,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 set_id TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position >= 0),
 bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 1 AND 524288),
 PRIMARY KEY(file_id,position)
);
CREATE INDEX pl_plan_chunk_job ON pl_plan_file_chunks(job_id);
