from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_name: str = "Cliptora API"
    database_url: str = "mysql+pymysql://root:@127.0.0.1:3306/cliptora?charset=utf8mb4"
    frontend_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    session_cookie: str = "cliptora_session"
    cookie_secure: bool = False
    session_days: int = 14
    reset_token_minutes: int = 30
    dev_expose_reset_link: bool = True
    frontend_url: str = "http://127.0.0.1:5173"

    @property
    def origins(self) -> list[str]:
        return [x.strip() for x in self.frontend_origins.split(",") if x.strip()]

@lru_cache
def get_settings() -> Settings:
    return Settings()
