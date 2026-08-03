/**
 * Carleton University academic dates. Bundled and offline, no network calls.
 *
 * Source: https://calendar.carleton.ca/academicyear/ (verified 2026-08-03),
 * corroborated by https://carleton.ca/registration/academic-dates/
 *
 * UPDATING EACH YEAR
 * Add a TERMS entry per term. For each, from the academic-year page, record:
 *   1. term start / end dates
 *   2. every "no classes" range (breaks)
 *   3. every "University closed" statutory holiday inside the term
 *   4. every "Classes follow a <Weekday> schedule" day (see below)
 *
 * THE SCHEDULE-SWAP RULE
 * Carleton repays weekdays lost to holidays by making a late-term day run a
 * different day's schedule. Fall 2026: Fri Dec 11 runs a Monday schedule.
 * This cuts BOTH ways and is the most-missed detail in schedule scrapers:
 *   - classes that meet on the SUBSTITUTE day (Mon) gain an occurrence
 *   - classes that meet on the ACTUAL weekday (Fri) lose one
 * Getting this wrong invents phantom classes and drops real ones.
 */

/** ISO weekday codes, matching the parser's day representation. */
export const WEEKDAY = Object.freeze({
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
});

const ORDERED_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Full weekday names for user-facing text. Never show raw day codes. */
const DAY_NAMES = Object.freeze({
  SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday',
  TH: 'Thursday', FR: 'Friday', SA: 'Saturday',
});

/** "2026-12-11" -> "Friday December 11" for user-facing messages. */
function friendlyDate(isoDate) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-CA', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

/** Weekday code for an ISO date string, timezone-independent. */
export function weekdayOf(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return ORDERED_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Inclusive list of ISO dates between two ISO dates. */
export function datesBetween(startIso, endIso) {
  const dates = [];
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  const cursor = new Date(Date.UTC(sy, sm - 1, sd));
  const last = Date.UTC(ey, em - 1, ed);

  while (cursor.getTime() <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export const TERMS = Object.freeze({
  'fall-2025': {
    id: 'fall-2025',
    label: 'Fall 2025',
    // Start and end confirmed against Banner's own reported range on a real
    // Fall 2025 schedule page ("Sep 03, 2025 - Dec 05, 2025").
    startDate: '2025-09-03',
    endDate: '2025-12-05',
    breaks: [
      { label: 'Fall break', startDate: '2025-10-20', endDate: '2025-10-24' },
    ],
    holidays: [
      { label: 'Thanksgiving', date: '2025-10-13' },
    ],
    /**
     * Fall 2025 loses Mondays to Thanksgiving and the fall break, and repays
     * one on the last day of classes. Same pattern as Fall 2026, different
     * date. Source: students.carleton.ca dates and deadlines, which states
     * "Classes will follow a Monday schedule that day."
     */
    scheduleSwaps: [
      {
        date: '2025-12-05',
        actualWeekday: 'FR',
        runsScheduleFor: 'MO',
        label: 'Last day of classes (campus runs a Monday schedule)',
      },
    ],
    notHolidays: [
      { label: 'Remembrance Day', date: '2025-11-11' },
    ],
  },

  'winter-2026': {
    id: 'winter-2026',
    label: 'Winter 2026',
    // Confirmed against Banner ("Jan 05, 2026 - Apr 08, 2026").
    startDate: '2026-01-05',
    endDate: '2026-04-08',
    breaks: [
      // Feb 16 is both the winter break start and Family Day.
      { label: 'Winter break', startDate: '2026-02-16', endDate: '2026-02-20' },
    ],
    holidays: [
      { label: 'Good Friday', date: '2026-04-03' },
    ],
    // No substitute-schedule day published for Winter 2026.
    scheduleSwaps: [],
    notHolidays: [],
  },

  'summer-2026': {
    id: 'summer-2026',
    label: 'Summer 2026',
    /**
     * Full summer. Carleton also runs early summer (May-June) and late summer
     * (July-August) inside this range; Banner reports the narrower dates on
     * those sections, so findTerm matches them by label rather than by range.
     */
    startDate: '2026-05-06',
    endDate: '2026-08-14',
    breaks: [
      // Between early and late summer: no classes or examinations.
      { label: 'Summer break', startDate: '2026-06-19', endDate: '2026-06-20' },
    ],
    holidays: [
      { label: 'Victoria Day', date: '2026-05-18' },
      { label: 'Canada Day', date: '2026-07-01' },
      { label: 'Civic Holiday', date: '2026-08-03' },
    ],
    /**
     * Summer loses Mondays to Victoria Day and the Civic Holiday, and repays
     * one on the last day. Same rule as the fall terms, different date.
     */
    scheduleSwaps: [
      {
        date: '2026-08-14',
        actualWeekday: 'FR',
        runsScheduleFor: 'MO',
        label: 'Last day of classes (campus runs a Monday schedule)',
      },
    ],
    notHolidays: [],
  },

  'fall-2026': {
    id: 'fall-2026',
    label: 'Fall 2026',
    // Banner reports this same range on every meeting row.
    startDate: '2026-09-09',
    endDate: '2026-12-11',
    /** Ranges where no classes are held at all. */
    breaks: [
      { label: 'Fall break', startDate: '2026-10-26', endDate: '2026-10-30' },
    ],
    /** Single-day closures inside the term. */
    holidays: [
      { label: 'Thanksgiving', date: '2026-10-12' },
    ],
    /**
     * Days running a different weekday's schedule.
     * Fall 2026 loses two Mondays (Oct 12, Oct 26) and repays one on Dec 11.
     */
    scheduleSwaps: [
      {
        date: '2026-12-11',
        actualWeekday: 'FR',
        runsScheduleFor: 'MO',
        label: 'Last day of classes (campus runs a Monday schedule)',
      },
    ],
    /**
     * Explicitly NOT holidays at Carleton. Recorded so a future maintainer
     * doesn't "helpfully" add them. Verified: Remembrance Day is not a
     * Carleton closure; classes run normally.
     */
    notHolidays: [
      { label: 'Remembrance Day', date: '2026-11-11' },
    ],
  },

  'winter-2027': {
    id: 'winter-2027',
    label: 'Winter 2027',
    startDate: '2027-01-06',
    endDate: '2027-04-09',
    breaks: [
      // Feb 15 is both the winter break start and Family Day.
      { label: 'Winter break', startDate: '2027-02-15', endDate: '2027-02-19' },
    ],
    holidays: [
      { label: 'Good Friday', date: '2027-03-26' },
    ],
    // Verified absent from the published Winter 2027 calendar.
    scheduleSwaps: [],
    notHolidays: [],
  },
});

/**
 * Finds the bundled term matching a Banner term label ("Fall 2026 (September-December)")
 * or a scraped date range. Returns null when unknown rather than guessing, so
 * the caller can surface that instead of silently mis-scheduling.
 */
/**
 * Banner's internal term code for a term label.
 *
 * Codes are <calendar year><season>, where the season is 10 for winter, 20 for
 * summer, and 30 for fall. The year is the one in the term's own name:
 * Fall 2025 is 202530 and Winter 2026 is 202610, even though both belong to
 * the 2025-26 academic year. Verified against the term dropdown on a real
 * Registration Term page.
 *
 * This matters because Carleton Central stores the selected term server-side.
 * Once a term has been picked, Detail Schedule stops showing the picker and
 * quietly serves the stored term instead. Passing ?term_in= bypasses that,
 * which is how Banner's own timetable links to a specific term.
 *
 * @param {string} label - e.g. "Fall 2025" or "Winter 2026 (January-April)"
 * @returns {string|null} the code, or null when the label is not understood
 */
export function bannerTermCode(label) {
  const match = /(winter|summer|fall)\s+(\d{4})/i.exec(label || '');
  if (!match) return null;

  const season = match[1].toLowerCase();
  const suffix = { winter: '10', summer: '20', fall: '30' }[season];
  return `${match[2]}${suffix}`;
}

/** The Detail Schedule URL, optionally pinned to a specific term. */
export function scheduleUrlFor(label) {
  const base = 'https://central.carleton.ca/prod/bwskfshd.P_CrseSchdDetl';
  const code = bannerTermCode(label);
  return code ? `${base}?term_in=${code}` : base;
}

export function findTerm({ label, startDate, endDate } = {}) {
  const terms = Object.values(TERMS);

  if (startDate && endDate) {
    const exact = terms.find((t) => t.startDate === startDate && t.endDate === endDate);
    if (exact) return exact;
  }

  if (label) {
    const normalized = label.toLowerCase();
    const byLabel = terms.find((t) => normalized.includes(t.label.toLowerCase()));
    if (byLabel) return byLabel;
  }

  return null;
}

/**
 * Resolves a term's calendar into per-weekday exclusions and additions.
 *
 * @param {object} term - a TERMS entry
 * @param {string[]} meetingDays - e.g. ['MO','WE'] for a class
 * @param {object} [options]
 * @param {boolean} [options.applyScheduleSwaps=true] - honour Carleton's
 *        day-substitution rule. User-facing toggle, on by default.
 * @returns {{excludedDates: string[], addedDates: string[], notes: object[]}}
 */
export function resolveTermCalendar(term, meetingDays, options = {}) {
  const applySwaps = options.applyScheduleSwaps !== false;
  const excluded = new Set();
  const added = new Set();
  const notes = [];

  // Break ranges: exclude any day the class would otherwise meet.
  for (const brk of term.breaks) {
    for (const date of datesBetween(brk.startDate, brk.endDate)) {
      if (meetingDays.includes(weekdayOf(date))) {
        excluded.add(date);
        notes.push({ kind: 'break', date, label: brk.label });
      }
    }
  }

  for (const holiday of term.holidays) {
    if (meetingDays.includes(weekdayOf(holiday.date))) {
      excluded.add(holiday.date);
      notes.push({ kind: 'holiday', date: holiday.date, label: holiday.label });
    }
  }

  // Schedule swaps, in both directions.
  for (const swap of term.scheduleSwaps) {
    const meetsOnActualDay = meetingDays.includes(swap.actualWeekday);
    const meetsOnSubstituteDay = meetingDays.includes(swap.runsScheduleFor);

    const substituteName = DAY_NAMES[swap.runsScheduleFor];
    const when = friendlyDate(swap.date);

    if (!applySwaps) {
      if (meetsOnActualDay || meetsOnSubstituteDay) {
        notes.push({
          kind: 'swap-ignored',
          date: swap.date,
          label: swap.label,
          message: `${when} runs a ${substituteName} schedule, but swap handling is turned off.`,
        });
      }
      continue;
    }

    // A class meeting BOTH weekdays needs no adjustment at all. The weekly
    // rule already generates this date (it falls on the actual weekday), and
    // the class does meet, because the substitute schedule is running. Adding
    // an RDATE here would duplicate it. MWF lectures are a common pattern,
    // so this case is not hypothetical.
    if (meetsOnActualDay && meetsOnSubstituteDay) continue;

    // Meets only the substitute weekday: the date is genuinely new, since the
    // weekly rule never generates it.
    if (meetsOnSubstituteDay) {
      added.add(swap.date);
      notes.push({
        kind: 'swap-added',
        date: swap.date,
        label: swap.label,
        message: `Extra class on ${when}, since campus runs a ${substituteName} schedule.`,
      });
    }

    // Meets only the actual weekday: the weekly rule generates this date, but
    // the class does not run, because a different day's schedule is in effect.
    if (meetsOnActualDay) {
      excluded.add(swap.date);
      notes.push({
        kind: 'swap-removed',
        date: swap.date,
        label: swap.label,
        message: `No class on ${when}, since campus runs a ${substituteName} schedule.`,
      });
    }
  }

  // A date can't be both added and excluded; exclusion is never right here,
  // since `added` only ever comes from an explicit swap rule.
  for (const date of added) excluded.delete(date);

  return {
    excludedDates: [...excluded].sort(),
    addedDates: [...added].sort(),
    notes,
  };
}
