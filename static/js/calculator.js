/**
 * calculator.js
 * ─────────────
 * Handles the carbon footprint calculator form: validation, API call, and
 * rendering the result card.
 *
 * Relies on:
 *   window.EcoAuth.currentUser()
 *   window.EcoApp.navigate(route)
 *   window.EcoApp.showToast(msg, type)
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/calculator]";

  /** Store the last calculation result for use by the dashboard. */
  let _lastResult = null;

  /**
   * Initialise the calculator form event listeners.
   * Called once from app.js on DOMContentLoaded.
   */
  function init() {
    const form = document.getElementById("calc-form");
    if (!form) return;

    form.addEventListener("submit", _handleSubmit);

    document.getElementById("btn-view-dashboard")?.addEventListener("click", () => {
      window.EcoApp?.navigate("dashboard");
    });

    console.info(TAG, "Calculator initialised.");
  }

  /**
   * Handle form submit: validate → call API → render result.
   *
   * @param {SubmitEvent} e
   */
  async function _handleSubmit(e) {
    e.preventDefault();
    _clearError();

    const btn = document.getElementById("btn-calculate");
    _setLoading(btn, true);

    try {
      const payload = _buildPayload();
      if (!payload) { _setLoading(btn, false); return; }

      // Attach UID if user is logged in (enables Firestore persistence)
      const user = window.EcoAuth?.currentUser();
      if (user) payload.uid = user.uid;

      await _attachRouteCoords(payload);

      const resp = await fetch("/api/calculate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });

      const data = await resp.json();

      if (!resp.ok) {
        _showError(data.error || "Calculation failed. Please check your inputs.");
        return;
      }

      _lastResult = data;
      _renderResult(data);

      // Update Insights tab with latest calculation
      const dietType = document.getElementById('diet-type')?.value || 'meat';
      window.EcoInsights?.update(data, dietType);

      window.EcoApp?.showToast("✅ Footprint calculated!", "success");
      console.info(TAG, "Calculation complete:", data.total, "kg CO₂e");

    } catch (err) {
      console.error(TAG, "Fetch error:", err);
      _showError("Network error — is the server running?");
    } finally {
      _setLoading(btn, false);
    }
  }

  /**
   * Read form fields and build the API payload.
   * Returns null (and shows an error) if validation fails.
   *
   * @returns {Object|null}
   */
  function _buildPayload() {
    const get     = (id) => document.getElementById(id)?.value.trim();
    const getNum  = (id) => parseFloat(document.getElementById(id)?.value) || 0;

    const transport_mode  = get("transport-mode");
    const transport_km    = getNum("transport-km");
    const diet_type       = get("diet-type");
    const food_days       = getNum("food-days");
    const electricity_kwh = getNum("electricity-kwh");
    const gas_m3          = getNum("gas-m3");
    const shopping_level  = get("shopping-level");
    const shopping_weeks  = getNum("shopping-weeks");

    // Validate required selects
    if (!transport_mode) { _showError("Please select a transport mode."); return null; }
    if (!diet_type)       { _showError("Please select your diet type."); return null; }
    if (!shopping_level)  { _showError("Please select your shopping intensity."); return null; }

    // Validate numeric ranges
    if (transport_km < 0)    { _showError("Distance cannot be negative."); return null; }
    if (electricity_kwh < 0) { _showError("Electricity cannot be negative."); return null; }
    if (gas_m3 < 0)          { _showError("Gas cannot be negative."); return null; }

    return {
      transport_mode,
      transport_km,
      diet_type,
      food_days,
      electricity_kwh,
      gas_m3,
      shopping_level,
      shopping_weeks,
    };
  }

  /**
   * If optional From/To location fields are filled, geocode them and attach
   * lat/lng to the payload so the trip appears on the Eco Map. Never blocks
   * the calculation — a geocoding failure just shows a warning toast.
   *
   * @param {Object} payload - Mutated in place with from_lat/from_lng/to_lat/to_lng.
   */
  async function _attachRouteCoords(payload) {
    const from = document.getElementById("calc-route-from")?.value.trim();
    const to   = document.getElementById("calc-route-to")?.value.trim();
    if (!from || !to) return;

    try {
      const [fromLL, toLL] = await Promise.all([
        window.EcoMap?.geocode(from),
        window.EcoMap?.geocode(to),
      ]);

      if (!fromLL || !toLL) {
        window.EcoApp?.showToast("⚠️ Could not find one or both locations — saved without map data.", "info");
        return;
      }

      payload.from_lat = fromLL[0];
      payload.from_lng = fromLL[1];
      payload.to_lat   = toLL[0];
      payload.to_lng   = toLL[1];
    } catch (err) {
      console.warn(TAG, "Geocoding error:", err);
      window.EcoApp?.showToast("⚠️ Could not locate trip — saved without map data.", "info");
    }
  }

  /**
   * Render the result card with breakdown and score.
   *
   * @param {Object} data - API response
   */
  function _renderResult(data) {
    const card = document.getElementById("calc-result");
    if (!card) return;

    document.getElementById("result-total").textContent        = data.total;
    document.getElementById("result-score-label").textContent  = data.score_label;

    // Breakdown pills
    const breakdown = document.getElementById("result-breakdown");
    const categories = [
      { key: "transport", icon: "🚗" },
      { key: "food",      icon: "🥗" },
      { key: "energy",    icon: "⚡" },
      { key: "shopping",  icon: "🛍️" },
    ];
    breakdown.innerHTML = categories.map(({ key, icon }) => `
      <div class="breakdown-item" role="listitem" aria-label="${key}: ${data[key]} kg CO₂e">
        <div class="breakdown-val">${data[key]}</div>
        <div class="breakdown-key">${icon} ${key}</div>
      </div>
    `).join("");

    card.classList.remove("hidden");
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** Show an error message below the form. */
  function _showError(msg) {
    const el = document.getElementById("calc-error");
    if (el) { el.textContent = "⚠️ " + msg; }
  }

  /** Clear any displayed error. */
  function _clearError() {
    const el = document.getElementById("calc-error");
    if (el) { el.textContent = ""; }
  }

  /**
   * Toggle button loading state.
   *
   * @param {HTMLElement} btn
   * @param {boolean} loading
   */
  function _setLoading(btn, loading) {
    if (!btn) return;
    btn.classList.toggle("loading", loading);
    btn.disabled = loading;
  }

  /**
   * Return the last calculated result (used by dashboard.js on navigation).
   *
   * @returns {Object|null}
   */
  function getLastResult() { return _lastResult; }

  // Expose to global scope
  window.EcoCalculator = { init, getLastResult };

})();
