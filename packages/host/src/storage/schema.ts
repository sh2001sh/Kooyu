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
  CASE WHEN kind='supervisor' AND title IN ('与 pi 对话','pi 主对话') THEN '与 Kodo 对话' ELSE title END,
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
