/**
 * Assembles the loadable extension into dist/.
 *
 * Not a bundler, just a copy. Chrome cannot resolve ES-module imports that escape
 * the extension root (../../src/...), so shared modules are copied in beside
 * the extension code and the import paths are rewritten to match.
 *
 * Output stays readable, unminified ES modules: minified code is itself a
 * Chrome Web Store review trigger, and this is easier to debug.
 */

import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Extension shell, minus dev-only sample data.
cpSync(join(root, 'extension'), dist, { recursive: true });

// Shared logic lives beside it, so imports never leave the extension root.
cpSync(join(root, 'src'), join(dist, 'lib'), { recursive: true });

/** Rewrites ../../src/x -> ../lib/x (or ./lib/x) for each file's depth. */
function rewriteImports(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      rewriteImports(path);
      continue;
    }
    if (!path.endsWith('.js')) continue;

    const depth = relative(dist, dirname(path)).split(/[\\/]/).filter(Boolean).length;
    const prefix = depth === 0 ? './' : '../'.repeat(depth);

    const source = readFileSync(path, 'utf8');
    const rewritten = source.replace(
      /(['"])(?:\.\.\/)+src\/([^'"]+)\1/g,
      (_match, quote, rest) => `${quote}${prefix}lib/${rest}${quote}`,
    );

    if (rewritten !== source) {
      writeFileSync(path, rewritten);
      console.log(`  rewrote imports in ${relative(dist, path)}`);
    }
  }
}

console.log('Building dist/');
rewriteImports(dist);

// sample-parsed.json is a dev convenience for rendering the page standalone;
// shipping it would mean the preview silently falls back to fake data if the
// real scrape were ever missing. Better to show the empty state.
rmSync(join(dist, 'preview', 'sample-parsed.json'), { force: true });

// The Google and Microsoft providers are written and tested but not wired to
// anything, so nothing in the extension imports them. Shipping unreachable
// code that talks about OAuth and Graph scopes invites reviewer questions the
// extension cannot answer, since it makes no network requests at all.
for (const unwired of ['google-provider.js', 'microsoft-provider.js']) {
  rmSync(join(dist, 'lib', 'providers', unwired), { force: true });
}

const manifestPath = join(dist, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// Chrome rejects the upload on these, so catch them at build time rather than
// after a failed submission.
const LIMITS = { name: 75, description: 132, version: 20 };
const tooLong = Object.entries(LIMITS)
  .filter(([field, max]) => (manifest[field] || '').length > max)
  .map(([field, max]) => `  ${field}: ${manifest[field].length} chars, max ${max}`);

if (tooLong.length) {
  console.error('\nManifest field(s) over Chrome\'s limit:');
  console.error(tooLong.join('\n'));
  console.error('\nFix extension/manifest.json and rebuild.');
  process.exit(1);
}

// The e2e harness serves the fixture from localhost. Granting that origin only
// under an explicit flag keeps it out of every shipped build.
if (process.argv.includes('--test-origins')) {
  // Port must be explicit: Chrome matches host permissions per-origin,
  // and the e2e server binds this fixed port.
  manifest.host_permissions = [...manifest.host_permissions, 'http://127.0.0.1:8731/*'];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('  added localhost host permissions (TEST BUILD, do not ship)');
}

console.log(`\n${manifest.name} v${manifest.version}`);
console.log(`Permissions: ${manifest.permissions.join(', ')}`);
console.log(`Host permissions: ${manifest.host_permissions.join(', ')}`);
console.log(`\nLoad unpacked from: ${dist}`);
