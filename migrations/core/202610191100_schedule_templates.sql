-- Company schedule templates contain schedule data and attributed decisions only.
CREATE TABLE pl_schedule_templates (
 id TEXT PRIMARY KEY NOT NULL,
 version INTEGER NOT NULL CHECK(version > 0),
 data TEXT NOT NULL CHECK(COALESCE(
  json_valid(data)
  AND json_type(data,'$.id') = 'text'
  AND json_type(data,'$.version') = 'integer'
  AND json_extract(data,'$.id') = id
  AND json_extract(data,'$.version') = version,
  0
 ))
);
