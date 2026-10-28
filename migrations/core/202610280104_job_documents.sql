-- Private document originals have independent immutable custody, like large plan originals.
CREATE TABLE pl_job_document_files(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,bytes BLOB NOT NULL);
INSERT INTO pl_job_document_files(id,job_id,bytes)
 SELECT a.id,a.job_id,a.bytes FROM pl_attachments a JOIN pl_jobs j ON j.id=a.job_id
 WHERE EXISTS(SELECT 1 FROM json_each(j.data,'$.private_documents.files') d JOIN json_each(d.value,'$.versions') v WHERE json_extract(v.value,'$.file.id')=a.id);
DELETE FROM pl_attachments WHERE id IN (SELECT id FROM pl_job_document_files);
CREATE TRIGGER pl_job_document_erasure AFTER DELETE ON pl_jobs BEGIN DELETE FROM pl_job_document_files WHERE job_id=OLD.id; END;
