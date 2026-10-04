import { test, expect } from "bun:test";
const C = require("../src/core.js");

test("Camelot mapping matches the wheel", () => {
  const cases = [[0, 1, "8B"], [9, 0, "8A"], [6, 0, "11A"], [3, 0, "2A"], [1, 1, "3B"], [7, 1, "9B"], [4, 0, "9A"], [11, 1, "1B"], [8, 0, "1A"], [3, 1, "5B"], [0, 0, "5A"], [5, 1, "7B"], [2, 0, "7A"], [9, 1, "11B"]];
  for (const [key, mode, want] of cases) expect(C.camStr(C.camelot(key, mode))).toBe(want);
  expect(C.camelot(-1, 1)).toBeNull();
});

test("key transitions", () => {
  const k = C.parseCamelot;
  expect(C.keyCost(k("8A"), k("8A"))).toBe(0);
  expect(C.keyCost(k("8A"), k("9A"))).toBe(0.1);
  expect(C.keyCost(k("8A"), k("8B"))).toBe(0.1);
  expect(C.keyCost(k("12A"), k("1A"))).toBe(0.1);
  expect(C.offWheel(k("8A"), k("2B"))).toBe(true);
});

const fake = (n) => Array.from({ length: n }, (_, i) => ({
  title: `Track ${i % 7 === 0 ? "Same" : i}${i % 7 === 0 ? ` (Remix ${i})` : ""}`,
  artists: [`Artist ${i % 5}`],
  cam: { n: (i * 5) % 12 + 1, l: i % 2 ? "A" : "B" },
  bpm: 120 + (i % 6),
  energy: ((i * 37) % 100) / 100,
}));

test("order is a full permutation and beats the input order", async () => {
  const t = fake(80);
  const o = await C.order(t, { steps: 100000, yieldEvery: 0 });
  const r = C.check(t, o);
  expect(r.complete).toBe(true);
  expect(r.off).toBeLessThan(C.check(t, t.map((_, i) => i)).off);
});

test("energy follows the arc: calm start, peak later", async () => {
  const t = fake(80);
  const o = await C.order(t, { steps: 100000, yieldEvery: 0 });
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  expect(avg(o.slice(0, 8).map((i) => t[i].energy))).toBeLessThan(avg(o.slice(56, 72).map((i) => t[i].energy)));
});
