"""
tests/test_calculator.py
────────────────────────
Unit tests for the carbon footprint calculation logic in api/calculator.py.

All tests are pure-function tests — no I/O, no Flask, no Firebase.
Run with:  pytest tests/test_calculator.py -v
"""

import pytest

from api.calculator import (
    ELECTRICITY_FACTOR,
    NATURAL_GAS_FACTOR,
    TRANSPORT_FACTORS,
    CalculationError,
    calc_energy,
    calc_food,
    calc_shopping,
    calc_total,
    calc_transport,
    calculate_footprint,
)

# ── calc_transport ────────────────────────────────────────────────────────────


class TestCalcTransport:
    """Tests for calc_transport()."""

    def test_car_emission_factor(self):
        """Car: 0.21 kg CO2/km × 100 km = 21.0 kg."""
        assert calc_transport("car", 100) == pytest.approx(21.0, rel=1e-3)

    def test_flight_emission_factor(self):
        """Flight: 0.255 kg CO2/km × 200 km = 51.0 kg."""
        assert calc_transport("flight", 200) == pytest.approx(51.0, rel=1e-3)

    def test_bus_emission_factor(self):
        """Bus: 0.089 kg CO2/km × 50 km = 4.45 kg."""
        assert calc_transport("bus", 50) == pytest.approx(4.45, rel=1e-3)

    def test_zero_km_returns_zero(self):
        """Zero distance should always yield zero emissions."""
        assert calc_transport("car", 0) == 0.0
        assert calc_transport("flight", 0) == 0.0
        assert calc_transport("bus", 0) == 0.0

    def test_unknown_mode_raises_error(self):
        """Unknown transport mode must raise CalculationError."""
        with pytest.raises(CalculationError, match="Unknown transport mode"):
            calc_transport("rocket", 100)

    def test_negative_km_raises_error(self):
        """Negative distance must raise CalculationError."""
        with pytest.raises(CalculationError):
            calc_transport("car", -10)

    def test_case_insensitive_mode(self):
        """Mode string should be normalised to lowercase."""
        assert calc_transport("CAR", 100) == calc_transport("car", 100)
        assert calc_transport("Flight", 100) == calc_transport("flight", 100)

    def test_fractional_km(self):
        """Fractional km values should produce correct results."""
        result = calc_transport("car", 1.5)
        assert result == pytest.approx(0.315, rel=1e-3)

    def test_large_km(self):
        """Large km values (e.g., long-haul flight) should not overflow."""
        result = calc_transport("flight", 10_000)
        assert result == pytest.approx(2550.0, rel=1e-3)

    def test_all_modes_present(self):
        """Every key in TRANSPORT_FACTORS should be a valid mode."""
        for mode in TRANSPORT_FACTORS:
            result = calc_transport(mode, 100)
            assert result > 0


# ── calc_food ─────────────────────────────────────────────────────────────────


class TestCalcFood:
    """Tests for calc_food()."""

    def test_meat_one_day(self):
        """Meat diet for 1 day = 7.2 kg CO2."""
        assert calc_food("meat", 1) == pytest.approx(7.2, rel=1e-3)

    def test_vegetarian_one_week(self):
        """Vegetarian for 7 days = 3.8 × 7 = 26.6 kg CO2."""
        assert calc_food("vegetarian", 7) == pytest.approx(26.6, rel=1e-3)

    def test_vegan_one_week(self):
        """Vegan for 7 days = 2.9 × 7 = 20.3 kg CO2."""
        assert calc_food("vegan", 7) == pytest.approx(20.3, rel=1e-3)

    def test_unknown_diet_raises_error(self):
        """Unknown diet type must raise CalculationError."""
        with pytest.raises(CalculationError, match="Unknown diet type"):
            calc_food("keto", 7)

    def test_negative_days_raises_error(self):
        """Negative days must raise CalculationError."""
        with pytest.raises(CalculationError):
            calc_food("vegan", -1)

    def test_zero_days_returns_zero(self):
        """Zero days should return zero CO2."""
        assert calc_food("meat", 0) == 0.0


# ── calc_energy ───────────────────────────────────────────────────────────────


class TestCalcEnergy:
    """Tests for calc_energy()."""

    def test_electricity_only(self):
        """100 kWh electricity × 0.233 = 23.3 kg CO2."""
        assert calc_energy(kwh=100, m3_gas=0) == pytest.approx(23.3, rel=1e-3)

    def test_gas_only(self):
        """5 m³ gas × 2.04 = 10.2 kg CO2."""
        assert calc_energy(kwh=0, m3_gas=5) == pytest.approx(10.2, rel=1e-3)

    def test_combined_energy(self):
        """Both electricity and gas combined."""
        expected = (100 * ELECTRICITY_FACTOR) + (5 * NATURAL_GAS_FACTOR)
        assert calc_energy(100, 5) == pytest.approx(expected, rel=1e-3)

    def test_zero_energy_returns_zero(self):
        """No energy use should yield zero CO2."""
        assert calc_energy(0, 0) == 0.0

    def test_negative_kwh_raises_error(self):
        """Negative kWh must raise CalculationError."""
        with pytest.raises(CalculationError):
            calc_energy(kwh=-50, m3_gas=0)

    def test_negative_gas_raises_error(self):
        """Negative gas must raise CalculationError."""
        with pytest.raises(CalculationError):
            calc_energy(kwh=0, m3_gas=-1)


# ── calc_shopping ─────────────────────────────────────────────────────────────


class TestCalcShopping:
    """Tests for calc_shopping()."""

    def test_high_shopping_one_week(self):
        """High shopping for 1 week = 15 kg CO2."""
        assert calc_shopping("high", 1) == pytest.approx(15.0, rel=1e-3)

    def test_medium_shopping_two_weeks(self):
        """Medium shopping for 2 weeks = 16 kg CO2."""
        assert calc_shopping("medium", 2) == pytest.approx(16.0, rel=1e-3)

    def test_low_shopping(self):
        """Low shopping for 1 week = 3 kg CO2."""
        assert calc_shopping("low", 1) == pytest.approx(3.0, rel=1e-3)

    def test_unknown_level_raises_error(self):
        """Unknown shopping level must raise CalculationError."""
        with pytest.raises(CalculationError, match="Unknown shopping level"):
            calc_shopping("extreme", 1)

    def test_negative_weeks_raises_error(self):
        """Negative weeks must raise CalculationError."""
        with pytest.raises(CalculationError):
            calc_shopping("low", -1)


# ── calc_total ────────────────────────────────────────────────────────────────


class TestCalcTotal:
    """Tests for calc_total()."""

    def test_total_sums_correctly(self):
        """Total should be the sum of all category values."""
        result = calc_total(10.0, 20.0, 30.0, 40.0)
        assert result["total"] == pytest.approx(100.0, rel=1e-3)

    def test_breakdown_keys_present(self):
        """Result must contain all expected category keys."""
        result = calc_total(1, 2, 3, 4)
        for key in ("transport", "food", "energy", "shopping", "total"):
            assert key in result

    def test_zero_total(self):
        """All-zero inputs should yield zero total."""
        result = calc_total(0, 0, 0, 0)
        assert result["total"] == 0.0


# ── calculate_footprint ───────────────────────────────────────────────────────


class TestCalculateFootprint:
    """Integration tests for the top-level calculate_footprint()."""

    def test_valid_payload_returns_dict(self, sample_payload):
        """Valid payload must return a dict with 'total' and 'score_label'."""
        result = calculate_footprint(sample_payload)
        assert isinstance(result, dict)
        assert "total" in result
        assert "score_label" in result

    def test_score_label_excellent(self):
        """Total < 30 → 'Excellent'."""
        data = {
            "transport_mode": "bus",
            "transport_km": 1,
            "diet_type": "vegan",
            "food_days": 1,
            "electricity_kwh": 1,
            "gas_m3": 0,
            "shopping_level": "low",
            "shopping_weeks": 1,
        }
        result = calculate_footprint(data)
        assert "Excellent" in result["score_label"]

    def test_missing_required_field_raises(self):
        """Missing 'transport_mode' must raise CalculationError."""
        with pytest.raises(CalculationError):
            calculate_footprint({"diet_type": "vegan", "shopping_level": "low"})


# ── Fixture used in this file ────────────────────────────────────────────────


@pytest.fixture()
def sample_payload():
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


# ── Gemini integration ────────────────────────────────────────────────────────


def test_gemini_fallback_on_api_failure(client):
    """Gemini failure must not crash the calculate endpoint."""
    from unittest.mock import patch

    with patch("api.tips.call_gemini_tips", side_effect=Exception("API down")):
        response = client.post(
            "/api/calculate",
            json={
                "transport_mode": "car",
                "transport_km": 100,
                "diet_type": "meat",
                "food_days": 7,
                "electricity_kwh": 200,
                "gas_m3": 0,
                "shopping_level": "medium",
                "shopping_weeks": 1,
            },
        )
        assert response.status_code == 200
        data = response.get_json()
        assert "tips" in data
        assert len(data["tips"]) > 0


def test_gemini_tips_returns_list():
    """call_gemini_tips must return a list when Gemini responds correctly."""
    from unittest.mock import MagicMock, patch

    from api.tips import call_gemini_tips

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "candidates": [
            {
                "content": {
                    "parts": [{"text": '[{"category":"energy","text":"Switch to LED bulbs."}]'}]
                }
            }
        ]
    }
    mock_response.raise_for_status.return_value = None
    with (
        patch("requests.post", return_value=mock_response),
        patch.dict("os.environ", {"GEMINI_API_KEY": "test-key-123"}),
    ):
        result = call_gemini_tips(31.5, 50.4, 58.25, 8.0)
        assert isinstance(result, list)
        assert result[0]["category"] == "energy"
