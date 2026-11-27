CREATE TABLE IF NOT EXISTS user_article_taxonomies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('category', 'tag')),
  name TEXT NOT NULL,
  parent_id INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS article_taxonomy_owner_idx ON user_article_taxonomies(user_id, kind);

CREATE TABLE IF NOT EXISTS user_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  draft_json TEXT NOT NULL,
  published_json TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private', 'public')),
  revision INTEGER NOT NULL DEFAULT 1,
  published_at INTEGER NOT NULL DEFAULT 0,
  trashed_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS article_owner_idx ON user_articles(user_id, trashed_at, updated_at);
CREATE INDEX IF NOT EXISTS article_public_idx ON user_articles(visibility, trashed_at, published_at);

CREATE TABLE IF NOT EXISTS user_article_files (
  article_id INTEGER NOT NULL REFERENCES user_articles(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL,
  draft_ref INTEGER NOT NULL DEFAULT 0 CHECK(draft_ref IN (0, 1)),
  published_ref INTEGER NOT NULL DEFAULT 0 CHECK(published_ref IN (0, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(article_id, file_id)
);
CREATE INDEX IF NOT EXISTS article_file_reference_idx ON user_article_files(file_id);

CREATE TABLE IF NOT EXISTS user_article_public_taxonomies (
  article_id INTEGER NOT NULL REFERENCES user_articles(id) ON DELETE CASCADE,
  taxonomy_id INTEGER NOT NULL REFERENCES user_article_taxonomies(id),
  PRIMARY KEY(article_id, taxonomy_id)
);
CREATE INDEX IF NOT EXISTS article_public_taxonomy_idx ON user_article_public_taxonomies(taxonomy_id);

CREATE TABLE IF NOT EXISTS article_file_meta (
  file_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS article_file_meta_owner_idx ON article_file_meta(user_id, updated_at);

CREATE TABLE IF NOT EXISTS article_site_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  config_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS article_site_files (
  site_id INTEGER NOT NULL REFERENCES article_site_settings(id),
  file_id INTEGER NOT NULL,
  PRIMARY KEY(site_id, file_id)
);
CREATE INDEX IF NOT EXISTS article_site_file_reference_idx ON article_site_files(file_id);

CREATE TABLE IF NOT EXISTS article_site_quotes (
  quote_day TEXT PRIMARY KEY,
  quote_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('pending', 'ready', 'failed')),
  source TEXT NOT NULL CHECK(source IN ('api', 'manual')),
  revision INTEGER NOT NULL DEFAULT 1,
  fetched_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS article_quote_status_day_idx ON article_site_quotes(status, quote_day);
