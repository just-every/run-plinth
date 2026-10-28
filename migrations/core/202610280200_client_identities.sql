-- Client job authority follows the operator bound at invitation acceptance, not a mutable sign-in address.
CREATE TABLE pl_job_clients (
 job_id TEXT NOT NULL REFERENCES pl_jobs(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL REFERENCES oa_operators(id),
 source TEXT NOT NULL,
 PRIMARY KEY(job_id,source)
);
CREATE INDEX pl_job_client_operator ON pl_job_clients(operator_id,job_id);

-- Existing accepted clients keep their current job links at upgrade time. A cancelled,
-- never-accepted invitation is not a client identity.
INSERT OR IGNORE INTO pl_job_clients(job_id,operator_id,source)
SELECT j.id,o.id,'primary' FROM pl_jobs j JOIN oa_operators o
 ON lower(o.email)=lower(json_extract(j.data,'$.client_email'))
WHERE o.role='member' AND (
 o.status='active' OR o.status='inactive' AND NOT EXISTS(
  SELECT 1 FROM oa_invitation_cancellations WHERE operator_id=o.id
 )
);
INSERT OR IGNORE INTO pl_job_clients(job_id,operator_id,source)
SELECT j.id,o.id,'contact:'||selected.value
FROM pl_jobs j
JOIN pl_customers c ON c.id=json_extract(j.data,'$.customer_id')
JOIN json_each(j.data,'$.client_contact_ids') selected
JOIN json_each(c.data,'$.contacts') contact ON json_extract(contact.value,'$.id')=selected.value
JOIN oa_operators o ON lower(o.email)=lower(json_extract(contact.value,'$.email'))
WHERE o.role='member' AND (
 o.status='active' OR o.status='inactive' AND NOT EXISTS(
  SELECT 1 FROM oa_invitation_cancellations WHERE operator_id=o.id
 )
);

-- Both native-link and provider invitation acceptance cross this same durable status edge.
CREATE TRIGGER pl_bind_client_invitation AFTER UPDATE OF status ON oa_operators
WHEN OLD.status='invited' AND NEW.status='active' AND NEW.role='member'
BEGIN
 INSERT OR IGNORE INTO pl_job_clients(job_id,operator_id,source)
 SELECT id,NEW.id,'primary' FROM pl_jobs
 WHERE lower(json_extract(data,'$.client_email'))=lower(NEW.email);
 INSERT OR IGNORE INTO pl_job_clients(job_id,operator_id,source)
 SELECT j.id,NEW.id,'contact:'||selected.value
 FROM pl_jobs j
 JOIN pl_customers c ON c.id=json_extract(j.data,'$.customer_id')
 JOIN json_each(j.data,'$.client_contact_ids') selected
 JOIN json_each(c.data,'$.contacts') contact ON json_extract(contact.value,'$.id')=selected.value
 WHERE lower(json_extract(contact.value,'$.email'))=lower(NEW.email);
END;

-- A job commissioned after acceptance binds the currently named client account once.
CREATE TRIGGER pl_bind_new_job AFTER INSERT ON pl_jobs
BEGIN
 INSERT OR IGNORE INTO pl_job_clients(job_id,operator_id,source)
 SELECT NEW.id,id,'primary' FROM oa_operators
 WHERE role='member' AND status='active' AND lower(email)=lower(json_extract(NEW.data,'$.client_email'));
 INSERT OR IGNORE INTO pl_job_clients(job_id,operator_id,source)
 SELECT NEW.id,o.id,'contact:'||selected.value
 FROM pl_customers c
 JOIN json_each(NEW.data,'$.client_contact_ids') selected
 JOIN json_each(c.data,'$.contacts') contact ON json_extract(contact.value,'$.id')=selected.value
 JOIN oa_operators o ON lower(o.email)=lower(json_extract(contact.value,'$.email'))
 WHERE c.id=json_extract(NEW.data,'$.customer_id') AND o.role='member' AND o.status='active';
END;

-- Editing the customer directory is an explicit owner action: revoke stale contact links
-- and bind any currently accepted replacement contact selected on those jobs.
CREATE TRIGGER pl_refresh_customer_clients AFTER UPDATE OF data ON pl_customers
BEGIN
 DELETE FROM pl_job_clients
 WHERE source LIKE 'contact:%' AND job_id IN (
  SELECT id FROM pl_jobs WHERE json_extract(data,'$.customer_id')=NEW.id
 );
 INSERT OR IGNORE INTO pl_job_clients(job_id,operator_id,source)
 SELECT j.id,o.id,'contact:'||selected.value
 FROM pl_jobs j
 JOIN json_each(j.data,'$.client_contact_ids') selected
 JOIN json_each(NEW.data,'$.contacts') contact ON json_extract(contact.value,'$.id')=selected.value
 JOIN oa_operators o ON lower(o.email)=lower(json_extract(contact.value,'$.email'))
 WHERE json_extract(j.data,'$.customer_id')=NEW.id AND o.role='member' AND o.status='active';
END;
