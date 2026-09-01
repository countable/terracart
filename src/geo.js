// ─── Geo — the page's ONE geolocation watcher ────────────────────────────────
//
// Every browser location prompt the player sees is a watchPosition() call made
// on a page whose grant isn't already remembered (Safari's "Allow Once", a
// fresh page load after a session-scoped grant, …). The game therefore asks
// exactly once per page: a single underlying watch, fanned out to every
// consumer that wants fixes (the boot-time home capture, the scene's GPS
// tracking), plus a grace period before a released watch is really torn down
// so a quick background→foreground bounce reuses the live watch instead of
// starting a new one (which on "allow once" browsers re-prompts).
//
// Usage:
//   const sub = Geo.subscribe(onFix, onErr);   // starts the watch if needed
//   Geo.unsubscribe(sub);                      // watch lingers RELEASE_GRACE_MS
//
// A newly-subscribed consumer is handed the most recent fix (if any) on the
// next tick, so joining late doesn't mean waiting for the next GPS update.
const Geo = (function () {
  // Same options the scene has always used: a real (not cell-tower) fix,
  // 5 s of cache tolerance, and a 10 s timeout so a cold start reports
  // TIMEOUT rather than hanging silently.
  const OPTS = { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 };
  // How long the watch survives with zero subscribers. Long enough to cover an
  // app-switch / notification-shade / lock-screen bounce, short enough that a
  // genuinely backgrounded game stops draining the battery on GPS.
  const RELEASE_GRACE_MS = 30000;

  let watchId = null;
  let teardownTimer = null;
  let lastFix = null;
  const subs = new Set();

  function _onFix(pos) {
    lastFix = pos;
    // Copy first — a subscriber may unsubscribe from inside its callback.
    for (const sub of [...subs]) {
      if (!subs.has(sub) || !sub.onFix) continue;
      try { sub.onFix(pos); } catch (e) { console.error('Geo fix handler:', e); }
    }
  }

  function _onErr(err) {
    // A denied watch is a dead watch — it will never produce another fix. Drop
    // it now so that if the player grants location afterwards (browser settings
    // → back to the tab) the next subscribe arms a FRESH watch instead of
    // rejoining this corpse for as long as the release grace lasts.
    // Transient errors (TIMEOUT, POSITION_UNAVAILABLE) keep the watch: they are
    // what a cold GPS start reports on its way to the first fix.
    if (err && err.code === 1 /* PERMISSION_DENIED */ && watchId != null) {
      try { navigator.geolocation.clearWatch(watchId); } catch (_) {}
      watchId = null;
      if (teardownTimer) { clearTimeout(teardownTimer); teardownTimer = null; }
    }
    for (const sub of [...subs]) {
      if (!subs.has(sub) || !sub.onErr) continue;
      try { sub.onErr(err); } catch (e) { console.error('Geo error handler:', e); }
    }
  }

  // Idempotent: at most one live watch per page, ever.
  function _ensureWatch() {
    if (teardownTimer) { clearTimeout(teardownTimer); teardownTimer = null; }
    if (watchId != null) return true;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return false;
    try {
      watchId = navigator.geolocation.watchPosition(_onFix, _onErr, OPTS);
    } catch (_) {
      watchId = null;
      return false;
    }
    return true;
  }

  // Returns an opaque subscription token, or null when the device has no
  // geolocation at all (callers treat that as "no GPS this session").
  function subscribe(onFix, onErr) {
    if (!_ensureWatch()) return null;
    const sub = { onFix, onErr };
    subs.add(sub);
    if (lastFix && onFix) {
      const pos = lastFix;
      // Deferred so subscribe() has returned (and the caller has stored the
      // token) before the first callback lands.
      setTimeout(() => {
        if (!subs.has(sub)) return;
        try { onFix(pos); } catch (e) { console.error('Geo fix handler:', e); }
      }, 0);
    }
    return sub;
  }

  function unsubscribe(sub) {
    if (!sub) return;
    subs.delete(sub);
    if (subs.size || watchId == null || teardownTimer) return;
    teardownTimer = setTimeout(() => {
      teardownTimer = null;
      if (subs.size) return;               // someone re-subscribed in the meantime
      try { navigator.geolocation.clearWatch(watchId); } catch (_) {}
      watchId = null;
    }, RELEASE_GRACE_MS);
  }

  return {
    subscribe,
    unsubscribe,
    isWatching: () => watchId != null,
    subscriberCount: () => subs.size,
    get lastFix() { return lastFix; },
    RELEASE_GRACE_MS,
  };
})();

if (typeof window !== 'undefined') window.Geo = Geo;
