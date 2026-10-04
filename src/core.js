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
if (typeof module !== "undefined") module.exports = DJMixCore;
