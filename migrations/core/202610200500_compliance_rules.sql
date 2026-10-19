-- SUB-003 owner rules: required insurance/license evidence per trade and the designated reviewers.
CREATE TABLE pl_compliance_rules(id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data)));
