/**
 * app.js
 * ──────
 * SPA bootstrap: auth state management, view routing, global utilities.
 *
 * Routing is handled via URL hash (#dashboard, #calculator, etc.).
 * Auth state changes trigger view gating so unauthenticated users always
 * land on the auth view.
 *
 * Exposes:
 *   window.EcoApp.navigate(route)           → void
 *   window.EcoApp.showToast(msg, type)       → void
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/app]";

  /** View IDs mapped to route names */
  const VIEWS = {
    auth:          "view-auth",
    dashboard:     "view-dashboard",
    calculator:    "view-calculator",
    challenges:    "view-challenges",
    insights:      "view-insights",
    settings:      "view-settings",
    help:          "view-help",
    map:           "view-map",
    import:        "view-import",
    notifications: "view-notifications",
  };

  /** @type {string|null} */
  let _currentRoute = null;
  /** @type {boolean} */
  let _authenticated = false;

  // ── Boot ────────────────────────────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", () => {
    _initAuth();
    _initAuthForms();
    _initNavButtons();
    _initInstallPrompt();
    window.EcoCalculator?.init();
    window.EcoInsights?.init();
    console.info(TAG, "EcoTrack SPA booted.");
  });

  // ── PWA Install ──────────────────────────────────────────────────────────

  /** Show the sidebar install card and wire it to the browser's install prompt. */
  function _initInstallPrompt() {
    const card = document.getElementById("sidebar-install-card");
    const btn = document.getElementById("btn-install-app");
    let deferredPrompt = null;

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      card?.classList.remove("hidden");
    });

    btn?.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      card?.classList.add("hidden");
    });

    window.addEventListener("appinstalled", () => {
      card?.classList.add("hidden");
    });
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  /**
   * Subscribe to Firebase auth state changes and gate views accordingly.
   */
  function _initAuth() {
    window.EcoAuth?.onStateChange((user) => {
      _authenticated = !!user;

      const emailEl  = document.getElementById("user-email");
      const authBtn  = document.getElementById("auth-btn");

      if (user) {
        if (emailEl) emailEl.textContent = user.email || "";
        // Update topbar avatar
        const avatarEl = document.getElementById("topbar-avatar");
        if (avatarEl) avatarEl.textContent = (user.displayName || user.email || "E")[0].toUpperCase();
        const nameEl = document.querySelector(".topbar-user-name");
        if (nameEl) nameEl.textContent = user.displayName || user.email?.split("@")[0] || "EcoUser";

        if (authBtn) {
          authBtn.textContent = "Sign Out";
          authBtn.setAttribute("aria-label", "Sign out of your account");
          authBtn.onclick = _handleSignOut;
        }

        // Init feature modules
        window.EcoNotifications?.init(user.uid);
        window.EcoBot?.init();

        // Apply saved theme
        const theme = localStorage.getItem("ecotrack-theme") || "light";
        document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "");

        // Navigate to dashboard (or hash-requested route)
        const hash = window.location.hash.replace("#", "") || "dashboard";
        const valid = ["dashboard","calculator","challenges","insights","settings","help","map","import"];
        navigate(valid.includes(hash) ? hash : "dashboard");
      } else {
        if (emailEl) emailEl.textContent = "";
        if (authBtn) {
          authBtn.textContent = "Sign In";
          authBtn.setAttribute("aria-label", "Sign in to your account");
          authBtn.onclick = () => navigate("auth");
        }
        window.EcoNotifications?.cleanup();
        navigate("auth");
        window.EcoCharts?.clear();
      }
    });
  }

  /**
   * Wire up the sign-in and sign-up forms.
   */
  function _initAuthForms() {
    // Tab switching
    document.getElementById("tab-signin")?.addEventListener("click", () => _switchAuthTab("signin"));
    document.getElementById("tab-signup")?.addEventListener("click", () => _switchAuthTab("signup"));

    // Sign-in form
    document.getElementById("form-signin")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn   = document.getElementById("btn-signin");
      const email = document.getElementById("signin-email")?.value.trim();
      const pass  = document.getElementById("signin-password")?.value;
      const errEl = document.getElementById("signin-error");

      if (!email || !pass) { if (errEl) errEl.textContent = "Please fill in all fields."; return; }
      if (errEl) errEl.textContent = "";

      _setLoading(btn, true);
      try {
        await window.EcoAuth.signIn(email, pass);
        showToast("✅ Welcome back!", "success");
      } catch (err) {
        if (errEl) errEl.textContent = "⚠️ " + err.message;
      } finally {
        _setLoading(btn, false);
      }
    });

    // Sign-up form
    document.getElementById("form-signup")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn   = document.getElementById("btn-signup");
      const email = document.getElementById("signup-email")?.value.trim();
      const pass  = document.getElementById("signup-password")?.value;
      const errEl = document.getElementById("signup-error");

      if (!email || !pass) { if (errEl) errEl.textContent = "Please fill in all fields."; return; }
      if (errEl) errEl.textContent = "";

      _setLoading(btn, true);
      try {
        await window.EcoAuth.signUp(email, pass);
        showToast("🌿 Account created! Welcome to EcoTrack.", "success");
      } catch (err) {
        if (errEl) errEl.textContent = "⚠️ " + err.message;
      } finally {
        _setLoading(btn, false);
      }
    });
  }

  /** Handle sign-out click. */
  async function _handleSignOut() {
    await window.EcoAuth?.signOut();
    showToast("👋 Signed out. See you soon!", "info");
  }

  /** Switch between sign-in / sign-up auth tabs. */
  function _switchAuthTab(tab) {
    const tabs   = document.querySelectorAll(".auth-tab");
    const panels = document.querySelectorAll(".auth-panel");

    tabs.forEach((t) => {
      const isActive = t.id === `tab-${tab}`;
      t.classList.toggle("active", isActive);
      t.setAttribute("aria-selected", String(isActive));
    });
    panels.forEach((p) => {
      p.classList.toggle("hidden", p.id !== `panel-${tab}`);
    });
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /** Wire nav buttons to the router. */
  function _initNavButtons() {
    document.querySelectorAll(".nav-btn[data-route]").forEach((btn) => {
      btn.addEventListener("click", () => navigate(btn.dataset.route));
    });

    document.getElementById("btn-go-calculator")?.addEventListener("click", () => navigate("calculator"));
    document.getElementById("btn-go-import")?.addEventListener("click", () => navigate("import"));
  }

  /**
   * Navigate to a named route.
   *
   * @param {string} route - One of: auth, dashboard, calculator, challenges, map
   */
  function navigate(route) {
    if (!_authenticated && route !== "auth") {
      route = "auth";
    }

    if (_currentRoute === route) return;
    _currentRoute = route;

    // Reset scroll position — views share one scrolling page, so without
    // this a scroll-deep visit to one view leaves the next view's content
    // hidden above the fold.
    window.scrollTo(0, 0);

    // Update hash
    window.location.hash = route === "auth" ? "" : route;

    // Toggle views
    Object.entries(VIEWS).forEach(([name, id]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const isActive = name === route;
      el.classList.toggle("hidden", !isActive);
      el.classList.toggle("active", isActive);
    });

    // Update nav button active state
    document.querySelectorAll(".nav-btn[data-route]").forEach((btn) => {
      const isActive = btn.dataset.route === route;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-current", isActive ? "page" : "false");
    });

    // Trigger view-specific side effects
    if (route === "dashboard") {
      window.EcoDashboard?.refresh();
    } else if (route === "challenges") {
      window.EcoChallenges?.init();
    } else if (route === "insights") {
      window.EcoInsights?.refresh();
    } else if (route === "settings") {
      window.EcoSettings?.init();
    } else if (route === "help") {
      window.EcoHelp?.init();
    } else if (route === "map") {
      // Leaflet needs a tick before init since view just became visible
      setTimeout(() => window.EcoMap?.init(), 50);
    } else if (route === "import") {
      window.EcoImport?.init();
    }

    console.info(TAG, "Navigated to:", route);
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  /** @type {ReturnType<typeof setTimeout>|null} */
  let _toastTimer = null;

  /**
   * Display a toast notification.
   *
   * @param {string} message
   * @param {"success"|"error"|"info"} [type]
   * @param {number} [duration] ms to show (default 3500)
   */
  function showToast(message, type = "info", duration = 3500) {
    const el = document.getElementById("toast");
    if (!el) return;

    el.textContent = message;
    el.className   = `toast ${type} show`;

    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.classList.remove("show");
    }, duration);
  }

  // ── Button loading helper ─────────────────────────────────────────────────

  function _setLoading(btn, loading) {
    if (!btn) return;
    btn.classList.toggle("loading", loading);
    btn.disabled = loading;
  }

  // ── Expose ────────────────────────────────────────────────────────────────
  window.EcoApp = { navigate, showToast };

})();
