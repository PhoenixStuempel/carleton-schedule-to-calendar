/**
 * Measures every rendered grid block and reports clipping.
 *
 * Catches the case where a long course title wraps and pushes the room text
 * out of its block, which is invisible to unit tests and easy to miss by eye.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const path = normalize(join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '')));
    if (!path.startsWith(root)) throw new Error('outside root');
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': `${TYPES[extname(path)] || 'text/plain'}; charset=utf-8` }).end(body);
  } catch (err) {
    res.writeHead(404).end(String(err));
  }
});

await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 1100 } });
await page.goto(`http://127.0.0.1:${port}/extension/preview/preview.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('.week .block');

const report = await page.evaluate(() => {
  const rows = [];
  for (const block of document.querySelectorAll('.week .block')) {
    const box = block.getBoundingClientRect();
    const code = block.querySelector('.b-code');
    const title = block.querySelector('.b-title');
    const meta = block.querySelector('.b-meta');

    const contentBottom = meta
      ? meta.getBoundingClientRect().bottom
      : (title || code).getBoundingClientRect().bottom;

    // 5px of bottom padding is the design intent.
    const overflowPx = Math.round(contentBottom - (box.bottom - 5));

    rows.push({
      label: code?.textContent.trim(),
      heightPx: Math.round(box.height),
      titleLines: title ? Math.round(title.getBoundingClientRect().height / 15) : 0,
      roomVisible: meta ? getComputedStyle(meta).display !== 'none' : false,
      roomText: meta?.textContent.trim() || '',
      overflowPx,
      clipped: overflowPx > 0,
    });
  }
  return rows;
});

console.log('BLOCK FIT CHECK\n');
let bad = 0;
for (const r of report) {
  const status = r.clipped ? `CLIPPED by ${r.overflowPx}px` : 'ok';
  if (r.clipped) bad += 1;
  console.log(`  ${status.padEnd(18)} ${String(r.heightPx).padStart(3)}px  `
    + `${(r.label || '').padEnd(14)} room="${r.roomText.slice(0, 30)}"`);
}

console.log(bad ? `\n${bad} block(s) clipped.` : `\nAll ${report.length} blocks fit.`);

await browser.close();
server.close();
process.exit(bad ? 1 : 0);
