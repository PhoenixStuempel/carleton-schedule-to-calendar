/**
 * Parser tests run against the user's REAL Carleton Central page
 * (sanitized: student name/number replaced, structure untouched).
 *
 * Expected values below are transcribed from that page, so a pass means the
 * parser works on genuine Banner output rather than on invented markup.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parseDetailSchedule, __testables } from '../src/parser/banner8.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(join(here, 'fixtures', 'banner8-detail-schedule.html'), 'utf8');

function parseFixture() {
  return parseDetailSchedule(new JSDOM(fixtureHtml).window.document);
}

function findSection(result, courseCode, section) {
  return result.courses.find((c) => c.courseCode === courseCode && c.section === section);
}

test('detects the page as a schedule page', () => {
  assert.equal(parseFixture().isSchedulePage, true);
});

test('extracts all seven registered sections', () => {
  const result = parseFixture();
  assert.equal(result.courses.length, 7);

  const codes = result.courses.map((c) => `${c.courseCode} ${c.section}`);
  assert.deepEqual(codes, [
    'COMP 1405 A',
    'COMP 1405 A3',
    'COMP 2402 A',
    'COMP 2804 A',
    'COMP 2404 A',
    'STAT 2507 A',
    'STAT 2507 A1',
  ]);
});

test('reads the term from the page header', () => {
  const { header } = parseFixture();
  assert.equal(header.term, 'Fall 2026 (September-December)');
});

test('splits course title, code, and section', () => {
  const course = findSection(parseFixture(), 'COMP 1405', 'A');
  assert.equal(course.title, 'Introduction to Computer Science');
  assert.equal(course.subject, 'COMP');
  assert.equal(course.courseNumber, '1405');
  assert.equal(course.section, 'A');
  assert.equal(course.crn, '30110');
});

test('parses a Tuesday/Thursday lecture correctly (R means Thursday)', () => {
  const meeting = findSection(parseFixture(), 'COMP 1405', 'A').meetings[0];

  assert.deepEqual(meeting.days, ['TU', 'TH']);
  assert.deepEqual(meeting.startTime, { hour: 14, minute: 35 }); // 2:35 pm
  assert.deepEqual(meeting.endTime, { hour: 15, minute: 55 }); // 3:55 pm
  assert.equal(meeting.location, 'Azrieli Theatre 302');
  assert.equal(meeting.scheduleType, 'Lecture');
  assert.equal(meeting.startDate, '2026-09-09');
  assert.equal(meeting.endDate, '2026-12-11');
  assert.equal(meeting.isSchedulable, true);
});

test('keeps a tutorial section separate from its parent lecture', () => {
  // COMP 1405 A3 is a distinct CRN meeting Mondays; merging it into the
  // lecture would lose a real calendar entry.
  const tutorial = findSection(parseFixture(), 'COMP 1405', 'A3');

  assert.equal(tutorial.crn, '30114');
  assert.deepEqual(tutorial.meetings[0].days, ['MO']);
  assert.equal(tutorial.meetings[0].scheduleType, 'Tutorial');
  assert.equal(tutorial.meetings[0].location, 'Tory Building 202');
});

test('parses a single-day Friday tutorial', () => {
  const meeting = findSection(parseFixture(), 'STAT 2507', 'A1').meetings[0];

  assert.deepEqual(meeting.days, ['FR']);
  assert.deepEqual(meeting.startTime, { hour: 17, minute: 35 });
  assert.deepEqual(meeting.endTime, { hour: 18, minute: 25 });
});

test('treats a TBA instructor as no instructors, not the literal string', () => {
  const meeting = findSection(parseFixture(), 'STAT 2507', 'A1').meetings[0];
  assert.deepEqual(meeting.instructors, []);
});

test('strips the (P) primary marker and collapses padded instructor names', () => {
  const meeting = findSection(parseFixture(), 'COMP 1405', 'A').meetings[0];
  assert.deepEqual(meeting.instructors, ['R. Whitfield']);
});

test('preserves non-ASCII building names', () => {
  // "Nideyinàn": a mangled accent here means a mojibake bug in the pipeline.
  const meeting = findSection(parseFixture(), 'STAT 2507', 'A').meetings[0];
  assert.match(meeting.location, /Nideyinàn/);
  assert.equal(meeting.location, 'Nideyinàn (former UC) 279');
});

test('every meeting in the fixture is schedulable', () => {
  const result = parseFixture();
  const meetings = result.courses.flatMap((c) => c.meetings);

  assert.equal(meetings.length, 7);
  assert.ok(
    meetings.every((m) => m.isSchedulable),
    'expected all real meetings to have time, days, and a date range',
  );
});

test('produces no warnings for this clean fixture', () => {
  assert.deepEqual(parseFixture().warnings, []);
});

// unit coverage for the tricky format helpers

test('parses all Banner day codes including weekends', () => {
  const { parseDays } = __testables;
  assert.deepEqual(parseDays('MWF').days, ['MO', 'WE', 'FR']);
  assert.deepEqual(parseDays('TR').days, ['TU', 'TH']);
  assert.deepEqual(parseDays('SU').days, ['SA', 'SU']);
  assert.deepEqual(parseDays('TBA').days, []);
});

test('reports unknown day codes instead of dropping them', () => {
  const { parseDays } = __testables;
  const result = parseDays('MXF');
  assert.deepEqual(result.days, ['MO', 'FR']);
  assert.deepEqual(result.unknown, ['X']);
});

test('handles noon and midnight boundaries', () => {
  const { parseClockTime } = __testables;
  assert.deepEqual(parseClockTime('12:00 pm'), { hour: 12, minute: 0 }); // noon
  assert.deepEqual(parseClockTime('12:30 am'), { hour: 0, minute: 30 }); // after midnight
  assert.deepEqual(parseClockTime('11:59 pm'), { hour: 23, minute: 59 });
});

test('rejects malformed times rather than guessing', () => {
  const { parseClockTime, parseTimeRange } = __testables;
  assert.equal(parseClockTime('25:00 pm'), null);
  assert.equal(parseClockTime('2:75 pm'), null);
  assert.equal(parseClockTime('garbage'), null);
  assert.equal(parseTimeRange('TBA'), null);
});

test('parses Banner date format', () => {
  const { parseDate, parseDateRange } = __testables;
  assert.equal(parseDate('Sep 09, 2026'), '2026-09-09');
  assert.equal(parseDate('Dec 11, 2026'), '2026-12-11');
  assert.equal(parseDate('not a date'), null);
  assert.deepEqual(parseDateRange('Sep 09, 2026 - Dec 11, 2026'), {
    startDate: '2026-09-09',
    endDate: '2026-12-11',
  });
});

test('splits course titles that themselves contain a hyphen', () => {
  const { parseCourseTitle } = __testables;
  const parsed = parseCourseTitle('Data Structures - Advanced - COMP 2402 - B');
  assert.equal(parsed.title, 'Data Structures - Advanced');
  assert.equal(parsed.courseCode, 'COMP 2402');
  assert.equal(parsed.section, 'B');
});
