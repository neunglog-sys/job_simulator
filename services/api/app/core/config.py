from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://app:app@localhost:5432/jobsim"
    redis_url: str = "redis://localhost:6379/0"
    storage_dir: str = "storage"

    llm_provider: str = "openai"  # openai | gemini
    openai_api_key: str = ""
    gemini_api_key: str = ""


settings = Settings()
