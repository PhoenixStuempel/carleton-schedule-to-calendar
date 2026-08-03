/**
 * End-to-end pipeline tests: real page HTML -> schedules -> .ics,
 * plus provider-layer behaviour.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parseDetailSchedule } from '../src/parser/banner8.js';
import { buildSchedules } from '../src/pipeline.js';
import { IcsProvider } from '../src/providers/ics-provider.js';
import { GoogleCalendarProvider, buildGoogleEvent } from '../src/providers/google-provider.js';
import { MicrosoftCalendarProvider, buildGraphEvent, toWindowsTimeZone, instancesToDelete } from '../src/providers/microsoft-provider.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'fixtures', 'banner8-detail-schedule.html'), 'utf8');

function run(options) {
  return buildSchedules(parseDetailSchedule(new JSDOM(html).window.document), options);
}

const find = (schedules, code, section) =>
  schedules.find((s) => s.courseCode === code && s.section === section);


test('builds a schedule for every meeting on the real page', () => {
  const { schedules, skipped } = run();
  assert.equal(schedules.length, 7);
  assert.deepEqual(skipped, []);
});

test('resolves the bundled Fall 2026 term from the page', () => {
  assert.equal(run().term.id, 'fall-2026');
});

test('applies holiday exclusions per class from its own meeting days', () => {
  const { schedules } = run();

  // Tue/Thu lecture: loses only the Tue/Thu of fall break.
  assert.deepEqual(find(schedules, 'COMP 1405', 'A').excludedDates, ['2026-10-27', '2026-10-29']);

  // Monday tutorial: loses Thanksgiving and the Monday of fall break...
  const tutorial = find(schedules, 'COMP 1405', 'A3');
  assert.ok(tutorial.excludedDates.includes('2026-10-12'));
  assert.ok(tutorial.excludedDates.includes('2026-10-26'));
  // ...and gains Dec 11.
  assert.deepEqual(tutorial.addedDates, ['2026-12-11']);
});

test('flags both directions of the Dec 11 schedule swap for confirmation', () => {
  const { flags } = run();
  const swaps = flags.filter((f) => f.date === '2026-12-11');

  const added = swaps.filter((f) => f.code === 'SWAP_ADDED');
  const removed = swaps.filter((f) => f.code === 'SWAP_REMOVED');

  // Monday sections gain a class: COMP 1405 A3, COMP 2402 A.
  assert.equal(added.length, 2);
  // Friday-only sections lose one: COMP 2404 A, STAT 2507 A, STAT 2507 A1.
  assert.equal(removed.length, 3);
  assert.ok(flags.every((f) => f.level === 'confirm'));
});

test('turning swaps off produces no additions and an explanatory flag', () => {
  const { schedules, flags } = run({ applyScheduleSwaps: false });

  assert.ok(schedules.every((s) => s.addedDates.length === 0));
  assert.ok(schedules.every((s) => !s.excludedDates.includes('2026-12-11')));
  assert.ok(flags.some((f) => f.code === 'SWAP_IGNORED'));
});

test('carries CRN and instructor into the event description', () => {
  const schedule = find(run().schedules, 'COMP 1405', 'A');
  assert.match(schedule.description, /CRN 30110/);
  assert.match(schedule.description, /R. Whitfield/);
  assert.match(schedule.description, /Lecture/);
});

test('omits the instructor line when Banner says TBA', () => {
  const schedule = find(run().schedules, 'STAT 2507', 'A1');
  assert.doesNotMatch(schedule.description, /Instructor:/);
  assert.match(schedule.description, /CRN 30471/);
});

test('warns rather than silently mis-scheduling an unknown term', () => {
  const doc = new JSDOM(html.replace(/Fall 2026 \(September-December\)/g, 'Fall 2099')
    .replace(/Sep 09, 2026 - Dec 11, 2026/g, 'Sep 09, 2099 - Dec 11, 2099')).window.document;
  const { schedules, flags } = buildSchedules(parseDetailSchedule(doc));

  assert.equal(schedules.length, 7, 'classes still export');
  assert.ok(schedules.every((s) => s.excludedDates.length === 0));
  assert.ok(flags.some((f) => f.code === 'UNKNOWN_TERM' && f.level === 'warning'));
});


test('ICS provider exports the whole real schedule', async () => {
  const { schedules } = run();
  const result = await new IcsProvider().exportSchedules(schedules, { dtstamp: '20260803T120000Z' });

  assert.equal(result.ok, true);
  assert.equal(result.eventCount, 7);
  assert.equal(result.filename, 'carleton-schedule.ics');

  // 7 weekly series + 2 standalone Dec 11 makeup classes (COMP 1405 A3,
  // COMP 2402 A), since Apple Calendar ignores RDATE.
  assert.equal((result.content.match(/BEGIN:VEVENT/g) || []).length, 9);
});

test('ICS output carries holiday EXDATEs and standalone makeup classes', async () => {
  const { schedules } = run();
  const { content } = await new IcsProvider().exportSchedules(schedules, { dtstamp: '20260803T120000Z' });

  assert.ok(content.includes('EXDATE;TZID=America/Toronto:20261012T160500')); // Thanksgiving, 4:05pm tutorial
  assert.ok(!content.includes('RDATE'), 'RDATE is unsupported by Apple Calendar');

  // COMP 1405 A3 meets 4:05-5:25pm; its makeup class is a standalone event.
  assert.ok(content.includes('DTSTART;TZID=America/Toronto:20261211T160500'));
});

test('ICS provider rejects an invalid schedule instead of emitting bad output', async () => {
  const result = await new IcsProvider().exportSchedules([{
    summary: 'Broken', days: ['MO'],
    startTime: { hour: 14, minute: 0 }, endTime: { hour: 13, minute: 0 }, // ends before it starts
    termStart: '2026-09-09', termEnd: '2026-12-11',
  }]);

  assert.equal(result.ok, false);
  assert.match(result.error, /ends at or before it starts/);
});

test('unwired providers refuse clearly and point at the .ics path', async () => {
  for (const provider of [new GoogleCalendarProvider(), new MicrosoftCalendarProvider()]) {
    assert.equal(provider.isAvailable, false);

    const result = await provider.exportSchedules([]);
    assert.equal(result.ok, false);
    assert.equal(result.eventCount, 0);
    assert.match(result.error, /\.ics/, 'should direct the user to the working path');
  }
});

test('Google payload omits DTSTART from recurrence and keeps EXDATE times', () => {
  const schedule = find(run().schedules, 'COMP 1405', 'A3');
  const event = buildGoogleEvent(schedule, '2026-09-14', '2026-12-07');

  assert.ok(event.recurrence.every((line) => !line.startsWith('DTSTART')), 'Google forbids DTSTART here');
  assert.equal(event.start.timeZone, 'America/Toronto');
  assert.ok(event.recurrence.some((l) => l.startsWith('RRULE:') && l.includes('BYDAY=MO')));
  assert.ok(event.recurrence.some((l) => l.includes('EXDATE') && l.includes('T160500')));
  assert.ok(event.recurrence.some((l) => l.includes('RDATE') && l.includes('20261211')));
});

test('Graph payload uses Windows zone names, not IANA', () => {
  assert.equal(toWindowsTimeZone('America/Toronto'), 'Eastern Standard Time');

  const schedule = find(run().schedules, 'COMP 1405', 'A3');
  const event = buildGraphEvent(schedule, '2026-09-14', '2026-12-07');

  assert.equal(event.start.timeZone, 'Eastern Standard Time');
  assert.equal(event.recurrence.range.recurrenceTimeZone, 'Eastern Standard Time');
  assert.deepEqual(event.recurrence.pattern.daysOfWeek, ['monday']);
});

test('Graph exclusions surface as instances to delete, since it has no EXDATE', () => {
  const schedule = find(run().schedules, 'COMP 1405', 'A3');
  const deletions = instancesToDelete(schedule);

  assert.ok(deletions.length >= 2);
  assert.ok(deletions.some((d) => d.date === '2026-10-12'));
});
