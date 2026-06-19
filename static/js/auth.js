/**
 * auth.js
 * ───────
 * Firebase Authentication helpers: sign-up, sign-in, sign-out, and
 * auth-state change listener.
 *
 * Exposes:
 *   window.EcoAuth.signUp(email, password)   → Promise
 *   window.EcoAuth.signIn(email, password)   → Promise
 *   window.EcoAuth.signOut()                 → Promise
 *   window.EcoAuth.currentUser()             → firebase.User | null
 *   window.EcoAuth.onStateChange(callback)   → unsubscribe fn
 */

(function () {
  "use strict";

  const TAG = "[EcoTrack/auth]";

  /**
   * Sign up a new user with email and password.
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<firebase.auth.UserCredential>}
   */
  async function signUp(email, password) {
    if (!window.__FIREBASE_READY__) throw new Error("Firebase not initialised.");
    try {
      const cred = await window.__AUTH__.createUserWithEmailAndPassword(
        email.trim(),
        password
      );
      console.info(TAG, "New user registered:", cred.user.uid);
      return cred;
    } catch (err) {
      console.error(TAG, "signUp error:", err.code, err.message);
      throw _friendlyError(err);
    }
  }

  /**
   * Sign in an existing user.
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<firebase.auth.UserCredential>}
   */
  async function signIn(email, password) {
    if (!window.__FIREBASE_READY__) throw new Error("Firebase not initialised.");
    try {
      const cred = await window.__AUTH__.signInWithEmailAndPassword(
        email.trim(),
        password
      );
      console.info(TAG, "User signed in:", cred.user.uid);
      return cred;
    } catch (err) {
      console.error(TAG, "signIn error:", err.code, err.message);
      throw _friendlyError(err);
    }
  }

  /**
   * Sign out the current user.
   *
   * @returns {Promise<void>}
   */
  async function signOut() {
    if (!window.__FIREBASE_READY__) return;
    await window.__AUTH__.signOut();
    console.info(TAG, "User signed out.");
  }

  /**
   * Return the currently authenticated user, or null.
   *
   * @returns {firebase.User | null}
   */
  function currentUser() {
    if (!window.__FIREBASE_READY__) return null;
    return window.__AUTH__.currentUser;
  }

  /**
   * Subscribe to auth state changes.
   *
   * @param {function(firebase.User|null): void} callback
   * @returns {function} unsubscribe
   */
  function onStateChange(callback) {
    if (!window.__FIREBASE_READY__) {
      callback(null);
      return () => {};
    }
    return window.__AUTH__.onAuthStateChanged(callback);
  }

  /**
   * Map Firebase error codes to friendly user-facing messages.
   *
   * @param {firebase.FirebaseError} err
   * @returns {Error}
   */
  function _friendlyError(err) {
    const map = {
      "auth/email-already-in-use":   "This email is already registered. Please sign in instead.",
      "auth/invalid-email":          "Please enter a valid email address.",
      "auth/weak-password":          "Password must be at least 6 characters.",
      "auth/user-not-found":         "No account found with this email.",
      "auth/wrong-password":         "Incorrect password. Please try again.",
      "auth/too-many-requests":      "Too many attempts. Please wait a moment and try again.",
      "auth/network-request-failed": "Network error. Please check your connection.",
    };
    const msg = map[err.code] || err.message || "Authentication failed.";
    return new Error(msg);
  }

  // Expose to global scope
  window.EcoAuth = { signUp, signIn, signOut, currentUser, onStateChange };

})();
