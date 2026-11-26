ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
CREATE INDEX IF NOT EXISTS tasks_priority_idx ON tasks(board_id, priority, id);
