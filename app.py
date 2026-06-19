"""
app.py
──────
Flask application factory for the Carbon Footprint Awareness Platform.

Initialises:
  - Flask app with config from config.py
  - CORS (Flask-CORS)
  - Rate limiting (Flask-Limiter)
  - Firebase Admin SDK
  - Registers the API Blueprint
  - Serves the SPA shell (index.html) with injected Firebase config

Usage (development):
    flask run

Usage (production via gunicorn):
    gunicorn app:app
"""

from __future__ import annotations

import logging
import os

from flask import Flask, render_template
from flask_cors import CORS
# pyrefly: ignore [missing-import]
from flask_limiter import Limiter
# pyrefly: ignore [missing-import]
from flask_limiter.util import get_remote_address 

from config import get_config
from api.routes import api_bp, init_limiter

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


def create_app(config=None) -> Flask:
    """
    Create and configure the Flask application.

    Parameters
    ----------
    config : Config | None
        Optional config object (used in tests to inject mock config).

    Returns
    -------
    Flask
        Configured Flask application instance.
    """
    app = Flask(
        __name__,
        template_folder="templates",
        static_folder="static",
    )

    # ── Load config ──────────────────────────────────────────────────────────
    cfg = config or get_config()
    app.secret_key = cfg.SECRET_KEY
    app.debug = cfg.DEBUG
    app.config["cfg"] = cfg

    # ── CORS ─────────────────────────────────────────────────────────────────
    CORS(
        app,
        resources={r"/api/*": {"origins": cfg.CORS_ORIGINS}},
        supports_credentials=False,
    )

    # ── Rate Limiting ─────────────────────────────────────────────────────────
    limiter = Limiter(
        get_remote_address,
        app=app,
        default_limits=[cfg.RATE_LIMIT],
        storage_uri="memory://",
    )
    init_limiter(limiter)

    # ── Firebase Admin SDK ────────────────────────────────────────────────────
    _init_firebase(cfg)

    # ── Register Blueprint ────────────────────────────────────────────────────
    app.register_blueprint(api_bp)

    # ── SPA Shell ─────────────────────────────────────────────────────────────
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def spa_shell(path: str):
        """
        Serve the SPA shell for all non-API routes.

        Firebase Web SDK config is injected via Jinja2 context so that API
        keys are never stored in static JS files.

        Parameters
        ----------
        path : str
            URL path (ignored — SPA handles routing client-side).

        Returns
        -------
        str
            Rendered index.html template.
        """
        firebase_config = {
            "apiKey": cfg.FIREBASE_API_KEY,
            "authDomain": cfg.FIREBASE_AUTH_DOMAIN,
            "projectId": cfg.FIREBASE_PROJECT_ID,
            "storageBucket": cfg.FIREBASE_STORAGE_BUCKET,
            "messagingSenderId": cfg.FIREBASE_MESSAGING_SENDER_ID,
            "appId": cfg.FIREBASE_APP_ID,
        }
        return render_template(
            "index.html",
            firebase_config=firebase_config,
            maps_api_key=cfg.GOOGLE_MAPS_API_KEY,
        )

    logger.info("Carbon Footprint Platform app created (env=%s)", os.environ.get("FLASK_ENV", "development"))
    return app


def _init_firebase(cfg) -> None:
    """
    Initialise Firebase Admin SDK from a service account credential file.

    Silently skips initialisation if:
    - The credentials file does not exist (e.g., in CI/test environments).
    - Firebase Admin is already initialised.

    Parameters
    ----------
    cfg : Config
        App configuration object.
    """
    try:
        # pyrefly: ignore [missing-import]
        import firebase_admin
        # pyrefly: ignore [missing-import]
        from firebase_admin import credentials

        if firebase_admin._apps:
            logger.info("Firebase Admin already initialised.")
            return

        cred_path = cfg.GOOGLE_APPLICATION_CREDENTIALS
        if not os.path.exists(cred_path):
            logger.warning(
                "Firebase service account key not found at '%s'. "
                "Firestore persistence will be disabled.",
                cred_path,
            )
            return

        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
        logger.info("Firebase Admin SDK initialised successfully.")
    except Exception as exc:
        logger.error("Failed to initialise Firebase Admin SDK: %s", exc)


# ── Entry point ───────────────────────────────────────────────────────────────
app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=app.debug)
