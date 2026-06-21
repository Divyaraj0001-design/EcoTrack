"""
tests/test_validation.py
────────────────────────
Input validation tests — verify that the calculator correctly rejects
out-of-range, missing, or malformed inputs.

Run with:  pytest tests/test_validation.py -v
"""

import pytest

from api.calculator import (
    CalculationError,
    calc_energy,
    calc_food,
    calc_shopping,
    calc_transport,
    calculate_footprint,
)


class TestTransportValidation:
    """Validate transport mode and distance inputs."""

    def test_empty_mode_string_rejected(self):
        """Empty string mode must raise CalculationError."""
        with pytest.raises(CalculationError):
            calc_transport("", 10)

    def test_whitespace_only_mode_rejected(self):
        """Whitespace-only mode must raise CalculationError."""
        with pytest.raises(CalculationError):
            calc_transport("   ", 10)

    def test_numeric_mode_rejected(self):
        """Numeric mode string must raise CalculationError."""
        with pytest.raises(CalculationError):
            calc_transport("123", 50)

    def test_negative_distance_rejected(self):
        """Negative km must raise CalculationError."""
        with pytest.raises(CalculationError, match="non-negative"):
            calc_transport("car", -1)


class TestFoodValidation:
    """Validate diet type and day count inputs."""

    def test_unknown_diet_rejected(self):
        """Unknown diet type must raise CalculationError."""
        with pytest.raises(CalculationError, match="Unknown diet type"):
            calc_food("paleo", 7)

    def test_negative_days_rejected(self):
        """Negative day count must raise CalculationError."""
        with pytest.raises(CalculationError, match="non-negative"):
            calc_food("vegan", -3)

    def test_empty_diet_string_rejected(self):
        """Empty diet string must raise CalculationError."""
        with pytest.raises(CalculationError):
            calc_food("", 7)


class TestEnergyValidation:
    """Validate electricity and gas inputs."""

    def test_negative_kwh_rejected(self):
        """Negative kWh must raise CalculationError."""
        with pytest.raises(CalculationError, match="non-negative"):
            calc_energy(kwh=-100, m3_gas=0)

    def test_negative_gas_rejected(self):
        """Negative gas m³ must raise CalculationError."""
        with pytest.raises(CalculationError, match="non-negative"):
            calc_energy(kwh=0, m3_gas=-5)


class TestShoppingValidation:
    """Validate shopping level and week count inputs."""

    def test_unknown_level_rejected(self):
        """Unknown shopping level must raise CalculationError."""
        with pytest.raises(CalculationError, match="Unknown shopping level"):
            calc_shopping("insane", 1)

    def test_negative_weeks_rejected(self):
        """Negative week count must raise CalculationError."""
        with pytest.raises(CalculationError, match="non-negative"):
            calc_shopping("low", -2)


class TestPayloadValidation:
    """Full payload validation via calculate_footprint()."""

    def test_completely_empty_payload_rejected(self):
        """Completely empty dict must raise CalculationError."""
        with pytest.raises(CalculationError):
            calculate_footprint({})

    def test_missing_diet_type_rejected(self):
        """Payload missing 'diet_type' must raise CalculationError."""
        with pytest.raises(CalculationError):
            calculate_footprint(
                {
                    "transport_mode": "car",
                    "transport_km": 10,
                    "shopping_level": "low",
                }
            )

    def test_missing_shopping_level_rejected(self):
        """Payload missing 'shopping_level' must raise CalculationError."""
        with pytest.raises(CalculationError):
            calculate_footprint(
                {
                    "transport_mode": "car",
                    "transport_km": 10,
                    "diet_type": "vegan",
                }
            )
