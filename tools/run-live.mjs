/**
 * Runs a saved live Carleton Central page through the real extension pipeline
 * and reports what would land in the calendar.
 *
 * Same modules the extension loads: parser -> pipeline -> IcsProvider.
 * Nothing is mocked, and the output .ics is the exact bytes the extension
 * would download.
 *
 *   node tools/run-live.mjs [path-to-saved-page.html]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import ICAL from 'ical.js';

import { parseDetailSchedule } from '../src/parser/banner8.js';
import { buildSchedules } from '../src/pipeline.js';
import { IcsProvider } from '../src/providers/ics-provider.js';
import { formatTime } from '../extension/preview/week-grid.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = process.argv[2] || join(root, 'live-page.html');

if (!existsSync(pagePath)) {
  console.error(`No page found at ${pagePath}`);
  console.error('Save your schedule page there first, then re-run.');
  process.exit(1);
}

const html = readFileSync(pagePath, 'utf8');
console.log(`Read ${(html.length / 1024).toFixed(1)} KB from ${pagePath}\n`);

const parsed = parseDetailSchedule(new JSDOM(html).window.document);

if (!parsed.isSchedulePage) {
  console.error('This does not look like a Student Detail Schedule page.');
  console.error('It has no course tables. Check that you saved the right page.');
  process.exit(1);
}

// Student identity is dropped immediately, exactly as the extension does.
const term = parsed.header.term;
parsed.header = { term, studentName: null, studentNumber: null };

console.log('='.repeat(58));
console.log(' PARSED');
console.log('='.repeat(58));
console.log(`Term: ${term}`);
console.log(`Sections: ${parsed.courses.length}`);

for (const course of parsed.courses) {
  for (const meeting of course.meetings) {
    const when = meeting.isSchedulable
      ? `${meeting.days.join('')} ${formatTime(meeting.startTime)}-${formatTime(meeting.endTime)}`
      : 'not schedulable';
    console.log(`  ${(course.courseCode + ' ' + course.section).padEnd(16)} `
      + `${(course.title || '').slice(0, 34).padEnd(35)} ${when}`);
    console.log(`  ${''.padEnd(16)} ${(meeting.scheduleType || '').padEnd(35)} ${meeting.location || ''}`);
  }
}

if (parsed.warnings.length) {
  console.log('\nParser warnings:');
  for (const w of parsed.warnings) console.log(`  [${w.code}] ${w.message}`);
}

const { schedules, flags, skipped, term: resolvedTerm } = buildSchedules(parsed);

console.log(`\n${'='.repeat(58)}`);
console.log(' ACADEMIC CALENDAR');
console.log('='.repeat(58));

if (!resolvedTerm) {
  console.log(`No bundled term data matched "${term}".`);
  console.log('Classes would repeat weekly with NO breaks excluded.');
  console.log('Add this term to src/calendar/carleton-terms.js.');
} else {
  console.log(`Matched: ${resolvedTerm.label} (${resolvedTerm.startDate} to ${resolvedTerm.endDate})`);
  for (const h of resolvedTerm.holidays) console.log(`  holiday   ${h.date}  ${h.label}`);
  for (const b of resolvedTerm.breaks) console.log(`  break     ${b.startDate}..${b.endDate}  ${b.label}`);
  for (const s of resolvedTerm.scheduleSwaps) console.log(`  swap      ${s.date}  runs a ${s.runsScheduleFor} schedule`);
  for (const n of resolvedTerm.notHolidays) console.log(`  NOT off   ${n.date}  ${n.label} (classes run)`);
}

if (flags.length) {
  console.log('\nFlagged for confirmation:');
  for (const f of flags) console.log(`  ${f.scope.padEnd(16)} ${f.message}`);
}
if (skipped.length) {
  console.log('\nSkipped:');
  for (const s of skipped) console.log(`  ${s.label}: ${s.reason}`);
}

const result = await new IcsProvider().exportSchedules(schedules);
if (!result.ok) {
  console.error(`\nExport failed: ${result.error}`);
  process.exit(1);
}

const outPath = join(root, 'live-output.ics');
writeFileSync(outPath, result.content, 'utf8');

console.log(`\n${'='.repeat(58)}`);
console.log(' CALENDAR OUTPUT');
console.log('='.repeat(58));

// Re-parse with a third-party library so occurrence counts are checked by
// something other than the code that produced them.
const comp = new ICAL.Component(ICAL.parse(result.content));
const vevents = comp.getAllSubcomponents('vevent');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

console.log(`${vevents.length} events, ${(result.content.length / 1024).toFixed(1)} KB`);
console.log(`VTIMEZONE: ${comp.getAllSubcomponents('vtimezone').length ? 'yes' : 'MISSING'}`);
console.log(`RDATE (must be none, Apple ignores it): ${result.content.includes('RDATE') ? 'PRESENT' : 'none'}\n`);

let total = 0;
for (const ve of vevents) {
  const event = new ICAL.Event(ve);
  const summary = event.summary;

  if (!ve.getFirstPropertyValue('rrule')) {
    const d = event.startDate.toJSDate();
    console.log(`${summary}`);
    console.log(`  one-off  ${d.toISOString().slice(0, 10)} (${DAYS[d.getDay()]})  makeup class`);
    total += 1;
    continue;
  }

  const dates = [];
  const it = event.iterator();
  for (let n = it.next(); n && dates.length < 300; n = it.next()) {
    dates.push(n.toJSDate());
  }
  total += dates.length;

  console.log(`${summary}`);
  console.log(`  ${dates.length} classes, ${dates[0].toISOString().slice(0, 10)} to `
    + `${dates[dates.length - 1].toISOString().slice(0, 10)}`);

  const exdates = ve.getAllProperties('exdate')
    .map((p) => p.getFirstValue().toJSDate().toISOString().slice(0, 10));
  if (exdates.length) console.log(`  skipping ${exdates.join(', ')}`);
}

console.log(`\nTotal class occurrences: ${total}`);
console.log(`\nWrote ${outPath}`);
console.log('Import that file to check it in a real calendar app.');
