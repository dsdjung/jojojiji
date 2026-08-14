-- D1 schema for the comments system.
--
-- Fresh setup:
--   npx wrangler d1 execute jojojiji-comments --local  --file=./schema.sql
--   npx wrangler d1 execute jojojiji-comments --remote --file=./schema.sql
--
-- Existing database: apply the files in migrations/ instead.

CREATE TABLE IF NOT EXISTS comments (
  id            TEXT PRIMARY KEY,
  post_slug     TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  author_email  TEXT,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at    TEXT NOT NULL,
  ip_hash       TEXT,
  user_agent    TEXT,

  -- How the commenter identified themselves.
  auth_provider TEXT NOT NULL DEFAULT 'anonymous'
                  CHECK (auth_provider IN ('anonymous', 'google')),
  -- Google's stable subject ID. Null for anonymous. Never shown publicly.
  provider_sub  TEXT,
  -- Profile picture URL from the identity provider.
  avatar_url    TEXT
);

-- Public read path: approved comments for one post, in order.
CREATE INDEX IF NOT EXISTS idx_comments_post_status
  ON comments (post_slug, status, created_at);

-- Admin moderation queue: everything pending, newest first.
CREATE INDEX IF NOT EXISTS idx_comments_status_created
  ON comments (status, created_at);

-- Rate limiting lookups by hashed IP.
CREATE INDEX IF NOT EXISTS idx_comments_ip_created
  ON comments (ip_hash, created_at);

-- Finding every comment by one signed-in person, for moderation.
CREATE INDEX IF NOT EXISTS idx_comments_provider_sub
  ON comments (provider_sub);
