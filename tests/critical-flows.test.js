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

function context(extra) {
  const ctx = Object.assign({ console, setTimeout, clearTimeout, Date, Promise }, extra);
  vm.createContext(ctx);
  return ctx;
}

function run(ctx, code) {
  vm.runInContext(code, ctx);
}

const amountAndDate = between("function parseAmount", "function compactTL");
const validator = between("function validateImportedPayments", "function importJSON");

async function testAmountsAndImports() {
  const ctx = context({ CATS: { fatura: {} } });
  run(ctx, amountAndDate + validator + "this.parseAmount = parseAmount; this.validate = validateImportedPayments;");

  [["1250", 1250], ["1250,50", 1250.5], ["1.250,50", 1250.5], ["1250.50", 1250.5]].forEach(([input, expected]) => {
    assert.strictEqual(ctx.parseAmount(input), expected);
  });
  ["", "-1", "metin", "12,345"].forEach((input) => assert.ok(Number.isNaN(ctx.parseAmount(input))));

  const valid = { version: 1, payments: [{ id: 1, cat: "fatura", amount: "1.250,50", due: "2026-02-28", status: "wait", note: "Elektrik", sub: "elektrik", repeat: "monthly" }] };
  assert.strictEqual(ctx.validate(valid)[0].amount, 1250.5);
  [
    { version: 2, payments: [] },
    { version: 1, payments: [{ cat: "fatura", amount: 10, due: "2026-02-30", status: "wait", repeat: "once" }] },
    { version: 1, payments: [{ cat: "fatura", amount: 0, due: "2026-02-28", status: "wait", repeat: "once" }] }
  ].forEach((backup) => assert.throws(() => ctx.validate(backup)));
}

async function testStorageAndMigration() {
  const stored = [{ id: 7, cat: "fatura", amount: 100, due: "2026-03-01", status: "wait", repeat: "once" }];
  const data = { "odeme-takip-v1": JSON.stringify({ version: 1, payments: stored, seeded: false }) };
  let mergeCalls = 0;
  const ctx = context({
    localStorage: { getItem: (key) => data[key] || null, setItem: (key, value) => { data[key] = value; } },
    toast: () => {}, applyOverdue: () => {}, mergeHistoricalData: () => { mergeCalls += 1; return Promise.resolve(); }
  });
  run(ctx, "var KEY='odeme-takip-v1'; var payments=[];" + between("function save", "function load") + between("function load", "/* ---------- Harici başlangıç verileri ---------- */") + "this.getPayments=()=>payments; this.save=save; this.load=load;");
  await ctx.load();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.getPayments())), stored);
  assert.strictEqual(mergeCalls, 0);

  let warning = "";
  const failing = context({ localStorage: { setItem: () => { throw new Error("quota"); } }, toast: (message) => { warning = message; } });
  run(failing, "var KEY='odeme-takip-v1'; var payments=[];" + between("function save", "function load") + "this.save=save;");
  assert.strictEqual(failing.save(), false);
  assert.match(warning, /kaydedilemedi/);
}

async function testImportTransaction() {
  const old = [{ id: 9, cat: "fatura", amount: 99, due: "2026-01-01", status: "wait", note: "Eski", sub: "su", repeat: "once" }];
  let fileText = "{";
  const local = {};
  function FileReader() { this.readAsText = () => { this.result = fileText; this.onload(); }; }
  const ctx = context({
    CATS: { fatura: {} }, localStorage: { getItem: () => null, setItem: (key, value) => { local[key] = value; } }, FileReader,
    confirm: () => true, saveBackupSnapshot: () => Promise.resolve(), applyOverdue: () => {}, render: () => {}, closeSheet: () => {}, toast: () => {}, Sound: { play: () => {} }
  });
  run(ctx, "var KEY='odeme-takip-v1'; var payments=" + JSON.stringify(old) + ";" + amountAndDate + between("function save", "function load") + validator + between("function importJSON", "/* ---------- Backup ---------- */") + "this.importJSON=importJSON; this.getPayments=()=>payments;");
  ctx.Sound = { play: () => {} };
  ctx.importJSON({});
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.getPayments())), old);

  fileText = JSON.stringify({ version: 1, payments: [{ id: 10, cat: "fatura", amount: 12.5, due: "2026-03-02", status: "wait", note: "Yeni", sub: "elektrik", repeat: "monthly" }] });
  ctx.importJSON({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(ctx.getPayments()[0].note, "Yeni");
  assert.ok(local["odeme-takip-v1"]);
}

async function testMonthlyRepeats() {
  let renders = 0;
  const ctx = context({
    Sound: { play: () => {} }, toast: () => {}, save: () => true, render: () => { renders += 1; }, todayMid: () => new Date(2026, 0, 1), CATS: { fatura: { label: "Fatura" } }, confirm: () => true, tl: () => "", dayLabel: () => ""
  });
  run(ctx, "var payments=[{id:1,cat:'fatura',amount:250.5,due:'2026-01-31',status:'wait',note:'Elektrik',sub:'elektrik',repeat:'monthly'}]; function byId(id){return payments.find(function(p){return p.id===id;});}" + between("function pad", "function parseISO") + between("function parseISO", "function dayLabel") + between("function nextMonthDue", "/* ---------- Events ---------- */") + "this.handleAction=handleAction; this.getPayments=()=>payments; this.nextMonthDue=nextMonthDue;");
  assert.strictEqual(ctx.nextMonthDue("2026-01-31"), "2026-02-28");
  assert.strictEqual(ctx.nextMonthDue("2026-02-28"), "2026-03-28"); // anchor yoksa eski davranış (gün kırpılır)
  assert.strictEqual(ctx.nextMonthDue("2026-02-28", 31), "2026-03-31"); // anchor: 31'i vadesi olan ödeme uzun aya geri döner
  ctx.handleAction("pay", 1);
  ctx.handleAction("pay", 1);
  const payments = ctx.getPayments();
  assert.strictEqual(payments.length, 2);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(payments[1])), { id: payments[1].id, cat: "fatura", amount: 250.5, due: "2026-02-28", status: "wait", note: "Elektrik", sub: "elektrik", repeat: "monthly", dueDay: 31, autoFrom: 1 });
  assert.strictEqual(renders, 2);
  // Geri al: otomatik oluşturulan sonraki ay kopyası da kalkmalı (tek kayıt kalır).
  ctx.handleAction("undo", 1);
  assert.strictEqual(ctx.getPayments().length, 1);
}

(async () => {
  await testAmountsAndImports();
  await testStorageAndMigration();
  await testImportTransaction();
  await testMonthlyRepeats();
  console.log("critical flows: OK");
})().catch((error) => { console.error(error); process.exitCode = 1; });
