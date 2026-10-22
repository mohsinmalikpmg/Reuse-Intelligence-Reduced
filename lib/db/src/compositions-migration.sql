CREATE TABLE IF NOT EXISTS compositions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  case_id text,
  revision integer NOT NULL DEFAULT 1,
  snapshot jsonb NOT NULL,
  undo jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS composition_idempotency ON compositions(user_id,idempotency_key);
CREATE TABLE IF NOT EXISTS composition_refinements (
  id text PRIMARY KEY,
  composition_id text NOT NULL,
  snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'preview',
  created_at timestamptz NOT NULL DEFAULT now()
);
