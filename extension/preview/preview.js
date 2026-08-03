/**
 * Preview tab: renders the week grid, the class roster, and the export.
 *
 * Reads scraped data from chrome.storage.session (set by the popup). Falls
 * back to a bundled sample when opened outside the extension, so the page can
 * be developed and screenshotted without a live Carleton session.
 */

import { layoutWeek, formatTime, formatHour, DAY_LABELS } from './week-grid.js';
import { buildSchedules } from '../../src/pipeline.js';
import { IcsProvider } from '../../src/providers/ics-provider.js';
import { TERMS } from '../../src/calendar/carleton-terms.js';
import { findConflicts } from '../../src/schedule-info.js';

/** Minutes below which a gap between buildings is worth warning about. */
const TIGHT_TURNAROUND_MINUTES = 15;

const state = {
  parsed: null,
  schedules: [],
  flags: [],
  skipped: [],
  term: null,
  applySwaps: true,
  dismissed: new Set(),
};

const $ = (id) => document.getElementById(id);

async function loadParsed() {
  if (globalThis.chrome?.storage?.session) {
    const { scrapeResult } = await chrome.storage.session.get('scrapeResult');
    if (scrapeResult) return scrapeResult;
  }
  // Dev/screenshot path only: a sample payload that the build step strips, so
  // the shipped extension shows the empty state rather than fake data.
  try {
    const response = await fetch('sample-parsed.json');
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function recompute() {
  const { schedules, flags, skipped, term } = buildSchedules(state.parsed, {
    applyScheduleSwaps: state.applySwaps,
  });

  // Preserve which classes the user unticked across a recompute.
  const disabled = new Set(state.schedules.filter((s) => s.enabled === false).map((s) => s.id));
  for (const schedule of schedules) {
    if (disabled.has(schedule.id)) schedule.enabled = false;
    schedule.flagged = flags.some((f) => f.scope === `${schedule.courseCode} ${schedule.section}`.trim());
  }

  Object.assign(state, { schedules, flags, skipped, term });
}

// rendering

function renderHeader() {
  const term = state.term;
  $('term-title').textContent = term ? term.label : (state.parsed?.header?.term || 'Your schedule');

  if (term) {
    const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA',
      { month: 'long', day: 'numeric' });
    $('term-range').textContent =
      `${fmt(term.startDate)} – ${fmt(term.endDate)}, ${term.endDate.slice(0, 4)} · Carleton University`;
  }

  const enabled = state.schedules.filter((s) => s.enabled !== false);
  const courses = new Set(enabled.map((s) => s.courseCode)).size;

  // Count distinct DATES needing confirmation, not per-class flags. Five
  // classes affected by one swapped day is one date to check.
  const pendingDates = new Set(
    groupFlags(state.flags)
      .filter((g) => !state.dismissed.has(`${g.code}|${g.date || ''}`))
      .map((g) => g.date || g.code),
  ).size;

  $('tally').innerHTML =
    `${enabled.length} section${enabled.length === 1 ? '' : 's'} · ${courses} course${courses === 1 ? '' : 's'}`
    + (pendingDates ? `<span class="confirm">${pendingDates} date${pendingDates === 1 ? '' : 's'} to confirm</span>` : '');
}

/**
 * Groups flags that describe the SAME underlying event across several classes.
 * One schedule swap affecting five sections is one thing to understand, not
 * five notices. Showing five buries the schedule under boilerplate.
 */
function groupFlags(flags) {
  const groups = new Map();

  for (const flag of flags) {
    // Same calendar event + same kind of effect = one notice.
    const key = `${flag.code}|${flag.date || ''}`;
    if (!groups.has(key)) groups.set(key, { ...flag, scopes: [] });
    groups.get(key).scopes.push(flag.scope);
  }
  return [...groups.values()];
}

function renderNotices() {
  const host = $('notices');
  host.innerHTML = '';

  for (const group of groupFlags(state.flags)) {
    const key = `${group.code}|${group.date || ''}`;
    if (state.dismissed.has(key)) continue;

    const notice = document.createElement('div');
    notice.className = `notice${group.level === 'warning' ? ' warning' : ''}`;

    // Strip the leading verb: the scope list already says which classes.
    const detail = group.message.replace(/^(Extra class|No class) on /, '');
    const verb = group.code === 'SWAP_ADDED' ? 'Extra class'
      : group.code === 'SWAP_REMOVED' ? 'No class'
        : null;

    notice.innerHTML = `
      <i class="icon" aria-hidden="true">${group.level === 'warning' ? '!' : '✎'}</i>
      <div class="body">
        <span class="scope">${escapeHtml(group.scopes.join(' · '))}</span>
        ${verb ? `${verb} on ` : ''}${escapeHtml(detail)}
      </div>`;

    const dismiss = document.createElement('button');
    dismiss.className = 'dismiss';
    dismiss.textContent = 'Got it';
    dismiss.addEventListener('click', () => {
      state.dismissed.add(key);
      render();
    });
    notice.appendChild(dismiss);
    host.appendChild(notice);
  }

  for (const item of state.skipped) {
    const notice = document.createElement('div');
    notice.className = 'notice warning';
    notice.innerHTML = `<i class="icon" aria-hidden="true">!</i>
      <div class="body"><span class="scope">${escapeHtml(item.label)}</span>
      Not added. ${escapeHtml(item.reason)}</div>`;
    host.appendChild(notice);
  }

  // Scheduling problems the student may not have noticed when registering.
  const conflicts = findConflicts(state.schedules, {
    tightTurnaroundMinutes: TIGHT_TURNAROUND_MINUTES,
  });

  // The same pair of classes clashing on Tuesday and Thursday is one problem,
  // not two, so collapse by pair and list the days.
  const byPair = new Map();
  for (const conflict of conflicts) {
    const key = `${conflict.kind}|${conflict.a}|${conflict.b}`;
    if (!byPair.has(key)) byPair.set(key, { ...conflict, days: [] });
    byPair.get(key).days.push(conflict.day);
  }

  for (const [pairKey, group] of byPair) {
    const key = `conflict|${pairKey}`;
    if (state.dismissed.has(key)) continue;

    const isOverlap = group.kind === 'overlap';
    const days = group.days.map((d) => DAY_LABELS[d].slice(0, 3)).join(' and ');

    const notice = document.createElement('div');
    notice.className = `notice${isOverlap ? ' warning' : ''}`;
    notice.innerHTML = `
      <i class="icon" aria-hidden="true">${isOverlap ? '!' : '→'}</i>
      <div class="body">
        <span class="scope">${escapeHtml(days)} · ${
          isOverlap ? 'classes overlap' : 'tight gap'}</span>
        ${escapeHtml(group.message)}
      </div>`;

    const dismiss = document.createElement('button');
    dismiss.className = 'dismiss';
    dismiss.textContent = 'Got it';
    dismiss.addEventListener('click', () => {
      state.dismissed.add(key);
      render();
    });
    notice.appendChild(dismiss);
    host.appendChild(notice);
  }
}

function renderGrid() {
  const host = $('grid-host');
  const enabled = state.schedules.filter((s) => s.enabled !== false);

  if (!enabled.length) {
    host.innerHTML = '<div class="empty">No classes selected.</div>';
    return;
  }

  const { blocks, days, hours } = layoutWeek(state.schedules);
  const grid = document.createElement('div');
  grid.className = 'week';
  grid.style.setProperty('--day-count', days.length);

  grid.appendChild(cell('div', 'week-head gutter', ''));
  for (const day of days) grid.appendChild(cell('div', 'week-head', DAY_LABELS[day].slice(0, 3)));

  const gutter = document.createElement('div');
  gutter.className = 'time-gutter';
  for (const hour of hours.slice(0, -1)) {
    const row = document.createElement('div');
    row.className = 'hour';
    row.innerHTML = `<span>${formatHour(hour)}</span>`;
    gutter.appendChild(row);
  }
  grid.appendChild(gutter);

  for (const day of days) {
    const column = document.createElement('div');
    column.className = 'day-column';

    for (let i = 0; i < hours.length - 1; i += 1) {
      column.appendChild(cell('div', 'hour-line', ''));
    }

    const layer = document.createElement('div');
    layer.className = 'blocks';
    for (const block of blocks.filter((b) => b.day === day)) layer.appendChild(renderBlock(block));
    column.appendChild(layer);

    grid.appendChild(column);
  }

  host.replaceChildren(grid);
}

function renderBlock(block) {
  const { schedule } = block;
  const el = document.createElement('div');
  const isTutorial = /tutorial|lab/i.test(schedule.scheduleType || '');

  // Roughly 62px is where code + two title lines + room stop fitting.
  const minutes = block.endMinutes - block.startMinutes;
  const isCompact = minutes < 62;

  el.className = `block${isTutorial ? ' tutorial' : ''}${block.hasFlag ? ' flagged' : ''}`
    + `${isCompact ? ' compact' : ''}`;
  el.tabIndex = 0;
  el.style.top = `${block.topPercent}%`;
  el.style.height = `${block.heightPercent}%`;
  // Side-by-side placement when classes overlap.
  el.style.left = `${(block.column / block.columnCount) * 100}%`;
  el.style.width = `${(1 / block.columnCount) * 100 - 1.5}%`;

  const time = `${formatTime(schedule.startTime)} – ${formatTime(schedule.endTime)}`;
  el.title = `${schedule.courseCode} ${schedule.section}: ${schedule.title}\n${time}\n${schedule.location || ''}`;
  el.innerHTML = `
    <div class="b-code">${escapeHtml(schedule.courseCode)} ${escapeHtml(schedule.section)}</div>
    <div class="b-title">${escapeHtml(schedule.title)}</div>
    <div class="b-meta">${escapeHtml(schedule.location || '')}</div>
    ${block.hasFlag ? '<span class="b-mark" title="Date adjusted. See notes">✎</span>' : ''}`;

  return el;
}

function renderRoster() {
  const host = $('roster');
  host.innerHTML = '';

  for (const schedule of state.schedules) {
    const entry = document.createElement('div');
    entry.className = `entry${schedule.enabled === false ? ' off' : ''}`;

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = schedule.enabled !== false;
    toggle.setAttribute('aria-label', `Include ${schedule.courseCode} ${schedule.section}`);
    toggle.addEventListener('change', () => {
      schedule.enabled = toggle.checked;
      render();
    });

    const who = schedule.instructors?.length
      ? escapeHtml(schedule.instructors.join(', '))
      : '<span class="pending">instructor to be announced</span>';

    const details = document.createElement('div');
    details.innerHTML = `
      <div class="e-code">${escapeHtml(schedule.courseCode)} · ${escapeHtml(schedule.section)}</div>
      <div class="e-title">${escapeHtml(schedule.title)}</div>
      <div class="e-meta">${escapeHtml(schedule.sectionType || schedule.scheduleType || '')}${
        schedule.deliveryMode === 'online' ? ' · <b>online</b>' : ''} · ${who}</div>`;

    const days = document.createElement('div');
    days.innerHTML = `<div class="e-days">${
      ['MO', 'TU', 'WE', 'TH', 'FR'].map((d) =>
        `<i class="${schedule.days.includes(d) ? 'on' : ''}">${DAY_LABELS[d][0]}</i>`).join('')
    }</div>`;

    const when = document.createElement('div');
    when.innerHTML = `
      <div class="e-time">${formatTime(schedule.startTime)} – ${formatTime(schedule.endTime)}</div>
      <div class="e-where">${escapeHtml(schedule.location || '')}</div>`;

    entry.append(toggle, details, days, when);

    // Terse per-row note; the grouped notice above carries the full reason.
    const note = state.flags.find((f) => f.scope === `${schedule.courseCode} ${schedule.section}`.trim());
    if (note) {
      const line = document.createElement('div');
      line.className = 'e-note';
      const shortDate = note.date
        ? new Date(`${note.date}T12:00:00`).toLocaleDateString('en-CA', { month: 'long', day: 'numeric' })
        : null;

      line.textContent = note.code === 'SWAP_ADDED' ? `Meets an extra time on ${shortDate}.`
        : note.code === 'SWAP_REMOVED' ? `Does not meet on ${shortDate}.`
          : note.message;
      entry.appendChild(line);
    }

    host.appendChild(entry);
  }
}

function renderExclusions() {
  const term = state.term;
  if (!term) {
    $('exclusions').innerHTML =
      '<span class="pending">No holiday data for this term. Every week will repeat.</span>';
    return;
  }

  const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const parts = [
    ...term.holidays.map((h) => `<b>${h.label}</b> ${fmt(h.date)}`),
    ...term.breaks.map((b) => `<b>${b.label}</b> ${fmt(b.startDate)}–${fmt(b.endDate)}`),
  ];

  const kept = term.notHolidays.map((h) => `${h.label} ${fmt(h.date)}: classes run as normal`);
  $('exclusions').innerHTML = `Skipping ${parts.join(' · ')}${kept.length ? `<br>${kept.join(' · ')}` : ''}`;
}

function render() {
  renderHeader();
  renderNotices();
  renderGrid();
  renderRoster();
  renderExclusions();
}

// export

async function handleExport() {
  const enabled = state.schedules.filter((s) => s.enabled !== false);
  if (!enabled.length) return;

  const result = await new IcsProvider().exportSchedules(enabled, {
    filename: `carleton-${(state.term?.id || 'schedule')}.ics`,
  });

  // Schedule swaps become standalone one-off events, so the file holds more
  // events than there are weekly classes.
  const extraCount = enabled.reduce((n, s) => n + (s.addedDates?.length || 0), 0);

  const done = $('done');
  if (!result.ok) {
    done.innerHTML = `<div class="done"><b>Couldn't build the file.</b><br>${escapeHtml(result.error)}</div>`;
    return;
  }

  const blob = new Blob([result.content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke late: the download reads the blob asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);

  done.innerHTML = `
    <div class="done">
      <b>Saved ${escapeHtml(result.filename)}</b>: ${result.eventCount} weekly
      ${result.eventCount === 1 ? 'class' : 'classes'}${extraCount
        ? `, plus ${extraCount} extra ${extraCount === 1 ? 'class that meets' : 'classes that meet'}
           once on a day campus runs a different weekday's schedule`
        : ''}.
      The file still needs importing:
      <ul>
        <li><b>Google Calendar</b>: Settings, then Import &amp; export, then Import</li>
        <li><b>Outlook</b>: File, Open &amp; Export, Import/Export, iCalendar (.ics)</li>
        <li><b>Apple Calendar (Mac)</b>: Calendar, then <b>File → Import</b>.
            Not <i>New Calendar Subscription</i>, which asks for a web address
            and won't take a file.</li>
        <li><b>iPhone or iPad</b>: importing on a Mac and letting iCloud sync
            is far more reliable. Otherwise email yourself the file and tap the
            attachment in Mail.</li>
      </ul>
      <p class="tip">Import into a new calendar named for the term. If you
      re-export later, delete that calendar first. Most apps add a second copy
      rather than updating the first.</p>
    </div>`;
}

function cell(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('swap-toggle').addEventListener('change', (event) => {
  state.applySwaps = event.target.checked;
  state.dismissed.clear();
  recompute();
  render();
});

$('export').addEventListener('click', handleExport);

$('rescan').addEventListener('click', () => {
  if (globalThis.chrome?.tabs) window.close();
  else window.location.reload();
});

loadParsed().then((parsed) => {
  if (!parsed) {
    document.querySelector('.page').innerHTML =
      '<div class="empty">No schedule data. Open the extension from your Carleton Central schedule page.</div>';
    return;
  }
  state.parsed = parsed;
  recompute();
  render();
});

export { state, recompute };
