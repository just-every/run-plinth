-- Plinth: complete immutable decision evidence travels with each job.
CREATE TABLE pl_jobs (id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL CHECK(version>0), data TEXT NOT NULL CHECK(COALESCE(json_valid(data) AND json_type(data,'$.id')='text' AND json_type(data,'$.version')='integer' AND json_extract(data,'$.id')=id AND json_extract(data,'$.version')=version,0)));
CREATE TABLE pl_attachments (id TEXT PRIMARY KEY NOT NULL,job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,entry_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,checksum TEXT NOT NULL,size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 2097152),bytes BLOB NOT NULL CHECK(length(bytes)=size));
CREATE INDEX pl_attachment_job ON pl_attachments(job_id);
CREATE TABLE pl_erased_jobs (job_id TEXT PRIMARY KEY NOT NULL,erased_at TEXT NOT NULL);
CREATE TRIGGER pl_no_resurrection BEFORE INSERT ON pl_jobs WHEN EXISTS(SELECT 1 FROM pl_erased_jobs WHERE job_id=NEW.id) BEGIN SELECT RAISE(ABORT,'job_erased'); END;
CREATE TRIGGER pl_no_resurrection_update BEFORE UPDATE ON pl_jobs WHEN EXISTS(SELECT 1 FROM pl_erased_jobs WHERE job_id=NEW.id) BEGIN SELECT RAISE(ABORT,'job_erased'); END;
CREATE TABLE pl_clock(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
INSERT INTO pl_clock VALUES(1,1);
-- A deliberately failing guard makes D1 batch roll back every domain write.
CREATE TABLE pl_guard(ok INTEGER NOT NULL CHECK(ok=1));
