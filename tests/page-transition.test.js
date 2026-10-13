const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("index.html", "utf8");
const transitionCss = source.slice(
  source.indexOf("/* === Sekme / ay geçişi === */"),
  source.indexOf("/* === Fatura türü çipleri + detay kutusu === */")
);

assert.ok(transitionCss.includes(".view{view-transition-name:page"));
// Tarayıcının varsayılan grup animasyonu, grup kutusunun yuksekligini ve dikey
// konumunu eski/yeni anlik goruntu arasinda morph'lar. Bu, yatay kaydirmali
// sekme gecisine dikey "kayma" bindiriyordu (olculdu: 291px, %123 yukseklik).
assert.ok(
  transitionCss.includes("::view-transition-group(page){animation:none}"),
  "Page-height / scroll-position changes must not get the browser's default geometry animation."
);
assert.ok(transitionCss.includes("::view-transition-old(page){animation:vtOut"));
assert.ok(transitionCss.includes("::view-transition-new(page){animation:vtIn"));

// .monthbar'in 14px us boslugu .view disina tasmamali; aksi halde Odemeler
// sekmesinde .view 86px, diger sekmelerde 72px'ten basliyor ve grup 14px kayiyor.
assert.ok(
  transitionCss.includes("display:flow-root"),
  ".view must contain the month bar's top margin so every tab starts at the same y."
);

assert.ok(source.includes(".no-rise .pay,.no-rise .soon-row{animation:none!important}"));

// Kaydirma, startViewTransition eski anlik goruntuyu yakalamadan ONCE
// sifirlanmali. Callback icinde kalirsa eski goruntü kaydirmali konumdan
// yukaridan asagiya kayar.
const navHandler = source.slice(
  source.indexOf('document.getElementById("navbar").addEventListener'),
  source.indexOf('document.getElementById("fab").addEventListener')
);
const scrollIdx = navHandler.indexOf("window.scrollTo(0, 0);");
const goIdx = navHandler.indexOf("go(function()");
assert.ok(scrollIdx !== -1 && goIdx !== -1, "Tab switch must still reset scroll and use go().");
assert.ok(
  scrollIdx < goIdx,
  "window.scrollTo must run before go()/startViewTransition captures the old snapshot."
);
assert.ok(
  !/go\(function\(\)\{[^}]*window\.scrollTo/.test(navHandler),
  "Scroll reset must not stay inside the view-transition callback."
);

console.log("Page transition CSS: OK");