CREATE TABLE notification_intents (
  intent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semantic_key text NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type = 'failed_assessment'),
  task_key text NOT NULL CHECK (task_key = 'failed_assessment'),
  request_id text NOT NULL REFERENCES workflow_requests(request_id),
  session_id text REFERENCES workflow_sessions(session_id),
  case_id text NOT NULL REFERENCES workflow_cases(case_id),
  source_revision bigint NOT NULL CHECK (source_revision > 0),
  recipient_role text NOT NULL CHECK (recipient_role = 'process_quality'),
  recipient_actor_key text NOT NULL,
  payload jsonb NOT NULL CHECK (payload = '{"templateKey":"exception_notice","reasonCode":"trainer_failed"}'::jsonb),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancel_reason text,
  UNIQUE (case_id, task_key, source_revision, recipient_role, recipient_actor_key),
  CHECK ((status = 'pending' AND cancelled_at IS NULL AND cancel_reason IS NULL) OR
         (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancel_reason = 'source_state_changed'))
);
CREATE INDEX notification_intents_pending_idx ON notification_intents(created_at, intent_id) WHERE status = 'pending';
