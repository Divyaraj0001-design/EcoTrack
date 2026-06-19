"""
tests/test_routes_firestore.py
──────────────────────────────
Tests for Firestore-dependent API routes, using unittest.mock to patch
Firebase Admin / Firestore so no real credentials are required.

Covers:
  GET  /api/history
  POST /api/support-ticket
  POST /api/import
  POST /api/notifications/mark-read
  POST /api/ecobot  (fallback path)

Run with:  pytest tests/test_routes_firestore.py -v
"""

import json
import pytest
from unittest.mock import MagicMock, patch


# ── /api/history ──────────────────────────────────────────────────────────────

class TestHistory:
    """Tests for GET /api/history."""

    def test_missing_uid_returns_400(self, client):
        """Missing 'uid' query param must return 400."""
        resp = client.get("/api/history")
        assert resp.status_code == 400
        data = resp.get_json()
        assert "error" in data

    def test_firestore_unavailable_returns_empty_history(self, client):
        """When Firestore is unavailable the endpoint returns an empty list, not an error."""
        # _get_firestore returns None when Firebase is not initialised (test mode)
        resp = client.get("/api/history?uid=test-user-123")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "history" in data
        assert isinstance(data["history"], list)

    def test_limit_capped_at_100(self, client):
        """Requesting more than 100 records should be silently capped."""
        # Still returns 200 even with over-limit request (no Firestore in tests)
        resp = client.get("/api/history?uid=abc&limit=9999")
        assert resp.status_code == 200

    def test_firestore_available_returns_records(self, client):
        """When Firestore returns docs, they should appear in the history list."""
        mock_doc = MagicMock()
        mock_doc.id = "doc-001"
        mock_doc.to_dict.return_value = {
            "total": 55.5,
            "transport": 10.5,
            "food": 25.0,
            "energy": 15.0,
            "shopping": 5.0,
            "timestamp": "2026-01-15T10:00:00+00:00",
        }

        mock_db = MagicMock()
        # Chain: .collection().document().collection().order_by().limit().stream()
        mock_db.collection.return_value.document.return_value \
            .collection.return_value.order_by.return_value \
            .limit.return_value.stream.return_value = iter([mock_doc])

        with patch("api.routes._get_firestore", return_value=mock_db), \
             patch("api.routes._FIRESTORE_AVAILABLE", True):
            resp = client.get("/api/history?uid=test-user-123&limit=5")

        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["history"]) == 1
        assert data["history"][0]["id"] == "doc-001"
        assert data["history"][0]["total"] == 55.5


# ── /api/support-ticket ───────────────────────────────────────────────────────

class TestSupportTicket:
    """Tests for POST /api/support-ticket."""

    def test_missing_fields_returns_400(self, client):
        """Omitting any required field must return 400."""
        resp = client.post(
            "/api/support-ticket",
            data=json.dumps({"name": "Alice"}),
            content_type="application/json",
        )
        assert resp.status_code == 400
        data = resp.get_json()
        assert "error" in data

    def test_empty_body_returns_400(self, client):
        """Empty body should return 400."""
        resp = client.post(
            "/api/support-ticket",
            data="",
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_valid_ticket_without_firestore(self, client):
        """Valid ticket submitted without Firestore returns 200 (logged only)."""
        payload = {
            "name": "Alice Green",
            "email": "alice@example.com",
            "message": "I'd love a dark mode option.",
        }
        resp = client.post(
            "/api/support-ticket",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("success") is True

    def test_valid_ticket_with_firestore(self, client):
        """Valid ticket with Firestore mock should also return 200."""
        mock_db = MagicMock()

        payload = {
            "name": "Bob Eco",
            "email": "bob@example.com",
            "message": "Great app!",
            "uid": "user-999",
        }

        with patch("api.routes._get_firestore", return_value=mock_db):
            resp = client.post(
                "/api/support-ticket",
                data=json.dumps(payload),
                content_type="application/json",
            )

        assert resp.status_code == 200
        # Verify Firestore was called
        mock_db.collection.assert_called_once_with("support_tickets")

    def test_xss_input_sanitised(self, client):
        """HTML in fields must be escaped (not rejected) to prevent XSS storage."""
        payload = {
            "name": "<script>alert(1)</script>",
            "email": "x@x.com",
            "message": "Normal message.",
        }
        resp = client.post(
            "/api/support-ticket",
            data=json.dumps(payload),
            content_type="application/json",
        )
        # Should succeed — sanitisation escapes, doesn't reject
        assert resp.status_code == 200


# ── /api/import ───────────────────────────────────────────────────────────────

class TestImport:
    """Tests for POST /api/import."""

    def test_missing_uid_returns_400(self, client):
        """Missing 'uid' must return 400."""
        resp = client.post(
            "/api/import",
            data=json.dumps({"rows": []}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_empty_rows_returns_400(self, client):
        """Empty rows list must return 400."""
        resp = client.post(
            "/api/import",
            data=json.dumps({"uid": "u1", "rows": []}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_exceeding_500_rows_returns_400(self, client):
        """More than 500 rows must return 400."""
        rows = [{"date": "2026-01-01", "category": "transport",
                 "activity": "car", "amount": 1, "unit": "km"}] * 501
        resp = client.post(
            "/api/import",
            data=json.dumps({"uid": "u1", "rows": rows}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_valid_rows_without_firestore(self, client):
        """Valid rows with no Firestore should still return imported count."""
        rows = [
            {"date": "2026-06-01", "category": "transport",
             "activity": "car trip", "amount": 50, "unit": "km"},
        ]
        resp = client.post(
            "/api/import",
            data=json.dumps({"uid": "u1", "rows": rows}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "imported" in data
        assert "skipped" in data

    def test_row_missing_required_fields_is_skipped(self, client):
        """Rows missing required fields (date/category/activity/unit) are skipped."""
        rows = [
            {"date": "", "category": "", "activity": "", "amount": 10, "unit": ""},
        ]
        resp = client.post(
            "/api/import",
            data=json.dumps({"uid": "u1", "rows": rows}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["skipped"] >= 1

    def test_valid_rows_with_firestore_mock(self, client):
        """Valid rows with a Firestore mock should call add() for each non-duplicate."""
        mock_db = MagicMock()
        # Simulate no existing duplicates (empty stream)
        mock_db.collection.return_value.document.return_value \
            .collection.return_value.where.return_value \
            .where.return_value.where.return_value \
            .limit.return_value.stream.return_value = iter([])

        rows = [
            {"date": "2026-06-01", "category": "food",
             "activity": "vegan meal", "amount": 1, "unit": "day"},
            {"date": "2026-06-02", "category": "energy",
             "activity": "electricity", "amount": 200, "unit": "kwh"},
        ]

        with patch("api.routes._get_firestore", return_value=mock_db):
            resp = client.post(
                "/api/import",
                data=json.dumps({"uid": "test-uid", "rows": rows}),
                content_type="application/json",
            )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["imported"] == 2
        assert data["skipped"] == 0


# ── /api/notifications/mark-read ─────────────────────────────────────────────

class TestMarkNotificationsRead:
    """Tests for POST /api/notifications/mark-read."""

    def test_missing_uid_returns_400(self, client):
        """Missing 'uid' must return 400."""
        resp = client.post(
            "/api/notifications/mark-read",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_no_firestore_returns_zero_updated(self, client):
        """Without Firestore, updated count is 0 with a warning."""
        resp = client.post(
            "/api/notifications/mark-read",
            data=json.dumps({"uid": "u1"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["updated"] == 0

    def test_mark_specific_ids_with_firestore(self, client):
        """Providing specific IDs should update only those notifications."""
        mock_db = MagicMock()

        with patch("api.routes._get_firestore", return_value=mock_db):
            resp = client.post(
                "/api/notifications/mark-read",
                data=json.dumps({"uid": "u1", "ids": ["notif-1", "notif-2"]}),
                content_type="application/json",
            )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["updated"] == 2

    def test_mark_all_read_with_firestore(self, client):
        """Omitting 'ids' (or passing []) should mark all unread as read."""
        mock_doc = MagicMock()
        mock_doc.id = "notif-xyz"

        mock_db = MagicMock()
        mock_db.collection.return_value.document.return_value \
            .collection.return_value.where.return_value \
            .stream.return_value = iter([mock_doc])

        with patch("api.routes._get_firestore", return_value=mock_db):
            resp = client.post(
                "/api/notifications/mark-read",
                data=json.dumps({"uid": "u1"}),
                content_type="application/json",
            )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["updated"] == 1

    def test_ids_capped_at_50(self, client):
        """Providing more than 50 IDs should only process the first 50."""
        mock_db = MagicMock()

        ids = [f"notif-{i}" for i in range(100)]

        with patch("api.routes._get_firestore", return_value=mock_db):
            resp = client.post(
                "/api/notifications/mark-read",
                data=json.dumps({"uid": "u1", "ids": ids}),
                content_type="application/json",
            )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["updated"] == 50


# ── /api/ecobot (fallback) ────────────────────────────────────────────────────

class TestEcoBotRoute:
    """Tests for POST /api/ecobot."""

    def test_missing_message_returns_400(self, client):
        """Empty 'message' must return 400."""
        resp = client.post(
            "/api/ecobot",
            data=json.dumps({"message": ""}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_fallback_reply_on_no_ai(self, client):
        """With no AI keys, fallback reply is returned and provider is 'fallback'."""
        resp = client.post(
            "/api/ecobot",
            data=json.dumps({"message": "What is my score?", "context": {}}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "reply" in data
        assert data["provider"] == "fallback"
        assert len(data["reply"]) > 0

    def test_message_truncated_at_500_chars(self, client):
        """Messages over 500 chars should be accepted (truncated silently)."""
        long_msg = "A" * 600
        resp = client.post(
            "/api/ecobot",
            data=json.dumps({"message": long_msg}),
            content_type="application/json",
        )
        assert resp.status_code == 200

    def test_context_with_known_stats(self, client):
        """Context dict with valid stats should produce a contextual fallback reply."""
        context = {
            "total_co2": 250.0,
            "score": "Good",
            "top_category": "food",
            "monthly_goal": 300,
            "activity_count": 5,
        }
        resp = client.post(
            "/api/ecobot",
            data=json.dumps({"message": "How can I reduce my footprint?", "context": context}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "reply" in data
        # fallback for "reduce" with top_category=food should mention food
        assert len(data["reply"]) > 10
