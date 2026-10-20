CREATE TABLE pl_invoice_sequence (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 next_number INTEGER NOT NULL CHECK (next_number > 0 AND next_number <= 1000000000000)
);
INSERT INTO pl_invoice_sequence(id,next_number) VALUES(1,1);
