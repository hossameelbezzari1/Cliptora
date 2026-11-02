-- Optional manual migration. FastAPI startup also creates this table when missing.
-- Requires the existing users table; does not touch workflow/project records.
CREATE TABLE IF NOT EXISTS credentials (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(160) NOT NULL,
    provider VARCHAR(40) NOT NULL,
    encrypted_data TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    KEY ix_credentials_user_id (user_id),
    CONSTRAINT fk_credentials_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
