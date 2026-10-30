CREATE TABLE participant_responses (
  response_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text NOT NULL,
  request_id text NOT NULL,
  assignment_id bigint NOT NULL REFERENCES workflow_assignments(assignment_id),
  actor_key text NOT NULL,
  actor_email text NOT NULL,
  identity_issuer text NOT NULL,
  identity_subject text NOT NULL,
  idempotency_key text NOT NULL,
  answer text NOT NULL CHECK (answer = 'yes'),
  typed_name text NOT NULL CHECK (length(typed_name) BETWEEN 1 AND 200),
  source_type text NOT NULL CHECK (source_type = 'hosted_participant_response'),
  event_id uuid NOT NULL REFERENCES workflow_events(event_id),
  revision bigint NOT NULL CHECK (revision > 1),
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, request_id) REFERENCES workflow_cases(case_id, request_id),
  UNIQUE (case_id, idempotency_key),
  UNIQUE (case_id)
);
CREATE INDEX participant_responses_request_idx ON participant_responses(request_id, received_at);

CREATE TRIGGER participant_responses_immutable BEFORE UPDATE OR DELETE ON participant_responses
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
