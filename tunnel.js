/* Resolve the school server's current address.
 *
 * url.txt lives in this repo and start.sh rewrites it on every tunnel restart.
 * Two facts make a naive read unreliable:
 *
 *  1. raw.githubusercontent.com serves it with cache-control: max-age=300 AND
 *     strips the query string from its cache key — so the old "?t=" +Date.now()
 *     cache-buster did nothing (measured: a fresh ?t= still returned
 *     x-cache: HIT). For up to 5 minutes after a restart this file hands back
 *     a hostname that no longer exists.
 *  2. A quick tunnel gets a new random hostname every time it starts, so the
 *     stale value is not merely old, it is dead.
 *
 * So: don't treat an unreachable server as an error. Keep re-reading until the
 * TTL rolls over and a different URL appears. What used to be a dead end
 * ("Server offline") is now a wait.
 */
(function (global) {
  var RAW = 'https://raw.githubusercontent.com/oavjnp/school_portal/main/url.txt';
  var POLL_MS = 30000;       // TTL is 300s; polling every 30s costs little
  var MAX_MS = 360000;       // 6 minutes — one full TTL plus slack
  var _current = null;

  function readUrlTxt() {
    return fetch(RAW, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('http')); })
      .then(function (text) {
        var url = text.trim();
        if (!url || url.charAt(0) === '#') throw new Error('offline');
        return url;
      });
  }

  function reachable(url) {
    // /api/ping is public (no login) and cheap. no-cors means we cannot read
    // the response, but a resolved promise still proves something answered —
    // which is all we need to tell "dead hostname" from "server is up".
    return fetch(url + '/api/ping', { mode: 'no-cors', cache: 'no-store' })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  function resolveTunnel(opts) {
    opts = opts || {};
    var started = Date.now();
    var attempt = 0;

    function tick() {
      attempt++;
      return readUrlTxt()
        .then(function (url) {
          return reachable(url).then(function (ok) {
            if (ok) { _current = url; return url; }
            throw new Error('unreachable');
          });
        })
        .catch(function (err) {
          if (Date.now() - started >= MAX_MS) {
            if (opts.onGiveUp) opts.onGiveUp();
            throw err;
          }
          if (opts.onWaiting) opts.onWaiting(attempt);
          return new Promise(function (res) { setTimeout(res, POLL_MS); }).then(tick);
        });
    }
    return tick();
  }

  global.resolveTunnel = resolveTunnel;
  global.currentTunnelUrl = function () { return _current; };
})(window);
