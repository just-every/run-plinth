ALTER TABLE pl_estimate_catalog ADD COLUMN import_group TEXT;
ALTER TABLE pl_estimate_catalog ADD COLUMN import_revision TEXT;
CREATE INDEX pl_catalog_import_group ON pl_estimate_catalog(import_group);
