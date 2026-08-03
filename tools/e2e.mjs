/**
 * End-to-end check: loads the built extension into real Chrome, serves a copy
 * of the Carleton schedule page, drives the popup, and confirms a valid .ics
 * comes out the other end.
 *
 * This is the check that matters, because unit tests pass on code that Chrome may
 * still refuse to load (bad manifest, escaping imports, CSP violations).
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';

import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

// Rebuild with localhost granted so the harness can drive the real
// executeScript path against a served copy of the fixture.
execFileSync(process.execPath, [join(root, 'tools/build.mjs'), '--test-origins'], { stdio: 'inherit' });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.gif': 'image/gif',
};

// Serve the sanitized fixture at a path shaped like the real Banner URL.
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(req.url.split('?')[0]);
    if (path.startsWith('/prod/bwskfshd')) {
      const html = await readFile(join(root, 'tests/fixtures/banner8-detail-schedule.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      return;
    }
    const file = normalize(join(root, path.replace(/^\//, '')));
    if (!file.startsWith(root)) throw new Error('outside root');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': `${TYPES[extname(file)] || 'text/plain'}; charset=utf-8` }).end(body);
  } catch (err) {
    res.writeHead(404).end(String(err));
  }
});

// Fixed port: Chrome host permissions are matched per-origin including port,
// so a random port would not match the pattern granted in the test build.
const PORT = 8731;
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, '127.0.0.1', resolve);
});
const scheduleUrl = `http://127.0.0.1:${PORT}/prod/bwskfshd.P_CrseSchdDetl`;

const profile = await mkdtemp(join(tmpdir(), 'carleton-ext-'));
const downloads = await mkdtemp(join(tmpdir(), 'carleton-dl-'));

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

console.log('=== END-TO-END: real Chrome, built extension ===\n');

const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: false, // extensions do not load in headless mode
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  acceptDownloads: true,
  downloadsPath: downloads,
});

try {
  // Wait for the service worker or any extension page to reveal the ID.
  let extensionId = null;
  for (let i = 0; i < 40 && !extensionId; i += 1) {
    const target = context.serviceWorkers()[0] || context.backgroundPages()[0];
    if (target) extensionId = new URL(target.url()).host;
    if (!extensionId) {
      const probe = await context.newPage();
      await probe.goto('chrome://extensions/');
      extensionId = await probe.evaluate(() => {
        const manager = document.querySelector('extensions-manager');
        const list = manager?.shadowRoot?.querySelector('extensions-item-list');
        const item = list?.shadowRoot?.querySelector('extensions-item');
        return item?.getAttribute('id') || null;
      }).catch(() => null);
      await probe.close();
    }
    if (!extensionId) await new Promise((r) => setTimeout(r, 250));
  }

  check('extension loads in Chrome', Boolean(extensionId), extensionId || 'no id found');
  if (!extensionId) throw new Error('extension did not load');

  // --- popup on the schedule page -----------------------------------------
  const page = await context.newPage();
  await page.goto(scheduleUrl, { waitUntil: 'domcontentloaded' });

  const popup = await context.newPage();
  const popupErrors = [];
  popup.on('pageerror', (e) => popupErrors.push(String(e)));
  popup.on('console', (m) => { if (m.type() === 'error') popupErrors.push(m.text()); });

  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  // Exercise the REAL scrape path: chrome.scripting.executeScript against the
  // schedule tab, exactly as the popup does on click. The extension page has
  // no host permission for the test origin (by design, since it never fetches),
  // so pulling the HTML via fetch here would test the wrong thing.
  // With a host permission granted for the served origin, query() returns
  // that tab's URL. Extension pages stay redacted, which is the tell.
  const targetTabId = await popup.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((t) => (t.url || '').startsWith(url));
    return match ? match.id : null;
  }, `http://127.0.0.1:${PORT}/`);

  check('popup can see the schedule tab', targetTabId !== null,
    targetTabId === null ? 'no tab matched the served origin' : `tab ${targetTabId}`);

  const scraped = await popup.evaluate(async (tabId) => {
    if (!tabId) return { error: 'no target tab' };

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const tables = [...document.querySelectorAll('table.datadisplaytable')];
        if (!tables.length) return { ok: false, reason: 'NO_SCHEDULE_TABLES' };
        return { ok: true, html: document.documentElement.outerHTML };
      },
    });

    if (!injection?.result?.ok) return { error: injection?.result?.reason || 'injection failed' };

    const { parseDetailScheduleHtml } = await import('../lib/parser/banner8.js');
    const parsed = parseDetailScheduleHtml(injection.result.html);
    parsed.header = { term: parsed.header.term, studentName: null, studentNumber: null };
    await chrome.storage.session.set({ scrapeResult: parsed });

    return { courses: parsed.courses.length, term: parsed.header.term };
  }, targetTabId);

  check('executeScript injects into the schedule tab', !scraped.error,
    scraped.error ? `${scraped.error} ${JSON.stringify(scraped.seen || '')}` : 'ok');

  check('popup parses the schedule page', scraped.courses === 7, `${scraped.courses} courses`);
  check('popup reads the term', /Fall 2026/.test(scraped.term || ''), scraped.term);
  check('popup has no console errors', popupErrors.length === 0, popupErrors.join('; '));

  // The term dropdown is the escape hatch for Carleton Central remembering the
  // last term. Its option values must be labels the term data actually knows,
  // or selecting one silently opens a term with no holidays excluded.
  const picker = await popup.evaluate(async () => {
    const { TERMS, scheduleUrlFor } = await import('../lib/calendar/carleton-terms.js');
    const labels = Object.values(TERMS).map((t) => t.label);
    return {
      count: labels.length,
      urls: labels.map((l) => scheduleUrlFor(l)),
    };
  });

  // Stage detection drives the whole stay-open flow. Run it in Chrome against
  // the served schedule page, so a DOMParser or module-loading problem shows
  // up here rather than as a popup stuck on "getting started".
  const stage = await popup.evaluate(async (tabUrl) => {
    const { detectStage, STAGE } = await import('../lib/page-stage.js');
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((t) => (t.url || '').startsWith(tabUrl));

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: match.id },
      func: () => document.documentElement.outerHTML,
    });
    const doc = new DOMParser().parseFromString(injection.result, 'text/html');
    return { got: detectStage(doc), want: STAGE.SCHEDULE };
  }, `http://127.0.0.1:${PORT}/`);

  check('popup detects the schedule stage in Chrome', stage.got === stage.want,
    `got ${stage.got}`);

  check('term switcher covers every bundled term', picker.count === 5, `${picker.count} terms`);
  check('term switcher pins each term in the URL',
    picker.urls.every((u) => /[?]term_in=\d{6}$/.test(u)),
    picker.urls.find((u) => !/[?]term_in=\d{6}$/.test(u)) || 'all pinned');

  // --- preview tab reads the handoff --------------------------------------
  const preview = await context.newPage();
  const previewErrors = [];
  preview.on('pageerror', (e) => previewErrors.push(String(e)));
  preview.on('console', (m) => { if (m.type() === 'error') previewErrors.push(m.text()); });

  await preview.goto(`chrome-extension://${extensionId}/preview/preview.html`);
  await preview.waitForSelector('.week .block', { timeout: 15_000 });

  const rendered = await preview.evaluate(() => {
    const texts = [...document.querySelectorAll('.notice')]
      .map((n) => n.textContent.replace(/\s+/g, ' ').trim());

    return {
      blocks: document.querySelectorAll('.week .block').length,
      entries: document.querySelectorAll('.entry').length,
      notices: texts.length,
      // The five Dec 11 flags must collapse to one "extra class" line and one
      // "no class" line. Counting all notices would also sweep in the tight-gap
      // warnings, which are a separate feature.
      swapNotices: texts.filter((t) => t.includes('December 11')).length,
      gapNotices: texts.filter((t) => t.includes('tight gap')).length,
      title: document.getElementById('term-title').textContent,
      hasSample: document.body.innerHTML.includes('sample-parsed'),
    };
  });

  check('preview renders the week grid', rendered.blocks === 12, `${rendered.blocks} blocks`);
  check('preview lists every section', rendered.entries === 7, `${rendered.entries} entries`);
  check('preview groups 5 Dec 11 flags into 2 notices', rendered.swapNotices === 2,
    `${rendered.swapNotices} Dec 11 notices of ${rendered.notices} total`);
  check('preview warns about both tight building gaps', rendered.gapNotices === 2,
    `${rendered.gapNotices} tight-gap notices`);
  check('preview reads data from storage, not the sample', !rendered.hasSample);
  check('preview has no console errors', previewErrors.length === 0, previewErrors.join('; '));

  // --- help page -----------------------------------------------------------
  // The walkthrough images are the whole point of that page, and a broken path
  // would render as empty boxes rather than failing loudly.
  const help = await context.newPage();
  const helpErrors = [];
  help.on('pageerror', (e) => helpErrors.push(String(e)));
  await help.goto(`chrome-extension://${extensionId}/help/help.html`);

  const helpState = await help.evaluate(() => ({
    steps: document.querySelectorAll('.steps > li').length,
    images: [...document.images].length,
    broken: [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')),
  }));

  check('help page walks through every step', helpState.steps === 3, `${helpState.steps} steps`);
  check('help page screenshots all load', helpState.broken.length === 0,
    helpState.broken.join(', ') || `${helpState.images} images`);
  check('help page has no console errors', helpErrors.length === 0, helpErrors.join('; '));
  await help.close();

  // --- export --------------------------------------------------------------
  const download = preview.waitForEvent('download', { timeout: 15_000 });
  await preview.click('#export');
  const file = await download;
  const saved = join(downloads, file.suggestedFilename());
  await file.saveAs(saved);

  const ics = await readFile(saved, 'utf8');
  check('download fires', Boolean(file.suggestedFilename()), file.suggestedFilename());
  // 7 weekly series + 2 standalone Dec 11 makeup classes.
  check('ics has all 9 events', (ics.match(/BEGIN:VEVENT/g) || []).length === 9);
  check('ics embeds VTIMEZONE', ics.includes('BEGIN:VTIMEZONE') && ics.includes('TZID:America/Toronto'));
  check('ics excludes Thanksgiving', ics.includes('EXDATE;TZID=America/Toronto:20261012'));
  check('ics adds the Dec 11 Monday class as a standalone event',
    ics.includes('DTSTART;TZID=America/Toronto:20261211'));
  check('ics avoids RDATE, which Apple Calendar ignores', !ics.includes('RDATE'));
  check('ics UNTIL uses the EST offset', ics.includes('UNTIL=20261211T150500Z') || ics.includes('UNTIL=20261211T'));
  check('ics keeps the accented building name', ics.includes('Nideyin'));
  check('ics uses CRLF endings', ics.includes('\r\n') && !/[^\r]\n/.test(ics));

  console.log(`\n  .ics saved at ${saved} (${ics.length} bytes)`);
} finally {
  await context.close();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(failures.length
  ? `\n${failures.length} CHECK(S) FAILED:\n  - ${failures.join('\n  - ')}`
  : '\nALL END-TO-END CHECKS PASSED.');
process.exit(failures.length ? 1 : 0);
