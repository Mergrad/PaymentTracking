const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("index.html", "utf8");
const transitionCss = source.slice(
  source.indexOf("/* === Sekme / ay geçişi === */"),
  source.indexOf("/* === Fatura türü çipleri + detay kutusu === */")
);

assert.ok(transitionCss.includes(".view{view-transition-name:page}"));
assert.ok(
  transitionCss.includes("::view-transition-group(page){animation:none}"),
  "Page-height changes must not receive the browser's default geometry animation."
);
assert.ok(transitionCss.includes("::view-transition-old(page){animation:vtOut"));
assert.ok(transitionCss.includes("::view-transition-new(page){animation:vtIn"));

console.log("Page transition CSS: OK");
