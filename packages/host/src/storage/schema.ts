// Keep the original draft schema as the first migration; durable native state
// is installed by the following migration for both fresh and existing databases.
export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  host_id TEXT NOT NULL,
  root_path TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  harness_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'supervisor')),
  scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
  project_id TEXT REFERENCES projects(id),
  workspace_id TEXT REFERENCES workspaces(id),
  host_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (kind != 'supervisor' OR harness_id = 'pi'),
  CHECK ((scope = 'global' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sessions_project ON sessions(project_id, created_at);
PRAGMA user_version = 1;
`;

export const SCHEMA_V2 = `
CREATE TABLE session_state (session_id TEXT PRIMARY KEY REFERENCES sessions(id), data TEXT NOT NULL);
CREATE TABLE native_identity (harness_id TEXT NOT NULL, instance_id TEXT NOT NULL, native_id TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id), UNIQUE(harness_id, instance_id, native_id));
CREATE TABLE commands (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), status TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX commands_pending ON commands(session_id, status);
CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id), data TEXT NOT NULL, UNIQUE(session_id, id));
CREATE INDEX events_session ON events(session_id, sequence);
CREATE VIRTUAL TABLE search_index USING fts5(session_id UNINDEXED, event_id UNINDEXED, text);
CREATE TABLE watches (id TEXT PRIMARY KEY, controller_id TEXT NOT NULL REFERENCES sessions(id), target_id TEXT NOT NULL REFERENCES sessions(id), mode TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
CREATE UNIQUE INDEX one_controller ON watches(target_id) WHERE mode = 'continue' AND state = 'active';
CREATE TABLE wakes (id TEXT PRIMARY KEY, watch_id TEXT NOT NULL REFERENCES watches(id), generation INTEGER NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
PRAGMA user_version = 2;
`;

// Rebuild the original CHECK constraint while preserving session/native IDs,
// control relations, receipts, cursors and historical configuration revisions.
export const SCHEMA_V3 = `
CREATE TABLE sessions_v3 (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  harness_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'supervisor')),
  scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
  project_id TEXT REFERENCES projects(id),
  workspace_id TEXT REFERENCES workspaces(id),
  host_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK ((kind = 'supervisor') = (harness_id = 'kodo')),
  CHECK ((scope = 'global' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL))
);
INSERT INTO sessions_v3 SELECT id,
  CASE WHEN kind='supervisor' AND title IN ('与 pi 对话','pi 主对话') THEN '与 Kooyu 对话' ELSE title END,
  CASE WHEN kind='supervisor' THEN 'kodo' ELSE harness_id END,
  kind,scope,project_id,workspace_id,host_id,created_at FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_v3 RENAME TO sessions;
CREATE INDEX sessions_project ON sessions(project_id,created_at);
UPDATE session_state SET data=json_set(data,'$.harnessId','kodo','$.title',(SELECT title FROM sessions WHERE id=session_state.session_id),'$.instanceId',
  CASE WHEN json_extract(data,'$.instanceId') LIKE 'pi:%' THEN 'kodo'||substr(json_extract(data,'$.instanceId'),3) ELSE 'kodo' END)
  WHERE session_id IN (SELECT id FROM sessions WHERE kind='supervisor');
UPDATE native_identity SET harness_id='kodo',instance_id=CASE WHEN instance_id LIKE 'pi:%' THEN 'kodo'||substr(instance_id,3) ELSE 'kodo' END
  WHERE session_id IN (SELECT id FROM sessions WHERE kind='supervisor');
UPDATE events SET data=json_set(data,'$.source','kodo')
  WHERE session_id IN (SELECT id FROM sessions WHERE kind='supervisor') AND json_extract(data,'$.source')='pi';
UPDATE records SET data=json_set(data,'$.source','kodo') WHERE kind='usage' AND json_extract(data,'$.source')='pi'
  AND json_extract(data,'$.sessionId') IN (SELECT id FROM sessions WHERE kind='supervisor');
UPDATE records SET data=json_set(data,'$.harnessProfileIds.kodo',json_extract(data,'$.harnessProfileIds.pi'))
  WHERE kind='profile-defaults' AND json_type(data,'$.harnessProfileIds.pi') IS NOT NULL AND json_type(data,'$.harnessProfileIds.kodo') IS NULL;
UPDATE records SET data=json_set(data,'$.profileDefaults.kodo',json_extract(data,'$.profileDefaults.pi'))
  WHERE kind='project-profile-defaults' AND json_type(data,'$.profileDefaults.pi') IS NOT NULL AND json_type(data,'$.profileDefaults.kodo') IS NULL;
PRAGMA user_version = 3;
`;

export const SCHEMA_V4 = `
CREATE VIRTUAL TABLE search_trigram USING fts5(session_id UNINDEXED, event_id UNINDEXED, text, tokenize='trigram');
INSERT INTO search_trigram SELECT session_id,event_id,text FROM search_index;
DROP TABLE search_index;
ALTER TABLE search_trigram RENAME TO search_index;
CREATE TABLE event_tombstones (session_id TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(session_id,id));
PRAGMA user_version = 4;
`;

// Goals, verification facts, retrieved web sources and the notification feed.
// Bodies stay in JSON; columns exist only for uniqueness, ordering and lookup.
export const SCHEMA_V7 = `
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  controller_session_id TEXT NOT NULL REFERENCES sessions(id),
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS goals_controller ON goals(controller_session_id, updated_at);
CREATE TABLE IF NOT EXISTS goal_history (
  goal_id TEXT NOT NULL REFERENCES goals(id),
  revision INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(goal_id, revision)
);
CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS verifications_goal ON verifications(goal_id, created_at);
CREATE TABLE IF NOT EXISTS web_sources (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  goal_id TEXT,
  accessed_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS web_sources_goal ON web_sources(goal_id, accessed_at);
CREATE INDEX IF NOT EXISTS web_sources_session ON web_sources(session_id, accessed_at);
CREATE TABLE IF NOT EXISTS notification_items (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  read_at TEXT,
  data TEXT NOT NULL
);
PRAGMA user_version = 7;
`;

// Managed uploads and immutable delivered artifacts. File bodies live in a
// content-addressed object directory; the database holds metadata only.
export const SCHEMA_V8 = `
CREATE TABLE IF NOT EXISTS managed_files (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  state TEXT NOT NULL,
  session_id TEXT,
  goal_id TEXT,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS managed_files_sha ON managed_files(sha256);
CREATE INDEX IF NOT EXISTS managed_files_goal ON managed_files(goal_id, created_at);
CREATE INDEX IF NOT EXISTS managed_files_session ON managed_files(session_id, created_at);
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES managed_files(id),
  goal_id TEXT,
  session_id TEXT,
  version_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL,
  UNIQUE(version_key, version)
);
CREATE INDEX IF NOT EXISTS artifacts_goal ON artifacts(goal_id, created_at);
CREATE INDEX IF NOT EXISTS artifacts_session ON artifacts(session_id, created_at);
PRAGMA user_version = 8;
`;

// Self-hosted execution, plans, grants, delivery and editable project memory.
export const SCHEMA_V9 = `
CREATE TABLE IF NOT EXISTS tool_action_receipts(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), status TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automations(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activations(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS activations_occurrence ON activations(json_extract(data,'$.automationId'),json_extract(data,'$.logicalOccurrenceKey'));
CREATE TABLE IF NOT EXISTS webhook_connections(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_delivery ON webhook_events(json_extract(data,'$.connectionId'),json_extract(data,'$.externalEventId'));
CREATE TABLE IF NOT EXISTS authorization_grants(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_entries(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_revisions(entry_id TEXT NOT NULL REFERENCES memory_entries(id),revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(entry_id,revision));
CREATE TABLE IF NOT EXISTS application_versions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_connections(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification_channels(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification_deliveries(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_identity ON notification_deliveries(json_extract(data,'$.notificationId'),json_extract(data,'$.deviceId'),json_extract(data,'$.channel'));
CREATE TABLE IF NOT EXISTS outbound_messages(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS executors(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS control_leases(id TEXT PRIMARY KEY, data TEXT NOT NULL);
PRAGMA user_version = 9;
`;

// Next-gen delegation tickets, managed Git worktrees, background jobs, unified intake & IM channels.
export const SCHEMA_V10 = `
CREATE TABLE IF NOT EXISTS workspace_worktrees (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  parent_workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  branch_name TEXT NOT NULL,
  base_ref TEXT,
  base_commit TEXT,
  lifecycle_state TEXT NOT NULL CHECK (
    lifecycle_state IN ('preparing', 'ready', 'failed', 'deleting', 'archived')
  ),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workspace_worktrees_parent
  ON workspace_worktrees(parent_workspace_id, lifecycle_state);

CREATE TABLE IF NOT EXISTS delegation_tickets (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
  controller_session_id TEXT NOT NULL REFERENCES sessions(id),
  worker_session_id TEXT REFERENCES sessions(id),
  watch_id TEXT REFERENCES watches(id),
  goal_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('provisioning', 'running', 'awaiting-review', 'completed', 'blocked', 'cancelled', 'failed')
  ),
  wait_policy TEXT NOT NULL DEFAULT 'all' CHECK (wait_policy IN ('any', 'all')),
  mandate TEXT NOT NULL,
  provisioning_step TEXT NOT NULL,
  report TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_ticket_per_worker
  ON delegation_tickets(worker_session_id)
  WHERE worker_session_id IS NOT NULL AND status IN ('provisioning', 'running', 'awaiting-review');
CREATE INDEX IF NOT EXISTS delegation_tickets_controller
  ON delegation_tickets(controller_session_id, created_at);
CREATE INDEX IF NOT EXISTS delegation_tickets_batch
  ON delegation_tickets(batch_id) WHERE batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS background_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  workspace_id TEXT REFERENCES workspaces(id),
  status TEXT NOT NULL CHECK (status IN ('running', 'exited', 'killed', 'lost')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS background_jobs_session ON background_jobs(session_id, status);

CREATE TABLE IF NOT EXISTS intake_events (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('context-only', 'observed', 'proposed', 'dispatched', 'dropped')),
  created_at TEXT NOT NULL,
  data TEXT NOT NULL,
  UNIQUE(source_kind, source_id, external_id)
);
CREATE INDEX IF NOT EXISTS intake_events_created ON intake_events(created_at);

CREATE TABLE IF NOT EXISTS im_channels (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS secure_requests (
  id TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS secure_requests_expiry ON secure_requests(expires);

PRAGMA user_version = 10;
`;
