/**
 * notifications.js
 * ────────────────
 * Bell dropdown and messages panel.
 *
 * Subscribes to Firestore users/{uid}/notifications in real-time.
 * Renders unread badge, dropdown list, and "mark all read" logic.
 *
 * Exposes: window.EcoNotifications
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/notifications]";
  let _unsubNotif = null;
  let _unsubAnnouncements = null;
  let _uid = null;

  // ── Init ────────────────────────────────────────────────────────────────

  function init(uid) {
    _uid = uid;
    _subscribeNotifications(uid);
    _subscribeAnnouncements();
    _bindUI();
  }

  function cleanup() {
    if (_unsubNotif) { _unsubNotif(); _unsubNotif = null; }
    if (_unsubAnnouncements) { _unsubAnnouncements(); _unsubAnnouncements = null; }
  }

  // ── Firestore subscriptions ─────────────────────────────────────────────

  function _subscribeNotifications(uid) {
    if (!window.__FIREBASE_READY__) return;
    const db = window.__FIRESTORE__;
    _unsubNotif = db
      .collection("users").doc(uid)
      .collection("notifications")
      .orderBy("timestamp", "desc")
      .limit(20)
      .onSnapshot((snap) => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _renderNotifications(items);
      }, (err) => {
        console.warn(TAG, "Notification snapshot error:", err);
      });
  }

  function _subscribeAnnouncements() {
    if (!window.__FIREBASE_READY__) return;
    const db = window.__FIRESTORE__;
    _unsubAnnouncements = db
      .collection("announcements")
      .orderBy("timestamp", "desc")
      .limit(5)
      .onSnapshot((snap) => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _renderAnnouncements(items);
      }, (err) => {
        console.warn(TAG, "Announcements snapshot error:", err);
      });
  }

  // ── Render notifications ────────────────────────────────────────────────

  function _renderNotifications(items) {
    const badge = document.getElementById("notif-badge");
    const listEl = document.getElementById("notif-list");
    if (!listEl) return;

    const unread = items.filter(n => !n.read);

    // Update badge
    if (badge) {
      badge.textContent = unread.length > 9 ? "9+" : unread.length || "";
      badge.style.display = unread.length ? "flex" : "none";
    }

    if (items.length === 0) {
      listEl.innerHTML = `<div class="notif-empty">🌿 All caught up! No notifications.</div>`;
      return;
    }

    listEl.innerHTML = items.map(n => {
      const time = _formatTime(n.timestamp);
      const icon = n.icon || "🔔";
      const unreadClass = n.read ? "" : "unread";
      return `
        <div class="notif-item ${unreadClass}" data-id="${n.id}">
          <span class="notif-icon">${icon}</span>
          <div class="notif-body">
            <div class="notif-item-text">${_esc(n.text || "")}</div>
            <div class="notif-time">${time}</div>
          </div>
          ${!n.read ? '<div class="notif-unread-dot"></div>' : ''}
        </div>
      `;
    }).join("");
  }

  function _renderAnnouncements(items) {
    const listEl = document.getElementById("msg-list");
    const badge = document.getElementById("msg-badge");
    if (!listEl) return;

    if (items.length === 0) {
      listEl.innerHTML = `<div class="notif-empty">📢 No announcements yet.</div>`;
      return;
    }

    if (badge) {
      badge.textContent = items.length;
      badge.style.display = "flex";
    }

    listEl.innerHTML = items.map(a => `
      <div class="notif-item">
        <span class="notif-icon">📢</span>
        <div class="notif-body">
          <div class="notif-item-text" style="font-weight:600">${_esc(a.title || "Announcement")}</div>
          <div class="notif-item-text">${_esc(a.body || "")}</div>
          <div class="notif-time">${_formatTime(a.timestamp)}</div>
        </div>
      </div>
    `).join("");
  }

  // ── UI binding ──────────────────────────────────────────────────────────

  function _bindUI() {
    // Bell button toggle
    const bellBtn = document.getElementById("btn-notifications");
    const notifPanel = document.getElementById("notif-panel");

    if (bellBtn && notifPanel) {
      bellBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const msgPanel = document.getElementById("msg-panel");
        if (msgPanel) msgPanel.classList.remove("open");
        notifPanel.classList.toggle("open");
      });
    }

    // Messages button toggle
    const msgBtn = document.getElementById("btn-messages");
    const msgPanel = document.getElementById("msg-panel");

    if (msgBtn && msgPanel) {
      msgBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (notifPanel) notifPanel.classList.remove("open");
        msgPanel.classList.toggle("open");
      });
    }

    // Close on outside click
    document.addEventListener("click", () => {
      document.getElementById("notif-panel")?.classList.remove("open");
      document.getElementById("msg-panel")?.classList.remove("open");
    });
    notifPanel?.addEventListener("click", e => e.stopPropagation());
    msgPanel?.addEventListener("click", e => e.stopPropagation());

    // Mark all read
    document.getElementById("btn-mark-all-read")?.addEventListener("click", async () => {
      if (!_uid) return;
      try {
        await fetch("/api/notifications/mark-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: _uid }),
        });
        window.EcoApp?.showToast("All notifications marked as read ✅", "success");
      } catch (err) {
        console.error(TAG, err);
      }
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  function _formatTime(ts) {
    if (!ts) return "";
    const d = typeof ts === "string" ? new Date(ts) : ts.toDate ? ts.toDate() : new Date();
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  }

  function _esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Expose ──────────────────────────────────────────────────────────────
  window.EcoNotifications = { init, cleanup };

})();
