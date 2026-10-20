-- Transient cursor only: agreement authority and attempts remain in the job.
CREATE TABLE pl_warranty_scheduler (id INTEGER PRIMARY KEY CHECK(id=1), last_rowid INTEGER NOT NULL);
INSERT INTO pl_warranty_scheduler(id,last_rowid) VALUES(1,0);
