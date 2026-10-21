"""Upgrade an existing Cliptora schema to V2.4 without removing existing data.

Safe to re-run: only missing columns are added. Existing clips, layers and
projects stay untouched. Works with MySQL / MariaDB and SQLite (for tests).
"""
from sqlalchemy import inspect, text
from app.core.database import engine


MISSING_COLUMNS = (
    ("tracks", "background_color", "VARCHAR(20) NOT NULL DEFAULT '#101214'"),
    ("clips", "properties_json", "TEXT NULL"),
    ("clips", "locked", "BOOLEAN NOT NULL DEFAULT 0"),
)


def migrate():
    with engine.begin() as conn:
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())
        required = {table for table, _, _ in MISSING_COLUMNS}
        missing_tables = required - tables
        if missing_tables:
            raise RuntimeError(
                "Missing timeline tables: " + ", ".join(sorted(missing_tables))
                + ". Run scripts\\init-database.ps1 first."
            )

        existing = {
            table: {column["name"] for column in inspector.get_columns(table)}
            for table in required
        }
        for table, column, definition in MISSING_COLUMNS:
            if column in existing[table]:
                print(f"Already present: {table}.{column}")
                continue
            # Table/column names above are fixed internal literals, not user input.
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))
            existing[table].add(column)
            print(f"Added: {table}.{column}")

        # Existing V2.2 clips have no transform JSON. Supply safe defaults.
        conn.execute(text("UPDATE clips SET properties_json = '{}' WHERE properties_json IS NULL"))
        if conn.dialect.name != "sqlite":
            conn.execute(text("UPDATE clips SET locked = 0 WHERE locked IS NULL"))

        refreshed = inspect(conn)
        for table, column, _ in MISSING_COLUMNS:
            if column not in {info["name"] for info in refreshed.get_columns(table)}:
                raise RuntimeError(f"Migration verification failed: {table}.{column}")

    print("Cliptora V2.4 timeline schema ready. No existing rows deleted.")


if __name__ == "__main__":
    migrate()
