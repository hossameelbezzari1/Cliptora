from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    environment: str = 'development'
    database_url: str = 'mysql+pymysql://root:@127.0.0.1:3306/cliptora_v2?charset=utf8mb4'
    secret_key: str = 'local-development-key-not-for-production'
    session_days: int = 14
    max_upload_mb: int = 250
    storage_dir: str = '../storage'
    frontend_origin: str = 'http://localhost:5173'
    model_config = SettingsConfigDict(env_file=str(Path(__file__).resolve().parents[2] / '.env'), extra='ignore')

    @property
    def production(self) -> bool:
        return self.environment.lower() == 'production'

    @property
    def storage_path(self) -> Path:
        p = Path(self.storage_dir)
        return (p if p.is_absolute() else Path(__file__).resolve().parents[2] / p).resolve()

@lru_cache
def settings() -> Settings:
    return Settings()
