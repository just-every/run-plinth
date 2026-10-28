-- Company originals remain independent of job custody and are included by native portability.
CREATE TABLE pl_company_documents(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE pl_company_document_files(id TEXT PRIMARY KEY,bytes BLOB NOT NULL);
