-- SUB-001 subcontractor and vendor directory; W-9 originals stay private beside it.
CREATE TABLE pl_vendors(id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE pl_vendor_documents(id TEXT PRIMARY KEY NOT NULL, vendor_id TEXT NOT NULL REFERENCES pl_vendors(id) ON DELETE CASCADE, name TEXT NOT NULL, mime TEXT NOT NULL, checksum TEXT NOT NULL, size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 2097152), bytes BLOB NOT NULL CHECK(length(bytes)=size));
CREATE INDEX pl_vendor_document_vendor ON pl_vendor_documents(vendor_id);
