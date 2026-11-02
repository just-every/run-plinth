-- Native checkpoints belong to the exact original and disappear with its custody.
CREATE TABLE pl_file_extraction_work (
 file_id TEXT PRIMARY KEY REFERENCES pl_mail_files(id) ON DELETE CASCADE,
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 checksum TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL CHECK(state IN ('queued','complete','no_text','failed')),
 method TEXT NOT NULL,
 progress INTEGER NOT NULL DEFAULT 0,
 total INTEGER,
 error TEXT,
 updated_at TEXT NOT NULL
);
CREATE TABLE pl_file_extraction_pages (
 file_id TEXT NOT NULL REFERENCES pl_file_extraction_work(file_id) ON DELETE CASCADE,
 checksum TEXT NOT NULL,
 page INTEGER NOT NULL,
 text TEXT NOT NULL,
 text_checksum TEXT NOT NULL,
 PRIMARY KEY(file_id,page)
);
-- Execution authority is deliberately excluded from portable archives.
CREATE TABLE pl_file_extraction_reviews (
 file_id TEXT PRIMARY KEY REFERENCES pl_file_extraction_work(file_id) ON DELETE CASCADE,
 checksum TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 owner_version INTEGER NOT NULL
);
