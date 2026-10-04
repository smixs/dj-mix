// Bundle src/ into the single file Spicetify loads: bun build.ts
const pkg = await Bun.file("package.json").json();
const header = `// DJ Mix v${pkg.version} for Spicetify — ${pkg.homepage}\n// Orders a playlist like a DJ set: Camelot key, energy arc, smooth tempo. MIT License.\n`;
const body = (await Bun.file("src/core.js").text()).replace(/\nif \(typeof module[^\n]*\n?$/, "\n") + "\n" + (await Bun.file("src/extension.js").text()) + "\n" + (await Bun.file("src/year-column.js").text());
await Bun.write("dj-mix.js", header + body);
console.log(`dj-mix.js v${pkg.version}: ${(header + body).length} bytes`);
