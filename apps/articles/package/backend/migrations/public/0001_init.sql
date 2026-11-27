CREATE TABLE IF NOT EXISTS public_articles (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  published_json TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private', 'public')),
  published_at INTEGER NOT NULL DEFAULT 0,
  cover_file_id INTEGER NOT NULL DEFAULT 0,
  cover_width INTEGER NOT NULL DEFAULT 0,
  cover_height INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS public_articles_vis_idx ON public_articles(visibility, published_at);
CREATE INDEX IF NOT EXISTS public_articles_user_idx ON public_articles(user_id, published_at);

CREATE TABLE IF NOT EXISTS public_taxonomies (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('category', 'tag')),
  name TEXT NOT NULL,
  parent_id INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS public_taxonomies_parent_idx ON public_taxonomies(parent_id);

CREATE TABLE IF NOT EXISTS public_article_taxonomies (
  article_id INTEGER NOT NULL,
  taxonomy_id INTEGER NOT NULL,
  PRIMARY KEY(article_id, taxonomy_id)
);
CREATE INDEX IF NOT EXISTS public_article_tax_idx ON public_article_taxonomies(taxonomy_id);

CREATE TABLE IF NOT EXISTS public_article_files (
  article_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(article_id, file_id)
);
CREATE INDEX IF NOT EXISTS public_article_files_fid_idx ON public_article_files(file_id);

CREATE TABLE IF NOT EXISTS public_site_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  config_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public_site_files (
  file_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'image/png',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public_site_quotes (
  quote_day TEXT PRIMARY KEY,
  quote_text TEXT NOT NULL
);
