/**
 * Renders the two Carleton Central pages on the way to the schedule and marks
 * the link to click on each.
 *
 * These become the illustrated walkthrough in the help page. Saved pages are
 * used rather than the live site so this is reproducible without a login, and
 * so nobody's account is needed to regenerate the images.
 *
 *   node tools/shoot-howto.mjs
 *
 * Personal identifiers on the saved pages are blanked before the screenshot.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'extension', 'help', 'img');
mkdirSync(outDir, { recursive: true });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
    const path = normalize(join(root, rel));
    if (!path.startsWith(root)) throw new Error('outside root');
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': `${TYPES[extname(path)] || 'text/plain'}; charset=utf-8` });
    res.end(body);
  } catch (err) {
    res.writeHead(404).end(String(err));
  }
});

await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;

const SHOTS = [
  {
    file: 'Main Menu.html',
    out: 'step-timetable.png',
    // The Main Menu links straight to the timetable; no submenu needed.
    match: (text) => text.trim() === 'Student Timetable',
  },
  {
    file: 'Student Timetable.html',
    out: 'step-detail.png',
    match: (text) => text.trim() === 'Detail Schedule',
  },
  {
    // Detail Schedule asks which term first. No link to highlight here, so the
    // dropdown and its Submit button are framed instead.
    file: 'Registration Term.html',
    out: 'step-term.png',
    selector: 'select[name="term_in"]',
  },
];

const browser = await chromium.launch();

for (const shot of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(shot.file)}`,
    { waitUntil: 'domcontentloaded' });

  // Strip anything identifying before the pixels are captured. These images
  // ship inside the extension, so a name or student number here would be
  // published to every user.
  await page.evaluate(() => {
    // Banner prints "<student number> <full name>" as a bare text node inside
    // .staticheaders, so walk text nodes rather than elements. An element-only
    // pass misses it, and these images ship to every user.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const IDENTITY = /\b\d{9}\b\s*[A-Z][A-Za-z.'-]*(\s+[A-Z][A-Za-z.'-]*)*/;

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      let text = node.nodeValue || '';
      if (IDENTITY.test(text)) text = text.replace(IDENTITY, '000000000 Test Student');
      text = text.replace(/\b\d{9}\b/g, '000000000');
      text = text.replace(/Welcome\s+[^,]{2,60},/i, 'Welcome,');
      if (text !== node.nodeValue) node.nodeValue = text;
    }
  });

  // Fail loudly rather than publishing an image with a real identity in it.
  const leaked = await page.evaluate(() => {
    const body = document.body.innerText || '';
    const hit = body.match(/\b\d{9}\b/g) || [];
    return hit.filter((n) => n !== '000000000');
  });
  if (leaked.length) {
    throw new Error(`refusing to screenshot ${shot.file}: `
      + `found an unsanitized 9-digit number (${leaked[0]})`);
  }

  const box = await page.evaluate(({ matchSource, selector }) => {
    const target = selector
      ? document.querySelector(selector)
      : [...document.querySelectorAll('a')]
        .find((a) => new Function(`return (${matchSource})`)()(a.textContent || ''));
    if (!target) return null;

    target.scrollIntoView({ block: 'center' });
    target.style.outline = '3px solid #8C2F39';
    target.style.outlineOffset = '3px';
    target.style.background = '#F4E8D3';
    target.style.borderRadius = '2px';

    const r = target.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, { matchSource: shot.match?.toString(), selector: shot.selector });

  if (!box) {
    console.error(`  could not find the target in ${shot.file}`);
    await page.close();
    continue;
  }

  // Crop around the highlighted link so the screenshot shows the click target
  // in context rather than a full page of unrelated menu items. Anchored to
  // the left edge: these are left-aligned menus, and starting mid-sentence
  // hides which section the link sits under.
  // The term page needs more room below, so the Submit button is in frame.
  const below = shot.selector ? 150 : 110;
  const top = Math.max(0, box.y - 110);
  const clip = {
    x: 0,
    y: top,
    width: 1000,
    height: Math.min(760 - top, box.height + 110 + below),
  };

  await page.screenshot({ path: join(outDir, shot.out), clip });
  console.log(`  ${shot.out}`);
  await page.close();
}

await browser.close();
server.close();
console.log(`\nWrote to ${outDir}`);
