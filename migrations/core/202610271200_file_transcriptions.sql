-- Supplementary human text never replaces original bytes or embedded extraction.
CREATE TABLE pl_file_transcriptions (
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 source TEXT NOT NULL,
 checksum TEXT NOT NULL CHECK(length(checksum)=64),
 revision INTEGER NOT NULL CHECK(revision>0),
 text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 100000),
 supplied_by TEXT NOT NULL,
 PRIMARY KEY(job_id,source,revision)
);
CREATE TRIGGER pl_file_transcriptions_immutable BEFORE UPDATE ON pl_file_transcriptions
BEGIN SELECT RAISE(ABORT,'Transcription revisions are immutable'); END;
