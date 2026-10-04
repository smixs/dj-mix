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
