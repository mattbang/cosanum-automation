CREATE TABLE workflow_requests (
  request_id text PRIMARY KEY,
  requester_name text NOT NULL,
  source_team text,
  reason text NOT NULL CHECK (reason IN ('new_training', 'retraining', 'process_change')),
  deadline_date date NOT NULL,
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('open', 'planning', 'invited', 'assessed', 'acknowledged', 'proof_ready', 'archived_verified', 'complete')),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_sessions (
  session_id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES workflow_requests(request_id),
  status text NOT NULL DEFAULT 'planned',
  starts_at timestamptz,
  ends_at timestamptz,
  calendar_event_id text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE workflow_cases (
  case_id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES workflow_requests(request_id),
  session_id text REFERENCES workflow_sessions(session_id),
  participant_key text NOT NULL,
  trainer_key text NOT NULL,
  owner_key text NOT NULL,
  proof_id text,
  proof_version text,
  status text NOT NULL DEFAULT 'open',
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, request_id),
  CHECK ((proof_id IS NULL) = (proof_version IS NULL))
);
CREATE INDEX workflow_cases_request_idx ON workflow_cases(request_id);
CREATE INDEX workflow_cases_session_idx ON workflow_cases(session_id);

CREATE TABLE verified_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  email_normalized text NOT NULL,
  email_verified boolean NOT NULL CHECK (email_verified),
  actor_key text NOT NULL,
  role text NOT NULL CHECK (role IN ('process_quality', 'assigned_trainer', 'assigned_participant', 'system')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject),
  UNIQUE (issuer, email_normalized, actor_key, role)
);

CREATE TABLE workflow_assignments (
  assignment_id bigserial PRIMARY KEY,
  case_id text NOT NULL REFERENCES workflow_cases(case_id),
  role text NOT NULL CHECK (role IN ('assigned_trainer', 'assigned_participant', 'process_quality')),
  actor_key text NOT NULL,
  email_normalized text,
  identity_issuer text,
  identity_subject text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK ((identity_issuer IS NULL) = (identity_subject IS NULL)),
  CHECK (active OR revoked_at IS NOT NULL)
);
CREATE UNIQUE INDEX workflow_assignments_active_actor_idx
  ON workflow_assignments(case_id, role, actor_key) WHERE active;
CREATE INDEX workflow_assignments_identity_idx
  ON workflow_assignments(identity_issuer, identity_subject) WHERE active;

CREATE TABLE hosted_participant_links (
  link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text NOT NULL REFERENCES workflow_cases(case_id),
  assignment_id bigint NOT NULL REFERENCES workflow_assignments(assignment_id),
  token_hash bytea NOT NULL UNIQUE,
  email_normalized text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  claimed_issuer text,
  claimed_subject text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_claimed_at timestamptz,
  CHECK ((claimed_issuer IS NULL) = (claimed_subject IS NULL))
);
CREATE INDEX hosted_participant_links_case_idx ON hosted_participant_links(case_id);

CREATE TABLE case_evidence (
  evidence_id bigserial PRIMARY KEY,
  case_id text NOT NULL REFERENCES workflow_cases(case_id),
  fact_key text NOT NULL,
  fact_value boolean,
  value_key text,
  value_text text,
  source_type text NOT NULL,
  source_id text,
  source_version text,
  observed_at timestamptz NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((fact_key <> '') OR (value_key IS NOT NULL))
);
CREATE INDEX case_evidence_latest_idx ON case_evidence(case_id, fact_key, observed_at DESC);

CREATE TABLE workflow_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL REFERENCES workflow_requests(request_id),
  case_id text NOT NULL REFERENCES workflow_cases(case_id),
  action_id text NOT NULL,
  actor_key text NOT NULL,
  actor_role text NOT NULL,
  actor_email text NOT NULL,
  idempotency_key text NOT NULL,
  scope jsonb NOT NULL,
  before_revision bigint NOT NULL,
  after_revision bigint NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'conflict')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, idempotency_key),
  CHECK (after_revision >= before_revision)
);
CREATE INDEX workflow_events_case_time_idx ON workflow_events(case_id, occurred_at DESC);

CREATE TABLE audit_events (
  audit_id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_key text NOT NULL,
  actor_role text NOT NULL,
  actor_email text NOT NULL,
  operation text NOT NULL,
  request_id text,
  case_id text,
  event_id uuid REFERENCES workflow_events(event_id),
  outcome text NOT NULL,
  correlation_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_events_case_time_idx ON audit_events(case_id, occurred_at DESC);
CREATE INDEX audit_events_correlation_idx ON audit_events(correlation_id) WHERE correlation_id IS NOT NULL;

CREATE TABLE google_resource_mappings (
  mapping_id bigserial PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('calendar', 'sheets')),
  environment text NOT NULL,
  logical_key text NOT NULL,
  resource_id text NOT NULL,
  range_name text,
  enabled boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, environment, logical_key),
  CHECK ((provider = 'sheets') OR range_name IS NULL)
);

CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'history rows are append-only';
END;
$$;
CREATE TRIGGER workflow_events_immutable BEFORE UPDATE OR DELETE ON workflow_events
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER case_evidence_immutable BEFORE UPDATE OR DELETE ON case_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
