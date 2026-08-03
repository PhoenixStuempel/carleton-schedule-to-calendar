/**
 * Event detail and delivery-mode tests.
 *
 * Covers what actually lands in each calendar entry: instructor, section type,
 * whether it meets in person, CRN, and credits. Also covers conflict
 * detection, which warns about overlapping classes before export.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parseDetailSchedule } from '../src/parser/banner8.js';
import { buildSchedules } from '../src/pipeline.js';
import { classifyLocation, describeSection, findConflicts } from '../src/schedule-info.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'fixtures', 'banner8-detail-schedule.html'), 'utf8');

const realSchedules = () =>
  buildSchedules(parseDetailSchedule(new JSDOM(html).window.document)).schedules;

const find = (list, code, section) =>
  list.find((s) => s.courseCode === code && s.section === section);

// delivery mode

test('recognises a physical room as in-person', () => {
  const result = classifyLocation('Azrieli Theatre 302');
  assert.equal(result.mode, 'in-person');
  assert.equal(result.building, 'Azrieli Theatre');
  assert.equal(result.room, '302');
});

test('keeps accented building names intact', () => {
  const result = classifyLocation('Nideyinàn  (former UC) 279');
  assert.equal(result.mode, 'in-person');
  assert.match(result.building, /Nideyinàn/);
  assert.equal(result.room, '279');
});

test('recognises Carleton online delivery markers', () => {
  for (const raw of ['Online', 'ONLINE', 'Online Asynchronous', 'Virtual Classroom', 'Web Based Course']) {
    assert.equal(classifyLocation(raw).mode, 'online', `expected "${raw}" to read as online`);
  }
});

test('reads Banner\'s two-word "ON LINE" as online, not a building', () => {
  // Banner prints this exact string in the Where column, with a space. A
  // substring test for "online" misses it, and the room matcher then reports
  // a building literally named "ON LINE". Seen on a real Fall 2025 page,
  // where five of nine sections were delivered this way.
  const result = classifyLocation('ON LINE');

  assert.equal(result.mode, 'online');
  assert.equal(result.building, null);
  assert.equal(result.room, null);
});

test('online detection tolerates spacing and hyphen variants', () => {
  for (const raw of ['ON LINE', 'On-Line', 'on line', 'Web-Based', 'WEB BASED']) {
    assert.equal(classifyLocation(raw).mode, 'online', `expected "${raw}" to read as online`);
  }
});

test('treats an unassigned room as unknown, not in-person', () => {
  // Claiming a room exists when Banner says TBA would be worse than admitting
  // we do not know.
  for (const raw of ['TBA', '', null, 'To Be Announced']) {
    assert.equal(classifyLocation(raw).mode, 'unknown');
  }
});

// section types

test('names the common Carleton section types', () => {
  assert.equal(describeSection('Lecture').label, 'Lecture');
  assert.equal(describeSection('Tutorial').label, 'Tutorial');
  assert.equal(describeSection('Laboratory').label, 'Lab');
  assert.equal(describeSection('Seminar').label, 'Seminar');
  assert.equal(describeSection('Practicum').label, 'Practicum');
  assert.equal(describeSection('Workshop').label, 'Workshop');
  assert.equal(describeSection('Studio').label, 'Studio');
});

test('passes through an unrecognised section type rather than dropping it', () => {
  // Carleton adds types over time; showing the raw value beats showing nothing.
  const result = describeSection('Co-operative Education Placement');
  assert.equal(result.label, 'Co-operative Education Placement');
  assert.equal(result.known, false);
});

test('marks lectures and tutorials as known types', () => {
  assert.equal(describeSection('Lecture').known, true);
  assert.equal(describeSection('Tutorial').known, true);
});

// event detail

test('event description carries instructor, type, CRN, and credits', () => {
  const schedule = find(realSchedules(), 'COMP 1405', 'A');

  assert.match(schedule.description, /Lecture/);
  assert.match(schedule.description, /R. Whitfield/);
  assert.match(schedule.description, /30110/);
  assert.match(schedule.description, /0\.5 credit/);
});

test('event description names the building and room', () => {
  const schedule = find(realSchedules(), 'STAT 2507', 'A');
  assert.match(schedule.description, /Nideyinàn/);
  assert.match(schedule.description, /279/);
});

test('a TBA instructor is stated plainly, not silently omitted', () => {
  const schedule = find(realSchedules(), 'STAT 2507', 'A1');
  assert.match(schedule.description, /instructor to be announced/i);
});

test('zero-credit sections do not claim a credit value', () => {
  // Tutorials carry 0.000 credits; the credit belongs to the parent lecture.
  const tutorial = find(realSchedules(), 'COMP 1405', 'A3');
  assert.doesNotMatch(tutorial.description, /0 credit/);
});

test('each schedule exposes structured delivery and section data', () => {
  const schedule = find(realSchedules(), 'COMP 1405', 'A3');

  assert.equal(schedule.deliveryMode, 'in-person');
  assert.equal(schedule.building, 'Tory Building');
  assert.equal(schedule.room, '202');
  assert.equal(schedule.sectionType, 'Tutorial');
});

test('the calendar title stays short and scannable', () => {
  // Calendar apps truncate; the course code and type must survive.
  const schedule = find(realSchedules(), 'COMP 1405', 'A3');
  assert.ok(schedule.summary.length <= 60, `title too long: ${schedule.summary}`);
  assert.match(schedule.summary, /COMP 1405/);
});

// conflicts

test('reports no conflicts for a schedule that has none', () => {
  assert.deepEqual(findConflicts(realSchedules()), []);
});

test('detects two classes overlapping on the same day', () => {
  const conflicts = findConflicts([
    { id: 'a', courseCode: 'COMP 1001', section: 'A', days: ['MO'],
      startTime: { hour: 10, minute: 0 }, endTime: { hour: 11, minute: 30 } },
    { id: 'b', courseCode: 'MATH 1002', section: 'B', days: ['MO'],
      startTime: { hour: 11, minute: 0 }, endTime: { hour: 12, minute: 0 } },
  ]);

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].day, 'MO');
  assert.equal(conflicts[0].overlapMinutes, 30);
});

test('does not flag classes that merely touch end to start', () => {
  const conflicts = findConflicts([
    { id: 'a', courseCode: 'A', section: '1', days: ['MO'],
      startTime: { hour: 10, minute: 0 }, endTime: { hour: 11, minute: 0 } },
    { id: 'b', courseCode: 'B', section: '1', days: ['MO'],
      startTime: { hour: 11, minute: 0 }, endTime: { hour: 12, minute: 0 } },
  ]);
  assert.deepEqual(conflicts, []);
});

test('does not flag the same times on different days', () => {
  const conflicts = findConflicts([
    { id: 'a', courseCode: 'A', section: '1', days: ['MO'],
      startTime: { hour: 10, minute: 0 }, endTime: { hour: 11, minute: 0 } },
    { id: 'b', courseCode: 'B', section: '1', days: ['TU'],
      startTime: { hour: 10, minute: 0 }, endTime: { hour: 11, minute: 0 } },
  ]);
  assert.deepEqual(conflicts, []);
});

test('ignores classes the user has unticked', () => {
  const conflicts = findConflicts([
    { id: 'a', courseCode: 'A', section: '1', days: ['MO'], enabled: false,
      startTime: { hour: 10, minute: 0 }, endTime: { hour: 11, minute: 30 } },
    { id: 'b', courseCode: 'B', section: '1', days: ['MO'],
      startTime: { hour: 11, minute: 0 }, endTime: { hour: 12, minute: 0 } },
  ]);
  assert.deepEqual(conflicts, []);
});

test('reports a back-to-back pair with no travel time between buildings', () => {
  // Ten minutes to cross campus between different buildings is worth knowing.
  const conflicts = findConflicts([
    { id: 'a', courseCode: 'A', section: '1', days: ['MO'], building: 'Azrieli Theatre',
      startTime: { hour: 10, minute: 0 }, endTime: { hour: 11, minute: 0 } },
    { id: 'b', courseCode: 'B', section: '1', days: ['MO'], building: 'Health Science Building',
      startTime: { hour: 11, minute: 5 }, endTime: { hour: 12, minute: 0 } },
  ], { tightTurnaroundMinutes: 10 });

  const tight = conflicts.filter((c) => c.kind === 'tight-turnaround');
  assert.equal(tight.length, 1);
  assert.equal(tight[0].gapMinutes, 5);
});

test('does not warn about a tight gap within the same building', () => {
  const conflicts = findConflicts([
    { id: 'a', courseCode: 'A', section: '1', days: ['MO'], building: 'Tory Building',
      startTime: { hour: 10, minute: 0 }, endTime: { hour: 11, minute: 0 } },
    { id: 'b', courseCode: 'B', section: '1', days: ['MO'], building: 'Tory Building',
      startTime: { hour: 11, minute: 5 }, endTime: { hour: 12, minute: 0 } },
  ], { tightTurnaroundMinutes: 10 });

  assert.deepEqual(conflicts.filter((c) => c.kind === 'tight-turnaround'), []);
});

test('does not warn about travel time when either class is online', () => {
  const conflicts = findConflicts([
    { id: 'a', courseCode: 'A', section: '1', days: ['MO'], deliveryMode: 'online',
      startTime: { hour: 10, minute: 0 }, endTime: { hour: 11, minute: 0 } },
    { id: 'b', courseCode: 'B', section: '1', days: ['MO'], building: 'Tory Building',
      startTime: { hour: 11, minute: 5 }, endTime: { hour: 12, minute: 0 } },
  ], { tightTurnaroundMinutes: 10 });

  assert.deepEqual(conflicts.filter((c) => c.kind === 'tight-turnaround'), []);
});
