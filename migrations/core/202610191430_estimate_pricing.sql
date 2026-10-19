-- Human-reviewed dated rate revisions; historical revisions remain in immutable JSON history.
CREATE TABLE pl_pricing_rates(id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data)));
