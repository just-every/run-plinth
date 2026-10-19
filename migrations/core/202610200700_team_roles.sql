-- ROLE-001 Plinth preset roles: an operator-auth administrator listed here is a project manager limited to these jobs and PO limit.
CREATE TABLE pl_team(operator_id TEXT PRIMARY KEY REFERENCES oa_operators(id) ON DELETE CASCADE, version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data)));
