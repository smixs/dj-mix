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
    let cell = row.querySelector(":scope > .dj-mix-year");
    if (!cell) {
      const end = row.querySelector(":scope > .main-trackList-rowSectionEnd");
      if (!end) return null;
      cell = document.createElement("div");
      cell.className = "main-trackList-rowSectionVariable dj-mix-year";
      cell.setAttribute("role", isHeader ? "columnheader" : "gridcell");
      cell.style.cssText = "display:flex;align-items:center;";
      const span = document.createElement("span");
      span.className = isHeader ? "dj-mix-year-head" : "dj-mix-year-text";
      cell.appendChild(span);
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
