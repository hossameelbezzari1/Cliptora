-- Apply to the existing CLIPTORA database, e.g. cliptora_v2.
-- All statements are additive and do NOT delete prior projects/media.
-- workflow_api.py also creates these tables on first authorized request.
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  project_id INT NOT NULL,
  name VARCHAR(160) NOT NULL,
  nodes_json LONGTEXT NOT NULL,
  current_version INT NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_workflow_def_user_project (user_id, project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS current_version INT NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS workflow_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workflow_id INT NOT NULL,
  user_id INT NOT NULL,
  project_id INT NOT NULL,
  version INT NOT NULL,
  name VARCHAR(160) NOT NULL,
  nodes_json LONGTEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_workflow_version (workflow_id, version),
  INDEX idx_workflow_versions_user_project (user_id, project_id),
  CONSTRAINT fk_workflow_versions_definition FOREIGN KEY (workflow_id)
    REFERENCES workflow_definitions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS workflow_sources (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  project_id INT NOT NULL,
  filename VARCHAR(200) NOT NULL,
  stored_name VARCHAR(80) NOT NULL,
  media_id INT NULL,
  size_bytes BIGINT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_workflow_source_user_project (user_id, project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE workflow_sources ADD COLUMN IF NOT EXISTS media_id INT NULL;
CREATE TABLE IF NOT EXISTS workflow_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  project_id INT NOT NULL,
  workflow_id INT NOT NULL,
  source_id INT NULL,
  workflow_json LONGTEXT NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'queued',
  progress INT NOT NULL DEFAULT 0,
  current_node VARCHAR(48) NULL,
  results_json LONGTEXT,
  error TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  INDEX idx_workflow_runs_user_project (user_id, project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
