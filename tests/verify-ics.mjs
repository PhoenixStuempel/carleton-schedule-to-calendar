/**
 * Independent verification: parse our generated .ics with a THIRD-PARTY
 * library and expand the recurrences, so occurrence counts are checked by
 * something other than the code that produced them.
 *
 * Not part of `npm test` (needs a dev-only dependency). Run via:
 *   node tests/verify-ics.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import ICAL from 'ical.js';

import { parseDetailSchedule } from '../src/parser/banner8.js';
import { buildCalendar } from '../src/calendar/ics.js';
import { findTerm, resolveTermCalendar } from '../src/calendar/carleton-terms.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'fixtures', 'banner8-detail-schedule.html'), 'utf8');

// full pipeline: real page -> parsed -> ICS
const parsed = parseDetailSchedule(new JSDOM(html).window.document);
const events = [];

for (const course of parsed.courses) {
  for (const meeting of course.meetings) {
    if (!meeting.isSchedulable) continue;

    const term = findTerm({ label: course.term, startDate: meeting.startDate, endDate: meeting.endDate });
    if (!term) throw new Error(`No bundled term for ${course.courseCode}`);

    const { excludedDates, addedDates } = resolveTermCalendar(term, meeting.days);
    events.push({
      summary: `${course.courseCode} ${course.section} - ${course.title}`,
      location: meeting.location,
      description: `${meeting.scheduleType}${meeting.instructors.length ? ` with ${meeting.instructors.join(', ')}` : ''}\nCRN ${course.crn}`,
      days: meeting.days,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      termStart: meeting.startDate,
      termEnd: meeting.endDate,
      excludedDates,
      addedDates,
    });
  }
}

const ics = buildCalendar(events, { dtstamp: '20260803T120000Z' });
const outPath = join(here, '..', 'sample-output.ics');
writeFileSync(outPath, ics, 'utf8');

// independent parse
const comp = new ICAL.Component(ICAL.parse(ics));
const vevents = comp.getAllSubcomponents('vevent');

console.log('=== INDEPENDENT VERIFICATION (ical.js) ===\n');
console.log(`Parsed OK. VEVENTs: ${vevents.length}, VTIMEZONE: ${comp.getAllSubcomponents('vtimezone').length}\n`);

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
};

const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Standalone makeup classes are separate VEVENTs (Apple ignores RDATE), so
// collect their dates per summary to check them alongside their series.
const makeupDates = new Map();
for (const ve of vevents) {
  if (ve.getFirstPropertyValue('rrule')) continue;
  const summary = ve.getFirstPropertyValue('summary');
  const date = new ICAL.Event(ve).startDate.toJSDate().toISOString().slice(0, 10);
  makeupDates.set(summary, [...(makeupDates.get(summary) || []), date]);
}

for (const ve of vevents) {
  if (!ve.getFirstPropertyValue('rrule')) continue; // handled via makeupDates

  const event = new ICAL.Event(ve);
  const summary = event.summary;

  // Expand every occurrence the library computes from OUR rrule/exdate.
  const iterator = event.iterator();
  const occurrences = [];
  for (let next = iterator.next(); next; next = iterator.next()) {
    occurrences.push(next.toJSDate());
    if (occurrences.length > 200) break;
  }

  // The full recurrence set the user sees = the series plus any standalone
  // makeup events carrying the same summary.
  const extras = makeupDates.get(summary) || [];
  const dates = [...occurrences.map((d) => d.toISOString().slice(0, 10)), ...extras].sort();
  const weekdays = [...new Set(occurrences.map((d) => DAY_NAMES[d.getDay()]))];

  console.log(`${summary}`);
  console.log(`  days=${weekdays.join(',')}  occurrences=${dates.length}`
    + `${extras.length ? ` (incl. ${extras.length} standalone makeup)` : ''}`);
  console.log(`  first=${dates[0]}  last=${dates[dates.length - 1]}`);

  // Holidays must be absent from the expansion.
  check('Thanksgiving Oct 12 absent', dates.includes('2026-10-12'), false);
  for (const d of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']) {
    check(`fall break ${d} absent`, dates.includes(d), false);
  }
  // Remembrance Day must still be present for classes meeting that weekday.
  if (weekdays.includes('WE')) {
    check('Remembrance Day Nov 11 present', dates.includes('2026-11-11'), true);
  }

  // The Dec 11 schedule swap, verified in both directions.
  const meetsMonday = event.component.getFirstPropertyValue('rrule').parts.BYDAY.includes('MO');
  const meetsFriday = event.component.getFirstPropertyValue('rrule').parts.BYDAY.includes('FR');
  if (meetsMonday) check('Dec 11 present (Monday schedule)', dates.includes('2026-12-11'), true);
  else if (meetsFriday) check('Dec 11 absent (campus runs Mondays)', dates.includes('2026-12-11'), false);

  // Wall-clock time must survive the Nov 1 DST change unchanged.
  const before = occurrences.find((d) => d < new Date('2026-11-01'));
  const after = occurrences.find((d) => d > new Date('2026-11-02'));
  if (before && after) {
    const fmt = (d) => d.toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour12: false });
    check(`wall-clock stable across DST (${fmt(before)})`, fmt(after), fmt(before));
  }
  console.log('');
}

console.log(failures === 0
  ? `ALL CHECKS PASSED: ${vevents.length} events verified independently.`
  : `${failures} CHECK(S) FAILED.`);
console.log(`\nWrote ${outPath}`);
process.exit(failures === 0 ? 0 : 1);
