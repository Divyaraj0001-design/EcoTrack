/**
 * challenges.js
 * ─────────────
 * Fetches and renders the daily/weekly challenges from the API.
 *
 * Exposes:
 *   window.EcoChallenges.init()    → void
 *   window.EcoChallenges.refresh() → Promise
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/challenges]";

  /** @type {Object|null} */
  let _data = null;

  /** @type {"daily"|"weekly"} */
  let _activeTab = "daily";

  /**
   * Initialise challenges view — fetch data and wire up UI.
   */
  async function init() {
    await refresh();
    _initTabs();
    _initCompleteButtons();
    console.info(TAG, "Challenges initialised.");
  }

  /**
   * Fetch challenges from the API and render them.
   *
   * @returns {Promise<void>}
   */
  async function refresh() {
    try {
      const resp = await fetch("/api/challenges");
      if (!resp.ok) throw new Error("API error: " + resp.status);
      _data = await resp.json();
      _renderFeatured();
      _renderList(_activeTab);
    } catch (err) {
      console.error(TAG, "Failed to load challenges:", err);
    }
  }

  /**
   * Render today's daily challenge and this week's weekly challenge cards.
   */
  function _renderFeatured() {
    if (!_data) return;

    _fillCard("daily", _data.daily);
    _fillCard("weekly", _data.weekly);
  }

  /**
   * Fill a featured challenge card with data.
   *
   * @param {"daily"|"weekly"} type
   * @param {Object} challenge
   */
  function _fillCard(type, challenge) {
    if (!challenge) return;
    const icon  = document.getElementById(`${type}-icon`);
    const title = document.getElementById(`${type}-title`);
    const desc  = document.getElementById(`${type}-desc`);
    const pts   = document.getElementById(`${type}-points`);

    if (icon)  icon.textContent  = challenge.icon  || "🌱";
    if (title) title.textContent = challenge.title || "";
    if (desc)  desc.textContent  = challenge.description || "";
    if (pts)   pts.textContent   = `+${challenge.points || 0} pts`;
  }

  /**
   * Render the full list of challenges for the active tab.
   *
   * @param {"daily"|"weekly"} type
   */
  function _renderList(type) {
    if (!_data) return;
    const list = document.getElementById("challenges-list");
    if (!list) return;

    const items = type === "daily" ? _data.all_daily : _data.all_weekly;
    if (!items || items.length === 0) {
      list.innerHTML = "<p class='text-muted text-center'>No challenges available.</p>";
      return;
    }

    list.innerHTML = items.map((c, i) => `
      <article class="challenge-list-item" role="listitem" style="animation-delay:${i * 0.05}s"
               aria-label="${c.title}">
        <div class="cli-header">
          <span class="cli-icon" aria-hidden="true">${c.icon}</span>
          <span class="cli-title">${_escape(c.title)}</span>
        </div>
        <p class="cli-desc">${_escape(c.description)}</p>
        <div class="cli-footer">
          <span class="cli-points" aria-label="${c.points} points">+${c.points} pts</span>
          <span class="cli-cat" aria-label="Category: ${c.category}">${c.category}</span>
        </div>
      </article>
    `).join("");
  }

  /** Wire tab buttons to switch between daily and weekly lists. */
  function _initTabs() {
    const tabs = document.querySelectorAll(".challenge-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
        tab.classList.add("active");
        tab.setAttribute("aria-selected", "true");
        _activeTab = tab.dataset.type;
        _renderList(_activeTab);
      });
    });
  }

  /** Wire "Mark Complete" buttons with a toast feedback. */
  function _initCompleteButtons() {
    document.getElementById("btn-daily-complete")?.addEventListener("click", () => {
      window.EcoApp?.showToast("🌿 Daily challenge marked complete! +pts", "success");
    });
    document.getElementById("btn-weekly-complete")?.addEventListener("click", () => {
      window.EcoApp?.showToast("🏆 Weekly challenge accepted! Good luck!", "info");
    });
  }

  /** HTML-escape a string to prevent XSS in innerHTML. */
  function _escape(str) {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  }

  // Expose to global scope
  window.EcoChallenges = { init, refresh };

})();
