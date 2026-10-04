// DJ Mix v1.0.0 for Spicetify — https://github.com/smixs/dj-mix
// Orders a playlist like a DJ set: Camelot key, energy arc, smooth tempo. MIT License.
// DJ Mix core: the ordering rules, with no Spotify dependency.
// Runs inside Spicetify (bundled into dj-mix.js) and under bun for tests.
const DJMixCore = (() => {
  // Spotify key = 0..11 (C..B), mode = 1 major / 0 minor. Camelot: C major = 8B, +1 per fifth.
  function camelot(key, mode) {
    if (key == null || key < 0 || mode == null) return null;
    const root = mode === 1 ? key : (key + 3) % 12; // minor via its relative major
    return { n: (((7 * root) % 12) + 7) % 12 + 1, l: mode === 1 ? "B" : "A" };
  }
  const parseCamelot = (s) => {
    const m = /^(\d{1,2})([AB])$/.exec(s || "");
    return m && +m[1] >= 1 && +m[1] <= 12 ? { n: +m[1], l: m[2] } : null;
  };
  const camStr = (c) => (c ? `${c.n}${c.l}` : "?");

  // Cost of a key transition on the Camelot wheel: 0 is perfect, 2 is off the wheel.
  function keyCost(a, b) {
    if (!a && !b) return 1.0;
    if (!a || !b) return 0.5;
    const d = Math.min((a.n - b.n + 12) % 12, (b.n - a.n + 12) % 12);
    if (d === 0) return a.l === b.l ? 0 : 0.1; // same key / relative major-minor
    if (d === 1 && a.l === b.l) return 0.1; // one step around the wheel
    if (d === 1) return 0.4; // diagonal
    if ((b.n - a.n + 12) % 12 === 2 && a.l === b.l) return 0.35; // +2 energy boost
    return 2.0;
  }
  const offWheel = (a, b) => !!a && !!b && keyCost(a, b) >= 2;

  const baseTitle = (t) => t.title.toLowerCase().replace(/\s*[-(\[].*$/, "").trim();
  const mainArtist = (t) => (t.artists[0] || "").toLowerCase();

  // Energy arc: calm start, two waves with the second one higher, short cool-down.
  const target = (x) => 0.15 + 0.7 * x + 0.15 * Math.sin(x * 4 * Math.PI - Math.PI / 2);

  // Energy rank 0..1 per track. Tempo is not part of it: BPM is not energy.
  function energyRank(tracks) {
    const idx = tracks.map((t, i) => [t.energy, i]).filter(([v]) => v != null).sort((p, q) => p[0] - q[0]);
    const r = new Array(tracks.length).fill(0.5);
    idx.forEach(([, i], k) => (r[i] = idx.length > 1 ? k / (idx.length - 1) : 0.5));
    return r;
  }

  // Simulated annealing over: key transitions, energy arc, tempo steps, repeats.
  // Returns indexes into tracks. Deterministic for the same input.
  async function order(tracks, { steps = 300000, yieldEvery = 20000 } = {}) {
    const n = tracks.length;
    if (n < 3) return tracks.map((_, i) => i);
    const E = energyRank(tracks);
    const o = tracks.map((_, i) => i).sort((p, q) => E[p] - E[q]);
    const local = (i) => {
      const t = tracks[o[i]];
      let c = 1.5 * Math.abs(E[o[i]] - target(i / (n - 1)));
      if (i) {
        const p = tracks[o[i - 1]];
        c += keyCost(p.cam, t.cam);
        if (p.bpm && t.bpm) c += 0.15 * Math.max(0, Math.abs(t.bpm - p.bpm) - 2);
        if (baseTitle(p) === baseTitle(t)) c += 1.5;
        else if (mainArtist(p) === mainArtist(t)) c += 0.5;
      }
      return c;
    };
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let s = 0; s < steps; s++) {
      if (yieldEvery && s % yieldEvery === 0) await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
      const temp = Math.pow(0.003, s / steps);
      const i = Math.floor(rnd() * n), j = Math.floor(rnd() * n);
      if (i === j) continue;
      const idx = [...new Set([i, i + 1, j, j + 1].filter((k) => k < n))];
      const before = idx.reduce((a, k) => a + local(k), 0);
      [o[i], o[j]] = [o[j], o[i]];
      const d = idx.reduce((a, k) => a + local(k), 0) - before;
      if (d > 0 && rnd() > Math.exp(-d / temp)) [o[i], o[j]] = [o[j], o[i]];
    }
    return o;
  }

  // Summary of an order (indexes into tracks).
  function check(tracks, o) {
    let off = 0, twins = 0;
    for (let i = 1; i < o.length; i++) {
      const a = tracks[o[i - 1]], b = tracks[o[i]];
      if (offWheel(a.cam, b.cam)) off++;
      if (baseTitle(a) === baseTitle(b)) twins++;
    }
    const complete = o.length === tracks.length && new Set(o).size === tracks.length;
    return { off, twins, complete };
  }

  return { camelot, parseCamelot, camStr, keyCost, offWheel, energyRank, target, order, check };
})();

// DJ Mix for Spicetify: "DJ Mix" in a playlist's context menu.
// Reads key, BPM and energy from Spotify itself, orders the tracks like a DJ set
// and saves the result as a new playlist "DJ Mix — <name>". The original is never changed.
(async function DJMix() {
  while (!window.Spicetify?.Platform?.PlaylistAPI || !Spicetify.ContextMenu || !Spicetify.showNotification || !Spicetify.URI) {
    await new Promise((r) => setTimeout(r, 300));
  }
  const { Platform, URI } = Spicetify;
  const Core = DJMixCore;
  const AUDIO_ATTRIBUTES_V2 = 222; // track extension behind Spotify's own Mix mode (Camelot key + BPM)
  const say = (msg, isError = false) => Spicetify.showNotification(`DJ Mix: ${msg}`, isError);
  const log = (...a) => console.log("[DJ Mix]", ...a);

  async function token(refresh) {
    if (refresh) Platform.Session.accessToken = (await Spicetify.CosmosAsync.get("sp://auth/v2/token")).accessToken;
    return Platform.Session.accessToken;
  }

  // Energy (and a fallback key/tempo) per track from Spotify's internal audio features.
  async function audioFeatures(ids) {
    const out = {};
    const one = async (id) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(`https://spclient.wg.spotify.com/audio-attributes/v1/audio-features/${id}`, {
            headers: { Authorization: `Bearer ${await token(attempt > 0)}` },
          });
          if (res.status === 401) continue;
          if (res.ok) { out[id] = await res.json(); return; }
        } catch (e) { /* network hiccup: retry */ }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    for (let i = 0; i < ids.length; i += 10) await Promise.all(ids.slice(i, i + 10).map(one));
    return out;
  }

  async function loadTracks(uri) {
    const contents = await Platform.PlaylistAPI.getContents(uri, { offset: 0, limit: 10000, filter: "", trackExtensions: [AUDIO_ATTRIBUTES_V2] });
    const items = (contents.items || []).filter((it) => it.type === "track" && it.uri?.startsWith("spotify:track:"));
    const ids = [...new Set(items.map((it) => it.uri.split(":")[2]))];
    const f = await audioFeatures(ids);
    return items.map((it) => {
      const a = f[it.uri.split(":")[2]] || {};
      return {
        uri: it.uri,
        title: it.name || "",
        artists: (it.artists || []).map((x) => x.name),
        cam: Core.parseCamelot(it.key?.camelotKey) || Core.camelot(a.key, a.mode),
        bpm: it.bpm || a.tempo || null,
        energy: a.energy ?? null,
      };
    });
  }

  async function createPlaylist(name, uris) {
    const uri = await Platform.RootlistAPI.createPlaylist(name, { before: "start" });
    await new Promise((r) => setTimeout(r, 800));
    for (let i = 0; i < uris.length; i += 500) await Platform.PlaylistAPI.add(uri, uris.slice(i, i + 500), { after: "end" });
    return uri;
  }

  async function run(uri) {
    const meta = await Platform.PlaylistAPI.getMetadata(uri);
    say(`building a mix from “${meta.name}”…`);
    const tracks = await loadTracks(uri);
    if (tracks.length < 3) return say("this playlist needs at least 3 tracks", true);
    const order = await Core.order(tracks);
    const report = Core.check(tracks, order);
    if (!report.complete) return say("could not order every track, nothing was created", true);
    const newUri = await createPlaylist(`DJ Mix — ${meta.name}`, order.map((i) => tracks[i].uri));
    const noKey = tracks.filter((t) => !t.cam).length;
    log("done", { tracks: tracks.length, offWheel: report.off, noKey, newUri });
    say(`done: ${tracks.length} tracks, ${report.off} off-wheel transitions${noKey ? `, ${noKey} without a key` : ""}`);
    Platform.History.push(URI.fromString(newUri).toURLPath(true));
    return { newUri, order, tracks, ...report };
  }

  const busy = new Set();
  async function start(uri) {
    if (busy.has(uri)) return say("this playlist is already being mixed");
    busy.add(uri);
    try { return await run(uri); }
    catch (e) { console.error("[DJ Mix]", e); say(`error: ${e.message}`, true); }
    finally { busy.delete(uri); }
  }

  Spicetify.SVGIcons["dj-mix"] =
    '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" fill="currentColor"/><path d="M8 1.5v3M14.5 8h-3M8 14.5v-3M1.5 8h3" stroke="currentColor" stroke-width="1.3"/>';
  new Spicetify.ContextMenu.Item("DJ Mix", ([uri]) => start(uri), (uris) => uris.length === 1 && URI.isPlaylistV1OrV2(uris[0]), "dj-mix").register();
  window.DJMix = { run: start, loadTracks, core: Core };
  log("loaded");
})();
