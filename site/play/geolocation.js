/*! SPDX-License-Identifier: GPL-3.0-only */
const KEY = 'tiplay.location-datum.v1';
const validDatum = value => value === 'WGS84' || value === 'GCJ02';

/** A datum belongs to this browser installation, never to the paired Android phone. */
export function loadDatum(storage, userAgent) {
  try {
    const record = JSON.parse(storage.getItem(KEY));
    return record?.version === 1 && record.userAgent === userAgent && validDatum(record.datum) ? record.datum : null;
  } catch (_) { return null; }
}
export function saveDatum(storage, userAgent, datum) {
  if (!validDatum(datum)) return;
  try { storage.setItem(KEY, JSON.stringify({ version: 1, userAgent, datum })); } catch (_) {}
}

export function createBrowserLocation({ push, navigator, storage, secure, onIssue = () => {},
  now = () => performance.now(), wall = () => Date.now() }) {
  let enabled = false, active = false, watch = null, generation = 0, id = 0, lastTimestamp = null;
  let denied = false;
  const userAgent = navigator.userAgent || '';
  const cached = () => loadDatum(storage, userAgent);
  function stop() {
    generation++;
    if (watch !== null) navigator.geolocation?.clearWatch(watch);
    watch = null;
    lastTimestamp = null;
  }
  function start() {
    if (!enabled || !active || watch !== null) return;
    if (denied) { onIssue('permission'); return; }
    if (!secure) { onIssue('insecure'); return; }
    if (!navigator.geolocation) { onIssue('unsupported'); return; }
    const owner = ++generation;
    watch = navigator.geolocation.watchPosition(position => {
      if (owner !== generation || !enabled || !active) return;
      const c = position.coords;
      if (![c.latitude, c.longitude, c.accuracy, position.timestamp].every(Number.isFinite) ||
          c.latitude < -90 || c.latitude > 90 || c.longitude < -180 || c.longitude > 180 ||
          c.accuracy <= 0 || c.accuracy > 100 || position.timestamp === lastTimestamp) return;
      lastTimestamp = position.timestamp;
      // Some vehicle browsers expose a non-Unix source timestamp. Keep it for deduplication,
      // and use our own monotonic callback clock for transport age in all cases.
      const sourceAge = Math.abs(wall() - position.timestamp) < 86400000 ? Math.max(0, wall() - position.timestamp) : 0;
      if (sourceAge > 3000) return;
      push({ k: 'loc', id: ++id, timestamp: position.timestamp, captured: now(), sourceAge,
        lat: c.latitude, lon: c.longitude, accuracy: c.accuracy,
        altitude: c.altitude, heading: c.heading, speed: c.speed, datum: cached() });
    }, error => {
      if (owner !== generation) return;
      // Keep a transient-error watch alive. A denied permission must not be re-prompted by heartbeats.
      if (error.code === 1) { denied = true; stop(); onIssue('permission'); }
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  }
  // The browser owns its permission prompt; the Android app has the permission button.
  navigator.permissions?.query({ name: 'geolocation' }).then(permission => {
    denied = permission.state === 'denied';
    permission.onchange = () => {
      denied = permission.state === 'denied';
      if (denied) stop();
      start();
    };
    if (denied) stop();
    start();
  }).catch(() => {});
  return {
    update(status) {
      enabled = status?.enabled === true;
      active = status?.active === true;
      if (validDatum(status?.datum) && enabled && active) saveDatum(storage, userAgent, status.datum);
      if (!enabled || !active) stop();
      else start();
    },
    stop() { enabled = active = false; stop(); },
  };
}

/** Recompute age for every POST, including outbox retries; never upload expired queued fixes. */
export function locationEvents(events, now = performance.now()) {
  return events.flatMap(event => {
    if (event.k !== 'loc') return [event];
    const { captured, sourceAge, ...fields } = event;
    const age = now - captured + sourceAge;
    return Number.isFinite(age) && age >= 0 && age <= 3000 ? [{ ...fields, age }] : [];
  });
}
