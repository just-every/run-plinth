-- ROLE-006: custom roles copied from a preset. An assignment in pl_team names a role by id and version, so an edit applies on the next request.
CREATE TABLE pl_roles (id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data)));
