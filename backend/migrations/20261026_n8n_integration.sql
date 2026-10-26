CREATE TABLE IF NOT EXISTS n8n_workflow_links (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  project_id INT NOT NULL,
  element_client_id VARCHAR(64) NOT NULL,
  n8n_workflow_id VARCHAR(80) NOT NULL,
  title VARCHAR(160) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'inactive',
  last_synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_n8n_link_element (project_id, element_client_id),
  INDEX idx_n8n_link_user_project (user_id, project_id),
  INDEX idx_n8n_workflow_id (n8n_workflow_id),
  CONSTRAINT fk_n8n_link_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS n8n_tool_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  operation VARCHAR(48) NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'queued',
  input_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  INDEX idx_n8n_tool_job_project (project_id),
  CONSTRAINT fk_n8n_tool_job_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
