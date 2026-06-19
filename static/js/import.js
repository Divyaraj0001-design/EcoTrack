/**
 * import.js
 * ─────────
 * CSV import pipeline:
 *  1. File drop zone / file input
 *  2. Client-side CSV parse + header validation
 *  3. Preview table (first 5 rows)
 *  4. Row-level error display
 *  5. Confirm → POST /api/import → batch Firestore write
 *  6. Duplicate detection on server
 *  7. Sample CSV download
 *
 * Exposes: window.EcoImport
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/import]";
  const REQUIRED_HEADERS = ["date","category","activity","amount","unit"];
  let _parsedRows = [];

  // ── Init ────────────────────────────────────────────────────────────────

  function init() {
    _bindDropZone();
    _bindSampleDownload();
    _bindConfirm();
    _bindFileInput();
  }

  // ── Drop zone ────────────────────────────────────────────────────────────

  function _bindDropZone() {
    const zone = document.getElementById("import-drop-zone");
    if (!zone) return;

    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", e => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const file = e.dataTransfer.files[0];
      if (file) _processFile(file);
    });
    zone.addEventListener("click", () => document.getElementById("import-file-input")?.click());
  }

  function _bindFileInput() {
    const input = document.getElementById("import-file-input");
    if (!input) return;
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (file) _processFile(file);
      input.value = ""; // reset so same file can be re-selected
    });
  }

  // ── CSV Processing ───────────────────────────────────────────────────────

  function _processFile(file) {
    const errEl = document.getElementById("import-errors");
    if (!file.name.toLowerCase().endsWith(".csv")) {
      _showErrors(["❌ Only .csv files are accepted."]);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { rows, errors } = _parseCSV(e.target.result);
        _parsedRows = rows;

        if (errors.length) {
          _showErrors(errors);
        } else {
          _clearErrors();
        }

        if (rows.length > 0) {
          _renderPreview(rows);
          document.getElementById("import-preview-section")?.classList.remove("hidden");
          document.getElementById("import-file-name").textContent = file.name;
          document.getElementById("import-row-count").textContent = `${rows.length} row${rows.length !== 1 ? "s" : ""} found`;
        }
      } catch (err) {
        _showErrors(["❌ Failed to parse CSV: " + err.message]);
      }
    };
    reader.readAsText(file);
  }

  function _parseCSV(text) {
    const lines  = text.trim().split(/\r?\n/);
    if (lines.length < 2) return { rows: [], errors: ["File is empty or has no data rows."] };

    // Parse header
    const headers = _splitCSVLine(lines[0]).map(h => h.toLowerCase().trim().replace(/^"|"$/g,""));
    const missing = REQUIRED_HEADERS.filter(h => !headers.includes(h));
    if (missing.length) {
      return {
        rows: [],
        errors: [`❌ Missing required columns: ${missing.join(", ")}. Expected: ${REQUIRED_HEADERS.join(", ")}`],
      };
    }

    const rows   = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const vals = _splitCSVLine(line).map(v => v.replace(/^"|"$/g,"").trim());

      const row = {};
      headers.forEach((h, idx) => { row[h] = vals[idx] || ""; });

      const rowErrors = [];
      if (!row.date) rowErrors.push("date is empty");
      if (!row.category) rowErrors.push("category is empty");
      if (!row.activity) rowErrors.push("activity is empty");
      if (isNaN(parseFloat(row.amount))) rowErrors.push("amount is not a number");
      if (!row.unit) rowErrors.push("unit is empty");

      if (rowErrors.length) {
        errors.push(`Row ${i}: ${rowErrors.join(", ")}`);
        continue;
      }

      row.amount = parseFloat(row.amount);
      rows.push(row);
    }

    return { rows, errors };
  }

  function _splitCSVLine(line) {
    const result = [];
    let inQuote = false;
    let cur = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        result.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    result.push(cur);
    return result;
  }

  // ── Preview table ────────────────────────────────────────────────────────

  function _renderPreview(rows) {
    const table = document.getElementById("import-preview-table");
    if (!table) return;
    const preview = rows.slice(0, 5);
    table.innerHTML = `
      <thead>
        <tr>${REQUIRED_HEADERS.map(h => `<th>${h}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${preview.map(r => `
          <tr>
            ${REQUIRED_HEADERS.map(h => `<td>${_esc(String(r[h] || ""))}</td>`).join("")}
          </tr>
        `).join("")}
      </tbody>
    `;
    if (rows.length > 5) {
      const note = document.getElementById("import-preview-note");
      if (note) note.textContent = `Showing first 5 of ${rows.length} rows`;
    }
  }

  // ── Confirm import ───────────────────────────────────────────────────────

  function _bindConfirm() {
    document.getElementById("btn-confirm-import")?.addEventListener("click", async () => {
      const user = firebase.auth().currentUser;
      if (!user) { window.EcoApp?.showToast("Please sign in first.", "error"); return; }
      if (!_parsedRows.length) { window.EcoApp?.showToast("No rows to import.", "error"); return; }

      const btn = document.getElementById("btn-confirm-import");
      if (btn) { btn.disabled = true; btn.textContent = "Importing…"; }

      try {
        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: user.uid, rows: _parsedRows }),
        });
        const data = await res.json();
        if (res.ok) {
          const msg = `✅ ${data.imported} activities imported successfully${data.skipped ? ` (${data.skipped} skipped as duplicates)` : ""}`;
          window.EcoApp?.showToast(msg, "success");
          _resetImport();
        } else {
          window.EcoApp?.showToast("⚠️ " + (data.error || "Import failed"), "error");
        }
      } catch (err) {
        window.EcoApp?.showToast("⚠️ Network error: " + err.message, "error");
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Confirm Import"; }
      }
    });

    document.getElementById("btn-cancel-import")?.addEventListener("click", _resetImport);
  }

  function _resetImport() {
    _parsedRows = [];
    document.getElementById("import-preview-section")?.classList.add("hidden");
    document.getElementById("import-errors")?.classList.add("hidden");
    _clearErrors();
  }

  // ── Sample CSV download ──────────────────────────────────────────────────

  function _bindSampleDownload() {
    document.getElementById("btn-sample-csv")?.addEventListener("click", () => {
      const sample = [
        "date,category,activity,amount,unit",
        "2025-06-01,transport,Car commute,150,km",
        "2025-06-02,food,Meat-based diet,7,days",
        "2025-06-03,energy,Electricity usage,250,kWh",
        "2025-06-04,shopping,Online shopping,1,week",
        "2025-06-05,transport,Bus commute,30,km",
      ].join("\n");

      const blob = new Blob([sample], { type: "text/csv" });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement("a"), { href: url, download: "ecotrack-sample.csv" });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // ── Error display ────────────────────────────────────────────────────────

  function _showErrors(errors) {
    const el = document.getElementById("import-errors");
    if (!el) return;
    el.classList.remove("hidden");
    el.innerHTML = errors.map(e => `<div class="import-error-row">⚠️ ${_esc(e)}</div>`).join("");
  }
  function _clearErrors() {
    const el = document.getElementById("import-errors");
    if (el) { el.innerHTML = ""; el.classList.add("hidden"); }
  }

  function _esc(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  // ── Expose ──────────────────────────────────────────────────────────────
  window.EcoImport = { init };

})();
