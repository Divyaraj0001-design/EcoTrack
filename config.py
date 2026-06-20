"""
config.py
─────────
Centralised configuration for the Carbon Footprint Platform.

All sensitive values are loaded from environment variables (via .env).
This module should be imported by app.py and the API layer — never by
the frontend JS (those values are injected through Jinja2 context only).
"""

import os
import secrets

from dotenv import load_dotenv

# Load .env file if it exists (development convenience)
load_dotenv()


class Config:
    """Base configuration shared by all environments."""

    # ── Flask Core ──────────────────────────────────────────────────────────
    SECRET_KEY: str = os.environ.get("FLASK_SECRET_KEY", "dev-insecure-key")
    DEBUG: bool = os.environ.get("FLASK_DEBUG", "0") == "1"

    # ── Firebase Admin SDK ──────────────────────────────────────────────────
    GOOGLE_APPLICATION_CREDENTIALS: str = os.environ.get(
        "GOOGLE_APPLICATION_CREDENTIALS", "serviceAccountKey.json"
    )
    FIREBASE_PROJECT_ID: str = os.environ.get("FIREBASE_PROJECT_ID", "")

    # ── Firebase Web SDK (injected into frontend via Jinja2) ────────────────
    FIREBASE_API_KEY: str = os.environ.get("FIREBASE_API_KEY", "")
    FIREBASE_AUTH_DOMAIN: str = os.environ.get("FIREBASE_AUTH_DOMAIN", "")
    FIREBASE_STORAGE_BUCKET: str = os.environ.get("FIREBASE_STORAGE_BUCKET", "")
    FIREBASE_MESSAGING_SENDER_ID: str = os.environ.get(
        "FIREBASE_MESSAGING_SENDER_ID", ""
    )
    FIREBASE_APP_ID: str = os.environ.get("FIREBASE_APP_ID", "")

    # ── Google APIs ─────────────────────────────────────────────────────────
    GOOGLE_MAPS_API_KEY: str = os.environ.get("GOOGLE_MAPS_API_KEY", "")

    # ── AI Provider Keys (for EcoBot) ────────────────────────────────────────
    GROQ_API_KEY: str = os.environ.get("GROQ_API_KEY", "")

    # ── Rate Limiting ───────────────────────────────────────────────────────
    RATE_LIMIT: str = f"{os.environ.get('RATE_LIMIT', '60')} per minute"

    # ── CORS ────────────────────────────────────────────────────────────────
    CORS_ORIGINS: list = [
        "http://localhost:5000", "http://127.0.0.1:5000",
        "http://localhost:5001", "http://127.0.0.1:5001",
    ]


class DevelopmentConfig(Config):
    """Development-specific settings."""

    DEBUG = True


class ProductionConfig(Config):
    """Production-specific settings (stricter)."""

    DEBUG = False
    CORS_ORIGINS = []  # Set via env / Firebase Hosting headers in production

    # Never ship the insecure development fallback to production. If no key is
    # supplied via the environment, fall back to a strong per-process random
    # key so the app stays bootable while still refusing the known-weak default.
    SECRET_KEY: str = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)


# Map string to config class
config_map = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
}


def get_config() -> Config:
    """
    Return the appropriate Config instance based on FLASK_ENV.

    Returns
    -------
    Config
        Configuration instance for the current environment.
    """
    env = os.environ.get("FLASK_ENV", "development").lower()
    return config_map.get(env, DevelopmentConfig)()
