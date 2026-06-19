/**
 * ecobot.js
 * ─────────
 * EcoBot AI chat widget.
 *
 * Floating FAB → slide-up panel → user/bot message bubbles → POST /api/ecobot
 *
 * Context (user stats) pulled from window.EcoDashboard.lastStats on each send.
 * Exposes: window.EcoBot
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/ecobot]";

  // Quick-reply suggestion chips shown after the welcome message
  const SUGGESTION_CHIPS = [
    "What does my score mean?",
    "How can I reduce my footprint?",
    "Compare me to the global average",
    "Suggest a challenge for me",
    "How do I log an activity?",
  ];

  let _isOpen  = false;
  let _loading = false;

  // ── Init ────────────────────────────────────────────────────────────────

  function init() {
    _injectWidget();
    _bindEvents();
  }

  // ── Widget injection (already in HTML, just bind) ───────────────────────

  function _injectWidget() {
    // Widget HTML is in index.html; just add welcome message
    setTimeout(() => {
      _appendBotMessage(
        "Hi! 🌿 I'm EcoBot, your carbon footprint coach. How can I help you today?",
        true
      );
    }, 600);
  }

  // ── Events ──────────────────────────────────────────────────────────────

  function _bindEvents() {
    document.getElementById("ecobot-fab")?.addEventListener("click", togglePanel);
    document.getElementById("ecobot-close")?.addEventListener("click", closePanel);

    const sendBtn = document.getElementById("ecobot-send");
    const input   = document.getElementById("ecobot-input");

    sendBtn?.addEventListener("click", _handleSend);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        _handleSend();
      }
    });
    input?.addEventListener("input", () => {
      if (sendBtn) sendBtn.disabled = !input.value.trim();
    });
  }

  // ── Panel open/close ─────────────────────────────────────────────────────

  function togglePanel() {
    _isOpen ? closePanel() : openPanel();
  }

  function openPanel() {
    _isOpen = true;
    document.getElementById("ecobot-panel")?.classList.add("open");
    document.getElementById("ecobot-input")?.focus();
  }

  function closePanel() {
    _isOpen = false;
    document.getElementById("ecobot-panel")?.classList.remove("open");
  }

  // ── Send message ─────────────────────────────────────────────────────────

  async function _handleSend() {
    if (_loading) return;
    const input = document.getElementById("ecobot-input");
    const msg   = (input?.value || "").trim();
    if (!msg) return;

    input.value = "";
    document.getElementById("ecobot-send").disabled = true;

    _appendUserMessage(msg);
    _showTyping();
    _loading = true;

    try {
      const context = _buildContext();
      const res = await fetch("/api/ecobot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, context }),
      });
      const data = await res.json();
      _hideTyping();
      _appendBotMessage(data.reply || "Sorry, I couldn't generate a response.");
    } catch (err) {
      _hideTyping();
      _appendBotMessage("Hmm, I'm having trouble connecting. Please try again shortly! 🔄");
      console.error(TAG, err);
    } finally {
      _loading = false;
    }
  }

  // ── Context builder ──────────────────────────────────────────────────────

  function _buildContext() {
    // Pull stats from dashboard if available
    const stats = window.EcoDashboard?.lastStats || {};
    return {
      total_co2:      stats.total      || 0,
      score:          stats.scoreLabel || "Unknown",
      top_category:   stats.topCat     || "energy",
      monthly_goal:   _getMonthlyGoal(),
      activity_count: stats.activityCount || 0,
    };
  }

  function _getMonthlyGoal() {
    try {
      if (!window.__FIREBASE_READY__) return 300;
      const user = window.__AUTH__.currentUser;
      if (!user) return 300;
      // Try to read from settings in memory
      return window._ecotrack_monthly_goal || 300;
    } catch {
      return 300;
    }
  }

  // ── Message rendering ────────────────────────────────────────────────────

  function _appendUserMessage(text) {
    const el = _createMsgEl("user", text);
    _getMessagesEl().appendChild(el);
    _scrollToBottom();
  }

  function _appendBotMessage(text, withChips = false) {
    const el = _createMsgEl("bot", text);
    const container = _getMessagesEl();
    container.appendChild(el);

    if (withChips) {
      const chipsEl = document.createElement("div");
      chipsEl.className = "ecobot-chips";
      SUGGESTION_CHIPS.forEach(chip => {
        const btn = document.createElement("button");
        btn.className = "ecobot-chip";
        btn.textContent = chip;
        btn.addEventListener("click", () => {
          const input = document.getElementById("ecobot-input");
          if (input) {
            input.value = chip;
            _handleSend();
          }
        });
        chipsEl.appendChild(btn);
      });
      container.appendChild(chipsEl);
    }

    _scrollToBottom();
  }

  function _createMsgEl(type, text) {
    const wrap = document.createElement("div");
    wrap.className = `ecobot-msg ${type}`;

    const time = new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });

    // Simple markdown: **bold**
    const formatted = _esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    wrap.innerHTML = `
      <div>${formatted}</div>
      <span class="ecobot-msg-time">${time}</span>
    `;
    return wrap;
  }

  function _showTyping() {
    const el = document.createElement("div");
    el.id = "ecobot-typing";
    el.className = "ecobot-typing";
    el.innerHTML = "<span></span><span></span><span></span>";
    _getMessagesEl().appendChild(el);
    _scrollToBottom();
  }

  function _hideTyping() {
    document.getElementById("ecobot-typing")?.remove();
  }

  function _getMessagesEl() {
    return document.getElementById("ecobot-messages");
  }

  function _scrollToBottom() {
    const el = _getMessagesEl();
    if (el) el.scrollTop = el.scrollHeight;
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;");
  }

  // ── Expose ──────────────────────────────────────────────────────────────
  window.EcoBot = { init, openPanel, closePanel, togglePanel };

})();
