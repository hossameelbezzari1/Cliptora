import re

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url

import app.models
import app.api.v1.workflow_api  # Registers workflow tables with shared metadata.
from app.core.config import settings
from app.core.database import Base, engine


def main():
    url = make_url(settings().database_url)
    name = url.database
    if not name or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name):
        raise SystemExit('Database name must be a safe identifier.')
    if not url.drivername.startswith('mysql'):
        raise SystemExit('Automatic database creation only supports MySQL.')

    server_url = URL.create(
        drivername=url.drivername,
        username=url.username,
        password=url.password,
        host=url.host,
        port=url.port,
        query=url.query,
    )
    server = create_engine(server_url, pool_pre_ping=True)
    try:
        with server.begin() as conn:
            conn.execute(text(f'CREATE DATABASE IF NOT EXISTS `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'))
    finally:
        server.dispose()

    Base.metadata.create_all(bind=engine)
    from app.migrate_editor import migrate
    migrate()
    print(f'Cliptora tables ready in MySQL database: {name}')
    print('No existing tables or rows were deleted.')


if __name__ == '__main__':
    main()
