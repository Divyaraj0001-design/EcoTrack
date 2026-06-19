/**
 * firestore.js
 * ────────────
 * Firestore CRUD helpers for the EcoTrack platform.
 *
 * Data model:
 *   users/{uid}/history/{autoId}  →  footprint entry document
 *
 * Exposes:
 *   window.EcoStore.saveEntry(uid, data)      → Promise<string>  (doc ID)
 *   window.EcoStore.getHistory(uid, limit)    → Promise<Array>
 *   window.EcoStore.getLatestEntry(uid)       → Promise<Object|null>
 *   window.EcoStore.getMonthlyGoal(uid)       → Promise<number>
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/firestore]";

  /**
   * Save a footprint entry to the user's history sub-collection.
   *
   * @param {string} uid    - Firebase user ID
   * @param {Object} data   - Footprint breakdown data from the API
   * @returns {Promise<string>} Firestore document ID of the saved entry
   */
  async function saveEntry(uid, data) {
    if (!window.__FIREBASE_READY__) {
      console.warn(TAG, "Firestore unavailable; entry not saved.");
      return null;
    }
    try {
      const db  = window.__FIRESTORE__;
      const doc = await db
        .collection("users")
        .doc(uid)
        .collection("history")
        .add({
          ...data,
          timestamp: new Date().toISOString(),
        });
      console.info(TAG, "Entry saved:", doc.id);
      return doc.id;
    } catch (err) {
      console.error(TAG, "saveEntry error:", err);
      throw err;
    }
  }

  /**
   * Retrieve the user's footprint history, most-recent first.
   *
   * @param {string} uid      - Firebase user ID
   * @param {number} [limit]  - Max records to return (default 30)
   * @returns {Promise<Array<Object>>}
   */
  async function getHistory(uid, limit = 30) {
    if (!window.__FIREBASE_READY__) return [];
    try {
      const db   = window.__FIRESTORE__;
      const snap = await db
        .collection("users")
        .doc(uid)
        .collection("history")
        .orderBy("timestamp", "desc")
        .limit(Math.min(limit, 100))
        .get();

      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.error(TAG, "getHistory error:", err);
      return [];
    }
  }

  /**
   * Retrieve only the most recent footprint entry for the user.
   *
   * @param {string} uid - Firebase user ID
   * @returns {Promise<Object|null>}
   */
  async function getLatestEntry(uid) {
    const history = await getHistory(uid, 1);
    return history.length > 0 ? history[0] : null;
  }

  /**
   * Retrieve the user's monthly carbon goal (kg CO2e), set on the Settings page.
   *
   * @param {string} uid - Firebase user ID
   * @returns {Promise<number>} Monthly goal in kg, defaulting to 300 if unset.
   */
  async function getMonthlyGoal(uid) {
    if (!window.__FIREBASE_READY__) return 300;
    try {
      const db  = window.__FIRESTORE__;
      const doc = await db.collection("users").doc(uid).collection("settings").doc("prefs").get();
      const data = doc.exists ? doc.data() : {};
      return data.monthlyGoalKg || 300;
    } catch (err) {
      console.warn(TAG, "getMonthlyGoal error:", err);
      return 300;
    }
  }

  // Expose to global scope
  window.EcoStore = { saveEntry, getHistory, getLatestEntry, getMonthlyGoal };

})();
