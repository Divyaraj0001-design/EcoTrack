"""
tests/conftest.py
─────────────────
Shared pytest fixtures for the Carbon Footprint Platform test suite.

Fixtures
────────
app         – configured Flask application (test mode, no Firestore)
client      – Flask test client
sample_payload – valid POST body for /api/calculate
"""

import os
import sys

import pytest

# Ensure the project root is on sys.path so imports resolve correctly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config


class TestConfig(Config):
    """Minimal config used in tests — no real Firebase credentials needed."""

    TESTING = True
    SECRET_KEY = "test-secret"
    FIREBASE_PROJECT_ID = "test-project"
    FIREBASE_API_KEY = "test-api-key"
    FIREBASE_AUTH_DOMAIN = "test.firebaseapp.com"
    FIREBASE_STORAGE_BUCKET = "test.appspot.com"
    FIREBASE_MESSAGING_SENDER_ID = "000000000000"
    FIREBASE_APP_ID = "1:000000000000:web:abc123"
    GOOGLE_MAPS_API_KEY = "test-maps-key"
    GOOGLE_APPLICATION_CREDENTIALS = "nonexistent.json"  # skips Firebase init
    RATE_LIMIT = "1000 per minute"  # effectively unlimited in tests
    CORS_ORIGINS = ["*"]


@pytest.fixture(scope="session")
def app():
    """
    Create a Flask application configured for testing.

    Yields
    ------
    Flask
        The test application instance.
    """
    from app import create_app

    flask_app = create_app(config=TestConfig())
    flask_app.config["TESTING"] = True
    yield flask_app


@pytest.fixture(autouse=True)
def _no_external_ai_calls(monkeypatch):
    """
    Strip AI provider keys from the environment for every test.

    _call_groq/_call_ollama/call_gemini_tips read os.environ directly at
    call time, so real keys in a developer's .env would otherwise make
    live network calls during the test run.
    """
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)


@pytest.fixture()
def client(app):
    """
    Return a Flask test client.

    Parameters
    ----------
    app : Flask
        The test application fixture.

    Yields
    ------
    FlaskClient
        A test client for making HTTP requests.
    """
    with app.test_client() as c:
        yield c


@pytest.fixture()
def sample_payload():
    """
    Return a valid, complete POST payload for /api/calculate.

    Returns
    -------
    dict
        A payload that should produce a successful 200 response.
    """
    return {
        "transport_mode": "car",
        "transport_km": 50.0,
        "diet_type": "meat",
        "food_days": 7,
        "electricity_kwh": 200.0,
        "gas_m3": 10.0,
        "shopping_level": "medium",
        "shopping_weeks": 1,
    }
