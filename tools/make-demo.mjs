/**
 * Builds the schedule used in the Web Store screenshots.
 *
 * The test fixture is a sanitized copy of a real schedule: the name and student
 * number are gone, but the courses, instructors, and CRNs are not. Publishing
 * screenshots of it would put a real person's course load and their professors
 * in the Store listing.
 *
 * This produces an invented schedule in the same Banner markup. Building names
 * and room numbers stay real, since those are public campus information and
 * make the screenshots recognisable to students.
 *
 *   node tools/make-demo.mjs
 *
 * Writes tools/demo-schedule.html, which shoot-store.mjs renders.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * An invented but plausible second-year schedule, built to show the features
 * the listing is selling:
 *
 *   - a Monday-only tutorial, so the Dec 11 substitution ADDS a class
 *   - a Friday-meeting lecture, so the same day REMOVES one
 *   - a 10-minute gap between two buildings, so the tight-gap warning fires
 *   - an online section, so delivery mode shows
 *   - a lab, so section types beyond lecture and tutorial appear
 *   - a late-afternoon block, so the grid is not all morning
 */
const DEMO = [
  {
    title: 'Introduction to Computer Science',
    code: 'COMP 1405',
    section: 'A',
    crn: '30110',
    instructor: 'R. Whitfield',
    credits: '0.500',
    type: 'Lecture',
    time: '10:05 am - 11:25 am',
    days: 'TR',
    where: 'Azrieli Theatre 101',
  },
  {
    title: 'Introduction to Computer Science',
    code: 'COMP 1405',
    section: 'A2',
    crn: '30114',
    instructor: 'R. Whitfield',
    credits: '0.000',
    type: 'Tutorial',
    time: '1:05 pm - 2:25 pm',
    days: 'M',
    where: 'Tory Building 342',
  },
  {
    title: 'Discrete Structures I',
    code: 'MATH 1800',
    section: 'B',
    crn: '30231',
    instructor: 'D. Marchetti',
    credits: '0.500',
    type: 'Lecture',
    time: '8:35 am - 9:55 am',
    days: 'MW',
    where: 'Richcraft Hall 2200',
  },
  {
    title: 'Foundations of Data Science',
    code: 'STAT 2507',
    section: 'C',
    crn: '30348',
    instructor: 'P. Oyelaran',
    credits: '0.500',
    type: 'Lecture',
    time: '1:05 pm - 2:25 pm',
    days: 'TF',
    where: 'Nideyinàn (former UC) 279',
  },
  {
    title: 'Foundations of Data Science',
    code: 'STAT 2507',
    section: 'C4',
    crn: '30352',
    instructor: 'TBA',
    credits: '0.000',
    type: 'Laboratory',
    time: '2:35 pm - 3:55 pm',
    days: 'W',
    where: 'Herzberg Laboratories 4385',
  },
  {
    title: 'Technical Communication',
    code: 'ENGL 2005',
    section: 'D',
    crn: '30467',
    instructor: 'M. Deshpande',
    credits: '0.500',
    type: 'Lecture',
    time: '11:35 am - 12:55 pm',
    days: 'TR',
    where: 'ON LINE',
  },
  {
    title: 'Ethics and Technology',
    code: 'PHIL 2103',
    section: 'A',
    crn: '30512',
    instructor: 'S. Bergeron',
    credits: '0.500',
    type: 'Lecture',
    // Starts 10 minutes after the STAT lab ends, in a different building, so
    // the tight-gap warning has something real to report.
    time: '4:05 pm - 5:25 pm',
    days: 'MW',
    where: 'Mackenzie Building 3380',
  },
];

const TERM = 'Fall 2026 (September-December)';
const RANGE = 'Sep 09, 2026 - Dec 11, 2026';

const courseBlock = (c) => `
<table class="datadisplaytable" summary="This layout table is used to present the schedule course detail">
<tbody><tr><th colspan="3" class="ddtitle" scope="colgroup"><a href="http://culearn.carleton.ca/">${c.title} - ${c.code} - ${c.section}</a></th>
</tr><tr>
<th colspan="2" class="ddlabel" scope="row">Associated Term:</th>
<td class="dddefault">${TERM}</td>
</tr>
<tr>
<th colspan="2" class="ddlabel" scope="row"><acronym title="Course Reference Number">CRN</acronym>:</th>
<td class="dddefault">${c.crn}</td>
</tr>
<tr>
<th colspan="2" class="ddlabel" scope="row">Status:</th>
<td class="dddefault">Registered on Jul 14, 2026</td>
</tr>
<tr>
<th colspan="2" class="ddlabel" scope="row">Assigned Instructor:</th>
<td class="dddefault">
${c.instructor}
</td>
</tr>
<tr>
<th colspan="2" class="ddlabel" scope="row">Grade Mode:</th>
<td class="dddefault">Standard Letter Grade</td>
</tr>
<tr>
<th colspan="2" class="ddlabel" scope="row">Credits:</th>
<td class="dddefault">    ${c.credits}</td>
</tr>
<tr>
<th colspan="2" class="ddlabel" scope="row">Level:</th>
<td class="dddefault">Undergraduate</td>
</tr>
<tr>
<th colspan="2" class="ddlabel" scope="row">Campus:</th>
<td class="dddefault">Main Campus</td>
</tr>
</tbody></table>
<table class="datadisplaytable" summary="This table lists the scheduled meeting times and assigned instructors for this class.">
<caption class="captiontext">Scheduled Meeting Times</caption>
<tbody><tr>
<th class="ddheader" scope="col">Type</th>
<th class="ddheader" scope="col">Time</th>
<th class="ddheader" scope="col">Days</th>
<th class="ddheader" scope="col">Where</th>
<th class="ddheader" scope="col">Date Range</th>
<th class="ddheader" scope="col">Schedule Type</th>
<th class="ddheader" scope="col">Instructors</th>
</tr>
<tr>
<td class="dddefault">Class</td>
<td class="dddefault">${c.time}</td>
<td class="dddefault">${c.days}</td>
<td class="dddefault">${c.where}</td>
<td class="dddefault">${RANGE}</td>
<td class="dddefault">${c.type}</td>
<td class="dddefault">${c.instructor}</td>
</tr>
</tbody></table>
<p></p>`;

const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Student Detail Schedule</title></head>
<body class="ctbannerBODY">
<div class="pagetitlediv"><h2>Student Detail Schedule</h2></div>
<div class="staticheaders">
000000000 Test Student<br>
${TERM}<br>
Aug 03, 2026 04:22 pm<br>
</div>
<div class="pagebodydiv">
Total Credit Hours: 2.500
<br><br>
${DEMO.map(courseBlock).join('\n')}
</div>
</body>
</html>
`;

const out = join(root, 'tools', 'demo-schedule.html');
await writeFile(out, html, 'utf8');

// Sanity check: a demo that does not parse would silently produce empty
// screenshots, and the whole point is that these get published.
const { JSDOM } = await import('jsdom');
const { parseDetailSchedule } = await import('../src/parser/banner8.js');
const parsed = parseDetailSchedule(new JSDOM(html).window.document);

if (!parsed.isSchedulePage || parsed.courses.length !== DEMO.length) {
  console.error(`Demo did not parse: ${parsed.courses.length} of ${DEMO.length} courses`);
  process.exit(1);
}

// Guard against a real name slipping back in from the fixture.
const real = ['Somayaji', 'Orogat', 'Junfeng', 'Rabinovich', 'Stuempel'];
const leaked = real.filter((n) => html.includes(n));
if (leaked.length) {
  console.error(`Demo contains a real name: ${leaked.join(', ')}`);
  process.exit(1);
}

console.log(`Wrote ${out}`);
console.log(`  ${parsed.courses.length} courses, ${parsed.courses.flatMap((c) => c.meetings).length} meetings`);

// The preview page falls back to this when opened outside the extension, which
// is how the Store screenshots are taken. It used to hold a real course load.
parsed.header = { term: parsed.header.term, studentName: null, studentNumber: null };
const samplePath = join(root, 'extension', 'preview', 'sample-parsed.json');
await writeFile(samplePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
console.log(`Wrote ${samplePath}`);
