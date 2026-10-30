"""Non-destructive repair/diagnostic for CLIPTORA V3's My Library table.

Usage, from backend/: python -m app.repair_library
"""
from sqlalchemy.engine import make_url
from app.core.config import settings
from app.services.library_schema import prepare_library_schema


def main() -> None:
    url = make_url(settings().database_url)
    print('CLIPTORA My Library schema check')
    print(f'  Driver: {url.drivername}')
    print(f'  Server: {url.host or "local"}:{url.port or "default"}')
    print(f'  Database: {url.database or "(not selected)"}')
    # Never print connection passwords or other secrets.
    created = prepare_library_schema()
    print('  user_library_items:', 'CREATED' if created else 'OK (existing table preserved)')
    print('  Status: OK — projects, timeline clips and media were not modified.')


if __name__ == '__main__':
    main()
    
