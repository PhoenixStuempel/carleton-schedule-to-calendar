/**
 * RFC 5545 iCalendar generator for recurring university classes.
 *
 * Hand-rolled deliberately. The popular `ics` npm package emits EXDATE without
 * a TZID against a floating DTSTART, so exclusions silently fail, which is
 * precisely the holiday feature this project depends on. `ical-generator` is
 * correct but cannot emit VTIMEZONE in a browser (its timezone plugin is
 * Node-only), and Outlook needs VTIMEZONE. Zero runtime dependencies.
 *
 * The rules that actually bite, all verified against RFC text and a real parser:
 *   - UNTIL must be UTC when DTSTART carries a TZID (section 3.3.10), and must be
 *     computed from the LAST occurrence's offset. A Sept-to-Dec term crosses
 *     the November DST change; using September's offset silently drops the
 *     final class.
 *   - EXDATE must match DTSTART's value type, TZID, AND time-of-day (section 3.8.5.1).
 *     A midnight EXDATE parses fine and excludes nothing.
 *   - Folding is 75 OCTETS, not characters (section 3.1). "Nideyinàn" is multibyte.
 *   - Escape backslash, semicolon, comma, newline. NOT colon (section 3.3.11).
 */

const CRLF = '\r\n';
const TZID = 'America/Toronto';

/**
 * VTIMEZONE for America/Toronto.
 * Outlook approximates to exactly one STANDARD/DAYLIGHT pair and ignores
 * anything more complex, so this is deliberately in that minimal shape.
 * Sanity check: each block's TZOFFSETFROM is the other's TZOFFSETTO.
 */
const VTIMEZONE_TORONTO = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZID}`,
  'X-LIC-LOCATION:America/Toronto',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** Escapes a TEXT value per section 3.3.11. Backslash MUST be replaced first. */
export function escapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/**
 * Folds a line to <=75 octets, never splitting a UTF-8 codepoint.
 * The leading space on a continuation line counts toward the 75.
 */
export function foldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const decoder = new TextDecoder();
  const chunks = [];
  let offset = 0;

  while (offset < bytes.length) {
    // 75 for the first line; 74 thereafter, since the space costs one octet.
    const budget = chunks.length === 0 ? 75 : 74;
    let end = Math.min(offset + budget, bytes.length);

    // Back off a continuation byte (10xxxxxx) so we never cut mid-codepoint.
    while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }

    chunks.push(decoder.decode(bytes.subarray(offset, end)));
    offset = end;
  }

  return chunks[0] + chunks.slice(1).map((chunk) => `${CRLF} ${chunk}`).join('');
}

/** "2026-09-09" + {hour,minute} -> "20260909T100500" (local, no Z). */
function toLocalStamp(isoDate, time) {
  const compact = isoDate.replace(/-/g, '');
  const hh = String(time.hour).padStart(2, '0');
  const mm = String(time.minute).padStart(2, '0');
  return `${compact}T${hh}${mm}00`;
}

/**
 * UTC offset in minutes for America/Toronto at a given local date/time.
 * Uses Intl rather than a hardcoded DST table so it stays correct if the
 * rules ever change. Returns e.g. -240 (EDT) or -300 (EST).
 */
export function torontoOffsetMinutes(isoDate, time) {
  const [y, m, d] = isoDate.split('-').map(Number);
  // Interpret the wall-clock time as if it were UTC, then ask what Toronto
  // would call that instant; the difference is the offset.
  const asUtc = Date.UTC(y, m - 1, d, time.hour, time.minute, 0);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TZID,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(asUtc)).map((p) => [p.type, p.value]),
  );
  const seenAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );

  return Math.round((seenAsUtc - asUtc) / 60000);
}

/** Local date/time in Toronto -> "YYYYMMDDTHHMMSSZ" UTC stamp. */
export function toUtcStamp(isoDate, time) {
  const offsetMinutes = torontoOffsetMinutes(isoDate, time);
  const [y, m, d] = isoDate.split('-').map(Number);
  const instant = Date.UTC(y, m - 1, d, time.hour, time.minute, 0) - offsetMinutes * 60000;
  return `${new Date(instant).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

const DAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** First date on/after `fromIso` falling on one of `days`. */
export function firstOccurrence(fromIso, days) {
  const [y, m, d] = fromIso.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  const wanted = new Set(days.map((day) => DAY_INDEX[day]));

  for (let i = 0; i < 14; i += 1) {
    if (wanted.has(cursor.getUTCDay())) return cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return null;
}

/** Last date on/before `untilIso` falling on one of `days`. */
export function lastOccurrence(untilIso, days) {
  const [y, m, d] = untilIso.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  const wanted = new Set(days.map((day) => DAY_INDEX[day]));

  for (let i = 0; i < 14; i += 1) {
    if (wanted.has(cursor.getUTCDay())) return cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return null;
}

/**
 * Stable, deterministic UID. Re-exporting the same schedule yields the same
 * UIDs, so Google updates rather than duplicating. Never derive from a clock
 * or a random value.
 */
export function buildUid(parts) {
  const seed = parts.filter(Boolean).join('|').toLowerCase().replace(/\s+/g, '-');
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  }
  const slug = seed.replace(/[^a-z0-9-]/g, '').slice(0, 48);
  return `${slug}-${hash.toString(36)}@carleton-calendar-plugin`;
}

/**
 * Builds one VEVENT for a recurring class meeting.
 *
 * @param {object} event
 * @param {string[]} event.days - ['MO','WE']
 * @param {string} event.termStart - ISO date
 * @param {string} event.termEnd - ISO date
 * @param {string[]} [event.excludedDates] - ISO dates to drop
 * @param {string[]} [event.addedDates] - ISO dates to add (schedule swaps)
 * @param {string} event.dtstamp - UTC stamp
 */
export function buildVevent(event) {
  const {
    summary, location, description, days, startTime, endTime,
    termStart, termEnd, excludedDates = [], addedDates = [], uid, dtstamp,
  } = event;

  const firstDate = firstOccurrence(termStart, days);
  if (!firstDate) throw new Error(`No occurrence of ${days.join(',')} on/after ${termStart}`);

  // UNTIL is computed from the LAST occurrence, whose UTC offset may differ
  // from the first once the term crosses a DST boundary.
  const finalDate = lastOccurrence(termEnd, days);
  if (!finalDate) throw new Error(`No occurrence of ${days.join(',')} on/before ${termEnd}`);

  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${TZID}:${toLocalStamp(firstDate, startTime)}`,
    `DTEND;TZID=${TZID}:${toLocalStamp(firstDate, endTime)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${days.join(',')};WKST=SU;UNTIL=${toUtcStamp(finalDate, startTime)}`,
  ];

  // One EXDATE per line: Apple historically mishandled comma-separated lists,
  // and splitting avoids folding a long line. Each carries the class's own
  // start time; a midnight EXDATE silently excludes nothing.
  for (const date of excludedDates) {
    lines.push(`EXDATE;TZID=${TZID}:${toLocalStamp(date, startTime)}`);
  }

  lines.push(`SUMMARY:${escapeText(summary)}`);
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'SEQUENCE:0', 'END:VEVENT');

  // Added dates become STANDALONE events, not RDATEs. Apple Calendar does not
  // implement RDATE (acknowledged on Apple's developer forums, Mar 2025), so
  // an RDATE class silently vanishes on Mac and iPhone. A separate event is
  // universally supported, and arguably more honest, since a makeup class
  // genuinely is not part of the weekly pattern.
  for (const date of addedDates) {
    lines.push(...buildSingleEvent({
      summary, location, description, date, startTime, endTime, dtstamp,
      uid: `${uid}-makeup-${date.replace(/-/g, '')}`,
    }));
  }

  return lines;
}

/** A single non-recurring VEVENT, used for schedule-swap makeup classes. */
function buildSingleEvent({ summary, location, description, date, startTime, endTime, uid, dtstamp }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${TZID}:${toLocalStamp(date, startTime)}`,
    `DTEND;TZID=${TZID}:${toLocalStamp(date, endTime)}`,
    `SUMMARY:${escapeText(summary)}`,
  ];

  if (location) lines.push(`LOCATION:${escapeText(location)}`);

  const note = 'Extra class. Campus is running a different weekday\'s schedule.';
  lines.push(`DESCRIPTION:${escapeText(description ? `${description}\n${note}` : note)}`);
  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'SEQUENCE:0', 'END:VEVENT');

  return lines;
}

/**
 * Assembles a complete .ics document.
 * @param {object[]} events - buildVevent inputs, minus uid/dtstamp
 * @param {object} [options]
 * @param {string} [options.dtstamp] - override for deterministic tests
 */
export function buildCalendar(events, options = {}) {
  const dtstamp = options.dtstamp
    || `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Carleton Calendar Plugin//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...VTIMEZONE_TORONTO,
  ];

  for (const event of events) {
    lines.push(...buildVevent({
      ...event,
      dtstamp,
      uid: event.uid || buildUid([event.summary, event.days.join(''), event.termStart]),
    }));
  }

  lines.push('END:VCALENDAR');

  // Fold last so folding sees final content, and terminate with CRLF.
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}
