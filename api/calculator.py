"""
api/calculator.py
─────────────────
Pure-function carbon footprint calculation logic.

All emission factors are sourced from peer-reviewed literature and government
datasets (UK DEFRA 2023, IPCC AR6).  No I/O is performed here — these
functions are safe to unit-test in isolation.

IMPORTANT — Score label thresholds
───────────────────────────────────
The ``score_label`` assigned by ``calculate_footprint()`` is calibrated for
a SINGLE ACTIVITY LOG, not a cumulative monthly total.

Thresholds (kg CO₂e, single entry):
  < 30   → Excellent 🌿
  < 60   → Good 🙂
  < 100  → Average ⚠️
  ≥ 100  → High ❗

For monthly totals (tracked via dashboard), the global average is ~333 kg/month.
Monthly comparisons are handled in api/routes.py and the EcoBot chat context.

Emission factors:
  Transport:
    car      → 0.21  kg CO₂e / km
    flight   → 0.255 kg CO₂e / km (economy, radiative forcing included)
    bus      → 0.089 kg CO₂e / km

  Food (per day):
    meat         → 7.2 kg CO₂e / day
    vegetarian   → 3.8 kg CO₂e / day
    vegan        → 2.9 kg CO₂e / day

  Energy:
    electricity  → 0.233 kg CO₂e / kWh  (UK average grid)
    natural_gas  → 2.04  kg CO₂e / m³

  Shopping (per week):
    high   → 15 kg CO₂e / week
    medium →  8 kg CO₂e / week
    low    →  3 kg CO₂e / week
"""

from __future__ import annotations

# ── Emission factor constants ───────────────────────────────────────────────

TRANSPORT_FACTORS: dict[str, float] = {
    "car": 0.21,
    "flight": 0.255,
    "bus": 0.089,
}

FOOD_FACTORS: dict[str, float] = {
    "meat": 7.2,
    "vegetarian": 3.8,
    "vegan": 2.9,
}

SHOPPING_FACTORS: dict[str, float] = {
    "high": 15.0,
    "medium": 8.0,
    "low": 3.0,
}

ELECTRICITY_FACTOR: float = 0.233   # kg CO₂e / kWh
NATURAL_GAS_FACTOR: float = 2.04    # kg CO₂e / m³

VALID_TRANSPORT_MODES = set(TRANSPORT_FACTORS.keys())
VALID_DIET_TYPES = set(FOOD_FACTORS.keys())
VALID_SHOPPING_LEVELS = set(SHOPPING_FACTORS.keys())


# ── Validation helpers ─────────────────────────────────────────────────────

class CalculationError(ValueError):
    """Raised when input values fail domain validation."""


def _require_non_negative(value: float, name: str) -> None:
    """
    Assert that a numeric value is ≥ 0.

    Parameters
    ----------
    value : float
        The value to check.
    name : str
        Human-readable field name used in the error message.

    Raises
    ------
    CalculationError
        If *value* is negative.
    """
    if value < 0:
        raise CalculationError(f"'{name}' must be non-negative, got {value}.")


# ── Core calculation functions ─────────────────────────────────────────────

def calc_transport(mode: str, km: float) -> float:
    """
    Calculate CO₂e emissions from transport.

    Parameters
    ----------
    mode : str
        Transport mode: 'car', 'flight', or 'bus'.
    km : float
        Distance travelled in kilometres (must be ≥ 0).

    Returns
    -------
    float
        Total CO₂e in kilograms.

    Raises
    ------
    CalculationError
        If mode is unknown or km is negative.
    """
    mode = mode.strip().lower()
    if mode not in TRANSPORT_FACTORS:
        raise CalculationError(
            f"Unknown transport mode '{mode}'. "
            f"Valid options: {sorted(TRANSPORT_FACTORS)}."
        )
    _require_non_negative(km, "km")
    return round(TRANSPORT_FACTORS[mode] * km, 4)


def calc_food(diet_type: str, days: float = 7.0) -> float:
    """
    Calculate CO₂e emissions from food consumption.

    Parameters
    ----------
    diet_type : str
        Diet category: 'meat', 'vegetarian', or 'vegan'.
    days : float, optional
        Number of days to calculate for (default 7 = one week).

    Returns
    -------
    float
        Total CO₂e in kilograms.

    Raises
    ------
    CalculationError
        If diet_type is unknown or days is negative.
    """
    diet_type = diet_type.strip().lower()
    if diet_type not in FOOD_FACTORS:
        raise CalculationError(
            f"Unknown diet type '{diet_type}'. "
            f"Valid options: {sorted(FOOD_FACTORS)}."
        )
    _require_non_negative(days, "days")
    return round(FOOD_FACTORS[diet_type] * days, 4)


def calc_energy(kwh: float = 0.0, m3_gas: float = 0.0) -> float:
    """
    Calculate CO₂e emissions from home energy use.

    Parameters
    ----------
    kwh : float, optional
        Electricity consumed in kilowatt-hours (default 0).
    m3_gas : float, optional
        Natural gas consumed in cubic metres (default 0).

    Returns
    -------
    float
        Total CO₂e in kilograms.

    Raises
    ------
    CalculationError
        If kwh or m3_gas is negative.
    """
    _require_non_negative(kwh, "kwh")
    _require_non_negative(m3_gas, "m3_gas")
    electricity_co2 = kwh * ELECTRICITY_FACTOR
    gas_co2 = m3_gas * NATURAL_GAS_FACTOR
    return round(electricity_co2 + gas_co2, 4)


def calc_shopping(level: str, weeks: float = 1.0) -> float:
    """
    Calculate CO₂e emissions from shopping habits.

    Parameters
    ----------
    level : str
        Shopping intensity: 'high', 'medium', or 'low'.
    weeks : float, optional
        Number of weeks (default 1).

    Returns
    -------
    float
        Total CO₂e in kilograms.

    Raises
    ------
    CalculationError
        If level is unknown or weeks is negative.
    """
    level = level.strip().lower()
    if level not in SHOPPING_FACTORS:
        raise CalculationError(
            f"Unknown shopping level '{level}'. "
            f"Valid options: {sorted(SHOPPING_FACTORS)}."
        )
    _require_non_negative(weeks, "weeks")
    return round(SHOPPING_FACTORS[level] * weeks, 4)


def calc_total(
    transport_co2: float,
    food_co2: float,
    energy_co2: float,
    shopping_co2: float,
) -> dict:
    """
    Aggregate individual category emissions into a total footprint.

    Parameters
    ----------
    transport_co2 : float
        Transport emissions in kg CO₂e.
    food_co2 : float
        Food emissions in kg CO₂e.
    energy_co2 : float
        Energy emissions in kg CO₂e.
    shopping_co2 : float
        Shopping emissions in kg CO₂e.

    Returns
    -------
    dict
        Keys: 'transport', 'food', 'energy', 'shopping', 'total'.
        All values are rounded to 2 decimal places.
    """
    total = transport_co2 + food_co2 + energy_co2 + shopping_co2
    return {
        "transport": round(transport_co2, 2),
        "food": round(food_co2, 2),
        "energy": round(energy_co2, 2),
        "shopping": round(shopping_co2, 2),
        "total": round(total, 2),
    }


def calculate_footprint(data: dict) -> dict:
    """
    Top-level entry point: parse raw API payload and return full footprint.

    Parameters
    ----------
    data : dict
        Expected keys:
            transport_mode (str), transport_km (float),
            diet_type (str), food_days (float, default 7),
            electricity_kwh (float, default 0),
            gas_m3 (float, default 0),
            shopping_level (str), shopping_weeks (float, default 1).

    Returns
    -------
    dict
        Footprint breakdown dict (see calc_total) plus a 'score' label.

    Raises
    ------
    CalculationError
        If any required field is missing or invalid.
    KeyError
        If a required key is absent from *data*.
    """
    try:
        transport = calc_transport(
            data["transport_mode"],
            float(data.get("transport_km", 0)),
        )
        food = calc_food(
            data["diet_type"],
            float(data.get("food_days", 7)),
        )
        energy = calc_energy(
            float(data.get("electricity_kwh", 0)),
            float(data.get("gas_m3", 0)),
        )
        shopping = calc_shopping(
            data["shopping_level"],
            float(data.get("shopping_weeks", 1)),
        )
    except KeyError as exc:
        raise CalculationError(f"Missing required field: {exc}") from exc

    breakdown = calc_total(transport, food, energy, shopping)

    # Assign a human-readable score label.
    # NOTE: These thresholds are calibrated for a SINGLE ACTIVITY LOG entry,
    # not a cumulative monthly total. The global monthly average is ~333 kg.
    # Monthly progress comparisons live in api/routes.py and the dashboard.
    total = breakdown["total"]
    if total < 30:
        breakdown["score_label"] = "Excellent 🌿"
    elif total < 60:
        breakdown["score_label"] = "Good 🙂"
    elif total < 100:
        breakdown["score_label"] = "Average ⚠️"
    else:
        breakdown["score_label"] = "High ❗"

    return breakdown
