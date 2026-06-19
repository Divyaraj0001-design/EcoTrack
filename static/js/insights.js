/**
 * insights.js
 * ──────────
 * Powers the Insights tab: Impact Visualizer, Smart Analytics,
 * Carbon Action Planner, and Achievements.
 *
 * Exposes: window.EcoInsights.init(), window.EcoInsights.refresh(),
 *          window.EcoInsights.update(breakdown, dietType),
 *          window.EcoInsights.recordChallengeComplete()
 */

/* ── Constants ──────────────────────────────────────────────────────────── */

// UK average weekly footprints (kg CO₂e) — DEFRA 2023
const UK_AVERAGES = {
  transport: 52.0,
  food:      53.2,
  energy:    28.5,
  shopping:  18.0,
  total:     151.7,
};

// CO₂ equivalence factors
const EQUIV = {
  treeDaysPerKg:   0.06,   // 1 tree absorbs ~17 kg/year → ~0.06 kg/day
  flightMinPerKg:  2.35,   // short-haul ~0.255 kg/km, ~850 km/h → ~0.43 kg/min
  carKmPerKg:      4.76,   // 0.21 kg/km  → 1 kg = 4.76 km
  electricityHrPerKg: 4.29, // 0.233 kg/kWh → 1 kg ≈ 4.29 kWh of use
  beefGramsPerKg:  37.0,   // beef ~27 kg CO₂/kg → 1 CO₂ kg ≈ 37 g beef
};

// Emission factors for the action planner (per week)
const FACTORS = {
  transport: { car: 0.21, flight: 0.255, bus: 0.089 },
  diet:      { meat: 50.4, vegetarian: 26.6, vegan: 20.3 },
  shopping:  { high: 15,  medium: 8,  low: 3 },
};

// Badges definition
const BADGE_DEFS = [
  { id: 'first_calc',    icon: '🌱', name: 'First Step',       desc: 'Logged your first footprint',        condition: s => s.totalCalcs >= 1 },
  { id: 'eco_warrior',   icon: '⚡', name: 'Eco Warrior',      desc: 'Total footprint under 50 kg',        condition: s => s.latestTotal > 0 && s.latestTotal < 50 },
  { id: 'below_avg',     icon: '🏆', name: 'Below Average',    desc: 'Better than UK average overall',     condition: s => s.latestTotal > 0 && s.latestTotal < UK_AVERAGES.total },
  { id: 'planner_used',  icon: '🎯', name: 'Action Taker',     desc: 'Used the Carbon Action Planner',     condition: s => s.plannerUsed },
  { id: 'challenge_done',icon: '🔥', name: 'Challenger',       desc: 'Completed at least one challenge',   condition: s => s.challengesDone >= 1 },
  { id: 'multi_calc',    icon: '📊', name: 'Data Nerd',        desc: 'Logged 5 or more footprints',        condition: s => s.totalCalcs >= 5 },
  { id: 'vegan_week',    icon: '🌿', name: 'Plant Power',      desc: 'Calculated a vegan diet footprint',  condition: s => s.usedVegan },
  { id: 'low_energy',    icon: '💡', name: 'Energy Saver',     desc: 'Energy footprint under 10 kg',       condition: s => s.latestEnergy > 0 && s.latestEnergy < 10 },
];

/* ── State ──────────────────────────────────────────────────────────────── */
let _insightsState = {
  totalCalcs: 0,
  latestTotal: 0,
  latestEnergy: 0,
  plannerUsed: false,
  challengesDone: 0,
  usedVegan: false,
  history: [],
};

/* ── Public API ─────────────────────────────────────────────────────────── */

/**
 * Initialise the Insights tab. Called once on app boot from app.js.
 */
function initInsights() {
  _buildActionPlanner();
  _renderBadges();
}

/**
 * Update Insights with the latest calculation result.
 * Called from calculator.js after a successful calculation.
 *
 * @param {Object} breakdown - { transport, food, energy, shopping, total }
 * @param {string} dietType  - 'meat' | 'vegetarian' | 'vegan'
 */
function updateInsights(breakdown, dietType) {
  _insightsState.totalCalcs++;
  _insightsState.latestTotal   = breakdown.total   || 0;
  _insightsState.latestEnergy  = breakdown.energy  || 0;
  if (dietType === 'vegan') _insightsState.usedVegan = true;

  _renderEquivalents(breakdown.total || 0);
  _renderAnalytics(breakdown);
  _renderBadges();
  _animateNumbers();
}

/**
 * Load history entries into the insights analytics.
 * Called from firestore.js after history is fetched.
 *
 * @param {Array} history - array of footprint documents
 */
function loadInsightsHistory(history) {
  _insightsState.history = history || [];
  if (history.length > 0) {
    _renderHistoryChart(history);
  }
}

/** Increment challenge count (called from challenges.js on completion). */
function recordChallengeComplete() {
  _insightsState.challengesDone++;
  _renderBadges();
}

/* ── Impact Equivalents ──────────────────────────────────────────────────── */

function _renderEquivalents(totalKg) {
  const el = document.getElementById('equiv-container');
  if (!el) return;

  if (totalKg <= 0) {
    el.innerHTML = '<p class="insights-empty">Calculate your footprint to see real-world equivalents.</p>';
    return;
  }

  const trees    = Math.round(totalKg / (EQUIV.treeDaysPerKg * 365) * 10) / 10;
  const flights  = Math.round(totalKg * EQUIV.flightMinPerKg);
  const carKm    = Math.round(totalKg * EQUIV.carKmPerKg);
  const elecKwh  = Math.round(totalKg * EQUIV.electricityHrPerKg);
  const beefG    = Math.round(totalKg * EQUIV.beefGramsPerKg);

  const equivs = [
    { icon: '🌳', value: trees,   unit: 'trees',   label: 'needed for 1 year to absorb this' },
    { icon: '✈️', value: flights, unit: 'minutes',  label: 'of short-haul flight' },
    { icon: '🚗', value: carKm,   unit: 'km',       label: 'driven by an average car' },
    { icon: '💡', value: elecKwh, unit: 'kWh',      label: 'of household electricity' },
    { icon: '🥩', value: beefG,   unit: 'g',        label: 'of beef produced' },
  ];

  el.innerHTML = equivs.map(e => `
    <div class="equiv-card glass-card">
      <div class="equiv-icon">${e.icon}</div>
      <div class="equiv-value" data-target="${e.value}">0</div>
      <div class="equiv-unit">${e.unit}</div>
      <div class="equiv-label">${e.label}</div>
    </div>
  `).join('');
}

/* ── Smart Analytics ─────────────────────────────────────────────────────── */

function _renderAnalytics(breakdown) {
  const el = document.getElementById('analytics-container');
  if (!el) return;

  const categories = [
    { key: 'transport', icon: '🚗', label: 'Transport', avg: UK_AVERAGES.transport },
    { key: 'food',      icon: '🥗', label: 'Food',      avg: UK_AVERAGES.food },
    { key: 'energy',    icon: '⚡', label: 'Energy',    avg: UK_AVERAGES.energy },
    { key: 'shopping',  icon: '🛍️', label: 'Shopping',  avg: UK_AVERAGES.shopping },
  ];

  el.innerHTML = `
    <div class="analytics-header">
      <span class="analytics-you">You</span>
      <span class="analytics-avg">UK Average</span>
    </div>
    ${categories.map(cat => {
      const you = breakdown[cat.key] || 0;
      const avg = cat.avg;
      const pct = Math.min((you / (avg * 2)) * 100, 100);
      const avgPct = Math.min((avg / (avg * 2)) * 100, 100);
      const better = you <= avg;
      const diff = Math.abs(you - avg).toFixed(1);
      const badge = better
        ? `<span class="cat-badge badge-good">▼ ${diff} kg better</span>`
        : `<span class="cat-badge badge-bad">▲ ${diff} kg over</span>`;
      return `
        <div class="analytics-row">
          <div class="analytics-label">${cat.icon} ${cat.label}</div>
          <div class="analytics-bars">
            <div class="bar-track">
              <div class="bar-fill bar-you ${better ? 'bar-good' : 'bar-bad'}" style="width:${pct}%">
                <span>${you.toFixed(1)}</span>
              </div>
            </div>
            <div class="bar-track bar-track-avg">
              <div class="bar-fill bar-avg" style="width:${avgPct}%">
                <span>${avg}</span>
              </div>
            </div>
          </div>
          ${badge}
        </div>
      `;
    }).join('')}
    <div class="analytics-total ${(breakdown.total || 0) < UK_AVERAGES.total ? 'total-good' : 'total-bad'}">
      Your total: <strong>${(breakdown.total || 0).toFixed(1)} kg</strong> 
      vs UK avg <strong>${UK_AVERAGES.total} kg</strong>
      ${(breakdown.total || 0) < UK_AVERAGES.total ? '✅ Below average!' : '⚠️ Above average'}
    </div>
  `;
}

function _renderHistoryChart(history) {
  const el = document.getElementById('history-sparkline');
  if (!el || history.length < 2) return;

  const sorted = [...history].reverse().slice(0, 8);
  const max = Math.max(...sorted.map(h => h.total || 0));
  const points = sorted.map((h, i) => {
    const x = (i / (sorted.length - 1)) * 280 + 10;
    const y = 80 - ((h.total || 0) / max) * 70;
    return `${x},${y}`;
  }).join(' ');

  el.innerHTML = `
    <div class="sparkline-label">Your last ${sorted.length} entries</div>
    <svg viewBox="0 0 300 90" class="sparkline-svg">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4ade80" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="#4ade80" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polyline points="${points}" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${sorted.map((h, i) => {
        const x = (i / (sorted.length - 1)) * 280 + 10;
        const y = 80 - ((h.total || 0) / max) * 70;
        return `<circle cx="${x}" cy="${y}" r="3.5" fill="#4ade80"/>`;
      }).join('')}
    </svg>
    <div class="sparkline-range">
      <span>Min: ${Math.min(...sorted.map(h => h.total || 0)).toFixed(1)} kg</span>
      <span>Max: ${max.toFixed(1)} kg</span>
    </div>
  `;
}

/* ── Carbon Action Planner ───────────────────────────────────────────────── */

function _buildActionPlanner() {
  const el = document.getElementById('planner-container');
  if (!el) return;

  el.innerHTML = `
    <p class="planner-intro">Slide the options below and see your projected weekly CO₂ savings in real time.</p>

    <div class="planner-row">
      <label class="planner-label">🚗 Transport Mode</label>
      <div class="planner-options" id="plan-transport">
        <button class="plan-opt active" data-val="car">Car</button>
        <button class="plan-opt" data-val="bus">Bus</button>
        <button class="plan-opt" data-val="none">Walk/Bike</button>
      </div>
    </div>

    <div class="planner-row">
      <label class="planner-label">📏 Weekly km</label>
      <div class="slider-wrap">
        <input type="range" id="plan-km" min="0" max="500" value="150" step="10" class="eco-slider"/>
        <span class="slider-val" id="plan-km-val">150 km</span>
      </div>
    </div>

    <div class="planner-row">
      <label class="planner-label">🥗 Diet</label>
      <div class="planner-options" id="plan-diet">
        <button class="plan-opt active" data-val="meat">Meat</button>
        <button class="plan-opt" data-val="vegetarian">Vegetarian</button>
        <button class="plan-opt" data-val="vegan">Vegan</button>
      </div>
    </div>

    <div class="planner-row">
      <label class="planner-label">🛍️ Shopping</label>
      <div class="planner-options" id="plan-shopping">
        <button class="plan-opt active" data-val="high">High</button>
        <button class="plan-opt" data-val="medium">Medium</button>
        <button class="plan-opt" data-val="low">Low</button>
      </div>
    </div>

    <div class="planner-result glass-card" id="planner-result">
      <div class="planner-score" id="planner-score">—</div>
      <div class="planner-score-label" id="planner-score-label">kg CO₂ / week</div>
      <div class="planner-saving" id="planner-saving"></div>
    </div>
  `;

  _bindPlannerEvents();
  _calcPlanner();
}

let _plannerState = { transport: 'car', km: 150, diet: 'meat', shopping: 'high' };

function _bindPlannerEvents() {
  // Transport buttons
  document.getElementById('plan-transport')?.querySelectorAll('.plan-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('plan-transport').querySelectorAll('.plan-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _plannerState.transport = btn.dataset.val;
      _insightsState.plannerUsed = true;
      _calcPlanner();
      _renderBadges();
    });
  });

  // KM slider
  const kmSlider = document.getElementById('plan-km');
  kmSlider?.addEventListener('input', () => {
    _plannerState.km = parseInt(kmSlider.value);
    document.getElementById('plan-km-val').textContent = `${_plannerState.km} km`;
    _insightsState.plannerUsed = true;
    _calcPlanner();
  });

  // Diet buttons
  document.getElementById('plan-diet')?.querySelectorAll('.plan-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('plan-diet').querySelectorAll('.plan-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _plannerState.diet = btn.dataset.val;
      _insightsState.plannerUsed = true;
      _calcPlanner();
    });
  });

  // Shopping buttons
  document.getElementById('plan-shopping')?.querySelectorAll('.plan-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('plan-shopping').querySelectorAll('.plan-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _plannerState.shopping = btn.dataset.val;
      _insightsState.plannerUsed = true;
      _calcPlanner();
    });
  });
}

function _calcPlanner() {
  const { transport, km, diet, shopping } = _plannerState;
  const factor = transport === 'none' ? 0 : (FACTORS.transport[transport] || 0.21);
  const transportCO2  = factor * km;
  const foodCO2       = FACTORS.diet[diet] || 50.4;
  const shoppingCO2   = FACTORS.shopping[shopping] || 15;
  const energyCO2     = 20; // fixed baseline

  const total = transportCO2 + foodCO2 + shoppingCO2 + energyCO2;
  const saving = UK_AVERAGES.total - total;

  const scoreEl  = document.getElementById('planner-score');
  const savingEl = document.getElementById('planner-saving');
  const labelEl  = document.getElementById('planner-score-label');

  if (scoreEl) scoreEl.textContent = total.toFixed(1);

  if (savingEl) {
    if (saving > 0) {
      savingEl.innerHTML = `<span class="saving-good">▼ ${saving.toFixed(1)} kg below UK average — great choice!</span>`;
    } else {
      savingEl.innerHTML = `<span class="saving-bad">▲ ${Math.abs(saving).toFixed(1)} kg above UK average</span>`;
    }
  }

  // Color the score
  if (scoreEl) {
    scoreEl.className = 'planner-score ' + (total < 80 ? 'score-great' : total < 130 ? 'score-ok' : 'score-bad');
  }
}

/* ── Badges ──────────────────────────────────────────────────────────────── */

function _renderBadges() {
  const el = document.getElementById('badges-container');
  if (!el) return;

  el.innerHTML = BADGE_DEFS.map(b => {
    const unlocked = b.condition(_insightsState);
    return `
      <div class="badge-card ${unlocked ? 'badge-unlocked' : 'badge-locked'}" title="${b.desc}">
        <div class="badge-icon">${unlocked ? b.icon : '🔒'}</div>
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>
        ${unlocked ? '<div class="badge-glow"></div>' : ''}
      </div>
    `;
  }).join('');
}

/* ── Animated number counter ─────────────────────────────────────────────── */

function _animateNumbers() {
  document.querySelectorAll('[data-target]').forEach(el => {
    const target = parseFloat(el.dataset.target) || 0;
    const duration = 1200;
    const start = performance.now();
    const isFloat = target % 1 !== 0;
    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = isFloat
        ? (target * eased).toFixed(1)
        : Math.round(target * eased);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}

/* ── Expose public API ───────────────────────────────────────────────────── */

let _lastBreakdown = null;
let _lastDietType  = null;

window.EcoInsights = {
  /** Called once on app boot. */
  init() {
    initInsights();
  },
  /** Called whenever the Insights tab is navigated to. */
  refresh() {
    if (_lastBreakdown) {
      _renderEquivalents(_lastBreakdown.total || 0);
      _renderAnalytics(_lastBreakdown);
      _animateNumbers();
    }
    _renderBadges();
    if (_insightsState.history.length > 0) {
      _renderHistoryChart(_insightsState.history);
    }
  },
  /** Called from calculator.js after a successful footprint calculation. */
  update(breakdown, dietType) {
    _lastBreakdown = breakdown;
    _lastDietType  = dietType;
    updateInsights(breakdown, dietType);
  },
  /** Called from firestore.js when history is loaded. */
  loadHistory(history) {
    loadInsightsHistory(history);
  },
  /** Called from challenges.js on challenge completion. */
  recordChallengeComplete() {
    recordChallengeComplete();
  },
};
