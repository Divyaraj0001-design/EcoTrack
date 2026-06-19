"""
api/routes.py
─────────────
Flask Blueprint containing all REST API endpoints.

All routes are prefixed with /api and protected against abuse via
flask-limiter.  CORS is configured in app.py.

Endpoints
─────────
POST /api/calculate              – calculate footprint, save to Firestore
GET  /api/history                – fetch user's history from Firestore
GET  /api/tips                   – return personalised tips
GET  /api/challenges             – return active challenges
GET  /api/health                 – health-check / liveness probe
POST /api/ecobot                 – EcoBot AI chat (Groq → Ollama → fallback)
POST /api/support-ticket         – store help contact form in Firestore
POST /api/import                 – batch import CSV activities to Firestore
POST /api/notifications/mark-read – mark user notifications as read
"""

from __future__ import annotations

import html
import io
import json
import logging
import os
import re
import csv as csv_module
from datetime import datetime, timezone
from functools import wraps

import requests
from flask import Blueprint, jsonify, request, current_app, g
# pyrefly: ignore [missing-import]
from flask_limiter import Limiter
# pyrefly: ignore [missing-import]
from flask_limiter.util import get_remote_address

from api.calculator import calculate_footprint, CalculationError
from api.tips import call_gemini_tips, get_tips
from api.challenges import get_all_challenges

# Optional: Firebase Admin (gracefully skipped in test mode)
try:
    # pyrefly: ignore [missing-import]
    import firebase_admin
    # pyrefly: ignore [missing-import]
    from firebase_admin import firestore as fs
    _FIRESTORE_AVAILABLE = True
except ImportError:
    _FIRESTORE_AVAILABLE = False

logger = logging.getLogger(__name__)

api_bp = Blueprint("api", __name__, url_prefix="/api")

# ── Limiter is initialised in app.py; imported here for decorator use ───────
_limiter: Limiter | None = None


def init_limiter(limiter: Limiter) -> None:
    """
    Register the Limiter instance created in app.py with this blueprint.

    Parameters
    ----------
    limiter : Limiter
        The flask-limiter instance.
    """
    global _limiter
    _limiter = limiter


def _rate_limited(limit: str = "60 per minute"):
    """
    Decorator factory that applies rate-limiting if a Limiter is registered.

    Parameters
    ----------
    limit : str
        Rate limit string e.g. '30 per minute'.
    """
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            return f(*args, **kwargs)
        if _limiter:
            wrapped = _limiter.limit(limit)(wrapped)
        return wrapped
    return decorator


# ── Firestore helpers ────────────────────────────────────────────────────────

def _get_firestore():
    """
    Return a Firestore client if Firebase Admin SDK is initialised.

    Returns
    -------
    google.cloud.firestore.Client or None
    """
    if not _FIRESTORE_AVAILABLE:
        return None
    try:
        return fs.client()
    except Exception as exc:
        logger.warning("Firestore unavailable: %s", exc)
        return None


def _sanitise(value: str) -> str:
    """
    HTML-escape a string to prevent XSS in logged/stored values.

    Parameters
    ----------
    value : str
        Raw user input string.

    Returns
    -------
    str
        Sanitised string.
    """
    return html.escape(str(value).strip())


# ── Routes ───────────────────────────────────────────────────────────────────

@api_bp.route("/health", methods=["GET"])
def health():
    """
    Liveness probe endpoint.

    Returns
    -------
    JSON
        ``{"status": "ok", "timestamp": "<ISO-8601>"}``
    """
    return jsonify({"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()})


@api_bp.route("/calculate", methods=["POST"])
@_rate_limited("30 per minute")
def calculate():
    """
    Accept a footprint payload, calculate CO₂, optionally persist to Firestore.

    Request body (JSON)
    -------------------
    transport_mode   : str   – 'car' | 'flight' | 'bus'
    transport_km     : float – distance in kilometres
    diet_type        : str   – 'meat' | 'vegetarian' | 'vegan'
    food_days        : float – number of days (default 7)
    electricity_kwh  : float – kWh consumed (default 0)
    gas_m3           : float – m³ natural gas consumed (default 0)
    shopping_level   : str   – 'high' | 'medium' | 'low'
    shopping_weeks   : float – number of weeks (default 1)
    uid              : str   – Firebase user ID (optional; enables Firestore save)
    from_lat/lng     : float – optional transport start coordinates
    to_lat/lng       : float – optional transport end coordinates

    Returns
    -------
    200 JSON
        Footprint breakdown with 'total' and 'score_label'.
    400 JSON
        Validation / calculation error details.
    500 JSON
        Unexpected server error.
    """
    try:
        data = request.get_json(force=True, silent=True)
        if not data:
            return jsonify({"error": "Request body must be valid JSON."}), 400

        # Sanitise string fields
        for key in ("transport_mode", "diet_type", "shopping_level"):
            if key in data:
                data[key] = _sanitise(data[key])

        # Calculate footprint
        breakdown = calculate_footprint(data)

        # Persist to Firestore if UID provided
        uid = _sanitise(data.get("uid", ""))
        if uid:
            db = _get_firestore()
            if db:
                try:
                    doc = {
                        **breakdown,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "inputs": {
                            k: data[k]
                            for k in (
                                "transport_mode", "transport_km",
                                "diet_type", "food_days",
                                "electricity_kwh", "gas_m3",
                                "shopping_level", "shopping_weeks",
                            )
                            if k in data
                        },
                    }
                    # Include map coordinates if provided
                    for coord_key in ("from_lat", "from_lng", "to_lat", "to_lng"):
                        if coord_key in data:
                            doc[coord_key] = float(data[coord_key])

                    db.collection("users").document(uid).collection(
                        "history"
                    ).add(doc)

                    # Auto-create a notification for this activity log
                    try:
                        notif = {
                            "type": "activity",
                            "icon": "🌿",
                            "text": f"Activity logged: {breakdown['total']:.1f} kg CO₂e",
                            "read": False,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                        db.collection("users").document(uid).collection(
                            "notifications"
                        ).add(notif)
                    except Exception:
                        pass  # Non-fatal

                except Exception as exc:
                    logger.error("Firestore write failed: %s", exc)
                    # Non-fatal — return result anyway

        # Attach tips — try Gemini first, silently fall back to rule-based tips
        gemini_tips = call_gemini_tips(
            transport=breakdown.get("transport", 0.0),
            food=breakdown.get("food", 0.0),
            energy=breakdown.get("energy", 0.0),
            shopping=breakdown.get("shopping", 0.0),
        )
        breakdown["tips"] = gemini_tips if gemini_tips else get_tips(breakdown)
        return jsonify(breakdown), 200

    except CalculationError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        logger.exception("Unexpected error in /calculate")
        return jsonify({"error": "Internal server error."}), 500


@api_bp.route("/history", methods=["GET"])
@_rate_limited("60 per minute")
def history():
    """
    Return a user's footprint history from Firestore.

    Query parameters
    ----------------
    uid   : str  – Firebase user ID (required)
    limit : int  – max records to return (default 30)

    Returns
    -------
    200 JSON
        ``{"history": [ ... ]}``
    400 JSON
        Missing UID.
    503 JSON
        Firestore unavailable.
    """
    try:
        uid = _sanitise(request.args.get("uid", ""))
        if not uid:
            return jsonify({"error": "Query parameter 'uid' is required."}), 400

        limit = min(int(request.args.get("limit", 30)), 100)

        db = _get_firestore()
        if db is None:
            return jsonify({"history": [], "warning": "Firestore unavailable."}), 200

        docs = (
            db.collection("users")
            .document(uid)
            .collection("history")
            .order_by("timestamp", direction=fs.Query.DESCENDING)
            .limit(limit)
            .stream()
        )
        records = [{"id": d.id, **d.to_dict()} for d in docs]
        return jsonify({"history": records}), 200

    except Exception as exc:
        logger.exception("Unexpected error in /history")
        return jsonify({"error": "Internal server error."}), 500


@api_bp.route("/tips", methods=["GET"])
@_rate_limited("60 per minute")
def tips():
    """
    Return personalised carbon-reduction tips.

    Query parameters
    ----------------
    transport : float – transport CO₂ (default 0)
    food      : float – food CO₂ (default 0)
    energy    : float – energy CO₂ (default 0)
    shopping  : float – shopping CO₂ (default 0)
    max       : int   – max tips to return (default 5)

    Returns
    -------
    200 JSON
        ``{"tips": [ ... ]}``
    """
    try:
        breakdown = {
            "transport": float(request.args.get("transport", 0)),
            "food": float(request.args.get("food", 0)),
            "energy": float(request.args.get("energy", 0)),
            "shopping": float(request.args.get("shopping", 0)),
        }
        max_tips = min(int(request.args.get("max", 5)), 20)
        return jsonify({"tips": get_tips(breakdown, max_tips)}), 200
    except ValueError as exc:
        return jsonify({"error": f"Invalid parameter: {exc}"}), 400
    except Exception as exc:
        logger.exception("Unexpected error in /tips")
        return jsonify({"error": "Internal server error."}), 500


@api_bp.route("/challenges", methods=["GET"])
@_rate_limited("60 per minute")
def challenges():
    """
    Return today's daily challenge and this week's weekly challenge.

    Returns
    -------
    200 JSON
        ``{"daily": {...}, "weekly": {...}, "all_daily": [...], "all_weekly": [...]}``
    """
    try:
        return jsonify(get_all_challenges()), 200
    except Exception as exc:
        logger.exception("Unexpected error in /challenges")
        return jsonify({"error": "Internal server error."}), 500


# ── EcoBot AI Chat ──────────────────────────────────────────────────────────

_ECOBOT_SYSTEM_PROMPT = """You are EcoBot, an AI carbon footprint coach inside EcoTrack app.
You help users understand their carbon emissions, suggest ways to reduce their footprint,
explain their carbon score, recommend eco-challenges, and motivate them to hit their monthly goals.

User's current stats:
- Total CO₂ this month: {total_co2} kg
- Carbon score: {score}
- Top emission category: {top_category}
- Monthly goal: {monthly_goal} kg
- Activities logged: {activity_count}

Keep responses concise (2-4 sentences). Be encouraging and specific.
Use emojis sparingly. Never make up emission data. Be friendly and motivating."""


def _call_groq(prompt: str, system: str) -> str | None:
    """Attempt to call Groq API (free tier, llama3-8b-8192)."""
    api_key = os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        return None
    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": "llama-3.1-8b-instant",
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 200,
                "temperature": 0.7,
            },
            timeout=12,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("Groq API call failed: %s", exc)
        return None


def _call_ollama(prompt: str, system: str) -> str | None:
    """Attempt to call local Ollama instance."""
    try:
        resp = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": "llama3.2",
                "prompt": f"{system}\n\nUser: {prompt}\nEcoBot:",
                "stream": False,
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("response", "").strip()
    except Exception as exc:
        logger.warning("Ollama call failed: %s", exc)
        return None


def _ecobot_fallback(message: str, context: dict) -> str:
    """Rule-based fallback when all AI providers fail."""
    msg = message.lower()
    total = context.get("total_co2", 0)
    score = context.get("score", "Unknown")
    top_cat = context.get("top_category", "energy")
    goal = context.get("monthly_goal", 300)

    if any(w in msg for w in ["score", "mean", "rating", "grade"]):
        return (f"Your current score is **{score}**. 🌿 Scores range from Excellent (under 100 kg/month) "
                f"to Critical (over 500 kg). The global average is ~333 kg/month. "
                f"Keep logging activities to track your progress!")

    if any(w in msg for w in ["reduce", "lower", "cut", "improve", "how"]):
        tips_map = {
            "transport": "Try switching car trips under 5 km to cycling or walking 🚴 — this alone can cut transport emissions by 30%.",
            "food": "Try 'Meat-Free Monday' 🥗 — skipping meat once a week saves ~0.9 kg CO₂. Over a year, that's 46 kg!",
            "energy": "Switch to LED bulbs 💡 and unplug idle devices — they save up to 75% more electricity than traditional bulbs.",
            "shopping": "Buy second-hand clothing 👕 — fashion causes more CO₂ than aviation and shipping combined!",
        }
        return tips_map.get(top_cat, "Focus on your highest-emission category for the biggest impact! 💚")

    if any(w in msg for w in ["compare", "average", "global", "world"]):
        return (f"The global average is ~4,000 kg CO₂/year (333 kg/month). "
                f"Your total this month is {total:.0f} kg. "
                f"{'You\'re doing great — below average! 🌟' if total < 333 else 'There\'s room to improve — try one of the eco-challenges! 💪'}")

    if any(w in msg for w in ["challenge", "suggest", "recommend"]):
        return (f"Based on your top emission category ({top_cat}), I recommend the "
                f"**{top_cat.title()} Reduction Challenge**! "
                f"Try it in the Challenges tab — even small changes add up. 🏆")

    if any(w in msg for w in ["goal", "target", "progress"]):
        pct = (total / goal * 100) if goal > 0 else 0
        return (f"Your monthly goal is {goal} kg CO₂. "
                f"You've used {total:.0f} kg so far — that's {pct:.0f}% of your budget. "
                f"{'On track! 🎯' if pct < 80 else 'Getting close — time to take action! ⚡'}")

    if any(w in msg for w in ["log", "add", "track", "record"]):
        return ("To log an activity, click **Log Activity** in the sidebar. "
                "Fill in your transport, food, energy, and shopping details, "
                "then hit Calculate to see your CO₂ impact instantly! 🌍")

    return (f"Hi! I'm EcoBot, your carbon coach. 🌿 "
            f"You've logged {total:.0f} kg CO₂ this month. "
            f"Ask me about your score, how to reduce emissions, challenges, or how to log activities!")


@api_bp.route("/ecobot", methods=["POST"])
@_rate_limited("20 per minute")
def ecobot():
    """
    EcoBot AI chat endpoint.

    Request body (JSON)
    -------------------
    message : str  – user's message
    context : dict – user stats (total_co2, score, top_category, monthly_goal, activity_count)

    Returns
    -------
    200 JSON
        ``{"reply": "...", "provider": "groq|ollama|fallback"}``
    400 JSON
        Missing message.
    """
    try:
        data = request.get_json(force=True, silent=True) or {}
        message = _sanitise(data.get("message", "")).strip()
        if not message:
            return jsonify({"error": "Field 'message' is required."}), 400
        if len(message) > 500:
            message = message[:500]

        context = data.get("context", {})
        total_co2     = float(context.get("total_co2", 0))
        score         = str(context.get("score", "Unknown"))
        top_category  = str(context.get("top_category", "energy"))
        monthly_goal  = float(context.get("monthly_goal", 300))
        activity_count = int(context.get("activity_count", 0))

        system_prompt = _ECOBOT_SYSTEM_PROMPT.format(
            total_co2=f"{total_co2:.1f}",
            score=score,
            top_category=top_category,
            monthly_goal=f"{monthly_goal:.0f}",
            activity_count=activity_count,
        )

        # Try Groq → Ollama → fallback
        reply = _call_groq(message, system_prompt)
        provider = "groq"

        if not reply:
            reply = _call_ollama(message, system_prompt)
            provider = "ollama"

        if not reply:
            reply = _ecobot_fallback(message, {
                "total_co2": total_co2,
                "score": score,
                "top_category": top_category,
                "monthly_goal": monthly_goal,
            })
            provider = "fallback"

        return jsonify({"reply": reply, "provider": provider}), 200

    except Exception as exc:
        logger.exception("Unexpected error in /ecobot")
        return jsonify({"reply": "Sorry, I'm having a moment! Try again shortly. 🤖", "provider": "error"}), 200


# ── Support Ticket ──────────────────────────────────────────────────────────

@api_bp.route("/support-ticket", methods=["POST"])
@_rate_limited("5 per minute")
def support_ticket():
    """
    Store a help contact form submission in Firestore.

    Request body (JSON)
    -------------------
    name    : str
    email   : str
    message : str
    uid     : str (optional)

    Returns
    -------
    200 JSON  Success.
    400 JSON  Missing fields.
    """
    try:
        data = request.get_json(force=True, silent=True) or {}
        name    = _sanitise(data.get("name", "")).strip()
        email   = _sanitise(data.get("email", "")).strip()
        message = _sanitise(data.get("message", "")).strip()

        if not name or not email or not message:
            return jsonify({"error": "name, email, and message are required."}), 400

        ticket = {
            "name": name,
            "email": email,
            "message": message,
            "uid": _sanitise(data.get("uid", "")),
            "status": "open",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        db = _get_firestore()
        if db:
            db.collection("support_tickets").add(ticket)
        else:
            logger.info("Support ticket (no Firestore): %s", ticket)

        return jsonify({"success": True, "message": "Ticket submitted. We'll respond within 24h!"}), 200

    except Exception as exc:
        logger.exception("Unexpected error in /support-ticket")
        return jsonify({"error": "Internal server error."}), 500


# ── CSV Import ──────────────────────────────────────────────────────────────

_REQUIRED_CSV_HEADERS = {"date", "category", "activity", "amount", "unit"}


@api_bp.route("/import", methods=["POST"])
@_rate_limited("10 per minute")
def import_activities():
    """
    Batch import CSV activity data to Firestore.

    Request body (JSON)
    -------------------
    uid  : str        – Firebase user ID (required)
    rows : list[dict] – validated rows from client CSV parser

    Returns
    -------
    200 JSON  ``{"imported": N, "skipped": M}``
    400 JSON  Validation error.
    """
    try:
        data = request.get_json(force=True, silent=True) or {}
        uid  = _sanitise(data.get("uid", "")).strip()
        rows = data.get("rows", [])

        if not uid:
            return jsonify({"error": "'uid' is required."}), 400
        if not isinstance(rows, list) or not rows:
            return jsonify({"error": "'rows' must be a non-empty list."}), 400
        if len(rows) > 500:
            return jsonify({"error": "Maximum 500 rows per import."}), 400

        db = _get_firestore()
        imported = 0
        skipped  = 0

        for row in rows:
            try:
                date     = _sanitise(str(row.get("date", "")))
                category = _sanitise(str(row.get("category", ""))).lower()
                activity = _sanitise(str(row.get("activity", "")))
                amount   = float(row.get("amount", 0))
                unit     = _sanitise(str(row.get("unit", "")))

                if not all([date, category, activity, unit]):
                    skipped += 1
                    continue

                doc = {
                    "date":      date,
                    "category":  category,
                    "activity":  activity,
                    "amount":    amount,
                    "unit":      unit,
                    "source":    "csv_import",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }

                if db:
                    # Duplicate check: date + category + activity
                    from google.cloud.firestore_v1.base_query import FieldFilter
                    existing = (
                        db.collection("users").document(uid)
                        .collection("activities")
                        .where(filter=FieldFilter("date",     "==", date))
                        .where(filter=FieldFilter("category", "==", category))
                        .where(filter=FieldFilter("activity", "==", activity))
                        .limit(1)
                        .stream()
                    )
                    if any(True for _ in existing):
                        skipped += 1
                        continue

                    db.collection("users").document(uid).collection("activities").add(doc)

                imported += 1

            except Exception:
                skipped += 1
                continue

        return jsonify({"imported": imported, "skipped": skipped}), 200

    except Exception as exc:
        logger.exception("Unexpected error in /import")
        return jsonify({"error": "Internal server error."}), 500


# ── Notifications mark-read ─────────────────────────────────────────────────

@api_bp.route("/notifications/mark-read", methods=["POST"])
@_rate_limited("30 per minute")
def mark_notifications_read():
    """
    Mark user notifications as read in Firestore.

    Request body (JSON)
    -------------------
    uid  : str       – Firebase user ID (required)
    ids  : list[str] – notification document IDs to mark read
              (omit or [] to mark ALL as read)

    Returns
    -------
    200 JSON  ``{"updated": N}``
    """
    try:
        data = request.get_json(force=True, silent=True) or {}
        uid  = _sanitise(data.get("uid", "")).strip()
        ids  = data.get("ids", [])

        if not uid:
            return jsonify({"error": "'uid' is required."}), 400

        db = _get_firestore()
        if not db:
            return jsonify({"updated": 0, "warning": "Firestore unavailable."}), 200

        notif_ref = db.collection("users").document(uid).collection("notifications")
        updated = 0

        if ids:
            for nid in ids[:50]:
                try:
                    notif_ref.document(str(nid)).update({"read": True})
                    updated += 1
                except Exception:
                    pass
        else:
            # Mark all unread
            from google.cloud.firestore_v1.base_query import FieldFilter
            docs = notif_ref.where(filter=FieldFilter("read", "==", False)).stream()
            for d in docs:
                try:
                    notif_ref.document(d.id).update({"read": True})
                    updated += 1
                except Exception:
                    pass

        return jsonify({"updated": updated}), 200

    except Exception as exc:
        logger.exception("Unexpected error in /notifications/mark-read")
        return jsonify({"error": "Internal server error."}), 500
