/**
 * Week-grid layout tests. Geometry is pure and testable independently of DOM.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parseDetailSchedule } from '../src/parser/banner8.js';
import { buildSchedules } from '../src/pipeline.js';
import {
  layoutWeek, computeTimeBounds, visibleDays, formatTime, formatHour,
} from '../extension/preview/week-grid.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'fixtures', 'banner8-detail-schedule.html'), 'utf8');

function realSchedules() {
  return buildSchedules(parseDetailSchedule(new JSDOM(html).window.document)).schedules;
}

test('places one block per meeting day', () => {
  const { blocks } = layoutWeek(realSchedules());
  // 7 sections: TR(2) + M(1) + MW(2) + TR(2) + WF(2) + WF(2) + F(1) = 12 blocks
  assert.equal(blocks.length, 12);
});

test('derives the time window from the actual classes', () => {
  // Real schedule runs 10:05 am to 6:55 pm; padded an hour each way.
  const { startHour, endHour } = computeTimeBounds(realSchedules());
  assert.equal(startHour, 9);
  assert.equal(endHour, 20);
});

test('hides unused weekend columns but keeps every weekday', () => {
  const days = visibleDays(realSchedules());
  assert.deepEqual(days, ['MO', 'TU', 'WE', 'TH', 'FR']);
});

test('shows a weekend column when a class actually meets then', () => {
  const days = visibleDays([{ days: ['MO', 'SA'], enabled: true }]);
  assert.ok(days.includes('SA'));
  assert.ok(!days.includes('SU'));
});

test('positions a block proportionally within the window', () => {
  const { blocks } = layoutWeek(
    [{ id: 'x', days: ['MO'], startTime: { hour: 10, minute: 0 }, endTime: { hour: 11, minute: 0 } }],
    { startHour: 9, endHour: 19 }, // 10-hour window
  );
  // 10:00 is 1h into a 10h window -> 10%; a 1h class -> 10% tall.
  assert.equal(blocks[0].topPercent, 10);
  assert.equal(blocks[0].heightPercent, 10);
});

test('lays overlapping classes side by side instead of hiding one', () => {
  const { blocks } = layoutWeek([
    { id: 'a', days: ['MO'], startTime: { hour: 10, minute: 0 }, endTime: { hour: 11, minute: 30 } },
    { id: 'b', days: ['MO'], startTime: { hour: 11, minute: 0 }, endTime: { hour: 12, minute: 0 } },
  ]);

  assert.equal(blocks.length, 2);
  assert.ok(blocks.every((b) => b.columnCount === 2), 'overlapping blocks should share a cluster');
  assert.deepEqual(blocks.map((b) => b.column).sort(), [0, 1]);
});

test('keeps back-to-back classes full width', () => {
  // A class ending exactly when the next starts does not overlap.
  const { blocks } = layoutWeek([
    { id: 'a', days: ['MO'], startTime: { hour: 10, minute: 0 }, endTime: { hour: 11, minute: 0 } },
    { id: 'b', days: ['MO'], startTime: { hour: 11, minute: 0 }, endTime: { hour: 12, minute: 0 } },
  ]);
  assert.ok(blocks.every((b) => b.columnCount === 1));
});

test('overlap detection is per-day, not global', () => {
  const { blocks } = layoutWeek([
    { id: 'a', days: ['MO'], startTime: { hour: 10, minute: 0 }, endTime: { hour: 11, minute: 0 } },
    { id: 'b', days: ['TU'], startTime: { hour: 10, minute: 0 }, endTime: { hour: 11, minute: 0 } },
  ]);
  assert.ok(blocks.every((b) => b.columnCount === 1), 'same time on different days must not collide');
});

test('the real schedule has no same-day time conflicts', () => {
  // COMP 2804 and COMP 2404 share 1:05-2:25pm but on different days.
  const { blocks } = layoutWeek(realSchedules());
  assert.ok(blocks.every((b) => b.columnCount === 1));
});

test('disabled classes leave the grid entirely', () => {
  const schedules = realSchedules();
  schedules[0].enabled = false;
  const { blocks } = layoutWeek(schedules);

  assert.ok(blocks.every((b) => b.scheduleId !== schedules[0].id));
  assert.equal(blocks.length, 10); // dropped a TR class = 2 blocks
});

test('flags blocks whose dates were adjusted by a schedule swap', () => {
  const { blocks } = layoutWeek(realSchedules());
  const monday = blocks.find((b) => b.schedule.courseCode === 'COMP 1405' && b.day === 'MO');

  assert.ok(monday.hasFlag, 'the Dec 11 addition should be visible on the block');
});

test('renders an empty grid rather than throwing when nothing is enabled', () => {
  const { blocks, days, hours } = layoutWeek([]);
  assert.deepEqual(blocks, []);
  assert.equal(days.length, 5);
  assert.ok(hours.length > 0);
});

test('formats times for display', () => {
  assert.equal(formatTime({ hour: 14, minute: 35 }), '2:35 pm');
  assert.equal(formatTime({ hour: 10, minute: 5 }), '10:05 am');
  assert.equal(formatTime({ hour: 12, minute: 0 }), '12:00 pm');
  assert.equal(formatTime({ hour: 0, minute: 30 }), '12:30 am');
  assert.equal(formatHour(13), '1 pm');
  assert.equal(formatHour(9), '9 am');
});
