/**
 * help.js
 * ───────
 * Help center page: FAQ accordion, live search, contact form.
 * Exposes: window.EcoHelp
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/help]";

  function init() {
    _bindAccordion();
    _bindSearch();
    _bindContactForm();
  }

  // ── FAQ accordion ────────────────────────────────────────────────────────

  function _bindAccordion() {
    document.querySelectorAll(".faq-question").forEach(btn => {
      btn.addEventListener("click", () => {
        const item   = btn.closest(".faq-item");
        const answer = item.querySelector(".faq-answer");
        const isOpen = item.classList.contains("open");

        // Close all
        document.querySelectorAll(".faq-item.open").forEach(el => {
          el.classList.remove("open");
          el.querySelector(".faq-answer").style.maxHeight = "0";
        });

        // Open clicked if it was closed
        if (!isOpen) {
          item.classList.add("open");
          answer.style.maxHeight = answer.scrollHeight + "px";
        }
      });
    });
  }

  // ── Live search ──────────────────────────────────────────────────────────

  function _bindSearch() {
    const input = document.getElementById("help-search");
    if (!input) return;
    input.addEventListener("input", () => {
      const query = input.value.toLowerCase().trim();
      document.querySelectorAll(".faq-item").forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = (!query || text.includes(query)) ? "" : "none";
      });
      const noResults = document.getElementById("help-no-results");
      if (noResults) {
        const visible = [...document.querySelectorAll(".faq-item")].some(el => el.style.display !== "none");
        noResults.classList.toggle("hidden", visible || !query);
      }
    });
  }

  // ── Contact form ─────────────────────────────────────────────────────────

  function _bindContactForm() {
    document.getElementById("help-contact-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("btn-submit-ticket");
      if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

      const user = firebase.auth().currentUser;
      const name    = document.getElementById("ticket-name")?.value.trim();
      const email   = document.getElementById("ticket-email")?.value.trim();
      const message = document.getElementById("ticket-message")?.value.trim();

      try {
        const res = await fetch("/api/support-ticket", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, message, uid: user?.uid || "" }),
        });
        const data = await res.json();
        if (res.ok) {
          window.EcoApp?.showToast("✅ Message sent! We'll respond within 24h.", "success");
          document.getElementById("help-contact-form")?.reset();
        } else {
          window.EcoApp?.showToast("⚠️ " + (data.error || "Failed to send."), "error");
        }
      } catch (err) {
        window.EcoApp?.showToast("⚠️ Network error. Please try again.", "error");
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Send Message"; }
      }
    });
  }

  window.EcoHelp = { init };

})();
