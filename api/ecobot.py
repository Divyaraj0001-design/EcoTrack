"""
api/ecobot.py
─────────────
EcoBot AI chat engine.

Encapsulates the carbon-coach assistant behind a single ``generate_reply``
entry point with a layered provider strategy:

    Groq (hosted, free tier)  →  Ollama (local)  →  rule-based fallback

Keeping this logic in its own service module — rather than inline in the
Flask route — means the route layer stays thin (HTTP concerns only) and the
AI behaviour can be unit-tested and swapped without touching request handling.
"""

from __future__ import annotations

import logging
import os

import requests

logger = logging.getLogger(__name__)

# Network timeouts (seconds) for each provider.
_GROQ_TIMEOUT = 12
_OLLAMA_TIMEOUT = 15

_SYSTEM_PROMPT = """You are EcoBot, an AI carbon footprint coach inside EcoTrack app.
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


def build_system_prompt(context: dict) -> str:
    """
    Render the EcoBot system prompt with the user's current stats.

    Parameters
    ----------
    context : dict
        User stats: total_co2, score, top_category, monthly_goal, activity_count.

    Returns
    -------
    str
        Formatted system prompt.
    """
    return _SYSTEM_PROMPT.format(
        total_co2=f"{float(context.get('total_co2', 0)):.1f}",
        score=str(context.get("score", "Unknown")),
        top_category=str(context.get("top_category", "energy")),
        monthly_goal=f"{float(context.get('monthly_goal', 300)):.0f}",
        activity_count=int(context.get("activity_count", 0)),
    )


def _call_groq(prompt: str, system: str) -> str | None:
    """Attempt to call the Groq API (free tier, llama-3.1-8b-instant)."""
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
            timeout=_GROQ_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("Groq API call failed: %s", exc)
        return None


def _call_ollama(prompt: str, system: str) -> str | None:
    """Attempt to call a local Ollama instance (llama3.2)."""
    try:
        resp = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": "llama3.2",
                "prompt": f"{system}\n\nUser: {prompt}\nEcoBot:",
                "stream": False,
            },
            timeout=_OLLAMA_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json().get("response", "").strip()
    except Exception as exc:
        logger.warning("Ollama call failed: %s", exc)
        return None


def _fallback(message: str, context: dict) -> str:
    """Rule-based reply used when every AI provider is unavailable."""
    msg = message.lower()
    total = context.get("total_co2", 0)
    score = context.get("score", "Unknown")
    top_cat = context.get("top_category", "energy")
    goal = context.get("monthly_goal", 300)

    if any(w in msg for w in ["score", "mean", "rating", "grade"]):
        return (
            f"Your current score is **{score}**. 🌿 Scores range from Excellent (under 100 kg/month) "
            f"to Critical (over 500 kg). The global average is ~333 kg/month. "
            f"Keep logging activities to track your progress!"
        )

    if any(w in msg for w in ["reduce", "lower", "cut", "improve", "how"]):
        tips_map = {
            "transport": "Try switching car trips under 5 km to cycling or walking 🚴 — this alone can cut transport emissions by 30%.",
            "food": "Try 'Meat-Free Monday' 🥗 — skipping meat once a week saves ~0.9 kg CO₂. Over a year, that's 46 kg!",
            "energy": "Switch to LED bulbs 💡 and unplug idle devices — they save up to 75% more electricity than traditional bulbs.",
            "shopping": "Buy second-hand clothing 👕 — fashion causes more CO₂ than aviation and shipping combined!",
        }
        return tips_map.get(
            top_cat, "Focus on your highest-emission category for the biggest impact! 💚"
        )

    if any(w in msg for w in ["compare", "average", "global", "world"]):
        verdict = (
            "You're doing great — below average! 🌟"
            if total < 333
            else "There's room to improve — try one of the eco-challenges! 💪"
        )
        return (
            f"The global average is ~4,000 kg CO₂/year (333 kg/month). "
            f"Your total this month is {total:.0f} kg. {verdict}"
        )

    if any(w in msg for w in ["challenge", "suggest", "recommend"]):
        return (
            f"Based on your top emission category ({top_cat}), I recommend the "
            f"**{top_cat.title()} Reduction Challenge**! "
            f"Try it in the Challenges tab — even small changes add up. 🏆"
        )

    if any(w in msg for w in ["goal", "target", "progress"]):
        pct = (total / goal * 100) if goal > 0 else 0
        return (
            f"Your monthly goal is {goal} kg CO₂. "
            f"You've used {total:.0f} kg so far — that's {pct:.0f}% of your budget. "
            f"{'On track! 🎯' if pct < 80 else 'Getting close — time to take action! ⚡'}"
        )

    if any(w in msg for w in ["log", "add", "track", "record"]):
        return (
            "To log an activity, click **Log Activity** in the sidebar. "
            "Fill in your transport, food, energy, and shopping details, "
            "then hit Calculate to see your CO₂ impact instantly! 🌍"
        )

    return (
        f"Hi! I'm EcoBot, your carbon coach. 🌿 "
        f"You've logged {total:.0f} kg CO₂ this month. "
        f"Ask me about your score, how to reduce emissions, challenges, or how to log activities!"
    )


def generate_reply(message: str, context: dict) -> tuple[str, str]:
    """
    Produce an EcoBot reply, trying each provider in priority order.

    Parameters
    ----------
    message : str
        The user's (already sanitised, length-capped) message.
    context : dict
        User stats used to ground the reply.

    Returns
    -------
    tuple[str, str]
        ``(reply, provider)`` where provider is 'groq', 'ollama', or 'fallback'.
    """
    system = build_system_prompt(context)

    reply = _call_groq(message, system)
    if reply:
        return reply, "groq"

    reply = _call_ollama(message, system)
    if reply:
        return reply, "ollama"

    return _fallback(message, context), "fallback"
