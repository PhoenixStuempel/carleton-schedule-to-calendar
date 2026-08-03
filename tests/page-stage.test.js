/**
 * Stage detection: which Carleton Central page the popup is looking at.
 *
 * Getting this wrong is user-visible and confusing. Reading the week-grid
 * timetable as the schedule reports "no classes found" on a page that plainly
 * shows classes, and missing the term picker leaves the popup telling someone
 * to navigate somewhere they already are.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

import { detectStage, STAGE } from '../src/page-stage.js';

const here = dirname(fileURLToPath(import.meta.url));
const docOf = (html) => new JSDOM(html).window.document;

test('reads a real Detail Schedule page as the schedule', () => {
  const html = readFileSync(join(here, 'fixtures', 'banner8-detail-schedule.html'), 'utf8');
  assert.equal(detectStage(docOf(html)), STAGE.SCHEDULE);
});

test('SILENT-FAILURE GUARD: the week-grid timetable is not the schedule', () => {
  // Student Timetable uses the same table class as Detail Schedule but has no
  // meeting-times caption. Matching on the class alone made this look like the
  // schedule, so the popup scraped it and reported no classes.
  const timetable = docOf(`
    <h2>Student Timetable</h2>
    <table class="datadisplaytable">
      <tr><td>COMP 3999-A</td></tr>
    </table>
    <a href="/prod/bwskfshd.P_CrseSchdDetl">Detail Schedule</a>`);

  assert.equal(detectStage(timetable), STAGE.CARLETON_OTHER);
});

test('recognises the term picker by its select', () => {
  const picker = docOf(`
    <h2>Registration Term</h2>
    <form action="/prod/bwskfshd.P_CrseSchdDetl" method="post">
      <select name="term_in">
        <option value="202530">Fall 2025 (September-December)</option>
      </select>
      <input type="submit" value="Submit">
    </form>`);

  assert.equal(detectStage(picker), STAGE.TERM_PICKER);
});

test('recognises the login page', () => {
  const login = docOf(`
    <form>
      <label>User ID</label><input type="text" name="sid">
      <label>Password</label><input type="password" name="PIN">
    </form>`);

  assert.equal(detectStage(login), STAGE.LOGIN);
});

test('does not call a page login just because it says password', () => {
  // A help page can mention passwords without being one. Without the input
  // check this would strand the user on "log in to continue".
  const article = docOf('<p>Forgot your password? Contact the service desk.</p>');
  assert.equal(detectStage(article), STAGE.CARLETON_OTHER);
});

test('falls back to carleton-other for an unrecognised page', () => {
  assert.equal(detectStage(docOf('<h2>Main Menu</h2><a href="#">Records</a>')), STAGE.CARLETON_OTHER);
});
