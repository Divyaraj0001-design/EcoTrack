/**
 * map.js
 * ──────
 * Leaflet.js + OpenStreetMap Eco Map:
 *  - Personal activity routes (polylines colored by emission level)
 *  - Heatmap layer (Leaflet.heat)
 *  - Green Spots finder (Overpass API)
 *  - Find Me button (geolocation → pulsing dot)
 *  - Route draw form with Nominatim geocoding
 *  - Map sidebar filter toggles
 *  - GPX export
 *
 * Uses: CDN Leaflet 1.9.4 + Leaflet.heat
 * Exposes: window.EcoMap
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/map]";

  let _map         = null;
  let _heatLayer   = null;
  let _routeLayers = L.layerGroup();
  let _spotsLayer  = L.layerGroup();
  let _youMarker   = null;
  let _userLat     = null;
  let _userLng     = null;
  let _routes      = []; // { from, to, co2, name, fromLatLng, toLatLng }
  let _loadedHistoryIds = new Set(); // Firestore history doc IDs already drawn

  // Layer visibility state
  const _visible = { routes: true, heatmap: false, spots: false };

  // ── Init ────────────────────────────────────────────────────────────────

  function init() {
    if (_map) { _map.invalidateSize(); _loadUserRoutes(); return; }

    const container = document.getElementById("eco-map");
    if (!container || typeof L === "undefined") {
      console.warn(TAG, "Leaflet not loaded or #eco-map missing");
      return;
    }

    _map = L.map("eco-map", {
      center: [51.505, -0.09],
      zoom: 5,
      zoomControl: true,
    });

    // OpenStreetMap tiles — free, no API key
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(_map);

    _routeLayers.addTo(_map);
    _spotsLayer.addTo(_map);

    _bindSidebarToggles();
    _bindFindMe();
    _bindRouteForm();
    _bindGPXExport();

    // Restore last location from localStorage
    const saved = _getSavedLocation();
    if (saved) {
      _map.setView([saved.lat, saved.lng], 12);
    }

    // Load user routes from Firestore
    _loadUserRoutes();

    console.info(TAG, "Eco Map initialised.");
  }

  // ── Sidebar filter toggles ───────────────────────────────────────────────

  function _bindSidebarToggles() {
    _bindToggle("toggle-routes", "routes", () => {
      if (_visible.routes) { _routeLayers.addTo(_map); }
      else { _map.removeLayer(_routeLayers); }
    });

    _bindToggle("toggle-heatmap", "heatmap", () => {
      if (_visible.heatmap) { _showHeatmap(); }
      else if (_heatLayer) { _map.removeLayer(_heatLayer); }
    });

    _bindToggle("toggle-spots", "spots", () => {
      if (_visible.spots) { _loadGreenSpots(); }
      else { _spotsLayer.clearLayers(); }
    });

    document.getElementById("btn-highlight-worst")?.addEventListener("click", _highlightWorstRoute);
  }

  function _bindToggle(btnId, key, callback) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.classList.toggle("active", _visible[key]);
    btn.addEventListener("click", () => {
      _visible[key] = !_visible[key];
      btn.classList.toggle("active", _visible[key]);
      callback();
    });
  }

  // ── Find Me ──────────────────────────────────────────────────────────────

  function _bindFindMe() {
    document.getElementById("btn-find-me")?.addEventListener("click", () => {
      if (!navigator.geolocation) {
        window.EcoApp?.showToast("Geolocation not supported by your browser.", "error");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          _userLat = pos.coords.latitude;
          _userLng = pos.coords.longitude;
          _saveLocation(_userLat, _userLng);

          _map.setView([_userLat, _userLng], 14);

          // Remove old marker
          if (_youMarker) _map.removeLayer(_youMarker);

          // Pulsing div icon
          const icon = L.divIcon({
            className: "",
            html: `<div class="eco-you-marker"><div class="eco-you-dot"></div></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          });
          _youMarker = L.marker([_userLat, _userLng], { icon })
            .bindPopup("<b>📍 You are here</b>")
            .addTo(_map)
            .openPopup();

          window.EcoApp?.showToast("📍 Location found!", "success");
        },
        (err) => {
          window.EcoApp?.showToast("⚠️ Could not get location: " + err.message, "error");
        }
      );
    });
  }

  // ── Route drawing form ───────────────────────────────────────────────────

  function _bindRouteForm() {
    document.getElementById("btn-draw-route")?.addEventListener("click", () => {
      document.getElementById("map-route-form")?.classList.toggle("visible");
    });

    document.getElementById("btn-add-route")?.addEventListener("click", async () => {
      const from = document.getElementById("route-from")?.value.trim();
      const to   = document.getElementById("route-to")?.value.trim();
      const name = document.getElementById("route-name")?.value.trim() || "Trip";
      const co2  = parseFloat(document.getElementById("route-co2")?.value || 0);

      if (!from || !to) {
        window.EcoApp?.showToast("Please enter both From and To locations.", "error");
        return;
      }

      const btn = document.getElementById("btn-add-route");
      if (btn) { btn.disabled = true; btn.textContent = "Geocoding…"; }

      try {
        const [fromLL, toLL] = await Promise.all([
          _geocode(from),
          _geocode(to),
        ]);

        if (!fromLL || !toLL) {
          window.EcoApp?.showToast("⚠️ Could not find one or both locations.", "error");
          return;
        }

        _drawRoute(fromLL, toLL, { name, co2 });
        _routes.push({ from, to, co2, name, fromLatLng: fromLL, toLatLng: toLL });
        _updateMapStats();

        document.getElementById("map-route-form")?.classList.remove("visible");
        document.getElementById("route-from").value = "";
        document.getElementById("route-to").value   = "";
        document.getElementById("route-name").value = "";
        document.getElementById("route-co2").value  = "";

        window.EcoApp?.showToast(`✅ Route "${name}" added`, "success");
      } catch (err) {
        window.EcoApp?.showToast("⚠️ " + err.message, "error");
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Add Route"; }
      }
    });
  }

  function _drawRoute(fromLL, toLL, meta = {}) {
    const co2   = meta.co2 || 0;
    const color = co2 > 100 ? "#ef4444" : co2 > 30 ? "#f97316" : "#22c55e";

    const line = L.polyline([fromLL, toLL], {
      color,
      weight: 4,
      opacity: 0.85,
      lineJoin: "round",
    });

    const level = co2 > 100 ? "high" : co2 > 30 ? "medium" : "low";
    const distKm = (_distKm(fromLL, toLL)).toFixed(1);
    line.bindPopup(`
      <div class="map-popup">
        <div class="map-popup-title">🗺️ ${_esc(meta.name || "Trip")}</div>
        <div class="map-popup-row"><span>Distance</span><span>${distKm} km</span></div>
        <div class="map-popup-row"><span>CO₂</span><span>${co2.toFixed(1)} kg</span></div>
        <span class="map-popup-badge ${level}">${level.toUpperCase()} EMISSION</span>
      </div>
    `);

    // Markers at endpoints
    const fromIcon = _dotIcon("#1B4332");
    const toIcon   = _dotIcon(color);
    L.marker(fromLL, { icon: fromIcon }).addTo(_routeLayers);
    L.marker(toLL,   { icon: toIcon   }).addTo(_routeLayers);
    line.addTo(_routeLayers);
  }

  // ── Heatmap layer ────────────────────────────────────────────────────────

  function _showHeatmap() {
    if (typeof L.heatLayer === "undefined") {
      window.EcoApp?.showToast("Heatmap plugin not loaded yet.", "info");
      return;
    }
    const points = _routes.flatMap(r => {
      const intensity = Math.min(r.co2 / 200, 1);
      return [
        [r.fromLatLng[0], r.fromLatLng[1], intensity],
        [r.toLatLng[0],   r.toLatLng[1],   intensity],
      ];
    });

    if (_heatLayer) _map.removeLayer(_heatLayer);
    _heatLayer = L.heatLayer(points, {
      radius: 35,
      blur: 20,
      gradient: { 0.4: "#22c55e", 0.65: "#f97316", 1.0: "#ef4444" },
    }).addTo(_map);
  }

  // ── Green Spots (Overpass API) ───────────────────────────────────────────

  async function _loadGreenSpots() {
    _spotsLayer.clearLayers();
    const lat = _userLat || 51.505;
    const lng = _userLng || -0.09;
    const r   = 5000; // 5km radius

    const query = `
      [out:json][timeout:15];
      (
        node["amenity"="bicycle_rental"](around:${r},${lat},${lng});
        node["amenity"="charging_station"](around:${r},${lat},${lng});
        node["amenity"="recycling"](around:${r},${lat},${lng});
        node["shop"="organic"](around:${r},${lat},${lng});
        node["leisure"="park"](around:${r},${lat},${lng});
      );
      out body;
    `;

    try {
      window.EcoApp?.showToast("🔍 Finding green spots nearby…", "info");
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: query,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const data = await res.json();
      const elements = data.elements || [];

      if (!elements.length) {
        window.EcoApp?.showToast("No green spots found nearby.", "info");
        return;
      }

      elements.forEach(el => {
        const name  = el.tags?.name || _spotType(el.tags);
        const type  = _spotType(el.tags);
        const icon  = _greenSpotIcon(type);
        const distM = _userLat ? _distKm([_userLat, _userLng], [el.lat, el.lon]) * 1000 : null;

        L.marker([el.lat, el.lon], { icon })
          .bindPopup(`
            <div class="map-popup">
              <div class="map-popup-title">${_esc(name)}</div>
              <div class="map-popup-row"><span>Type</span><span>${_esc(type)}</span></div>
              ${distM ? `<div class="map-popup-row"><span>Distance</span><span>${distM < 1000 ? Math.round(distM)+"m" : (distM/1000).toFixed(1)+"km"}</span></div>` : ""}
            </div>
          `)
          .addTo(_spotsLayer);
      });

      window.EcoApp?.showToast(`✅ Found ${elements.length} green spots`, "success");
    } catch (err) {
      console.warn(TAG, "Overpass error:", err);
      window.EcoApp?.showToast("⚠️ Could not load green spots. Try again.", "error");
    }
  }

  function _spotType(tags = {}) {
    if (tags.amenity === "bicycle_rental")  return "Bike Rental";
    if (tags.amenity === "charging_station") return "EV Charging";
    if (tags.amenity === "recycling")        return "Recycling";
    if (tags.shop === "organic")             return "Organic Store";
    if (tags.leisure === "park")             return "Park";
    return "Eco Spot";
  }

  // ── User routes from Firestore ───────────────────────────────────────────

  function _loadUserRoutes() {
    const user = firebase.auth?.()?.currentUser;
    if (!user) return;
    try {
      const db = firebase.firestore();
      db.collection("users").doc(user.uid).collection("history")
        .where("from_lat", ">", -90)
        .limit(50)
        .get()
        .then(snap => {
          const newlyDrawn = [];
          snap.forEach(doc => {
            if (_loadedHistoryIds.has(doc.id)) return; // already drawn on a prior visit
            const d = doc.data();
            if (d.from_lat && d.from_lng && d.to_lat && d.to_lng) {
              const fromLL = [d.from_lat, d.from_lng];
              const toLL   = [d.to_lat, d.to_lng];
              const co2    = d.transport || 0;
              const name   = d.inputs?.transport_mode ? `${d.inputs.transport_mode} trip` : "Trip";
              _drawRoute(fromLL, toLL, { name, co2 });
              const route = { from: "", to: "", co2, name, fromLatLng: fromLL, toLatLng: toLL };
              _routes.push(route);
              newlyDrawn.push(route);
            }
            _loadedHistoryIds.add(doc.id);
          });
          _updateMapStats();
          if (newlyDrawn.length) {
            // Fit map to the newly-loaded routes
            const allPoints = newlyDrawn.flatMap(r => [r.fromLatLng, r.toLatLng]);
            _map.fitBounds(allPoints, { padding: [30, 30] });
          }
        });
    } catch (err) {
      console.warn(TAG, "Could not load Firestore routes:", err);
    }
  }

  // ── Map stats sidebar ────────────────────────────────────────────────────

  function _updateMapStats() {
    const totalKm = _routes.reduce((sum, r) => sum + _distKm(r.fromLatLng, r.toLatLng), 0);
    const el = document.getElementById("map-stat-km");
    if (el) el.textContent = totalKm.toFixed(1);
  }

  function _highlightWorstRoute() {
    if (!_routes.length) {
      window.EcoApp?.showToast("No routes logged yet.", "info");
      return;
    }
    const worst = _routes.reduce((a, b) => a.co2 > b.co2 ? a : b);
    if (worst.fromLatLng && worst.toLatLng) {
      _map.fitBounds([worst.fromLatLng, worst.toLatLng], { padding: [40, 40] });
      window.EcoApp?.showToast(`🔴 Most polluting: ${worst.name} (${worst.co2} kg CO₂)`, "info");
    }
  }

  // ── GPX Export ──────────────────────────────────────────────────────────

  function _bindGPXExport() {
    document.getElementById("btn-export-gpx")?.addEventListener("click", () => {
      if (!_routes.length) {
        window.EcoApp?.showToast("No routes to export.", "info");
        return;
      }
      const gpx = _buildGPX(_routes);
      const blob = new Blob([gpx], { type: "application/gpx+xml" });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement("a"), { href: url, download: "ecotrack-routes.gpx" });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      window.EcoApp?.showToast("✅ GPX exported!", "success");
    });
  }

  function _buildGPX(routes) {
    const tracks = routes.map(r => `
  <trk>
    <name>${_esc(r.name)}</name>
    <desc>CO2: ${r.co2} kg</desc>
    <trkseg>
      <trkpt lat="${r.fromLatLng[0]}" lon="${r.fromLatLng[1]}"></trkpt>
      <trkpt lat="${r.toLatLng[0]}" lon="${r.toLatLng[1]}"></trkpt>
    </trkseg>
  </trk>`).join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="EcoTrack">
${tracks}
</gpx>`;
  }

  // ── Geocoding (Nominatim) ────────────────────────────────────────────────

  async function _geocode(query) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
      const res = await fetch(url, { headers: { "Accept-Language": "en" } });
      const data = await res.json();
      if (!data.length) return null;
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    } catch (err) {
      console.warn(TAG, "Geocode error:", err);
      return null;
    }
  }

  // ── Icons ────────────────────────────────────────────────────────────────

  function _dotIcon(color) {
    return L.divIcon({
      className: "",
      html: `<div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>`,
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    });
  }

  function _greenSpotIcon(type) {
    const emojis = {
      "Bike Rental": "🚲", "EV Charging": "⚡", "Recycling": "♻️",
      "Organic Store": "🥦", "Park": "🌳", "Eco Spot": "🌿",
    };
    const emoji = emojis[type] || "🌿";
    return L.divIcon({
      className: "",
      html: `<div style="font-size:20px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4))">${emoji}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function _distKm(a, b) {
    if (!a || !b) return 0;
    const R = 6371;
    const dLat = (b[0] - a[0]) * Math.PI / 180;
    const dLon = (b[1] - a[1]) * Math.PI / 180;
    const s = Math.sin(dLat/2)**2 +
              Math.cos(a[0]*Math.PI/180) * Math.cos(b[0]*Math.PI/180) *
              Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
  }

  function _saveLocation(lat, lng) {
    try { localStorage.setItem("ecotrack-location", JSON.stringify({ lat, lng })); } catch {}
  }
  function _getSavedLocation() {
    try { return JSON.parse(localStorage.getItem("ecotrack-location")); } catch { return null; }
  }

  function _esc(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  // ── Expose ──────────────────────────────────────────────────────────────
  window.EcoMap = { init, geocode: _geocode };

})();
