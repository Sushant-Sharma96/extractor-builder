// verify.js — Phase B: automated fidelity harness.
//
// For a Lovable URL it (1) measures the LIVE original, (2) generates the export
// via the real pipeline, (3) measures the export, and (4) asserts the export
// matches the original on structure / content / no-blank / counters / charts.
// Output is a pass/fail table so we can QA the whole corpus without eyeballing
// each page. This is the acceptance test for the animation reconstruction.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { captureSite } = require('./capture');
const { build } = require('./build');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Runs IN THE PAGE (live or export). Scrolls through to trigger view-animations,
// then returns comparable fidelity metrics.
/* istanbul ignore next */
async function pageMetrics() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vh = window.innerHeight;
  const H = () => document.documentElement.scrollHeight;
  const isDecor = (e) => e.getAttribute('aria-hidden') === 'true' || !!e.closest('[class*="group"]');

  // Scroll through once to trigger view-animations…
  for (let y = 0; y <= H(); y += Math.round(vh * 0.6)) { window.scrollTo(0, y); await sleep(250); }
  window.scrollTo(0, 0); await sleep(400);
  // …then scan the WHOLE DOM (not just what the scroll happened to sample) for
  // content elements still at opacity 0. Missing this is how a stuck-hidden
  // section slips a QA pass — so the scan must be exhaustive.
  const suspects = [].slice.call(document.querySelectorAll('h1,h2,h3,h4,p,span,a,li,img,button,div,svg')).filter((e) => {
    const c = getComputedStyle(e); const r = e.getBoundingClientRect();
    return c.opacity === '0' && r.width > 2 && r.height > 2 && !isDecor(e) && ((e.textContent || '').trim() || e.tagName === 'IMG' || e.tagName.toLowerCase() === 'svg');
  }).slice(0, 60);
  // Real blank = still hidden AFTER settling in view, double-confirmed (so an
  // element merely mid-animation with a long delay isn't miscounted as broken).
  let realBlank = 0;
  for (const e of suspects) {
    try {
      e.scrollIntoView({ block: 'center' }); await sleep(1000);
      const c = getComputedStyle(e);
      // Ignore elements mid-reveal (a keyframe animation is applied) — they'll settle.
      if (c.opacity !== '0' || c.animationName !== 'none') continue;
      await sleep(600);
      const c2 = getComputedStyle(e);
      if (c2.opacity === '0' && c2.animationName === 'none') realBlank++;
    } catch (err) {}
  }

  // Count-up numbers: read each AFTER scrolling into view + settle (values are
  // animated/transient, so a quick snapshot is unreliable on live AND export).
  const bigCands = [].slice.call(document.querySelectorAll('*')).filter((e) => {
    const only = e.childNodes.length === 1 && e.firstChild && e.firstChild.nodeType === 3;
    return only && /^[0-9][0-9,.]*\+?%?$/.test((e.textContent || '').trim()) && parseFloat(getComputedStyle(e).fontSize) >= 20;
  });
  const bigNumbers = [];
  for (const e of bigCands) { try { e.scrollIntoView({ block: 'center' }); await sleep(1300); bigNumbers.push((e.textContent || '').trim()); } catch (err) {} }
  bigNumbers.sort();

  // SVG line/ring draws: dash pattern drawn >50%.
  const drawnPaths = [].slice.call(document.querySelectorAll('path,circle,line')).filter((c) => {
    const s = getComputedStyle(c); const da = parseFloat(s.strokeDasharray); const doff = parseFloat(s.strokeDashoffset);
    return da > 20 && !isNaN(doff) && doff < da * 0.5;
  }).length;

  return {
    sectionCount: document.querySelectorAll('section,header,footer').length,
    bodyChars: (document.body.innerText || '').trim().length,
    bigNumbers, drawnPaths, maxBlankInView: realBlank,
  };
}

async function measure(browser, url) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 900));
  const m = await page.evaluate(pageMetrics);
  await page.close();
  return m;
}

async function verify(url) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let live, exp, err = null;
  try {
    live = await measure(browser, url);
    const model = await captureSite(url);
    const r = build(model);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etverify-'));
    fs.writeFileSync(path.join(dir, 'index.html'), r.html);
    fs.writeFileSync(path.join(dir, 'styles.css'), r.css);
    fs.writeFileSync(path.join(dir, 'script.js'), r.js);
    const fileUrl = 'file:///' + path.join(dir, 'index.html').replace(/\\/g, '/');
    exp = await measure(browser, fileUrl);
  } catch (e) { err = e.message; }
  finally { await browser.close(); }
  if (err) return { url, error: err, pass: false, checks: [] };

  // Counters/charts on Lovable dashboards are often one-shot or looping, so a
  // live SNAPSHOT is transient (unreliable to match exactly). The meaningful,
  // achievable bar: the export baked a non-zero final (the count-up/draw was
  // captured, not frozen at 0). Live values are logged for context only.
  const num = (s) => parseFloat(String(s).replace(/[^\d.]/g, '')) || 0;
  const countersOk = exp.bigNumbers.length === 0 || exp.bigNumbers.every((n) => num(n) > 0);
  const checks = [
    ['structure', Math.abs(exp.sectionCount - live.sectionCount) <= Math.max(2, Math.round(live.sectionCount * 0.2)), `${exp.sectionCount} vs ${live.sectionCount}`],
    ['content',   exp.bodyChars >= live.bodyChars * 0.85, `${exp.bodyChars} vs ${live.bodyChars}`],
    ['no-blank',  exp.maxBlankInView === 0, `${exp.maxBlankInView} hidden`],
    ['counters',  countersOk, `export ${JSON.stringify(exp.bigNumbers)} (live ${JSON.stringify(live.bigNumbers)})`],
    ['charts',    exp.drawnPaths >= Math.floor(live.drawnPaths * 0.8), `${exp.drawnPaths} vs ${live.drawnPaths} drawn`],
  ];
  return { url, live, exp, checks, pass: checks.every((c) => c[1]) };
}

module.exports = { verify };

// CLI: node server/verify.js <url> [url2 ...]
if (require.main === module) {
  (async () => {
    const urls = process.argv.slice(2);
    const results = [];
    for (const u of urls) {
      process.stderr.write(`\nverifying ${u} …\n`);
      try { results.push(await verify(u)); }
      catch (e) { results.push({ url: u, error: e.message, pass: false, checks: [] }); }
    }
    console.log('\n================= FIDELITY REPORT =================');
    for (const r of results) {
      const short = r.url.replace(/^https?:\/\//, '').replace(/\.lovable\.app.*/, '');
      console.log(`\n${r.pass ? 'PASS' : 'FAIL'}  ${short}`);
      if (r.error) { console.log(`      error: ${r.error}`); continue; }
      for (const [name, ok, detail] of r.checks) console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(10)} ${detail}`);
    }
    console.log('\n==================================================');
  })();
}
