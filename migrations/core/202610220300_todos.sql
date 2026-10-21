-- Job to-dos stay in pl_jobs and inherit its erasure and archive custody.
-- This library contains company-level to-dos, reusable templates, schedule-template checklist bindings and personal email choices.
CREATE TABLE pl_todo_library (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('todo','template','preference','job_template')),
 version INTEGER NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data))
);
