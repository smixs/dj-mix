// DJ Mix v1.2.0 for Spicetify — https://github.com/smixs/dj-mix
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

// "Year" column in playlist track lists: the release year of each track, right before the duration.
(async function DJMixYearColumn() {
  while (!window.Spicetify?.Platform?.PlaylistAPI || !Spicetify.Platform.History) await new Promise((r) => setTimeout(r, 300));
  const { Platform } = Spicetify;
  const YEAR_WIDTH = 64;
  const NATIVE = ["main-trackList-rowSectionIndex", "main-trackList-rowSectionStart", "main-trackList-rowSectionVariable", "main-trackList-rowSectionEnd"];

  // Years for the playlist on screen: track uri -> year
  let years = { uri: null, map: new Map(), loading: null, missesAt: 0 };
  const playlistUri = () => {
    const m = /^\/playlist\/([A-Za-z0-9]+)/.exec(Platform.History.location?.pathname || "");
    return m ? `spotify:playlist:${m[1]}` : null;
  };
  async function loadYears(uri) {
    const contents = await Platform.PlaylistAPI.getContents(uri, { offset: 0, limit: 10000 });
    const map = new Map();
    for (const it of contents.items || []) {
      const iso = it.release?.isoString || it.album?.releaseDate?.isoString;
      if (it.uri && iso) map.set(it.uri, iso.slice(0, 4));
    }
    return map;
  }
  function ensureYears(uri) {
    if (years.uri === uri && !years.loading) return;
    if (years.uri === uri && years.loading) return;
    years = { uri, map: new Map(), loading: null, missesAt: 0 };
    years.loading = loadYears(uri).then((map) => { if (years.uri === uri) { years.map = map; years.loading = null; refresh(true); } })
      .catch((e) => { console.warn("[DJ Mix] years", e); years.loading = null; });
  }

  // Track uri behind a row: walk up the React fiber to the component that renders the track
  function rowTrackUri(row) {
    const key = Object.keys(row).find((k) => k.startsWith("__reactFiber"));
    let f = key && row[key];
    for (let d = 0; f && d < 20; d++, f = f.return) {
      const p = f.memoizedProps;
      if (!p || typeof p !== "object") continue;
      for (const v of [p.uri, p.item?.uri, p.track?.uri, p.value?.item?.uri]) {
        if (typeof v === "string" && v.startsWith("spotify:track:")) return v;
      }
    }
    return null;
  }

  const nativeCells = (row) => [...row.children].filter((c) => !c.classList.contains("dj-mix-year") && NATIVE.some((n) => c.classList.contains(n)) && getComputedStyle(c).display !== "none");

  // Keep Spotify's proportions, add a fixed-width year track before [last]
  function templateFor(header) {
    const cells = nativeCells(header);
    if (cells.length < 3) return null;
    const w = cells.map((c) => c.getBoundingClientRect().width);
    const last = Math.max(w[w.length - 1], 1);
    const parts = [`[index] ${Math.round(w[0])}px`, `[first] ${(w[1] / last).toFixed(3)}fr`];
    for (let i = 2; i < cells.length - 1; i++) parts.push(`[var${i - 1}] ${(w[i] / last).toFixed(3)}fr`);
    parts.push(`[var${cells.length - 2}] ${YEAR_WIDTH}px`, "[last] minmax(120px,1fr)");
    return { key: cells.length, css: parts.join(" ") };
  }

  function addCell(row, isHeader) {
    const end = row.querySelector(":scope > .main-trackList-rowSectionEnd");
    if (!end) return null;
    let cell = row.querySelector(":scope > .dj-mix-year");
    // Spotify may insert its own cells after ours when it re-renders a row: keep ours right before the duration
    if (cell && cell.nextElementSibling !== end) row.insertBefore(cell, end);
    if (!cell) {
      cell = document.createElement("div");
      cell.className = "main-trackList-rowSectionVariable dj-mix-year";
      cell.setAttribute("role", isHeader ? "columnheader" : "gridcell");
      cell.style.cssText = "display:flex;align-items:center;";
      const span = document.createElement("span");
      span.className = isHeader ? "dj-mix-year-head" : "dj-mix-year-text";
      cell.appendChild(span);
      if (isHeader) {
        cell.style.cursor = "pointer";
        cell.title = "Sort this playlist by release year";
        cell.addEventListener("click", () => sortByYear(playlistUri()));
      }
      row.insertBefore(cell, end);
    }
    return cell;
  }

  // One stylesheet rule per track list. Spotify re-renders rows and resets inline styles; a rule survives that.
  const rules = new Map(); // grid id -> css
  let gridSeq = 0;
  function writeRules() {
    sheet.textContent = BASE_CSS + [...rules].map(([id, css]) =>
      `[data-dj-mix-grid="${id}"] :is(.main-trackList-trackListHeaderRow,.main-trackList-trackListRow){grid-template-columns:${css}!important}`).join("\n");
  }

  function apply(grid, force) {
    const header = grid.querySelector(".main-trackList-trackListHeaderRow");
    if (!header) return;
    const id = grid.dataset.djMixGrid || (grid.dataset.djMixGrid = String(++gridSeq));
    const count = nativeCells(header).length;
    if (force || grid.dataset.djMixYearKey !== String(count) || !rules.has(id)) {
      const t = templateFor(header);
      if (!t) return;
      grid.dataset.djMixYearKey = String(t.key);
      if (rules.get(id) !== t.css) { rules.set(id, t.css); writeRules(); }
    }
    const head = addCell(header, true);
    if (head && head.firstChild.textContent !== "Year") head.firstChild.textContent = "Year";
    let misses = 0;
    for (const row of grid.querySelectorAll(".main-trackList-trackListRow")) {
      const cell = addCell(row, false);
      if (!cell) continue;
      const uri = row.dataset.djMixUri || (row.dataset.djMixUri = rowTrackUri(row) || "");
      const y = uri ? years.map.get(uri) : null;
      if (!y && uri && !years.loading) misses++;
      if (cell.firstChild.textContent !== (y || "")) cell.firstChild.textContent = y || "";
    }
    // Rows recycle while scrolling: a new uri on a reused row needs a fresh lookup
    for (const row of grid.querySelectorAll(".main-trackList-trackListRow[data-dj-mix-uri]")) {
      const now = rowTrackUri(row);
      if (now && now !== row.dataset.djMixUri) { row.dataset.djMixUri = now; row.querySelector(".dj-mix-year-text").textContent = years.map.get(now) || ""; }
    }
    // A track added to the playlist after loading: reload, at most every 10 s
    if (misses && Date.now() - years.missesAt > 10000) { years.missesAt = Date.now(); years.uri = null; ensureYears(playlistUri()); }
  }

  // Click on "Year": reorder the playlist itself by release year (Spotify has no year sort for playlists).
  // Moves one block per year to the top, so tracks keep their added dates and their order inside a year.
  const direction = new Map(); // playlist uri -> last direction
  let sorting = false;
  async function sortByYear(uri) {
    if (!uri || sorting) return;
    const say = (m, err) => Spicetify.showNotification(`DJ Mix: ${m}`, err);
    try {
      sorting = true;
      const meta = await Platform.PlaylistAPI.getMetadata(uri);
      if (!meta.canRemove) return say("only your own playlists can be sorted by year", true);
      const asc = direction.get(uri) !== "asc";
      direction.set(uri, asc ? "asc" : "desc");
      const contents = await Platform.PlaylistAPI.getContents(uri, { offset: 0, limit: 10000 });
      const groups = new Map();
      for (const it of contents.items || []) {
        if (!it.uri || !it.uid) continue;
        const y = (it.release?.isoString || it.album?.releaseDate?.isoString || "").slice(0, 4) || "";
        if (!groups.has(y)) groups.set(y, []);
        groups.get(y).push({ uri: it.uri, uid: it.uid });
      }
      const years = [...groups.keys()].filter(Boolean).sort();
      if (!asc) years.reverse();
      const finalOrder = groups.has("") ? [...years, ""] : years; // tracks without a year go last
      for (const y of finalOrder.reverse()) await Platform.PlaylistAPI.move(uri, groups.get(y), { before: "start" });
      // Show the playlist in its own order ("Custom order"), not in a view sort like "Recently added"
      const L = Platform.LocalStorageAPI;
      const st = { ...(L?.getItem("sortedState") || {}) };
      if (st[uri]) { delete st[uri]; L.setItem("sortedState", st); }
      say(`sorted by year, ${asc ? "oldest" : "newest"} first`);
    } catch (e) {
      console.error("[DJ Mix] sort by year", e);
      say(`could not sort by year: ${e.message}`, true);
    } finally {
      sorting = false;
    }
  }

  function clear() {
    document.querySelectorAll(".dj-mix-year").forEach((c) => c.remove());
    if (rules.size) { rules.clear(); writeRules(); }
  }

  let timer = null, busy = false;
  function refresh(force) {
    if (busy) return;
    busy = true;
    try { refreshNow(force); } finally { busy = false; }
  }
  function refreshNow(force) {
    const uri = playlistUri();
    if (!uri) return clear();
    ensureYears(uri);
    document.querySelectorAll(".main-trackList-trackListHeaderRow").forEach((h) => {
      const grid = h.closest('[role="grid"]') || h.parentElement?.parentElement;
      if (grid) apply(grid, force);
    });
  }
  const BASE_CSS = `.dj-mix-year-text{color:var(--text-subdued,#a7a7a7);font-size:.875rem;font-variant-numeric:tabular-nums}
.dj-mix-year-head{color:var(--text-subdued,#a7a7a7);font-size:.875rem}
.dj-mix-year[role="columnheader"]:hover .dj-mix-year-head{color:var(--text-base,#fff)}
.main-trackList-trackListRow:hover .dj-mix-year-text,.main-trackList-selected .dj-mix-year-text{color:var(--text-base,#fff)}
`;
  const sheet = document.createElement("style");
  sheet.textContent = BASE_CSS;
  document.head.appendChild(sheet);
  // Only react to changes inside track lists; ignore our own year cells
  new MutationObserver((muts) => {
    for (const m of muts) {
      const t = m.target;
      if (t.nodeType !== 1 || t.closest?.(".dj-mix-year")) continue;
      if (t.closest?.('[role="grid"]') || [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.('[role="grid"], .main-trackList-trackListRow, .main-trackList-trackListHeaderRow') || n.querySelector?.(".main-trackList-trackListHeaderRow")))) {
        refresh(false);
        return;
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(() => refresh(true), 200); });
  Platform.History.listen(() => setTimeout(() => refresh(true), 300));
  refresh(true);
})();
