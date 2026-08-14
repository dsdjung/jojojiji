-- D1 schema for the comments system.
--
-- Apply locally:  npx wrangler d1 execute jojojiji-comments --local  --file=./schema.sql
-- Apply remotely: npx wrangler d1 execute jojojiji-comments --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS comments (
  id           TEXT PRIMARY KEY,
  post_slug    TEXT NOT NULL,
  author_name  TEXT NOT NULL,
  author_email TEXT,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at   TEXT NOT NULL,
  ip_hash      TEXT,
  user_agent   TEXT
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
