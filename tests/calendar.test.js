const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("index.html", "utf8");

function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Source section not found: ${start}`);
  return source.slice(from, to);
}

const ctx = Object.assign({ console, Date });
vm.createContext(ctx);
vm.runInContext(
  between("function pad", "function dayLabel") +
  between("function sum", "function todayMid") +
  between("function calendarData", "function calendarHTML") +
  "this.calendarData = calendarData;",
  ctx
);

// Kasım 2026 pazar günü başlar: pazartesi bazlı offset 6, 30 gün.
const nov = ctx.calendarData([], 2026, 10);
assert.strictEqual(nov.offset, 6);
assert.strictEqual(nov.days.length, 30);
assert.strictEqual(nov.days[0].iso, "2026-11-01");
assert.strictEqual(nov.days[29].iso, "2026-11-30");

// Şubat 2026: 28 gün, 1 Şubat pazar → offset 6. Artık yıl 2028: 29 gün.
assert.strictEqual(ctx.calendarData([], 2026, 1).days.length, 28);
assert.strictEqual(ctx.calendarData([], 2028, 1).days.length, 29);
// Ocak 2026 perşembe başlar → offset 3.
assert.strictEqual(ctx.calendarData([], 2026, 0).offset, 3);

// Gruplama: yalnızca ilgili ayın günleri toplanır, toplam hesaplanır.
const list = [
  { id: 1, cat: "fatura", amount: 100, due: "2026-11-05", status: "wait" },
  { id: 2, cat: "kira", amount: 8500, due: "2026-11-05", status: "wait" },
  { id: 3, cat: "kart", amount: 4800, due: "2026-11-20", status: "done" },
  { id: 4, cat: "fatura", amount: 999, due: "2026-12-05", status: "wait" },
  { id: 5, cat: "fatura", amount: 999, due: "2025-11-05", status: "wait" }
];
const grouped = ctx.calendarData(list, 2026, 10);
assert.strictEqual(grouped.days[4].items.length, 2);
assert.strictEqual(grouped.days[4].total, 8600);
assert.strictEqual(grouped.days[19].items.length, 1);
assert.strictEqual(grouped.days[19].total, 4800);
assert.strictEqual(grouped.days[0].items.length, 0);
assert.strictEqual(grouped.days[0].total, 0);
assert.strictEqual(grouped.days.reduce((a, d) => a + d.items.length, 0), 3);

// Takvim modu anahtarı ve gün seçimi bağlantıları yerinde olmalı.
assert.ok(source.includes('data-ymode="cal"'), "Takvim anahtarı eksik");
assert.ok(source.includes('settings.yearMode = ym.getAttribute("data-ymode")'), "Mod anahtarı kaydedilmiyor");
const clickHandler = between('view.addEventListener("click"', 'view.addEventListener("input"');
assert.ok(
  clickHandler.indexOf("[data-ymode]") < clickHandler.indexOf('btn.closest(".chip")'),
  "data-ymode, .chip filtresinden önce yakalanmalı (ymode düğmeleri de .chip sınıfında)."
);
assert.ok(clickHandler.includes('btn.hasAttribute("data-day")'), "Gün seçimi bağlantısı eksik");
assert.ok(source.includes('tab === "year" && settings.yearMode === "cal"'), "Takvimde ay kaydırma bağlı olmalı");

console.log("calendar: OK");