/**
 * dashboard-ui.js
 * ───────────────
 * Handles all new UI components added in the Donezo redesign:
 *   • Sidebar toggle (mobile)
 *   • Emission Analytics bar chart (Chart.js)
 *   • Progress Tracker donut chart (Chart.js)
 *   • Carbon Timer widget
 *   • Topbar avatar initial from user email
 *   • Auth-state visibility of sidebar/main-wrapper
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/dashboard-ui]";

  // ── Chart.js instances (kept for cleanup / re-render) ─────────────────────
  let _barChart  = null;
  let _donutChart = null;

  // ── Timer state ───────────────────────────────────────────────────────────
  let _timerSeconds = 0;
  let _timerInterval = null;
  let _timerPaused = false;

  // ── Init on DOM ready ─────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    _initSidebarToggle();
    _initAuthVisibility();
    _initTimer();
    _initBarChart();
    _initDonutChart();
    _patchNavigate();
    console.info(TAG, "Dashboard UI initialised.");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SIDEBAR TOGGLE (mobile)
  // ═══════════════════════════════════════════════════════════════════════════

  function _initSidebarToggle() {
    const toggleBtn = document.getElementById("sidebar-toggle");
    const sidebar   = document.getElementById("sidebar");
    const overlay   = document.getElementById("sidebar-overlay");

    if (!toggleBtn || !sidebar) return;

    function openSidebar() {
      sidebar.classList.add("open");
      document.body.classList.add("sidebar-open");
      if (overlay) { overlay.style.opacity = "1"; overlay.style.pointerEvents = "auto"; }
      toggleBtn.setAttribute("aria-expanded", "true");
    }

    function closeSidebar() {
      sidebar.classList.remove("open");
      document.body.classList.remove("sidebar-open");
      if (overlay) { overlay.style.opacity = "0"; overlay.style.pointerEvents = "none"; }
      toggleBtn.setAttribute("aria-expanded", "false");
    }

    toggleBtn.addEventListener("click", () => {
      sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
    });

    if (overlay) overlay.addEventListener("click", closeSidebar);

    // Close on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && sidebar.classList.contains("open")) closeSidebar();
    });

    // Close on nav-btn click (mobile)
    sidebar.querySelectorAll(".nav-btn[data-route]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (window.innerWidth < 768) closeSidebar();
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTH VISIBILITY — show/hide sidebar + main-wrapper based on auth state
  // ═══════════════════════════════════════════════════════════════════════════

  function _initAuthVisibility() {
    const sidebar     = document.getElementById("sidebar");
    const mainWrapper = document.querySelector(".main-wrapper");
    const overlay     = document.getElementById("sidebar-overlay");

    // Watch for view-auth active/inactive changes via a MutationObserver
    const authView = document.getElementById("view-auth");
    if (!authView || !sidebar || !mainWrapper) return;

    function _syncVisibility() {
      const isAuth = !authView.classList.contains("hidden");
      sidebar.style.display     = isAuth ? "none" : "";
      mainWrapper.style.display = isAuth ? "none" : "";
      if (overlay) overlay.style.display = isAuth ? "none" : "";
    }

    // Initial sync
    _syncVisibility();

    // Watch class changes on #view-auth
    const mo = new MutationObserver(_syncVisibility);
    mo.observe(authView, { attributes: true, attributeFilter: ["class"] });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH NAVIGATE — update avatar initial + title when user logs in
  // ═══════════════════════════════════════════════════════════════════════════

  function _patchNavigate() {
    // Watch user-email span for content changes to update avatar initial
    const emailEl  = document.getElementById("user-email");
    const avatarEl = document.getElementById("topbar-avatar");
    if (!emailEl || !avatarEl) return;

    const mo = new MutationObserver(() => {
      const email = emailEl.textContent.trim();
      if (email) {
        avatarEl.textContent = email[0].toUpperCase();
      }
    });
    mo.observe(emailEl, { characterData: true, childList: true, subtree: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EMISSION ANALYTICS BAR CHART (Chart.js)
  // ═══════════════════════════════════════════════════════════════════════════

  const _WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  /** Diagonal stripe pattern used for days later this week (no data yet). */
  function _makeStripe(ctx, color) {
    const size = 8;
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const cx = c.getContext("2d");
    cx.strokeStyle = color;
    cx.lineWidth   = 1.5;
    cx.beginPath();
    cx.moveTo(0, size); cx.lineTo(size, 0);
    cx.stroke();
    return ctx.createPattern(c, "repeat");
  }

  /**
   * Build bar chart colors for a week of real values. Days after today
   * (Mon-start index) are hatched since they genuinely have no data yet —
   * not because they're "incomplete demo data".
   */
  function _buildBarChartColors(ctx, values) {
    const todayIdx = (new Date().getDay() + 6) % 7; // Mon=0 .. Sun=6
    const pastValues = values.filter((_, i) => i <= todayIdx);
    const maxVal = Math.max(...pastValues, 0);
    const maxIdx = values.indexOf(maxVal);

    const backgroundColor = values.map((_, i) => {
      const isFuture = i > todayIdx;
      if (isFuture) return _makeStripe(ctx, i === maxIdx ? "#1B4332" : "#74C69D");
      return i === maxIdx && maxVal > 0 ? "#1B4332" : "#B7E4C7";
    });
    const hoverBackgroundColor = values.map((_, i) =>
      i === maxIdx && i <= todayIdx && maxVal > 0 ? "#2D6A4F" : "#74C69D"
    );
    return { backgroundColor, hoverBackgroundColor };
  }

  /**
   * Render (or update) the weekly emissions bar chart with real per-day totals.
   *
   * @param {number[]} [weekTotals] - 7 values, Monday-first, kg CO2e per day.
   *   Defaults to an all-zero placeholder before real data has loaded.
   */
  function _initBarChart(weekTotals) {
    const canvas = document.getElementById("emission-bar-chart");
    if (!canvas || typeof Chart === "undefined") return;

    // Chart already has real data and no new data was passed (e.g. the
    // navigate-to-dashboard re-init) — just resize, don't reset to zeros.
    if (_barChart && !weekTotals) { _barChart.resize(); return; }

    const values = weekTotals || [0, 0, 0, 0, 0, 0, 0];
    const ctx = canvas.getContext("2d");
    const { backgroundColor, hoverBackgroundColor } = _buildBarChartColors(ctx, values);

    if (_barChart) {
      _barChart.data.datasets[0].data = values;
      _barChart.data.datasets[0].backgroundColor = backgroundColor;
      _barChart.data.datasets[0].hoverBackgroundColor = hoverBackgroundColor;
      _barChart.update();
      return;
    }

    _barChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: _WEEK_DAYS,
        datasets: [{
          label: "kg CO₂e",
          data: values,
          backgroundColor,
          hoverBackgroundColor,
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1B4332",
            titleColor: "#B7E4C7",
            bodyColor: "#fff",
            padding: 10,
            borderRadius: 8,
            callbacks: {
              label: (ctx) => ` ${ctx.parsed.y} kg CO₂e`,
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: "#6B7280", font: { family: "Inter", size: 12 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: "#F3F4F6", drawTicks: false },
            border: { display: false, dash: [4, 4] },
            ticks: {
              color: "#6B7280",
              font: { family: "Inter", size: 11 },
              callback: (v) => v + " kg",
              maxTicksLimit: 5
            }
          }
        },
        animation: {
          duration: 800,
          easing: "easeOutQuart",
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROGRESS TRACKER DONUT CHART (Chart.js)
  // ═══════════════════════════════════════════════════════════════════════════

  function _initDonutChart() {
    const canvas = document.getElementById("progress-donut-chart");
    if (!canvas || typeof Chart === "undefined") return;

    // Already created — keep whatever real data updateDonut() last set,
    // just make sure it's sized correctly (avoids a re-init race wiping
    // real numbers back to the [0,0] placeholder on every dashboard visit).
    if (_donutChart) { _donutChart.resize(); return; }

    const ctx = canvas.getContext("2d");

    _donutChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Used", "Remaining"],
        datasets: [{
          data: [0, 0],
          backgroundColor: ["#1B4332", "#B7E4C7"],
          hoverBackgroundColor: ["#2D6A4F", "#74C69D"],
          borderWidth: 0,
          borderRadius: 4,
          spacing: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "72%",
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1B4332",
            bodyColor: "#fff",
            padding: 10,
            borderRadius: 8,
            callbacks: {
              label: (ctx) => ` ${ctx.parsed} kg CO₂`,
            }
          }
        },
        animation: {
          animateRotate: true,
          duration: 1000,
          easing: "easeOutQuart",
        }
      }
    });
  }

  // ── Update donut: this month's usage vs the monthly carbon goal ───────────
  function updateDonut(usedKg, goalKg) {
    const goal      = Math.max(goalKg, 1);
    const used      = Math.max(usedKg, 0);
    const remaining = Math.max(goal - used, 0);
    const pct       = Math.min(Math.round((used / goal) * 100), 100);
    const overBudget = used > goal;

    const pctEl = document.getElementById("donut-pct");
    if (pctEl) pctEl.textContent = pct + "%";

    _setText("donut-used-val",      used.toFixed(1)      + " kg");
    _setText("donut-remaining-val", remaining.toFixed(1) + " kg");
    _setText("donut-target-val",    goal.toFixed(1)       + " kg");

    if (_donutChart) {
      _donutChart.data.datasets[0].data = [Math.min(used, goal), remaining];
      _donutChart.data.datasets[0].backgroundColor[0] = overBudget ? "#ef4444" : "#1B4332";
      _donutChart.update("active");
    }
  }

  /** Helper: set textContent safely. */
  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CARBON TIMER
  // ═══════════════════════════════════════════════════════════════════════════

  function _initTimer() {
    const display   = document.getElementById("timer-display");
    const pauseBtn  = document.getElementById("timer-pause-btn");
    const stopBtn   = document.getElementById("timer-stop-btn");

    if (!display) return;

    // Start counting from 0
    _timerSeconds = 0;
    _timerPaused  = false;
    _startTimer(display);

    if (pauseBtn) {
      pauseBtn.addEventListener("click", () => {
        _timerPaused = !_timerPaused;
        // Swap pause ↔ play icon
        pauseBtn.innerHTML = _timerPaused
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
        pauseBtn.setAttribute("aria-label", _timerPaused ? "Resume timer" : "Pause timer");
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener("click", () => {
        _stopTimer();
        _timerSeconds = 0;
        if (display) display.textContent = "00:00:00";
        _timerPaused = false;
        // Restart after short delay
        setTimeout(() => _startTimer(display), 500);
        // Reset pause button
        if (pauseBtn) {
          pauseBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
          pauseBtn.setAttribute("aria-label", "Pause timer");
        }
      });
    }
  }

  function _startTimer(display) {
    _stopTimer();
    _timerInterval = setInterval(() => {
      if (!_timerPaused) {
        _timerSeconds++;
        if (display) display.textContent = _formatTime(_timerSeconds);
      }
    }, 1000);
  }

  function _stopTimer() {
    if (_timerInterval) {
      clearInterval(_timerInterval);
      _timerInterval = null;
    }
  }

  function _formatTime(totalSecs) {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RE-RENDER CHARTS when dashboard route is activated
  // ═══════════════════════════════════════════════════════════════════════════

  // Patch EcoApp.navigate to reinitialise charts when switching to dashboard
  const _origNavigate = window.EcoApp?.navigate;
  if (_origNavigate) {
    window.EcoApp.navigate = function (route) {
      _origNavigate(route);
      if (route === "dashboard") {
        // Small delay to let the view become visible first
        setTimeout(() => {
          _initBarChart();
          _initDonutChart();
        }, 80);
      }
    };
  }

  // ── Expose for external use ────────────────────────────────────────────────
  window.EcoDashboardUI = { updateDonut, initBarChart: _initBarChart, initDonutChart: _initDonutChart };

})();
