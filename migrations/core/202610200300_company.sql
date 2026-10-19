-- One company setup per installation (US-001): name, USD currency, default IANA time zone, US address and phone.
CREATE TABLE pl_company(id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL CHECK(version > 0), data TEXT NOT NULL CHECK(json_valid(data)));
