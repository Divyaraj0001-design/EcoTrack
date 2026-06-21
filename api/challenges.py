"""
api/challenges.py
─────────────────
Daily and weekly challenge engine.

Challenges rotate based on the current day-of-week (daily) or ISO week number
(weekly) so users see fresh content without a database lookup.
"""

from __future__ import annotations

import datetime

# ── Challenge databases ─────────────────────────────────────────────────────

DAILY_CHALLENGES: list[dict] = [
    {
        "id": "d1",
        "title": "Zero-Waste Lunch",
        "description": "Pack a lunch with zero single-use packaging today.",
        "points": 20,
        "category": "food",
        "icon": "🥡",
    },
    {
        "id": "d2",
        "title": "Walk or Cycle",
        "description": "Replace at least one motorised trip with walking or cycling.",
        "points": 25,
        "category": "transport",
        "icon": "🚲",
    },
    {
        "id": "d3",
        "title": "Unplug Standby Devices",
        "description": "Unplug all electronics you're not actively using before bed.",
        "points": 15,
        "category": "energy",
        "icon": "🔌",
    },
    {
        "id": "d4",
        "title": "Plant-Based Meal",
        "description": "Eat at least one fully plant-based meal today.",
        "points": 20,
        "category": "food",
        "icon": "🌱",
    },
    {
        "id": "d5",
        "title": "Short Shower",
        "description": "Keep your shower under 4 minutes to save water & heating energy.",
        "points": 10,
        "category": "energy",
        "icon": "🚿",
    },
    {
        "id": "d6",
        "title": "Use a Reusable Bag",
        "description": "Shop with a reusable bag instead of single-use plastic.",
        "points": 10,
        "category": "shopping",
        "icon": "👜",
    },
    {
        "id": "d7",
        "title": "Turn Off Lights",
        "description": "Turn off all lights when leaving a room for the entire day.",
        "points": 15,
        "category": "energy",
        "icon": "💡",
    },
]

WEEKLY_CHALLENGES: list[dict] = [
    {
        "id": "w1",
        "title": "Meat-Free Week",
        "description": "Avoid all meat products for an entire week.",
        "points": 100,
        "category": "food",
        "icon": "🥦",
    },
    {
        "id": "w2",
        "title": "Car-Free Week",
        "description": "Use only public transport, cycling, or walking this week.",
        "points": 120,
        "category": "transport",
        "icon": "🚌",
    },
    {
        "id": "w3",
        "title": "Energy Audit",
        "description": "Identify and switch off 3 energy-wasting habits at home.",
        "points": 80,
        "category": "energy",
        "icon": "🔍",
    },
    {
        "id": "w4",
        "title": "Buy Nothing New",
        "description": "Don't purchase any new items for 7 days.",
        "points": 90,
        "category": "shopping",
        "icon": "🚫",
    },
    {
        "id": "w5",
        "title": "Plant a Seed",
        "description": "Start growing something edible at home — herbs count!",
        "points": 50,
        "category": "food",
        "icon": "🌿",
    },
    {
        "id": "w6",
        "title": "Switch to Green Energy",
        "description": "Research and sign up for a renewable electricity tariff.",
        "points": 150,
        "category": "energy",
        "icon": "☀️",
    },
    {
        "id": "w7",
        "title": "Second-Hand Shopping Only",
        "description": "If you must buy clothing this week, buy it second-hand.",
        "points": 80,
        "category": "shopping",
        "icon": "👚",
    },
]


def get_daily_challenge() -> dict:
    """
    Return today's daily challenge, rotating through the list by day-of-year.

    Returns
    -------
    dict
        The challenge dict for today.
    """
    day_of_year = datetime.date.today().timetuple().tm_yday
    index = day_of_year % len(DAILY_CHALLENGES)
    return DAILY_CHALLENGES[index]


def get_weekly_challenge() -> dict:
    """
    Return this week's weekly challenge, rotating by ISO week number.

    Returns
    -------
    dict
        The challenge dict for the current ISO week.
    """
    iso_week = datetime.date.today().isocalendar()[1]
    index = iso_week % len(WEEKLY_CHALLENGES)
    return WEEKLY_CHALLENGES[index]


def get_all_challenges() -> dict:
    """
    Return both the daily and weekly challenge for the current date.

    Returns
    -------
    dict
        Keys: 'daily' (dict), 'weekly' (dict), 'all_daily' (list),
        'all_weekly' (list).
    """
    return {
        "daily": get_daily_challenge(),
        "weekly": get_weekly_challenge(),
        "all_daily": DAILY_CHALLENGES,
        "all_weekly": WEEKLY_CHALLENGES,
    }
