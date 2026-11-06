CREATE TABLE member_browser_families (
  family_hash text PRIMARY KEY CHECK (family_hash ~ '^[a-f0-9]{64}$'),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0 AND generation < 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE member_auth_challenges (
  challenge_hash text PRIMARY KEY CHECK (challenge_hash ~ '^[a-f0-9]{64}$'),
  family_hash text NOT NULL REFERENCES member_browser_families(family_hash),
  generation bigint NOT NULL,
  nonce_hash text NOT NULL CHECK (nonce_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_challenge_expiry ON member_auth_challenges(expires_at);
CREATE INDEX member_challenge_family ON member_auth_challenges(family_hash, created_at);

CREATE TABLE member_sessions (
  session_hash text PRIMARY KEY CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  family_hash text NOT NULL REFERENCES member_browser_families(family_hash),
  generation bigint NOT NULL,
  person_key text NOT NULL,
  claims jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX member_session_expiry ON member_sessions(expires_at);
CREATE INDEX member_session_family ON member_sessions(family_hash, created_at);
