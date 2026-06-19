/**
 * charts.js
 * ─────────
 * Google Charts wrapper for the EcoTrack dashboard.
 *
 * Exposes:
 *   window.EcoCharts.init()                   → Promise (loads Google Charts)
 *   window.EcoCharts.drawPieChart(breakdown)  → void
 *   window.EcoCharts.drawLineChart(history)   → void
 *   window.EcoCharts.clear()                  → void
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/charts]";

  /** @type {boolean} */
  let _ready = false;

  /**
   * Load the Google Charts library.  Safe to call multiple times.
   *
   * @returns {Promise<void>}
   */
  function init() {
    return new Promise((resolve, reject) => {
      if (_ready) { resolve(); return; }
      if (typeof google === "undefined" || !google.charts) {
        console.warn(TAG, "Google Charts not loaded.");
        resolve();
        return;
      }
      google.charts.load("current", { packages: ["corechart"] });
      google.charts.setOnLoadCallback(() => {
        _ready = true;
        console.info(TAG, "Google Charts ready.");
        resolve();
      });
    });
  }

  /**
   * Draw a dark-themed pie chart showing footprint by category.
   *
   * @param {{transport:number, food:number, energy:number, shopping:number}} breakdown
   */
  function drawPieChart(breakdown) {
    if (!_ready) { console.warn(TAG, "Charts not ready."); return; }
    const el = document.getElementById("pie-chart");
    if (!el) return;

    const data = google.visualization.arrayToDataTable([
      ["Category", "kg CO₂e"],
      ["Transport 🚗", breakdown.transport || 0],
      ["Food 🥗",      breakdown.food      || 0],
      ["Energy ⚡",    breakdown.energy    || 0],
      ["Shopping 🛍️", breakdown.shopping  || 0],
    ]);

    const options = {
      backgroundColor:    "transparent",
      pieHole:            0.45,
      chartArea:          { width: "90%", height: "85%" },
      legend: {
        position:   "bottom",
        textStyle:  { color: "#86efac", fontSize: 13 },
        alignment:  "center",
      },
      pieSliceTextStyle: { color: "#000", fontName: "Inter", bold: true },
      slices: {
        0: { color: "#34d399" },
        1: { color: "#10b981" },
        2: { color: "#fbbf24" },
        3: { color: "#60a5fa" },
      },
      tooltip: {
        textStyle: { color: "#f0fdf4" },
        showColorCode: true,
      },
    };

    const chart = new google.visualization.PieChart(el);
    chart.draw(data, options);

    document.getElementById("pie-empty")?.classList.add("hidden");
  }

  /**
   * Draw a dark-themed line chart showing total CO₂ history.
   *
   * @param {Array<{timestamp:string, total:number}>} history - Oldest first
   */
  function drawLineChart(history) {
    if (!_ready) return;
    if (!history || history.length < 2) {
      document.getElementById("line-empty")?.classList.remove("hidden");
      return;
    }
    document.getElementById("line-empty")?.classList.add("hidden");

    const el = document.getElementById("line-chart");
    if (!el) return;

    // Reverse so history is chronological (oldest → newest)
    const sorted = [...history].reverse();

    const rows = sorted.map((entry) => {
      const date = entry.timestamp
        ? new Date(entry.timestamp).toLocaleDateString("en-GB", { month: "short", day: "numeric" })
        : "Entry";
      return [date, entry.total || 0];
    });

    const data = google.visualization.arrayToDataTable([
      ["Date", "Total kg CO₂e"],
      ...rows,
    ]);

    const options = {
      backgroundColor:  "transparent",
      chartArea:        { width: "85%", height: "75%" },
      lineWidth:        3,
      pointSize:        6,
      pointShape:       "circle",
      colors:           ["#34d399"],
      curveType:        "function",
      legend:           { position: "none" },
      hAxis: {
        textStyle:       { color: "#86efac", fontSize: 11 },
        gridlines:       { color: "transparent" },
        baselineColor:   "#1f2e27",
      },
      vAxis: {
        textStyle:       { color: "#86efac", fontSize: 11 },
        gridlines:       { color: "#1f2e27" },
        baselineColor:   "#1f2e27",
        minValue:        0,
      },
      tooltip: {
        textStyle: { color: "#f0fdf4" },
        showColorCode: true,
      },
    };

    const chart = new google.visualization.LineChart(el);
    chart.draw(data, options);
  }

  /**
   * Clear both charts (e.g. on sign-out).
   */
  function clear() {
    const pie  = document.getElementById("pie-chart");
    const line = document.getElementById("line-chart");
    if (pie)  pie.innerHTML  = "";
    if (line) line.innerHTML = "";
    document.getElementById("pie-empty")?.classList.remove("hidden");
    document.getElementById("line-empty")?.classList.remove("hidden");
  }

  // Expose to global scope
  window.EcoCharts = { init, drawPieChart, drawLineChart, clear };

})();
