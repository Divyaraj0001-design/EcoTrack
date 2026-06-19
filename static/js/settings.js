/**
 * settings.js
 * ───────────
 * Settings page logic: profile, notification prefs, carbon goals,
 * theme toggle, delete account.
 *
 * Reads/writes: users/{uid}/settings Firestore doc + localStorage for theme.
 * Exposes: window.EcoSettings
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/settings]";

  // ── Init ────────────────────────────────────────────────────────────────

  function init() {
    _loadSettings();
    _bindUI();
    _applyTheme(localStorage.getItem("ecotrack-theme") || "light");
  }

  // ── Load settings from Firestore ────────────────────────────────────────

  async function _loadSettings() {
    if (!window.__FIREBASE_READY__) return;
    const user = window.__AUTH__.currentUser;
    if (!user) return;
    try {
      const db  = window.__FIRESTORE__;
      const doc = await db.collection("users").doc(user.uid).collection("settings").doc("prefs").get();
      const data = doc.exists ? doc.data() : {};

      // Profile
      const nameInput = document.getElementById("settings-display-name");
      const emailInput = document.getElementById("settings-email");
      if (nameInput) nameInput.value = user.displayName || data.displayName || "";
      if (emailInput) emailInput.value = user.email || "";

      // Notification toggles
      _setToggle("toggle-email-alerts",       data.emailAlerts !== false);
      _setToggle("toggle-weekly-summary",     data.weeklySummary !== false);
      _setToggle("toggle-challenge-reminder", data.challengeReminders !== false);

      // Carbon goal
      const goalInput = document.getElementById("settings-monthly-goal");
      if (goalInput) goalInput.value = data.monthlyGoalKg || 300;

      // Theme
      const theme = localStorage.getItem("ecotrack-theme") || data.theme || "light";
      const themeToggle = document.getElementById("settings-theme-toggle");
      if (themeToggle) themeToggle.checked = theme === "dark";

      console.info(TAG, "Settings loaded.");
    } catch (err) {
      console.warn(TAG, "Could not load settings:", err);
    }
  }

  // ── Save settings ───────────────────────────────────────────────────────

  async function _saveSettings(e) {
    e.preventDefault();
    if (!window.__FIREBASE_READY__) return;
    const user = window.__AUTH__.currentUser;
    if (!user) return;

    const btn = document.getElementById("btn-save-settings");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

    try {
      // Update display name
      const newName = document.getElementById("settings-display-name")?.value.trim();
      if (newName && newName !== user.displayName) {
        await user.updateProfile({ displayName: newName });
        // Update topbar
        const nameEl = document.querySelector(".topbar-user-name");
        if (nameEl) nameEl.textContent = newName;
      }

      // Update profile photo URL if provided
      const photoUrl = document.getElementById("settings-photo-url")?.value.trim();
      if (photoUrl && photoUrl !== user.photoURL) {
        await user.updateProfile({ photoURL: photoUrl });
      }

      const theme = document.getElementById("settings-theme-toggle")?.checked ? "dark" : "light";
      localStorage.setItem("ecotrack-theme", theme);
      _applyTheme(theme);

      // Save to Firestore
      const db = window.__FIRESTORE__;
      const prefs = {
        displayName:          newName || user.displayName || "",
        emailAlerts:          _getToggle("toggle-email-alerts"),
        weeklySummary:        _getToggle("toggle-weekly-summary"),
        challengeReminders:   _getToggle("toggle-challenge-reminder"),
        monthlyGoalKg:        parseFloat(document.getElementById("settings-monthly-goal")?.value || 300),
        theme,
        updatedAt:            new Date().toISOString(),
      };
      await db.collection("users").doc(user.uid).collection("settings").doc("prefs").set(prefs, { merge: true });

      window.EcoApp?.showToast("Settings saved successfully ✅", "success");
    } catch (err) {
      console.error(TAG, err);
      window.EcoApp?.showToast("⚠️ Failed to save settings: " + err.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Save Settings"; }
    }
  }

  // ── Theme ────────────────────────────────────────────────────────────────

  function _applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "");
    localStorage.setItem("ecotrack-theme", theme);
    // Sync settings toggle if on settings page
    const settingsToggle = document.getElementById("settings-theme-toggle");
    if (settingsToggle) settingsToggle.checked = theme === "dark";
  }

  // ── Delete Account ───────────────────────────────────────────────────────

  function _showDeleteModal() {
    const modal = document.getElementById("modal-delete-account");
    if (modal) modal.classList.add("open");
  }

  function _hideDeleteModal() {
    const modal = document.getElementById("modal-delete-account");
    if (modal) modal.classList.remove("open");
  }

  async function _confirmDelete() {
    if (!window.__FIREBASE_READY__) return;
    const user = window.__AUTH__.currentUser;
    if (!user) return;
    const confirmInput = document.getElementById("delete-confirm-input");
    if (!confirmInput || confirmInput.value.trim().toUpperCase() !== "DELETE") {
      window.EcoApp?.showToast('Type "DELETE" to confirm account deletion', "error");
      return;
    }
    try {
      // Delete Firestore data
      const db = window.__FIRESTORE__;
      const batch = db.batch();
      const settingsRef = db.collection("users").doc(user.uid).collection("settings").doc("prefs");
      batch.delete(settingsRef);
      await batch.commit();
      // Delete Auth account
      await user.delete();
      window.EcoApp?.showToast("Account deleted. Goodbye! 👋", "info");
    } catch (err) {
      if (err.code === "auth/requires-recent-login") {
        window.EcoApp?.showToast("Please sign out and sign in again to delete your account.", "error");
      } else {
        window.EcoApp?.showToast("⚠️ " + err.message, "error");
      }
    }
    _hideDeleteModal();
  }

  // ── UI binding ───────────────────────────────────────────────────────────

  function _bindUI() {
    document.getElementById("settings-form")?.addEventListener("submit", _saveSettings);
    document.getElementById("btn-delete-account")?.addEventListener("click", _showDeleteModal);
    document.getElementById("btn-cancel-delete")?.addEventListener("click", _hideDeleteModal);
    document.getElementById("btn-confirm-delete")?.addEventListener("click", _confirmDelete);

    // Dark mode quick toggle in topbar
    document.getElementById("dark-mode-toggle")?.addEventListener("click", () => {
      const current = localStorage.getItem("ecotrack-theme") || "light";
      _applyTheme(current === "dark" ? "light" : "dark");
    });
  }

  // ── Toggle helpers ───────────────────────────────────────────────────────

  function _setToggle(id, value) {
    const el = document.getElementById(id);
    if (el) el.checked = !!value;
  }
  function _getToggle(id) {
    return !!document.getElementById(id)?.checked;
  }

  // ── Expose ──────────────────────────────────────────────────────────────
  window.EcoSettings = { init, applyTheme: _applyTheme };

})();
