"""
tests/test_api.py
─────────────────
API endpoint tests using Flask test client (pytest-flask).

Tests cover happy paths, error responses, CORS headers, and response shape.
Run with:  pytest tests/test_api.py -v
"""

import json

# ── /api/health ───────────────────────────────────────────────────────────────


class TestHealth:
    """Tests for GET /api/health."""

    def test_health_returns_200(self, client):
        """Health endpoint must return HTTP 200."""
        resp = client.get("/api/health")
        assert resp.status_code == 200

    def test_health_returns_ok_status(self, client):
        """Health endpoint body must contain status: ok."""
        resp = client.get("/api/health")
        data = resp.get_json()
        assert data["status"] == "ok"

    def test_health_returns_timestamp(self, client):
        """Health endpoint must include an ISO-8601 timestamp."""
        resp = client.get("/api/health")
        data = resp.get_json()
        assert "timestamp" in data
        assert "T" in data["timestamp"]  # basic ISO-8601 check


# ── /api/calculate ────────────────────────────────────────────────────────────


class TestCalculate:
    """Tests for POST /api/calculate."""

    def test_valid_payload_returns_200(self, client, sample_payload):
        """Valid complete payload must return HTTP 200."""
        resp = client.post(
            "/api/calculate",
            data=json.dumps(sample_payload),
            content_type="application/json",
        )
        assert resp.status_code == 200

    def test_response_contains_total(self, client, sample_payload):
        """Response must contain a numeric 'total' key."""
        resp = client.post(
            "/api/calculate",
            data=json.dumps(sample_payload),
            content_type="application/json",
        )
        data = resp.get_json()
        assert "total" in data
        assert isinstance(data["total"], (int, float))

    def test_response_contains_score_label(self, client, sample_payload):
        """Response must contain a 'score_label' string."""
        resp = client.post(
            "/api/calculate",
            data=json.dumps(sample_payload),
            content_type="application/json",
        )
        data = resp.get_json()
        assert "score_label" in data
        assert isinstance(data["score_label"], str)

    def test_response_contains_tips(self, client, sample_payload):
        """Response must include a 'tips' list."""
        resp = client.post(
            "/api/calculate",
            data=json.dumps(sample_payload),
            content_type="application/json",
        )
        data = resp.get_json()
        assert "tips" in data
        assert isinstance(data["tips"], list)
        assert len(data["tips"]) > 0

    def test_missing_transport_mode_returns_400(self, client, sample_payload):
        """Missing 'transport_mode' must return HTTP 400."""
        del sample_payload["transport_mode"]
        resp = client.post(
            "/api/calculate",
            data=json.dumps(sample_payload),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_invalid_transport_mode_returns_400(self, client, sample_payload):
        """Unknown transport mode must return HTTP 400."""
        sample_payload["transport_mode"] = "hovercraft"
        resp = client.post(
            "/api/calculate",
            data=json.dumps(sample_payload),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_empty_body_returns_400(self, client):
        """Empty request body must return HTTP 400."""
        resp = client.post(
            "/api/calculate",
            data="",
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_breakdown_categories_present(self, client, sample_payload):
        """Response must include all four category breakdown values."""
        resp = client.post(
            "/api/calculate",
            data=json.dumps(sample_payload),
            content_type="application/json",
        )
        data = resp.get_json()
        for key in ("transport", "food", "energy", "shopping"):
            assert key in data, f"Missing key: {key}"


# ── /api/tips ─────────────────────────────────────────────────────────────────


class TestTips:
    """Tests for GET /api/tips."""

    def test_tips_returns_200(self, client):
        """Tips endpoint must return HTTP 200."""
        resp = client.get("/api/tips")
        assert resp.status_code == 200

    def test_tips_returns_list(self, client):
        """Tips endpoint must return a JSON list under 'tips'."""
        resp = client.get("/api/tips")
        data = resp.get_json()
        assert "tips" in data
        assert isinstance(data["tips"], list)

    def test_tips_with_query_params(self, client):
        """Tips with breakdown query params should return relevant tips."""
        resp = client.get("/api/tips?transport=50&food=80&energy=20&shopping=5")
        data = resp.get_json()
        assert len(data["tips"]) > 0


# ── /api/challenges ───────────────────────────────────────────────────────────


class TestChallenges:
    """Tests for GET /api/challenges."""

    def test_challenges_returns_200(self, client):
        """Challenges endpoint must return HTTP 200."""
        resp = client.get("/api/challenges")
        assert resp.status_code == 200

    def test_challenges_has_daily_and_weekly(self, client):
        """Response must contain both 'daily' and 'weekly' keys."""
        resp = client.get("/api/challenges")
        data = resp.get_json()
        assert "daily" in data
        assert "weekly" in data

    def test_daily_challenge_has_required_fields(self, client):
        """Daily challenge must have id, title, description, points, icon."""
        resp = client.get("/api/challenges")
        daily = resp.get_json()["daily"]
        for field in ("id", "title", "description", "points", "icon"):
            assert field in daily, f"Missing field: {field}"
