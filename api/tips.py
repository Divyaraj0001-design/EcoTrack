"""
api/tips.py
───────────
Tip engine for EcoTrack.

Provides two strategies:
  1. call_gemini_tips() — calls Google Gemini 2.5 Flash for personalised tips.
  2. get_tips()         — rule-based fallback prioritised by highest-emission category.

The /api/calculate route always calls call_gemini_tips() first and falls back to
get_tips() automatically if the Gemini API is unavailable or returns invalid data.
"""

from __future__ import annotations

import json
import logging
import os

import requests

logger = logging.getLogger(__name__)

# ── Tip database ────────────────────────────────────────────────────────────

TIPS: dict[str, list[str]] = {
    "transport": [
        "🚲  Try cycling or walking for trips under 5 km — zero emissions and great exercise!",
        "🚌  Swap one car trip per week for public transport to cut emissions by up to 89%.",
        "🚂  Take a train instead of a short-haul flight; rail is ~90% cleaner per km.",
        "🚗  If you must drive, maintain proper tyre pressure — it improves fuel economy by up to 3%.",
        "🤝  Carpool with colleagues; sharing a car halves your per-person transport footprint.",
        "⚡  Consider switching to an electric vehicle — EVs emit 70% less CO₂ over their lifetime.",
    ],
    "food": [
        "🥗  Try 'Meat-Free Monday' — skipping meat one day a week saves ~0.9 kg CO₂.",
        "🌱  Replace beef with chicken or legumes; beef produces 20× more CO₂ than lentils.",
        "🛒  Buy seasonal, local produce to reduce transport and cold-chain emissions.",
        "🍱  Plan meals to reduce food waste — wasted food accounts for ~8% of global emissions.",
        "🌿  Explore plant-based alternatives for protein; legumes are both cheap and low-carbon.",
        "🐟  When eating fish, choose sustainably sourced options certified by MSC.",
    ],
    "energy": [
        "💡  Switch to LED bulbs — they use 75% less electricity than incandescent bulbs.",
        "🌡️  Lower your thermostat by 1°C in winter; this saves around 10% of heating energy.",
        "🔌  Unplug electronics when not in use — standby power can account for 10% of home electricity.",
        "☀️  Consider solar panels; a typical rooftop system offsets ~1.5 tonnes of CO₂ per year.",
        "🏠  Insulate your home properly — good insulation can halve heating and cooling demands.",
        "🌬️  Choose a green energy tariff from a renewable electricity provider.",
    ],
    "shopping": [
        "👚  Buy second-hand clothing — the fashion industry emits as much CO₂ as aviation & shipping combined.",
        "📦  Choose products with minimal or recycled packaging.",
        "🔧  Repair rather than replace electronics — extending device life by 1 year halves manufacturing emissions.",
        "🌍  Support brands with verified carbon-neutral or B-Corp certifications.",
        "🛍️  Avoid impulse buying; consolidate deliveries to reduce last-mile transport emissions.",
        "♻️  Recycle correctly — contamination in recycling streams causes landfill diversion.",
    ],
    "general": [
        "🌳  Offset unavoidable emissions by supporting verified reforestation projects (Gold Standard).",
        "📊  Track your footprint monthly — awareness is the first step to lasting change.",
        "🗳️  Engage with local green policies; systemic change amplifies individual action.",
        "💬  Share your journey with friends and family — social influence is a powerful driver of behaviour.",
    ],
}


# ── Gemini AI tip engine ─────────────────────────────────────────────────────


def call_gemini_tips(
    transport: float,
    food: float,
    energy: float,
    shopping: float,
) -> list[dict]:
    """
    Call Google Gemini 2.5 Flash to generate 3 personalised carbon-reduction tips.

    Constructs a structured prompt with the user's category emissions, sends it to
    the Gemini generateContent endpoint, and parses the JSON array response.

    If the API call fails for **any** reason (network error, bad key, quota exceeded,
    malformed JSON, etc.), the exception is caught and an empty list is returned so
    that the caller can fall back to rule-based tips without crashing.

    Parameters
    ----------
    transport : float
        Monthly transport emissions in kg CO₂e.
    food : float
        Monthly food emissions in kg CO₂e.
    energy : float
        Monthly home energy emissions in kg CO₂e.
    shopping : float
        Monthly shopping emissions in kg CO₂e.

    Returns
    -------
    list[dict]
        Each dict has keys ``'category'`` (str) and ``'text'`` (str).
        Returns an empty list on any failure.
    """
    try:
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not api_key:
            logger.debug("GEMINI_API_KEY not set — skipping Gemini tips.")
            return []

        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/"
            "models/gemini-2.5-flash:generateContent"
        )

        prompt = (
            "You are an eco coach. A user has these monthly carbon emissions: "
            f"Transport: {transport} kg CO2e, Food: {food} kg CO2e, "
            f"Energy: {energy} kg CO2e, Shopping: {shopping} kg CO2e. "
            "Return exactly 3 personalised tips to reduce their highest emission "
            "categories. Each tip must be 1 sentence. "
            'Format as JSON array: [{"category": string, "text": string}]'
        )

        payload = {"contents": [{"parts": [{"text": prompt}]}]}

        response = requests.post(
            endpoint,
            json=payload,
            params={"key": api_key},
            timeout=10,
        )

        response.raise_for_status()

        raw_text: str = response.json()["candidates"][0]["content"]["parts"][0]["text"]

        # Strip markdown code fences if Gemini wraps the JSON
        clean = raw_text.strip()
        if clean.startswith("```"):
            lines = clean.splitlines()
            clean = "\n".join(line for line in lines if not line.startswith("```")).strip()

        tips: list[dict] = json.loads(clean)

        # Validate structure — must be a list of dicts with 'category' and 'text'
        if not isinstance(tips, list):
            raise ValueError("Gemini response is not a JSON array.")
        for item in tips:
            if not isinstance(item, dict) or "category" not in item or "text" not in item:
                raise ValueError(f"Unexpected tip format: {item}")

        logger.info("Gemini returned %d tips successfully.", len(tips))
        return tips

    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Gemini tips failed (%s: %s) — using rule-based fallback.", type(exc).__name__, exc
        )
        return []


def get_tips(breakdown: dict, max_tips: int = 5) -> list[dict]:
    """
    Return prioritised tips based on the highest-emission categories.

    Tips for the single worst category are listed first, followed by tips
    from other categories and finally general tips.

    Parameters
    ----------
    breakdown : dict
        Footprint breakdown with keys 'transport', 'food', 'energy', 'shopping'.
    max_tips : int, optional
        Maximum number of tips to return (default 5).

    Returns
    -------
    list[dict]
        Each dict has keys 'category' (str) and 'tip' (str).
    """
    category_order = sorted(
        ["transport", "food", "energy", "shopping"],
        key=lambda c: breakdown.get(c, 0),
        reverse=True,
    )

    result: list[dict] = []
    used: set[str] = set()

    for category in category_order:
        for tip in TIPS.get(category, []):
            if tip not in used:
                result.append({"category": category, "text": tip})
                used.add(tip)
                break  # one tip per category in first pass

    # Fill remaining slots from all categories round-robin
    for category in category_order + ["general"]:
        for tip in TIPS.get(category, []):
            if len(result) >= max_tips:
                break
            if tip not in used:
                result.append({"category": category, "text": tip})
                used.add(tip)

    return result[:max_tips]
