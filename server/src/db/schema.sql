-- Chrome owns: url, folder, position, title, date_added.
-- The app owns everything else, keyed on bookmark id, so a Chrome-side delete
-- never destroys enrichment, tags or notes.

CREATE TABLE IF NOT EXISTS folders (
  id          INTEGER PRIMARY KEY,
  chrome_guid TEXT    NOT NULL UNIQUE,
  parent_guid TEXT,
  root        TEXT    NOT NULL,           -- bookmark_bar | other | synced
  name        TEXT    NOT NULL,
  path        TEXT    NOT NULL,           -- 'Bookmarks bar/Dev/Rust'
  depth       INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  date_added  INTEGER,
  present     INTEGER NOT NULL DEFAULT 1,
  chrome_id   TEXT
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id             INTEGER PRIMARY KEY,
  chrome_guid    TEXT    NOT NULL UNIQUE,
  folder_guid    TEXT,
  url            TEXT    NOT NULL,
  url_hash       TEXT    NOT NULL,        -- sha1 of the normalised url
  domain         TEXT    NOT NULL,
  chrome_title   TEXT,
  position       INTEGER NOT NULL DEFAULT 0,
  date_added     INTEGER,
  date_last_used INTEGER,
  first_seen     INTEGER NOT NULL,
  present        INTEGER NOT NULL DEFAULT 1,
  removed_at     INTEGER,
  source         TEXT    NOT NULL DEFAULT 'chrome',  -- chrome | local
  -- Chrome's own node id. The chrome.bookmarks API addresses nodes by id, not
  -- guid, so write-back needs it; it is not stable across profile rebuilds,
  -- which is why the guid stays the identity and this is only a lookup hint.
  chrome_id      TEXT
);

-- 1:1 enrichment scraped from the site itself.
CREATE TABLE IF NOT EXISTS metadata (
  bookmark_id  INTEGER PRIMARY KEY REFERENCES bookmarks(id) ON DELETE CASCADE,
  title        TEXT,
  description  TEXT,
  site_name    TEXT,
  favicon_path TEXT,
  thumb_path   TEXT,
  thumb_source TEXT,                      -- og | twitter | icon | none
  accent_color TEXT,                      -- '#rrggbb', drives the fallback card
  http_status  INTEGER,
  content_type TEXT,
  reading_time INTEGER,                   -- minutes
  fetched_at   INTEGER,
  fetch_error  TEXT,
  link_status  TEXT                       -- ok | blocked | dead | unreachable
);

CREATE TABLE IF NOT EXISTS content (
  bookmark_id INTEGER PRIMARY KEY REFERENCES bookmarks(id) ON DELETE CASCADE,
  text        TEXT,
  excerpt     TEXT,
  word_count  INTEGER
);

-- Standalone FTS index, rebuilt per bookmark. Not external-content: the tiny
-- duplication is worth not fighting FTS5 delete semantics.
CREATE VIRTUAL TABLE IF NOT EXISTS bookmarks_fts USING fts5(
  title,
  description,
  url,
  text,
  notes,
  bookmark_id UNINDEXED,
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color      TEXT NOT NULL DEFAULT 'slate',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmark_tags (
  bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (bookmark_id, tag_id)
);

CREATE TABLE IF NOT EXISTS user_data (
  bookmark_id  INTEGER PRIMARY KEY REFERENCES bookmarks(id) ON DELETE CASCADE,
  notes        TEXT,
  favorite     INTEGER NOT NULL DEFAULT 0,
  custom_title TEXT,
  updated_at   INTEGER,
  -- Hidden bookmarks stay in the database and keep their tags and notes, but
  -- never appear in any view except Hidden. Chrome re-importing them is a
  -- no-op, so hiding survives a sync.
  hidden       INTEGER NOT NULL DEFAULT 0,
  hidden_at    INTEGER
);

-- Whole folders the library should ignore. Keyed on guid so a rename in Chrome
-- does not silently un-exclude the folder.
CREATE TABLE IF NOT EXISTS folder_exclusions (
  folder_guid TEXT PRIMARY KEY,
  excluded_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS enrich_queue (
  bookmark_id     INTEGER PRIMARY KEY REFERENCES bookmarks(id) ON DELETE CASCADE,
  state           TEXT    NOT NULL DEFAULT 'pending',  -- pending | done | failed | skipped
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  updated_at      INTEGER NOT NULL DEFAULT 0
);

-- Changes this app wants made in Chrome. The companion extension drains this
-- queue through the chrome.bookmarks API; nothing here ever writes Chrome's
-- file directly, because Chrome keeps bookmarks in memory and would overwrite
-- anything we put there.
CREATE TABLE IF NOT EXISTS bookmark_ops (
  id          INTEGER PRIMARY KEY,
  op          TEXT    NOT NULL,                     -- delete | move
  bookmark_id INTEGER REFERENCES bookmarks(id) ON DELETE CASCADE,
  chrome_guid TEXT,
  chrome_id   TEXT,
  url         TEXT,                                 -- verified before deleting
  payload     TEXT,                                 -- JSON, op-specific
  state       TEXT    NOT NULL DEFAULT 'pending',   -- pending | done | failed
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  applied_at  INTEGER,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_ops_state ON bookmark_ops(state, id);

-- Chrome writes its Bookmarks file a moment after the extension deletes a node,
-- so a sync landing in that gap would re-import the bookmark we just removed.
-- A short-lived tombstone closes that window; it expires so that genuinely
-- re-adding the same bookmark in Chrome later still works.
CREATE TABLE IF NOT EXISTS deleted_guids (
  chrome_guid TEXT PRIMARY KEY,
  deleted_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
  id          INTEGER PRIMARY KEY,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  added       INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL DEFAULT 0,
  removed     INTEGER NOT NULL DEFAULT 0,
  resurrected INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_folder  ON bookmarks(folder_guid);
CREATE INDEX IF NOT EXISTS idx_bookmarks_present ON bookmarks(present);
CREATE INDEX IF NOT EXISTS idx_bookmarks_hash    ON bookmarks(url_hash);
CREATE INDEX IF NOT EXISTS idx_bookmarks_domain  ON bookmarks(domain);
CREATE INDEX IF NOT EXISTS idx_folders_parent    ON folders(parent_guid);
CREATE INDEX IF NOT EXISTS idx_btags_tag         ON bookmark_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_queue_state       ON enrich_queue(state, next_attempt_at);
