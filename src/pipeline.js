/**
 * Turns a parsed Carleton schedule into export-ready ClassSchedule objects.
 *
 * This is where scraped page data meets the bundled academic calendar. Anything
 * uncertain becomes a user-facing flag rather than a silent assumption.
 */

import { findTerm, resolveTermCalendar } from './calendar/carleton-terms.js';
import { classifyLocation, describeSection } from './schedule-info.js';

/** Calendar apps truncate long titles, so keep the identifying part first. */
function truncateSummary(summary, max = 60) {
  if (summary.length <= max) return summary;
  return `${summary.slice(0, max - 1).replace(/[\s:,-]+$/, '')}…`;
}

/**
 * @param {object} parsed - output of parseDetailSchedule
 * @param {object} [options]
 * @param {boolean} [options.applyScheduleSwaps=true]
 * @returns {{schedules: object[], flags: object[], skipped: object[], term: object|null}}
 */
export function buildSchedules(parsed, options = {}) {
  const schedules = [];
  const flags = [];
  const skipped = [];
  let resolvedTerm = null;

  for (const course of parsed.courses) {
    for (const meeting of course.meetings) {
      const label = `${course.courseCode || course.title} ${course.section || ''}`.trim();

      if (!meeting.isSchedulable) {
        skipped.push({
          label,
          crn: course.crn,
          reason: meeting.warnings.map((w) => w.message).join(' ')
            || 'No usable time, days, or date range.',
        });
        continue;
      }

      const term = findTerm({
        label: course.term,
        startDate: meeting.startDate,
        endDate: meeting.endDate,
      });

      // No bundled academic calendar for this term: still export the class,
      // but say plainly that holidays could not be applied. Silently emitting
      // a calendar with classes on Thanksgiving would be worse.
      if (!term) {
        flags.push({
          level: 'warning',
          scope: label,
          code: 'UNKNOWN_TERM',
          message: `No bundled holiday data for "${course.term || 'this term'}". `
            + 'Classes will repeat every week with no breaks excluded. Check the dates before importing.',
        });
        schedules.push(toSchedule(course, meeting, label, [], []));
        continue;
      }

      resolvedTerm = term;
      const { excludedDates, addedDates, notes } = resolveTermCalendar(
        term, meeting.days, { applyScheduleSwaps: options.applyScheduleSwaps !== false },
      );

      // Schedule swaps change what the user sees versus what Banner said, so
      // they always surface for confirmation.
      for (const note of notes) {
        if (note.kind === 'swap-added' || note.kind === 'swap-removed' || note.kind === 'swap-ignored') {
          flags.push({
            level: 'confirm',
            scope: label,
            code: note.kind.toUpperCase().replace('-', '_'),
            date: note.date,
            message: note.message,
          });
        }
      }

      schedules.push(toSchedule(course, meeting, label, excludedDates, addedDates));
    }
  }

  return { schedules, flags, skipped, term: resolvedTerm };
}

function toSchedule(course, meeting, label, excludedDates, addedDates) {
  const place = classifyLocation(meeting.location);
  const section = describeSection(meeting.scheduleType || meeting.meetingType);

  // What a student wants when they tap the event in their calendar: what kind
  // of class, who teaches it, where to physically go, and the CRN for any
  // registration issue.
  const lines = [];
  if (section.label) lines.push(section.label);

  lines.push(meeting.instructors.length
    ? `Instructor: ${meeting.instructors.join(', ')}`
    : 'Instructor to be announced');

  if (place.mode === 'online') lines.push('Online delivery');
  else if (place.mode === 'in-person' && place.building) {
    lines.push(`Room: ${place.building}${place.room ? ` ${place.room}` : ''}`);
  } else if (place.mode === 'unknown') lines.push('Room to be announced');

  if (course.crn) lines.push(`CRN ${course.crn}`);

  // Banner prints "0.500"; tutorials carry 0.000 because the credit sits on
  // the parent lecture, so only state a real credit value.
  const credits = Number.parseFloat(course.credits);
  if (Number.isFinite(credits) && credits > 0) {
    lines.push(`${credits} credit${credits === 1 ? '' : 's'}`);
  }
  if (course.campus && !/main campus/i.test(course.campus)) lines.push(`Campus: ${course.campus}`);

  // Title stays short: calendar apps truncate, and the code plus type is what
  // identifies the entry at a glance.
  const summary = section.label
    ? `${label} ${section.label}: ${course.title}`
    : `${label}: ${course.title}`;

  return {
    id: `${course.crn || label}-${meeting.days.join('')}`,
    crn: course.crn,
    courseCode: course.courseCode,
    section: course.section,
    title: course.title,
    scheduleType: meeting.scheduleType,
    sectionType: section.label,
    sectionTypeKnown: section.known,
    deliveryMode: place.mode,
    building: place.building,
    room: place.room,
    credits: Number.isFinite(credits) ? credits : null,
    level: course.level || null,
    campus: course.campus || null,
    status: course.status || null,
    summary: truncateSummary(summary),
    location: meeting.location || undefined,
    description: lines.join('\n'),
    instructors: meeting.instructors,
    days: meeting.days,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    termStart: meeting.startDate,
    termEnd: meeting.endDate,
    excludedDates,
    addedDates,
    timeZone: 'America/Toronto',
    enabled: true,
  };
}
