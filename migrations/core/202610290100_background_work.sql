-- A private snapshot and bounded output checkpoints survive a process restart.
CREATE TABLE pl_background_work(
 id TEXT PRIMARY KEY,
 version INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('paused','complete','failed','cancelled')),
 owner_id TEXT NOT NULL,
 format TEXT NOT NULL CHECK(format IN ('csv','xlsx')),
 created_at TEXT NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data)),
 progress INTEGER NOT NULL DEFAULT 0,
 total INTEGER NOT NULL,
 error TEXT,
 checksum TEXT
);
CREATE TABLE pl_background_sources(
 task_id TEXT NOT NULL REFERENCES pl_background_work(id) ON DELETE CASCADE,
 record_scope TEXT NOT NULL,
 record_id TEXT NOT NULL,
 job_id TEXT,
 PRIMARY KEY(task_id,record_id)
);
CREATE TABLE pl_background_chunks(
 task_id TEXT NOT NULL REFERENCES pl_background_work(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL,
 source TEXT NOT NULL CHECK(json_valid(source)),
 output TEXT,
 PRIMARY KEY(task_id,sequence)
);
-- Deliberately excluded from archives: restored tasks have no execution authority.
CREATE TABLE pl_background_reviews(task_id TEXT PRIMARY KEY REFERENCES pl_background_work(id) ON DELETE CASCADE, owner_id TEXT NOT NULL, digest TEXT NOT NULL);
CREATE TRIGGER pl_background_job_erasure BEFORE DELETE ON pl_jobs BEGIN
 DELETE FROM pl_background_work WHERE id IN (SELECT task_id FROM pl_background_sources WHERE job_id=OLD.id);
END;
CREATE TRIGGER pl_background_customer_erasure BEFORE DELETE ON pl_customers BEGIN
 DELETE FROM pl_background_work WHERE id IN (SELECT task_id FROM pl_background_sources WHERE record_scope='customer' AND record_id=OLD.id);
END;
CREATE TRIGGER pl_background_vendor_erasure BEFORE DELETE ON pl_vendors BEGIN
 DELETE FROM pl_background_work WHERE id IN (SELECT task_id FROM pl_background_sources WHERE record_scope='vendor' AND record_id=OLD.id);
END;
