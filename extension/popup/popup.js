/**
 * Popup: detects the schedule page, scrapes it, hands off to the preview tab.
 *
 * Uses chrome.scripting.executeScript rather than a declared content script:
 * a tab that has been open since before the extension was installed has no
 * content script in it, and messaging one fails with a confusing
 * "Could not establish connection" error. Injecting on demand cannot hit that.
 */

import { STAGE, detectStage } from '../../src/page-stage.js';
import { TERMS, scheduleUrlFor, bannerTermCode } from '../../src/calendar/carleton-terms.js';

const CARLETON_HOST = /(^|\.)carleton\.ca$/i;

/**
 * How to reach the schedule by hand.
 *
 * "Open my schedule" jumps straight there, but it lands on the login page if
 * the session has expired, and Detail Schedule is buried far enough in Carleton
 * Central that people do not find it on their own. Both routes are offered.
 */
const HOW_TO_STEPS = `
  <ol class="steps">
    <li>Log in to <b>Carleton Central</b></li>
    <li>Hit <b>Open my schedule</b> below</li>
    <li>Pick your term and click <b>Submit</b></li>
  </ol>
  <div class="note">Leave this open. It follows along and picks up your
  classes on its own.</div>`;

const $ = (id) => document.getElementById(id);

const ui = {
  title: (text) => { $('title').textContent = text; },
  subtitle: (text) => { $('subtitle').textContent = text || ''; },
  detail: (html) => { $('detail').innerHTML = html; },
  status: (text, isError = false) => {
    $('status').textContent = text || '';
    $('status').className = `status${isError ? ' error' : ''}`;
  },
  actions: (buttons) => {
    const host = $('actions');
    host.innerHTML = '';
    for (const { label, onClick, ghost, disabled } of buttons) {
      const button = document.createElement('button');
      button.textContent = label;
      if (ghost) button.className = 'ghost';
      if (disabled) button.disabled = true;
      button.addEventListener('click', onClick);
      host.appendChild(button);
    }
  },
};

/**
 * Runs INSIDE the page. Serialized by executeScript, so it must be fully
 * self-contained: no imports, no closure over anything out here.
 *
 * Returns a tagged result object rather than throwing: Chrome does not
 * populate InjectionResult.error, so a thrown exception surfaces as an
 * unhelpful undefined.
 */
function scrapePage() {
  try {
    // A timed-out Banner session returns HTTP 200 with a redirect stub, so
    // detect it from the body rather than the status code.
    const bodyText = document.body?.innerText || '';
    if (/twbkwbis\.p_idm_logout|user id.*pin|please log ?in/i.test(bodyText)
        && !document.querySelector('table.datadisplaytable')) {
      return { ok: false, reason: 'SESSION_EXPIRED' };
    }

    const tables = [...document.querySelectorAll('table.datadisplaytable')];
    if (!tables.length) return { ok: false, reason: 'NO_SCHEDULE_TABLES' };
    if (!tables.some((t) => t.querySelector('th.ddtitle'))) {
      return { ok: false, reason: 'NO_COURSES' };
    }

    // Hand back raw HTML; parsing happens in the extension where it is tested.
    return {
      ok: true,
      html: document.documentElement.outerHTML,
      url: location.href,
      title: document.title,
    };
  } catch (error) {
    return { ok: false, reason: 'SCRAPE_FAILED', message: String(error) };
  }
}

const FAILURES = {
  SESSION_EXPIRED: {
    title: 'Session timed out',
    detail: 'Carleton Central logs out after a few minutes of inactivity. '
      + 'Log back in and open your schedule again.',
  },
  NO_SCHEDULE_TABLES: {
    title: 'Not a schedule page',
    detail: 'This is Carleton Central, but not the schedule itself.'
      + HOW_TO_STEPS,
  },
  NO_COURSES: {
    title: 'No classes found',
    detail: 'The page loaded but had no courses on it. Carleton Central keeps '
      + 'showing whichever term you picked last, so this is usually the wrong '
      + 'term rather than an empty schedule.',
  },
  SCRAPE_FAILED: {
    title: "Couldn't read the page",
    detail: 'Something went wrong reading the schedule.',
  },
};

/**
 * Opens Detail Schedule in the current tab, optionally pinned to a term, and
 * keeps the popup open so it can pick up wherever the user lands.
 *
 * Carleton Central stores the chosen term server-side, so returning to Detail
 * Schedule serves that term again and never shows the picker. Short of logging
 * out there is no visible way back, which strands anyone wanting a different
 * term. Passing ?term_in= sidesteps the stored value, which is how Banner's
 * own timetable links to a specific term.
 */
async function openSchedulePage(tab, termLabel) {
  ui.title('Opening your schedule…');
  ui.subtitle('');
  ui.detail('<div class="skeleton"><i></i><i></i><i></i></div>');
  ui.actions([]);
  ui.status('');

  try {
    await navigateAndWait(tab.id, scheduleUrlFor(termLabel));
  } catch (error) {
    showFailure('SCRAPE_FAILED', tab, String(error));
    return;
  }

  await inspectTab(tab);
}

/**
 * Navigates a tab and resolves once it has finished loading.
 *
 * chrome.tabs.update resolves when navigation *starts*, so scraping straight
 * after would read the old page. onUpdated is the reliable signal; the timeout
 * keeps a hung load from leaving the popup on a spinner forever.
 */
function navigateAndWait(tabId, url, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const done = (error) => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };

    const listener = (changedId, info) => {
      if (changedId === tabId && info.status === 'complete') done();
    };

    const timer = setTimeout(() => done(new Error('the page took too long to load')), timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch(done);
  });
}

/**
 * Opens the walkthrough in a background tab.
 *
 * Not focused, so the popup survives. Chrome dismisses a popup when focus
 * moves to another tab, and losing your place mid-flow is the friction this
 * whole screen exists to avoid.
 */
async function openHelp() {
  await chrome.tabs.create({
    url: chrome.runtime.getURL('help/help.html'),
    active: false,
  });
  ui.status('Opened the walkthrough in a new tab.');
}

/** "Open my schedule" plus the illustrated walkthrough, in that order. */
function lostActions(tab) {
  return [
    { label: 'Open my schedule', onClick: () => openSchedulePage(tab) },
    { label: 'Show me how', ghost: true, onClick: openHelp },
  ];
}

/**
 * Reads the schedule tab and stores the result for the preview.
 *
 * Returns the parsed schedule, or null after showing the reason it failed.
 * Shared by the normal flow and the one-click export so both handle a lapsed
 * session and an empty term the same way.
 */
async function scrapeInto(tab) {
  let injection;
  try {
    [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapePage,
    });
  } catch (error) {
    // Usually activeTab not granted, or a restricted page.
    await showFailure('SCRAPE_FAILED', tab, String(error));
    return null;
  }

  const result = injection?.result;
  if (!result?.ok) {
    await showFailure(result?.reason || 'SCRAPE_FAILED', tab, result?.message);
    return null;
  }

  // Parse in the extension context, where the parser is tested.
  const { parseDetailScheduleHtml } = await import('../../src/parser/banner8.js');
  const parsed = parseDetailScheduleHtml(result.html);

  if (!parsed.isSchedulePage || !parsed.courses.length) {
    await showFailure('NO_COURSES', tab);
    return null;
  }

  // Drop student identity before storing; nothing downstream needs it.
  parsed.header = { term: parsed.header.term, studentName: null, studentNumber: null };
  await chrome.storage.session.set({ scrapeResult: parsed, scrapedAt: Date.now() });

  return parsed;
}

async function runScrape(tab) {
  ui.title('Reading your schedule…');
  ui.subtitle('');
  ui.detail('<div class="skeleton"><i></i><i></i><i></i></div>');
  ui.actions([]);
  ui.status('');

  const parsed = await scrapeInto(tab);
  if (parsed) await showFound(parsed, tab);
}

async function showFound(parsed, tab) {
  const meetings = parsed.courses.flatMap((c) => c.meetings);
  const schedulable = meetings.filter((m) => m.isSchedulable).length;
  const courses = new Set(parsed.courses.map((c) => c.courseCode)).size;

  ui.title(parsed.header.term?.replace(/\s*\(.*\)$/, '') || 'Schedule found');
  ui.subtitle(parsed.header.term?.match(/\((.*)\)/)?.[1] || '');

  const missing = meetings.length - schedulable;
  const options = await knownTermOptions();

  ui.detail(`
    <span class="count">${schedulable}</span> section${schedulable === 1 ? '' : 's'}
    across <span class="count-sm">${courses}</span> course${courses === 1 ? '' : 's'}.
    ${missing ? `<div class="note">${missing} entr${missing === 1 ? 'y has' : 'ies have'} no
       scheduled time and cannot be added.</div>` : ''}
    ${termPickerHtml(parsed.header.term, options)}`);

  ui.actions([
    { label: 'Review & export →', onClick: openPreview },
    { label: 'Scan again', ghost: true, onClick: () => runScrape(tab) },
  ]);
  ui.status('');

  bindTermPicker(tab);
}

/**
 * Every term Carleton offers, as last seen on the term picker.
 *
 * The schedule page carries no term list, so the picker's options are cached
 * when the user passes through it. Without this the switcher could only offer
 * the handful of terms with bundled academic dates, which is a fraction of
 * what Carleton actually lists.
 */
async function rememberTermOptions(options) {
  if (!options?.length) return;
  await chrome.storage.session.set({ termOptions: options });
}

async function knownTermOptions() {
  const { termOptions } = await chrome.storage.session.get('termOptions');
  if (termOptions?.length) return termOptions;

  // Never been through the picker this session: fall back to bundled terms.
  return Object.values(TERMS)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map((t) => ({ value: bannerTermCode(t.label), label: t.label }));
}

/** True when the extension has academic dates for this term label. */
function hasTermData(label) {
  return Object.values(TERMS).some((t) => (label || '').includes(t.label));
}

/**
 * A term dropdown, inline rather than on its own screen.
 *
 * Terms without bundled dates are listed but marked, rather than hidden.
 * Refusing to open someone's actual term would be worse than exporting one
 * with no breaks excluded, and the preview repeats the warning before export.
 */
function termPickerHtml(currentTerm, options, { stacked = false, id = 'term-select' } = {}) {
  const html = options
    .map(({ value, label }) => {
      const selected = currentTerm && label.includes(currentTerm.replace(/\s*\(.*\)$/, ''))
        ? ' selected' : '';
      const short = label.replace(/\s*\(View only\)\s*$/i, '');
      return `<option value="${value}"${selected}>${short}${
        hasTermData(label) ? '' : ' (no holiday data)'}</option>`;
    })
    .join('');

  return `
    <label class="term-switch${stacked ? ' stacked' : ''}">
      <span>Term</span>
      <select id="${id}">${html}</select>
    </label>`;
}

/** Wires the dropdown to load the chosen term in place. */
function bindTermPicker(tab) {
  const select = $('term-select');
  if (!select) return;

  const initial = select.value;
  select.addEventListener('change', () => {
    if (select.value === initial) return;
    loadTermByCode(tab, select.value, select.selectedOptions[0]?.textContent || '');
  });
}

async function showFailure(reason, tab, extra) {
  const failure = FAILURES[reason] || FAILURES.SCRAPE_FAILED;
  ui.title(failure.title);
  ui.subtitle('');

  // An empty schedule almost always means the stored term is the wrong one, so
  // offer the dropdown right here rather than making the user hunt for it.
  if (reason === 'NO_COURSES') {
    ui.detail(failure.detail + termPickerHtml(null, await knownTermOptions()));
    bindTermPicker(tab);
  } else {
    ui.detail(failure.detail);
  }

  const actions = [{ label: 'Open my schedule', onClick: () => openSchedulePage(tab) }];

  if (reason !== 'SESSION_EXPIRED') {
    actions.push({ label: 'Try again', ghost: true, onClick: () => runScrape(tab) });
  }
  if (reason === 'NO_SCHEDULE_TABLES' || reason === 'NO_COURSES') {
    actions.push({ label: 'Show me how', ghost: true, onClick: openHelp });
  }
  ui.actions(actions);
  ui.status(extra || '', true);
}

async function openPreview() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('preview/preview.html') });
  window.close();
}

/**
 * The term picker, answered from inside the popup.
 *
 * Chrome closes a popup the moment focus leaves it, so telling someone to go
 * click the page is telling them to dismiss this. The page's own options are
 * read instead and offered here, so choosing a term never means leaving.
 *
 * Terms the extension has no academic dates for are still listed, since
 * refusing to open someone's actual term would be worse. They are marked, and
 * the preview says the same before anything is exported.
 */
async function showTermPrompt(tab) {
  let options = [];
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => [...document.querySelectorAll('select[name="term_in"] option')]
        .map((o) => ({ value: o.value, label: o.textContent.trim() }))
        .filter((o) => o.value),
    });
    options = injection?.result || [];
    // Cache for the schedule page, which carries no term list of its own.
    await rememberTermOptions(options);
  } catch {
    // Fall through to the bundled list below.
  }

  // Without page options, offer what the extension definitely knows.
  if (!options.length) options = await knownTermOptions();

  ui.title('Pick your term');
  ui.subtitle('Choose here and this stays open.');
  ui.detail(termPickerHtml(null, options, { stacked: true, id: 'term-prompt' }));

  // Straight to the review page: nothing between here and the calendar needs
  // the user, so stopping at the schedule would just be an extra click.
  ui.actions([{
    label: 'Review & export →',
    onClick: () => {
      const select = $('term-prompt');
      quickExport(tab, select.value, select.selectedOptions[0]?.textContent || '');
    },
  }]);
  ui.status('');
}

/** Loads a term by its Banner code, for options read off the page. */
async function loadTermByCode(tab, code, label) {
  ui.title(`Loading ${label.replace(/\s*\(.*\)$/, '')}…`);
  ui.subtitle('');
  ui.detail('<div class="skeleton"><i></i><i></i><i></i></div>');
  ui.actions([]);
  ui.status('');

  const url = `https://central.carleton.ca/prod/bwskfshd.P_CrseSchdDetl?term_in=${code}`;
  try {
    await navigateAndWait(tab.id, url);
  } catch (error) {
    showFailure('SCRAPE_FAILED', tab, String(error));
    return;
  }

  await inspectTab(tab);
}

/**
 * Which step of Carleton Central the tab is on.
 *
 * The page's HTML is pulled out and classified here, using the same tested
 * function the unit tests cover, rather than duplicating the rules inside the
 * injected function where they would drift.
 */
async function detectTabStage(tab) {
  let host = '';
  try { host = new URL(tab.url || '').hostname; } catch { /* non-http page */ }
  if (!CARLETON_HOST.test(host)) return STAGE.ELSEWHERE;

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.documentElement.outerHTML,
    });
    if (!injection?.result) return STAGE.CARLETON_OTHER;

    const doc = new DOMParser().parseFromString(injection.result, 'text/html');
    return detectStage(doc);
  } catch {
    // Injection is refused on Chrome's own pages and before login redirects.
    return STAGE.CARLETON_OTHER;
  }
}

/**
 * Renders whatever the current stage calls for.
 *
 * Called on open and again after every navigation the popup drives, so the
 * user is always looking at the step they are actually on.
 */
async function inspectTab(tab) {
  const stage = await detectTabStage(tab);

  if (stage === STAGE.SCHEDULE) {
    await runScrape(tab);
    return;
  }

  if (stage === STAGE.TERM_PICKER) {
    await showTermPrompt(tab);
    return;
  }

  if (stage === STAGE.LOGIN) {
    ui.title('Log in to continue');
    ui.subtitle('Carleton Central needs your credentials.');
    ui.detail('Sign in on the page. This will carry on once you are through.');
    ui.actions([]);
    ui.status('');
    watchTab(tab);
    return;
  }

  // Signed in and on Carleton Central, just not on the right page. Everything
  // between here and the calendar is navigation the extension can do itself,
  // so offer the whole thing as one action rather than sending the user off
  // to find Detail Schedule.
  if (stage === STAGE.CARLETON_OTHER) {
    await showQuickExport(tab);
    return;
  }

  ui.title('Getting started');
  ui.subtitle('This reads your schedule from Carleton Central.');
  ui.detail(HOW_TO_STEPS);
  ui.actions(lostActions(tab));
  ui.status('');
}

/**
 * Pick a term and go straight to the review page.
 *
 * Once someone is logged in, reaching Detail Schedule and selecting a term is
 * pure navigation the extension can do on its own. Offering that as one action
 * skips the menu hunting entirely.
 */
async function showQuickExport(tab) {
  const options = await knownTermOptions();

  ui.title('Export your schedule');
  ui.subtitle('You are logged in. Pick a term and go.');
  ui.detail(termPickerHtml(null, options, { stacked: true, id: 'quick-term' }));

  ui.actions([
    {
      label: 'Review & export →',
      onClick: () => {
        const select = $('quick-term');
        quickExport(tab, select.value, select.selectedOptions[0]?.textContent || '');
      },
    },
    { label: 'Show me how', ghost: true, onClick: openHelp },
  ]);
  ui.status('');
  watchTab(tab);
}

/**
 * Loads a term, scrapes it, and opens the review tab in one go.
 *
 * Stops and explains itself if the schedule does not appear, rather than
 * opening an empty review page: a lapsed session lands on login, and a term
 * with no registration lands on a schedule with no courses.
 */
async function quickExport(tab, code, label) {
  const shortLabel = label.replace(/\s*\(.*\)$/, '').trim();

  ui.title(`Fetching ${shortLabel}…`);
  ui.subtitle('');
  ui.detail('<div class="skeleton"><i></i><i></i><i></i></div>');
  ui.actions([]);
  ui.status('');

  const url = `https://central.carleton.ca/prod/bwskfshd.P_CrseSchdDetl?term_in=${code}`;
  try {
    await navigateAndWait(tab.id, url);
  } catch (error) {
    await showFailure('SCRAPE_FAILED', tab, String(error));
    return;
  }

  if (await detectTabStage(tab) !== STAGE.SCHEDULE) {
    await inspectTab(tab);
    return;
  }

  const parsed = await scrapeInto(tab);
  if (!parsed) return;

  await openPreview();
}

/**
 * Re-checks the stage when the user navigates the tab themselves.
 *
 * Logging in and submitting the term form are things only the user can do, so
 * the popup waits for those rather than asking them to click anything.
 */
let watching = null;
function watchTab(tab) {
  if (watching) return;

  watching = (changedId, info) => {
    if (changedId !== tab.id || info.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(watching);
    watching = null;
    inspectTab(tab).catch(() => { /* the next open will re-detect */ });
  };
  chrome.tabs.onUpdated.addListener(watching);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url) {
    ui.title('Getting started');
    ui.subtitle('This reads your schedule from Carleton Central.');
    ui.detail(HOW_TO_STEPS);
    ui.actions([]);
    return;
  }

  await inspectTab(tab);
}

init().catch((error) => {
  ui.title('Something went wrong');
  ui.detail('The extension hit an unexpected error.');
  ui.status(String(error), true);
});
