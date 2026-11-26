CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX notes_author ON notes (author_id, created_at);
