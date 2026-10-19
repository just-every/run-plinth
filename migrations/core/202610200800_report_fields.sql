CREATE TABLE pl_report_config(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE pl_report_values(record_scope TEXT NOT NULL, record_id TEXT NOT NULL, job_id TEXT REFERENCES pl_jobs(id) ON DELETE CASCADE, version INTEGER NOT NULL, stage TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(record_scope,record_id));
CREATE TABLE pl_report_views(id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
