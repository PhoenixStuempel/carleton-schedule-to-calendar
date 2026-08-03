/**
 * ICS generation + Carleton term-calendar tests.
 *
 * Several of these guard SILENT failure modes: cases that produce a
 * valid-looking .ics that quietly schedules the wrong thing. Those are called
 * out individually, because a regression there is invisible without a test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeText, foldLine, toUtcStamp, torontoOffsetMinutes,
  firstOccurrence, lastOccurrence, buildVevent, buildCalendar, buildUid,
} from '../src/calendar/ics.js';

import {
  TERMS, findTerm, weekdayOf, datesBetween, resolveTermCalendar,
  bannerTermCode, scheduleUrlFor,
} from '../src/calendar/carleton-terms.js';

const AT_1005 = { hour: 10, minute: 5 };
const AT_1125 = { hour: 11, minute: 25 };
const STAMP = '20260803T120000Z';


test('weekdayOf maps ISO dates to Banner-style weekday codes', () => {
  assert.equal(weekdayOf('2026-09-09'), 'WE'); // term start is a Wednesday
  assert.equal(weekdayOf('2026-12-11'), 'FR'); // term end is a Friday
  assert.equal(weekdayOf('2026-10-12'), 'MO'); // Thanksgiving
});

test('datesBetween is inclusive of both ends', () => {
  assert.deepEqual(datesBetween('2026-10-26', '2026-10-30'), [
    '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30',
  ]);
});

test('finds the bundled term from the scraped Banner date range', () => {
  const term = findTerm({ startDate: '2026-09-09', endDate: '2026-12-11' });
  assert.equal(term.id, 'fall-2026');
});

test('finds the bundled term from a Banner term label', () => {
  const term = findTerm({ label: 'Fall 2026 (September-December)' });
  assert.equal(term.id, 'fall-2026');
});

test('returns null for an unknown term rather than guessing', () => {
  assert.equal(findTerm({ label: 'Summer 2031' }), null);
  assert.equal(findTerm({ startDate: '2031-01-01', endDate: '2031-04-01' }), null);
});

test('builds Banner term codes from the year in the term name', () => {
  // Ground truth: the term dropdown on a real Registration Term page. The year
  // is the one in the term's own name, so Fall 2025 is 202530 and Winter 2026
  // is 202610, despite both being the 2025-26 academic year. Assuming an
  // academic-year rollover here opens the wrong term silently.
  const cases = [
    ['Fall 2025 (September-December)', '202530'],
    ['Winter 2026 (January-April)', '202610'],
    ['Summer 2026 (May-August)', '202620'],
    ['Fall 2026 (September-December)', '202630'],
    ['Winter 2027 (January-April)', '202710'],
  ];

  for (const [label, code] of cases) {
    assert.equal(bannerTermCode(label), code, `wrong code for ${label}`);
  }
});

test('returns no term code for a label it cannot read', () => {
  for (const label of ['', null, undefined, 'Reading Week', 'Fall']) {
    assert.equal(bannerTermCode(label), null);
  }
});

test('SILENT-FAILURE GUARD: schedule URL pins the term', () => {
  // Carleton Central stores the selected term server-side. Without ?term_in=,
  // Detail Schedule stops showing the picker and serves whichever term was
  // chosen earlier, so the user exports a calendar for the wrong term.
  assert.equal(
    scheduleUrlFor('Fall 2025 (September-December)'),
    'https://central.carleton.ca/prod/bwskfshd.P_CrseSchdDetl?term_in=202530',
  );

  // With no term to pin, fall back to the plain URL rather than guessing.
  assert.equal(
    scheduleUrlFor(null),
    'https://central.carleton.ca/prod/bwskfshd.P_CrseSchdDetl',
  );
});

test('matches the terms on real Banner pages, by label and by date range', () => {
  // These four pairs were read off actual Student Detail Schedule pages. If a
  // term entry drifts from what Banner reports, the extension silently falls
  // back to "no breaks excluded" and every holiday lands in the calendar.
  const cases = [
    { label: 'Fall 2025 (September-December)', startDate: '2025-09-03', endDate: '2025-12-05', id: 'fall-2025' },
    { label: 'Winter 2026 (January-April)', startDate: '2026-01-05', endDate: '2026-04-08', id: 'winter-2026' },
  ];

  for (const { label, startDate, endDate, id } of cases) {
    assert.equal(findTerm({ label }).id, id, `label lookup failed for ${id}`);
    assert.equal(findTerm({ startDate, endDate }).id, id, `date lookup failed for ${id}`);
    assert.equal(TERMS[id].startDate, startDate, `${id} start drifted from Banner`);
    assert.equal(TERMS[id].endDate, endDate, `${id} end drifted from Banner`);
  }
});

test('SILENT-FAILURE GUARD: Fall 2025 repays a Monday on Fri Dec 5', () => {
  // Same substitution rule as Fall 2026, different date. A Monday-only class
  // gains Dec 5; a Friday-only class loses it.
  const monday = resolveTermCalendar(TERMS['fall-2025'], ['MO']);
  assert.ok(monday.addedDates.includes('2025-12-05'));

  const friday = resolveTermCalendar(TERMS['fall-2025'], ['FR']);
  assert.ok(friday.excludedDates.includes('2025-12-05'));
  assert.equal(friday.addedDates.length, 0);

  // And a class meeting both weekdays is neither added nor removed.
  const both = resolveTermCalendar(TERMS['fall-2025'], ['MO', 'FR']);
  assert.ok(!both.addedDates.includes('2025-12-05'));
  assert.ok(!both.excludedDates.includes('2025-12-05'));
});

test('Summer 2026 excludes all three statutory closures', () => {
  // Two of these fall on Mondays, which is why the term repays one on Aug 14.
  const monday = resolveTermCalendar(TERMS['summer-2026'], ['MO']);
  assert.ok(monday.excludedDates.includes('2026-05-18'), 'Victoria Day');
  assert.ok(monday.excludedDates.includes('2026-08-03'), 'Civic Holiday');

  const wednesday = resolveTermCalendar(TERMS['summer-2026'], ['WE']);
  assert.ok(wednesday.excludedDates.includes('2026-07-01'), 'Canada Day');

  // A Monday class also gains the last day, which runs a Monday schedule.
  assert.ok(monday.addedDates.includes('2026-08-14'));
});

test('SILENT-FAILURE GUARD: Summer 2026 repays a Monday on Fri Aug 14', () => {
  const friday = resolveTermCalendar(TERMS['summer-2026'], ['FR']);
  assert.ok(friday.excludedDates.includes('2026-08-14'), 'Friday classes lose it');
  assert.equal(friday.addedDates.length, 0);

  // Meeting both weekdays needs no adjustment either way.
  const both = resolveTermCalendar(TERMS['summer-2026'], ['MO', 'FR']);
  assert.ok(!both.addedDates.includes('2026-08-14'));
  assert.ok(!both.excludedDates.includes('2026-08-14'));
});

test('Winter 2026 excludes Family Day, the winter break, and Good Friday', () => {
  const monday = resolveTermCalendar(TERMS['winter-2026'], ['MO']);
  // Feb 16 is both Family Day and the first day of the winter break.
  assert.ok(monday.excludedDates.includes('2026-02-16'));

  const friday = resolveTermCalendar(TERMS['winter-2026'], ['FR']);
  assert.ok(friday.excludedDates.includes('2026-04-03'), 'Good Friday must be excluded');
  assert.ok(friday.excludedDates.includes('2026-02-20'), 'winter break Friday must be excluded');
});

// exclusions & swaps

test('excludes Thanksgiving for a Monday class', () => {
  const { excludedDates } = resolveTermCalendar(TERMS['fall-2026'], ['MO']);
  assert.ok(excludedDates.includes('2026-10-12'));
});

test('does not exclude Thanksgiving for a class that never meets Mondays', () => {
  const { excludedDates } = resolveTermCalendar(TERMS['fall-2026'], ['TU', 'TH']);
  assert.ok(!excludedDates.includes('2026-10-12'));
});

test('excludes only the fall-break days a class actually meets', () => {
  const { excludedDates } = resolveTermCalendar(TERMS['fall-2026'], ['TU', 'TH']);
  // Fall break is Mon Oct 26 - Fri Oct 30; a TR class loses Tue 27 and Thu 29.
  assert.deepEqual(excludedDates, ['2026-10-27', '2026-10-29']);
});

test('SILENT-FAILURE GUARD: Monday classes gain Fri Dec 11 (Monday schedule)', () => {
  // COMP 1405 A3 in the real schedule. Without this, a real class is missing.
  const { addedDates, excludedDates } = resolveTermCalendar(TERMS['fall-2026'], ['MO']);
  assert.deepEqual(addedDates, ['2026-12-11']);
  assert.ok(!excludedDates.includes('2026-12-11'));
});

test('SILENT-FAILURE GUARD: Friday classes lose Dec 11 (campus runs Mondays)', () => {
  // STAT 2507 A1 in the real schedule. Without this, a phantom class appears.
  const { addedDates, excludedDates } = resolveTermCalendar(TERMS['fall-2026'], ['FR']);
  assert.ok(excludedDates.includes('2026-12-11'));
  assert.deepEqual(addedDates, []);
});

test('SILENT-FAILURE GUARD: a Mon+Fri class meets Dec 11 exactly once', () => {
  // Dec 11 is a Friday, so the weekly rule ALREADY generates it for any class
  // meeting Fridays. Adding an RDATE on top produces a duplicate. A MWF
  // lecture is one of the most common Carleton patterns, so this matters.
  const { addedDates, excludedDates } = resolveTermCalendar(TERMS['fall-2026'], ['MO', 'FR']);

  assert.deepEqual(addedDates, [], 'RRULE already covers Dec 11; no RDATE needed');
  assert.ok(!excludedDates.includes('2026-12-11'), 'the class does meet that day');
});

test('SILENT-FAILURE GUARD: an MWF class meets Dec 11 exactly once', () => {
  const { addedDates, excludedDates } = resolveTermCalendar(TERMS['fall-2026'], ['MO', 'WE', 'FR']);

  assert.deepEqual(addedDates, []);
  assert.ok(!excludedDates.includes('2026-12-11'));
});

test('a Mon+Fri class raises no misleading extra-class note', () => {
  // "Extra class on Friday December 11" would be wrong: it meets once, as usual.
  const { notes } = resolveTermCalendar(TERMS['fall-2026'], ['MO', 'FR']);
  assert.ok(!notes.some((n) => n.kind === 'swap-added'));
  assert.ok(!notes.some((n) => n.kind === 'swap-removed'));
});

test('schedule swaps can be turned off, leaving an explanatory note', () => {
  const result = resolveTermCalendar(TERMS['fall-2026'], ['FR'], { applyScheduleSwaps: false });
  assert.ok(!result.excludedDates.includes('2026-12-11'));
  assert.deepEqual(result.addedDates, []);
  assert.ok(result.notes.some((n) => n.kind === 'swap-ignored'));
});

test('Remembrance Day is never excluded (Carleton holds classes)', () => {
  for (const days of [['WE'], ['MO', 'WE', 'FR'], ['TU', 'TH']]) {
    const { excludedDates } = resolveTermCalendar(TERMS['fall-2026'], days);
    assert.ok(!excludedDates.includes('2026-11-11'), `Nov 11 wrongly excluded for ${days}`);
  }
});

test('winter 2027 excludes Good Friday and the winter break', () => {
  const { excludedDates } = resolveTermCalendar(TERMS['winter-2027'], ['FR']);
  assert.ok(excludedDates.includes('2027-03-26')); // Good Friday
  assert.ok(excludedDates.includes('2027-02-19')); // Friday of winter break
});

// DST / offsets

test('resolves Toronto offsets across the DST boundary', () => {
  assert.equal(torontoOffsetMinutes('2026-09-09', AT_1005), -240); // EDT
  assert.equal(torontoOffsetMinutes('2026-12-07', AT_1005), -300); // EST
});

test('SILENT-FAILURE GUARD: UNTIL uses the last occurrence offset, not the first', () => {
  // A term running Sept->Dec crosses the Nov 1 DST change. Computing UNTIL
  // from September's EDT offset yields 14:05Z, one hour early, which silently
  // drops the final class. December's EST offset is correct: 15:05Z.
  const lines = buildVevent({
    summary: 'Foundations of Data Science',
    days: ['WE', 'FR'],
    startTime: AT_1005,
    endTime: AT_1125,
    termStart: '2026-09-09',
    termEnd: '2026-12-11',
    uid: 'test',
    dtstamp: STAMP,
  });
  const rrule = lines.find((l) => l.startsWith('RRULE:'));

  assert.match(rrule, /UNTIL=20261211T150500Z/);
  assert.doesNotMatch(rrule, /UNTIL=\d{8}T1405/);
});

test('UNTIL is UTC with a Z, as required when DTSTART carries a TZID', () => {
  const lines = buildVevent({
    summary: 'X', days: ['MO'], startTime: AT_1005, endTime: AT_1125,
    termStart: '2026-09-09', termEnd: '2026-12-11', uid: 'u', dtstamp: STAMP,
  });
  assert.match(lines.find((l) => l.startsWith('RRULE:')), /UNTIL=\d{8}T\d{6}Z/);
});


test('SILENT-FAILURE GUARD: EXDATE carries the class start time, not midnight', () => {
  // A midnight EXDATE parses without error and excludes absolutely nothing.
  const lines = buildVevent({
    summary: 'X', days: ['MO'], startTime: AT_1005, endTime: AT_1125,
    termStart: '2026-09-09', termEnd: '2026-12-11',
    excludedDates: ['2026-10-12'], uid: 'u', dtstamp: STAMP,
  });
  const exdate = lines.find((l) => l.startsWith('EXDATE'));

  assert.equal(exdate, 'EXDATE;TZID=America/Toronto:20261012T100500');
  assert.doesNotMatch(exdate, /T000000/);
});

test('EXDATE carries the same TZID as DTSTART', () => {
  const lines = buildVevent({
    summary: 'X', days: ['MO'], startTime: AT_1005, endTime: AT_1125,
    termStart: '2026-09-09', termEnd: '2026-12-11',
    excludedDates: ['2026-10-12'], uid: 'u', dtstamp: STAMP,
  });
  const dtstart = lines.find((l) => l.startsWith('DTSTART'));
  const exdate = lines.find((l) => l.startsWith('EXDATE'));

  assert.ok(dtstart.includes('TZID=America/Toronto'));
  assert.ok(exdate.includes('TZID=America/Toronto'));
});

test('emits one EXDATE per line rather than a comma-separated list', () => {
  const lines = buildVevent({
    summary: 'X', days: ['MO'], startTime: AT_1005, endTime: AT_1125,
    termStart: '2026-09-09', termEnd: '2026-12-11',
    excludedDates: ['2026-10-12', '2026-10-26'], uid: 'u', dtstamp: STAMP,
  });
  const exdates = lines.filter((l) => l.startsWith('EXDATE'));

  assert.equal(exdates.length, 2);
  assert.ok(exdates.every((l) => !l.includes(',')));
});

test('SILENT-FAILURE GUARD: never emits RDATE, since Apple Calendar ignores it', () => {
  // Apple Calendar does not implement RDATE (confirmed on Apple's developer
  // forums, Mar 2025, acknowledged by an Apple engineer). An added class
  // would silently vanish on Mac and iPhone, so added dates must become
  // standalone events instead.
  const ics = buildCalendar([{
    summary: 'X', days: ['MO'], startTime: AT_1005, endTime: AT_1125,
    termStart: '2026-09-09', termEnd: '2026-12-11',
    addedDates: ['2026-12-11'],
  }], { dtstamp: STAMP });

  assert.ok(!ics.includes('RDATE'), 'RDATE is unsupported by Apple Calendar');
});

test('an added date becomes its own standalone event', () => {
  const ics = buildCalendar([{
    summary: 'COMP 1405 A3 - Introduction to Computer Science',
    days: ['MO'], startTime: AT_1005, endTime: AT_1125,
    termStart: '2026-09-09', termEnd: '2026-12-11',
    addedDates: ['2026-12-11'],
  }], { dtstamp: STAMP });

  // Two VEVENTs: the weekly series, plus a single-occurrence makeup class.
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);

  const extra = ics.slice(ics.lastIndexOf('BEGIN:VEVENT'));
  assert.ok(extra.includes('DTSTART;TZID=America/Toronto:20261211T100500'));
  assert.ok(extra.includes('DTEND;TZID=America/Toronto:20261211T112500'));
  assert.ok(!extra.includes('RRULE'), 'the makeup class does not recur');
});

test('a standalone makeup event has its own stable, distinct UID', () => {
  const build = () => buildCalendar([{
    summary: 'COMP 1405 A3', days: ['MO'], startTime: AT_1005, endTime: AT_1125,
    termStart: '2026-09-09', termEnd: '2026-12-11', addedDates: ['2026-12-11'],
  }], { dtstamp: STAMP });

  const uids = [...build().matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
  assert.equal(uids.length, 2);
  assert.notEqual(uids[0], uids[1], 'series and makeup class need distinct UIDs');
  assert.deepEqual([...build().matchAll(/^UID:(.+)$/gm)].map((m) => m[1]), uids,
    'UIDs must be stable across exports');
});

test('no makeup event is emitted when there are no added dates', () => {
  const ics = buildCalendar([{
    summary: 'X', days: ['TU', 'TH'], startTime: AT_1005, endTime: AT_1125,
    termStart: '2026-09-09', termEnd: '2026-12-11',
  }], { dtstamp: STAMP });

  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});

// escaping & folding

test('escapes exactly the four TEXT specials, leaving colons alone', () => {
  assert.equal(escapeText('a,b'), 'a\\,b');
  assert.equal(escapeText('a;b'), 'a\\;b');
  assert.equal(escapeText('a\\b'), 'a\\\\b');
  assert.equal(escapeText('a\nb'), 'a\\nb');
  assert.equal(escapeText('Time: 10:05'), 'Time: 10:05'); // colon NOT escaped
  assert.equal(escapeText('He said "hi"'), 'He said "hi"'); // quote NOT escaped
});

test('escapes backslash before other specials, avoiding double-escaping', () => {
  assert.equal(escapeText('Row 3; seat 4\\5'), 'Row 3\\; seat 4\\\\5');
});

test('SILENT-FAILURE GUARD: folds on octets without splitting a codepoint', () => {
  // "Nideyinàn" is real data from the fixture; à is two bytes in UTF-8.
  const line = `LOCATION:${'Nideyinàn (former UC) '.repeat(6)}279`;
  const folded = foldLine(line);
  const encoder = new TextEncoder();

  for (const segment of folded.split('\r\n')) {
    assert.ok(encoder.encode(segment).length <= 75, `segment over 75 octets: ${segment}`);
  }
  // Unfolding must reproduce the original exactly: no mojibake, no lost bytes.
  assert.equal(folded.replace(/\r\n /g, ''), line);
});

test('leaves short lines unfolded', () => {
  assert.equal(foldLine('SUMMARY:COMP 1405 A'), 'SUMMARY:COMP 1405 A');
});


test('produces a well-formed calendar with VTIMEZONE and CRLF endings', () => {
  const ics = buildCalendar([{
    summary: 'COMP 1405 A - Introduction to Computer Science',
    location: 'Azrieli Theatre 302',
    days: ['TU', 'TH'],
    startTime: { hour: 14, minute: 35 },
    endTime: { hour: 15, minute: 55 },
    termStart: '2026-09-09',
    termEnd: '2026-12-11',
  }], { dtstamp: STAMP });

  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('BEGIN:VTIMEZONE'));
  assert.ok(ics.includes('TZID:America/Toronto'));
  assert.ok(ics.includes('VERSION:2.0'));
  assert.ok(ics.includes('PRODID:'));
  // Every line ends CRLF: no bare LF anywhere.
  assert.equal(ics.split('\n').length - 1, ics.split('\r\n').length - 1);
});

test('VTIMEZONE offsets mirror each other between EST and EDT', () => {
  const ics = buildCalendar([{
    summary: 'X', days: ['MO'], startTime: AT_1005, endTime: AT_1125,
    termStart: '2026-09-09', termEnd: '2026-12-11',
  }], { dtstamp: STAMP });

  // DAYLIGHT: -0500 -> -0400. STANDARD: -0400 -> -0500.
  const daylight = ics.slice(ics.indexOf('BEGIN:DAYLIGHT'), ics.indexOf('END:DAYLIGHT'));
  const standard = ics.slice(ics.indexOf('BEGIN:STANDARD'), ics.indexOf('END:STANDARD'));

  assert.ok(daylight.includes('TZOFFSETFROM:-0500') && daylight.includes('TZOFFSETTO:-0400'));
  assert.ok(standard.includes('TZOFFSETFROM:-0400') && standard.includes('TZOFFSETTO:-0500'));
});

test('DTSTART lands on the first real meeting day, not the term start', () => {
  // Term starts Wed Sep 9; a Tue/Thu class first meets Thu Sep 10.
  const lines = buildVevent({
    summary: 'X', days: ['TU', 'TH'], startTime: AT_1005, endTime: AT_1125,
    termStart: '2026-09-09', termEnd: '2026-12-11', uid: 'u', dtstamp: STAMP,
  });
  assert.ok(lines.find((l) => l.startsWith('DTSTART')).includes(':20260910T100500'));
});

test('finds first and last occurrences of a weekday pattern', () => {
  assert.equal(firstOccurrence('2026-09-09', ['MO']), '2026-09-14');
  assert.equal(firstOccurrence('2026-09-09', ['WE', 'FR']), '2026-09-09');
  assert.equal(lastOccurrence('2026-12-11', ['MO']), '2026-12-07');
  assert.equal(lastOccurrence('2026-12-11', ['WE', 'FR']), '2026-12-11');
});

test('UIDs are stable across runs and distinct across sections', () => {
  const a = buildUid(['COMP 1405 A', 'TUTH', '2026-09-09']);
  const b = buildUid(['COMP 1405 A', 'TUTH', '2026-09-09']);
  const c = buildUid(['COMP 1405 A3', 'MO', '2026-09-09']);

  assert.equal(a, b, 'same inputs must yield the same UID for clean re-import');
  assert.notEqual(a, c);
  assert.ok(a.endsWith('@carleton-calendar-plugin'));
});

test('every VEVENT carries the RFC-required properties', () => {
  const ics = buildCalendar([{
    summary: 'X', days: ['MO'], startTime: AT_1005, endTime: AT_1125,
    termStart: '2026-09-09', termEnd: '2026-12-11',
  }], { dtstamp: STAMP });

  for (const required of ['UID:', 'DTSTAMP:', 'DTSTART;', 'DTEND;']) {
    assert.ok(ics.includes(required), `missing ${required}`);
  }
  // DTEND and DURATION must never both appear.
  assert.ok(!ics.includes('DURATION:'));
});
