/**
 * Enriches scraped meetings: delivery mode, section type, and conflicts.
 *
 * Everything here is derived from what Banner actually prints. Where Banner is
 * silent the answer is "unknown" rather than a guess, since a confidently
 * wrong room or mode is worse than an admitted gap.
 */

/**
 * Strings Carleton uses in the Where column for non-room delivery.
 *
 * Matched against a form with spaces and hyphens stripped, so "ON LINE",
 * "On-Line", and "Online" all reduce to "online". Banner really does print
 * "ON LINE" as two words, which a plain substring test for "online" misses.
 */
const ONLINE_MARKERS = [
  'online', 'virtual', 'webbased', 'remote',
  'asynchronous', 'synchronousonline', 'distance',
];

/** Collapses spacing and hyphen variants so marker matching is stable. */
function condense(text) {
  return text.toLowerCase().replace(/[\s-]+/g, '');
}

const UNKNOWN_MARKERS = ['tba', 'to be announced', 'tbd', 'not assigned'];

/**
 * Splits a Where value into delivery mode, building, and room.
 * "Azrieli Theatre 302" -> in-person, Azrieli Theatre, 302
 */
export function classifyLocation(raw) {
  const text = (raw || '').replace(/\s+/g, ' ').trim();

  if (!text || UNKNOWN_MARKERS.some((m) => text.toLowerCase() === m)) {
    return { mode: 'unknown', building: null, room: null, raw: text || null };
  }

  const condensed = condense(text);
  if (ONLINE_MARKERS.some((m) => condensed.includes(m))) {
    return { mode: 'online', building: null, room: null, raw: text };
  }

  // Carleton rooms end in a number, sometimes with a letter suffix (2017B).
  const match = text.match(/^(.*?)\s+(\d+[A-Za-z]?)$/);
  if (!match) {
    return { mode: 'in-person', building: text, room: null, raw: text };
  }

  return {
    mode: 'in-person',
    building: match[1].replace(/\s+/g, ' ').trim(),
    room: match[2],
    raw: text,
  };
}

/**
 * Carleton section types. Banner prints the long form; students say the short
 * one. Unrecognised values pass through so a new type is never swallowed.
 */
const SECTION_TYPES = {
  lecture: 'Lecture',
  tutorial: 'Tutorial',
  laboratory: 'Lab',
  lab: 'Lab',
  seminar: 'Seminar',
  practicum: 'Practicum',
  workshop: 'Workshop',
  studio: 'Studio',
  'problem analysis': 'Problem Analysis',
  discussion: 'Discussion',
  'directed studies': 'Directed Studies',
  thesis: 'Thesis',
  'work term': 'Work Term',
  'clinical': 'Clinical',
  'field placement': 'Field Placement',
  'independent study': 'Independent Study',
};

export function describeSection(raw) {
  const text = (raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return { label: null, known: false };

  const mapped = SECTION_TYPES[text.toLowerCase()];
  return mapped
    ? { label: mapped, known: true }
    : { label: text, known: false };
}

const minutesOf = (t) => t.hour * 60 + t.minute;

/**
 * Finds scheduling problems across a term's classes.
 *
 * Two kinds:
 *  - overlap: two classes claim the same minutes on the same day. Usually a
 *    registration mistake worth catching before the term starts.
 *  - tight-turnaround: back-to-back classes in different buildings with too
 *    little time to walk between them.
 *
 * @param {object[]} schedules
 * @param {object} [options]
 * @param {number} [options.tightTurnaroundMinutes=0] gap under which to warn.
 *        0 disables the check.
 */
export function findConflicts(schedules, options = {}) {
  const tightGap = options.tightTurnaroundMinutes || 0;
  const active = schedules.filter((s) => s.enabled !== false && s.startTime && s.endTime);
  const conflicts = [];

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      const sharedDays = (a.days || []).filter((d) => (b.days || []).includes(d));
      if (!sharedDays.length) continue;

      const aStart = minutesOf(a.startTime);
      const aEnd = minutesOf(a.endTime);
      const bStart = minutesOf(b.startTime);
      const bEnd = minutesOf(b.endTime);

      for (const day of sharedDays) {
        // Touching end-to-start is not an overlap.
        const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
        if (overlap > 0) {
          conflicts.push({
            kind: 'overlap',
            day,
            overlapMinutes: overlap,
            a: label(a),
            b: label(b),
            message: `${label(a)} and ${label(b)} overlap by ${overlap} minutes.`,
          });
          continue;
        }

        if (!tightGap) continue;

        // Walking time only matters between two physical, different buildings.
        const gap = bStart >= aEnd ? bStart - aEnd : aStart - bEnd;
        if (gap < 0 || gap >= tightGap) continue;
        if (a.deliveryMode === 'online' || b.deliveryMode === 'online') continue;
        if (!a.building || !b.building || a.building === b.building) continue;

        // Name the earlier class first so the direction of travel reads right.
        const [from, to] = bStart >= aEnd ? [a, b] : [b, a];

        conflicts.push({
          kind: 'tight-turnaround',
          day,
          gapMinutes: gap,
          a: label(from),
          b: label(to),
          message: `Only ${gap} minutes between ${label(from)} and ${label(to)}, `
            + `and they are in different buildings (${from.building} to ${to.building}).`,
        });
      }
    }
  }

  return conflicts;
}

function label(schedule) {
  return `${schedule.courseCode || ''} ${schedule.section || ''}`.trim();
}
