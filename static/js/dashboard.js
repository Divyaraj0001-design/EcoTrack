/**
 * dashboard.js
 * ────────────
 * Orchestrates the dashboard view: loads history from Firestore,
 * draws charts, renders tips, and updates score cards.
 *
 * Exposes:
 *   window.EcoDashboard.refresh()  → Promise
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/dashboard]";

  /**
   * Refresh the dashboard for the currently signed-in user.
   * Pulls history from Firestore, updates score cards, redraws charts,
   * and renders personalised tips.
   *
   * @returns {Promise<void>}
   */
  async function refresh() {
    const user = window.EcoAuth?.currentUser();
    if (!user) {
      _showEmpty();
      return;
    }

    try {
      // Prefer freshly calculated result; fall back to Firestore history
      const lastCalc = window.EcoCalculator?.getLastResult();

      if (lastCalc) {
        _updateScoreCards(lastCalc);
        _renderTips(lastCalc.tips || []);
      }

      // Always try to load full history for the line chart
      const history = await window.EcoStore?.getHistory(user.uid, 30) || [];

      // Progress Tracker: this month's total CO2 vs the user's monthly goal
      const now = new Date();
      const monthlyTotal = history.reduce((sum, entry) => {
        const d = entry.timestamp ? new Date(entry.timestamp) : null;
        const inThisMonth = d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        return inThisMonth ? sum + (entry.total || 0) : sum;
      }, 0);
      const goalKg = await window.EcoStore?.getMonthlyGoal(user.uid) || 300;
      window.EcoDashboardUI?.updateDonut(monthlyTotal, goalKg);
      window.EcoDashboardUI?.initBarChart(_currentWeekTotals(history));
      _renderRecentActivity(history);
      _renderTodayChallenges();

      if (lastCalc) {
        await window.EcoCharts.init();
        window.EcoCharts.drawPieChart(lastCalc);
        window.EcoCharts.drawLineChart(history);
      } else if (history.length > 0) {
        const latest = history[0];
        _updateScoreCards(latest);
        _renderTips([]);   // fetch tips from API with latest breakdown
        _fetchAndRenderTips(latest);
        await window.EcoCharts.init();
        window.EcoCharts.drawPieChart(latest);
        window.EcoCharts.drawLineChart(history);
      } else {
        _showEmpty();
      }

      // Update greeting
      const hour = new Date().getHours();
      const greeting =
        hour < 12 ? "Good morning" :
        hour < 17 ? "Good afternoon" : "Good evening";
      const greetEl = document.getElementById("dashboard-greeting");
      if (greetEl) {
        greetEl.textContent = `${greeting}! Here's your carbon footprint overview.`;
      }

    } catch (err) {
      console.error(TAG, "refresh error:", err);
    }
  }

  /**
   * Update the four score cards with footprint breakdown values.
   *
   * @param {Object} data - Footprint breakdown from API or Firestore
   */
  function _updateScoreCards(data) {
    _setText("dash-total",     data.total     ?? "—");
    _setText("dash-transport", data.transport ?? "—");
    _setText("dash-food",      data.food      ?? "—");
    _setText("dash-energy",    data.energy    ?? "—");
    _setText("dash-score-label", data.score_label || "");
  }

  /**
   * Render the tips list from an array of tip objects.
   *
   * @param {Array<{category:string, tip:string}>} tips
   */
  function _renderTips(tips) {
    const list = document.getElementById("tips-list");
    if (!list) return;

    if (!tips || tips.length === 0) {
      list.innerHTML = `<p class="tips-empty">Calculate your footprint to get personalised tips.</p>`;
      return;
    }

    list.innerHTML = tips.map((item, i) => `
      <div class="tip-item" role="listitem" style="animation-delay:${i * 0.08}s"
           aria-label="Tip for ${item.category}: ${item.text}">
        <span class="tip-category">${item.category}</span>
        <span class="tip-text">${_escape(item.text)}</span>
      </div>
    `).join("");
  }

  /**
   * Fetch tips from the API using a breakdown object and render them.
   *
   * @param {Object} breakdown
   */
  async function _fetchAndRenderTips(breakdown) {
    try {
      const params = new URLSearchParams({
        transport: breakdown.transport || 0,
        food:      breakdown.food      || 0,
        energy:    breakdown.energy    || 0,
        shopping:  breakdown.shopping  || 0,
        max:       5,
      });
      const resp = await fetch(`/api/tips?${params}`);
      if (!resp.ok) return;
      const data = await resp.json();
      _renderTips(data.tips || []);
    } catch (err) {
      console.warn(TAG, "Could not fetch tips:", err);
    }
  }

  /** Show empty state when no data is available. */
  function _showEmpty() {
    _setText("dash-total",     "—");
    _setText("dash-transport", "—");
    _setText("dash-food",      "—");
    _setText("dash-energy",    "—");
    _setText("dash-score-label", "No data yet");
    window.EcoCharts?.clear();
    window.EcoDashboardUI?.updateDonut(0, 300);
    window.EcoDashboardUI?.initBarChart();
    _renderTips([]);
    _renderRecentActivity([]);
    _renderTodayChallenges();
  }

  /**
   * Sum each history entry's total into a Monday-first 7-element array
   * for the current calendar week, for the Emission Analytics bar chart.
   *
   * @param {Array<Object>} history
   * @returns {number[]} 7 values (Mon..Sun), kg CO2e per day.
   */
  function _currentWeekTotals(history) {
    const now = new Date();
    const todayIdx = (now.getDay() + 6) % 7; // Mon=0 .. Sun=6
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - todayIdx);

    const totals = [0, 0, 0, 0, 0, 0, 0];
    (history || []).forEach((entry) => {
      if (!entry.timestamp) return;
      const d = new Date(entry.timestamp);
      const diffDays = Math.floor((d - monday) / (24 * 60 * 60 * 1000));
      if (diffDays >= 0 && diffDays < 7) totals[diffDays] += entry.total || 0;
    });
    return totals;
  }

  /** Fetch today's real daily/weekly challenges and fill the dashboard card. */
  async function _renderTodayChallenges() {
    try {
      const resp = await fetch("/api/challenges");
      if (!resp.ok) return;
      const data = await resp.json();
      _fillChallengeRow("daily", data.daily);
      _fillChallengeRow("weekly", data.weekly);
    } catch (err) {
      console.warn(TAG, "Could not load challenges:", err);
    }
  }

  function _fillChallengeRow(type, challenge) {
    if (!challenge) return;
    _setText(`dash-${type}-icon`,   challenge.icon || "🌱");
    _setText(`dash-${type}-points`, `+${challenge.points || 0}`);
    _setText(`dash-${type}-title`,  challenge.title || "");
    _setText(`dash-${type}-desc`,   challenge.description || "");
  }

  // ── Recent Activity card (real Firestore history) ─────────────────────────

  const _ACTIVITY_ICONS = {
    transport: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    food:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
    energy:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    shopping:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  };

  /**
   * Identify the dominant emission category for a history entry and a
   * human-readable label for it, e.g. "Car trip" or "Vegan diet".
   *
   * @param {Object} entry - History entry with transport/food/energy/shopping/inputs.
   * @returns {{category: string, label: string}}
   */
  function _classifyActivity(entry) {
    const totals = {
      transport: entry.transport || 0,
      food:      entry.food      || 0,
      energy:    entry.energy    || 0,
      shopping:  entry.shopping  || 0,
    };
    const category = Object.keys(totals).reduce((a, b) => (totals[b] > totals[a] ? b : a));
    const inputs = entry.inputs || {};
    const labels = {
      transport: inputs.transport_mode ? `${_capitalize(inputs.transport_mode)} trip` : "Transport",
      food:      inputs.diet_type ? `${_capitalize(inputs.diet_type)} diet` : "Food",
      energy:    "Home energy",
      shopping:  inputs.shopping_level ? `${_capitalize(inputs.shopping_level)} shopping` : "Shopping",
    };
    return { category, label: labels[category] };
  }

  function _capitalize(s) {
    return String(s).charAt(0).toUpperCase() + String(s).slice(1);
  }

  /** Format a timestamp as "Today" / "Yesterday" / "Jun 16". */
  function _formatActivityDate(isoString) {
    const d = new Date(isoString);
    if (isNaN(d)) return "";
    const now = new Date();
    const oneDay = 24 * 60 * 60 * 1000;
    const dayDiff = Math.floor((_stripTime(now) - _stripTime(d)) / oneDay);
    if (dayDiff === 0) return "Today";
    if (dayDiff === 1) return "Yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function _stripTime(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /**
   * Render the Recent Activity card from real Firestore history entries.
   *
   * @param {Array<Object>} history - From window.EcoStore.getHistory().
   */
  function _renderRecentActivity(history) {
    const list = document.getElementById("recent-activity-list");
    if (!list) return;

    if (!history || history.length === 0) {
      list.innerHTML = `<p class="tips-empty">Calculate your footprint to see recent activity.</p>`;
      return;
    }

    list.innerHTML = history.slice(0, 5).map((entry) => {
      const { category, label } = _classifyActivity(entry);
      const date = _formatActivityDate(entry.timestamp);
      const total = (entry.total || 0).toFixed(1);
      return `
        <div class="activity-item" role="listitem">
          <div class="activity-cat-icon cat-${category}" aria-hidden="true">${_ACTIVITY_ICONS[category]}</div>
          <div class="activity-info">
            <div class="activity-name">${_escape(label)}</div>
            <div class="activity-date">${_escape(date)}</div>
          </div>
          <div class="activity-val">+${total} kg</div>
        </div>
      `;
    }).join("");
  }

  /** Helper: set textContent safely. */
  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /** HTML-escape a string for safe innerHTML insertion. */
  function _escape(str) {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  }

  // Expose to global scope
  window.EcoDashboard = { refresh };

})();
