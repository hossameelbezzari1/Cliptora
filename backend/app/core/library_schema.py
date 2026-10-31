"""Create/check the V3 personal library table without touching existing user data.

A user may install the new backend files before running the V3 MySQL upgrade
script. In that case the first /library request would previously fail with a
500 (MySQL 1146, table does not exist). Only the personal library table is
created here; timeline/media/project tables are not modified.
"""
from __future__ import annotations

import logging
from threading import Lock

from fastapi import Depends, HTTPException
from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import engine, get_db
from app.models import UserLibraryItem

logger = logging.getLogger(__name__)
_lock = Lock()
_ready = False

REQUIRED_COLUMNS = frozenset({
    'id', 'user_id', 'kind', 'name', 'parent_id',
    'payload_json', 'created_at', 'updated_at',
})


def prepare_library_schema() -> bool:
    """Verify the current DB and create *only* a missing library table.

    Returns True if the table had to be created. Existing rows are never
    deleted, rewritten or migrated by this helper.
    """
    global _ready
    if _ready:
        return False
    with _lock:
        if _ready:
            return False
        inspector = inspect(engine)
        if not inspector.has_table('users'):
            raise RuntimeError(
                'The configured database does not contain the users table. '
                'Check DATABASE_URL in backend/.env before running a migration.'
            )
        created = not inspector.has_table(UserLibraryItem.__tablename__)
        if created:
            # CREATE TABLE only when absent. Never call drop_all or modify old rows.
            UserLibraryItem.__table__.create(bind=engine, checkfirst=True)
        columns = {
            col['name'] for col in inspect(engine).get_columns(UserLibraryItem.__tablename__)
        }
        missing = REQUIRED_COLUMNS - columns
        if missing:
            raise RuntimeError(
                'user_library_items is incomplete; missing columns: '
                + ', '.join(sorted(missing))
                + '. Inspect the table before attempting a manual repair.'
            )
        _ready = True
        if created:
            logger.info('Created missing My Library table (no existing data changed).')
        return created


def get_library_db(db: Session = Depends(get_db)) -> Session:
    """Initialize legacy V2.5 installations at first authenticated library use."""
    try:
        prepare_library_schema()
    except (SQLAlchemyError, RuntimeError) as exc:
        logger.exception('Unable to access CLIPTORA personal library schema')
        raise HTTPException(
            status_code=503,
            detail=(
                'My Library database is not ready. Ensure MySQL is running, '
                'verify backend/.env DATABASE_URL and run '
                'scripts\\fix-library-500.ps1. See the FastAPI console for details.'
            ),
        ) from exc
    return db
