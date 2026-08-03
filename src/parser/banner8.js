/**
 * Parser for Carleton Central "Student Detail Schedule" pages.
 *
 * Target: Banner 8.7.1 classic server-rendered HTML at
 * https://central.carleton.ca/prod/bwskfshd.P_CrseSchdDetl
 *
 * Page shape: pairs of <table class="datadisplaytable">. The first table of a
 * pair holds course metadata (title/code/section in a th.ddtitle, then
 * label/value rows). The second holds a "Scheduled Meeting Times" grid. A
 * course with no meeting table (fully async/TBA) still yields a course record
 * with zero meetings, which the caller surfaces rather than silently drops.
 */

const DAY_CODES = Object.freeze({
  M: 'MO',
  T: 'TU',
  W: 'WE',
  R: 'TH', // Banner uses R for Thursday to disambiguate from Tuesday.
  F: 'FR',
  S: 'SA',
  U: 'SU',
});

const MONTHS = Object.freeze({
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
});

/** Collapses runs of whitespace (incl. &nbsp;) and trims. */
function normalizeText(value) {
  return (value || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Splits a Banner course title cell into its parts.
 * "Introduction to Computer Science - COMP 1405 - A" -> title/subject/courseNumber/section
 *
 * Split from the right: course titles may themselves contain " - ", but the
 * final two hyphen-separated fields are always course code and section.
 */
function parseCourseTitle(raw) {
  const text = normalizeText(raw);
  const parts = text.split(' - ');

  if (parts.length < 3) {
    return { title: text, subject: null, courseNumber: null, section: null, courseCode: null };
  }

  const section = parts[parts.length - 1];
  const courseCode = parts[parts.length - 2];
  const title = parts.slice(0, parts.length - 2).join(' - ');
  const codeMatch = courseCode.match(/^([A-Za-z]+)\s+(\S+)$/);

  return {
    title,
    subject: codeMatch ? codeMatch[1].toUpperCase() : null,
    courseNumber: codeMatch ? codeMatch[2] : null,
    section,
    courseCode,
  };
}

/**
 * "TR" -> ['TU','TH']. Unknown characters are reported rather than dropped, so
 * an unexpected Banner day code becomes a visible warning instead of a class
 * silently missing from the calendar.
 */
function parseDays(raw) {
  const text = normalizeText(raw);
  if (!text || text.toUpperCase() === 'TBA') return { days: [], unknown: [] };

  const days = [];
  const unknown = [];
  for (const char of text.replace(/\s/g, '')) {
    const mapped = DAY_CODES[char.toUpperCase()];
    if (mapped) {
      if (!days.includes(mapped)) days.push(mapped);
    } else {
      unknown.push(char);
    }
  }
  return { days, unknown };
}

/** "2:35 pm" -> {hour: 14, minute: 35} in 24-hour form. */
function parseClockTime(raw) {
  const match = normalizeText(raw).match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (!match) return null;

  const minute = Number(match[2]);
  const meridiem = match[3].toLowerCase();
  let hour = Number(match[1]);

  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (meridiem === 'p' && hour !== 12) hour += 12;
  if (meridiem === 'a' && hour === 12) hour = 0; // 12:xx am is midnight.

  return { hour, minute };
}

/** "2:35 pm - 3:55 pm" -> {start, end}. Returns null for TBA/unparseable. */
function parseTimeRange(raw) {
  const text = normalizeText(raw);
  if (!text || text.toUpperCase() === 'TBA') return null;

  const parts = text.split(/\s*-\s*/);
  if (parts.length !== 2) return null;

  const start = parseClockTime(parts[0]);
  const end = parseClockTime(parts[1]);
  if (!start || !end) return null;

  return { start, end };
}

/** "Sep 09, 2026" -> "2026-09-09" (ISO date, no timezone implied). */
function parseDate(raw) {
  const match = normalizeText(raw).match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/);
  if (!match) return null;

  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  if (!month || day < 1 || day > 31) return null;

  return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "Sep 09, 2026 - Dec 11, 2026" -> {startDate, endDate} as ISO strings. */
function parseDateRange(raw) {
  const text = normalizeText(raw);
  if (!text || text.toUpperCase() === 'TBA') return null;

  const parts = text.split(/\s*-\s*/);
  if (parts.length !== 2) return null;

  const startDate = parseDate(parts[0]);
  const endDate = parseDate(parts[1]);
  if (!startDate || !endDate) return null;

  return { startDate, endDate };
}

/**
 * "R.   Whitfield (P)" -> "R. Whitfield". Banner pads names with extra
 * spaces and appends a primary-instructor marker via <abbr>.
 */
function parseInstructors(raw) {
  const text = normalizeText(raw);
  if (!text || text.toUpperCase() === 'TBA') return [];

  return text
    .split(',')
    .map((name) => normalizeText(name.replace(/\((P|Primary)\)/gi, '')))
    .filter(Boolean);
}

/** Reads the "label: value" rows of a course-info table into a map. */
function extractCourseFields(table) {
  const fields = {};
  for (const row of table.querySelectorAll('tr')) {
    const label = row.querySelector('th.ddlabel');
    const value = row.querySelector('td.dddefault');
    if (!label || !value) continue;

    const key = normalizeText(label.textContent).replace(/:$/, '');
    if (key) fields[key.toLowerCase()] = normalizeText(value.textContent);
  }
  return fields;
}

/**
 * Maps the "Scheduled Meeting Times" header row to column indices, so the
 * parser survives Banner reordering or adding columns.
 */
function mapMeetingColumns(table) {
  const headers = [...table.querySelectorAll('th.ddheader')];
  const index = {};
  headers.forEach((header, position) => {
    index[normalizeText(header.textContent).toLowerCase()] = position;
  });
  return index;
}

function parseMeetingRow(cells, columns, context) {
  const cellText = (name) => {
    const position = columns[name];
    return position === undefined || !cells[position]
      ? ''
      : normalizeText(cells[position].textContent);
  };

  const rawTime = cellText('time');
  const rawDays = cellText('days');
  const rawRange = cellText('date range');

  const time = parseTimeRange(rawTime);
  const { days, unknown } = parseDays(rawDays);
  const dateRange = parseDateRange(rawRange);
  const warnings = [];

  if (!time) {
    warnings.push({
      code: rawTime.toUpperCase() === 'TBA' ? 'TIME_TBA' : 'TIME_UNPARSEABLE',
      message: `${context}: could not read a start/end time from "${rawTime}".`,
      field: 'time',
    });
  }
  if (!days.length) {
    warnings.push({
      code: rawDays.toUpperCase() === 'TBA' ? 'DAYS_TBA' : 'DAYS_MISSING',
      message: `${context}: no meeting days found in "${rawDays}".`,
      field: 'days',
    });
  }
  if (unknown.length) {
    warnings.push({
      code: 'DAYS_UNKNOWN_CODE',
      message: `${context}: unrecognized day code(s) "${unknown.join('')}" in "${rawDays}".`,
      field: 'days',
    });
  }
  if (!dateRange) {
    warnings.push({
      code: rawRange.toUpperCase() === 'TBA' ? 'DATE_RANGE_TBA' : 'DATE_RANGE_UNPARSEABLE',
      message: `${context}: could not read a date range from "${rawRange}".`,
      field: 'dateRange',
    });
  }

  return {
    meetingType: cellText('type'),
    scheduleType: cellText('schedule type'),
    location: cellText('where'),
    instructors: parseInstructors(cellText('instructors')),
    days,
    startTime: time ? time.start : null,
    endTime: time ? time.end : null,
    startDate: dateRange ? dateRange.startDate : null,
    endDate: dateRange ? dateRange.endDate : null,
    raw: { time: rawTime, days: rawDays, dateRange: rawRange },
    warnings,
    isSchedulable: Boolean(time && days.length && dateRange),
  };
}

function parseMeetingTable(table, context) {
  const columns = mapMeetingColumns(table);
  const meetings = [];

  for (const row of table.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll('td.dddefault')];
    if (!cells.length) continue; // header row
    meetings.push(parseMeetingRow(cells, columns, context));
  }
  return meetings;
}

function isMeetingTable(table) {
  const caption = table.querySelector('caption.captiontext');
  return Boolean(caption && /scheduled meeting times/i.test(caption.textContent));
}

function isCourseTable(table) {
  return Boolean(table.querySelector('th.ddtitle'));
}

/** Reads student name, term label, and student number from the page header. */
function parseHeader(doc) {
  const header = doc.querySelector('.staticheaders');
  if (!header) return { studentName: null, studentNumber: null, term: null };

  const lines = header.innerHTML
    .split(/<br\s*\/?>/i)
    .map((line) => normalizeText(line.replace(/<[^>]*>/g, '')))
    .filter(Boolean);

  const identity = (lines[0] || '').match(/^(\d+)\s+(.*)$/);

  return {
    studentNumber: identity ? identity[1] : null,
    studentName: identity ? identity[2] : lines[0] || null,
    term: lines[1] || null,
  };
}

/**
 * Parses a Student Detail Schedule document into structured courses.
 *
 * @param {Document} doc - a parsed DOM Document of the schedule page.
 * @returns {{courses: Array, header: object, warnings: Array, isScheduledPage: boolean}}
 */
export function parseDetailSchedule(doc) {
  const tables = [...doc.querySelectorAll('table.datadisplaytable')];
  const courses = [];
  const warnings = [];

  for (let i = 0; i < tables.length; i += 1) {
    if (!isCourseTable(tables[i])) continue;

    const titleCell = tables[i].querySelector('th.ddtitle');
    const identity = parseCourseTitle(titleCell.textContent);
    const fields = extractCourseFields(tables[i]);
    const context = identity.courseCode
      ? `${identity.courseCode} ${identity.section || ''}`.trim()
      : identity.title;

    // The meeting table, when present, immediately follows the course table.
    const next = tables[i + 1];
    const meetings = next && isMeetingTable(next) ? parseMeetingTable(next, context) : [];

    if (!meetings.length) {
      warnings.push({
        code: 'NO_MEETING_TIMES',
        message: `${context}: no scheduled meeting times found; nothing to add to a calendar.`,
        courseCode: identity.courseCode,
        section: identity.section,
      });
    }
    for (const meeting of meetings) {
      warnings.push(
        ...meeting.warnings.map((w) => ({
          ...w,
          courseCode: identity.courseCode,
          section: identity.section,
        })),
      );
    }

    courses.push({
      ...identity,
      crn: fields.crn || null,
      term: fields['associated term'] || null,
      status: fields.status || null,
      credits: fields.credits || null,
      level: fields.level || null,
      campus: fields.campus || null,
      gradeMode: fields['grade mode'] || null,
      assignedInstructor: fields['assigned instructor'] || null,
      meetings,
    });
  }

  return {
    header: parseHeader(doc),
    courses,
    warnings,
    isSchedulePage: courses.length > 0,
  };
}

/** Parses an HTML string. Convenience wrapper for tests and the popup. */
export function parseDetailScheduleHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseDetailSchedule(doc);
}

export const __testables = {
  parseCourseTitle,
  parseDays,
  parseClockTime,
  parseTimeRange,
  parseDate,
  parseDateRange,
  parseInstructors,
  normalizeText,
};
