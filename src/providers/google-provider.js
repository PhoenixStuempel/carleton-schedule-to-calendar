/**
 * Google Calendar provider: SCAFFOLDED, NOT WIRED.
 *
 * exportSchedules() refuses with a clear reason rather than pretending to
 * work. The payload builder below is real and unit-tested, so enabling this
 * later is a matter of adding auth, not writing the mapping.
 *
 * TO ENABLE
 * 1. Create a Google Cloud project; enable the Calendar API.
 * 2. Create an OAuth client ID of type "Chrome Extension" using the
 *    extension's stable ID (from a packed .crx or the Web Store listing).
 * 3. Add to manifest.json:
 *      "oauth2": {
 *        "client_id": "<id>.apps.googleusercontent.com",
 *        "scopes": ["https://www.googleapis.com/auth/calendar.app.created"]
 *      }
 *    `calendar.app.created` is the minimal scope: it grants access only to
 *    calendars this app creates, not the user's existing ones.
 * 4. Get a token via chrome.identity.getAuthToken({interactive: true}).
 * 5. Flip isAvailable to true.
 *
 * Verification burden: Calendar is a SENSITIVE scope, not a restricted one, so
 * no third-party security assessment. Expect ~10 days of review and a 100-user
 * cap until verified. Publishing is NOT required for getAuthToken to work in
 * development; a stable extension ID is.
 */

import { BaseProvider } from './provider.js';

const DAY_TO_GOOGLE = { SU: 'SU', MO: 'MO', TU: 'TU', WE: 'WE', TH: 'TH', FR: 'FR', SA: 'SA' };

/** "2026-09-09" + {hour,minute} -> "2026-09-09T10:05:00" (local, no offset). */
function toLocalDateTime(isoDate, time) {
  const hh = String(time.hour).padStart(2, '0');
  const mm = String(time.minute).padStart(2, '0');
  return `${isoDate}T${hh}:${mm}:00`;
}

function toCompactUtc(isoDate, time, timeZone) {
  // Google wants UNTIL in UTC, same rule as ICS.
  const [y, m, d] = isoDate.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, time.hour, time.minute, 0);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(asUtc)).map((p) => [p.type, p.value]),
  );
  const seen = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  const instant = asUtc - (seen - asUtc);
  return `${new Date(instant).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/**
 * Maps a ClassSchedule to a Google Calendar events.insert body.
 *
 * Two Google-specific rules, both verified against their docs:
 *  - recurrence[] carries RRULE/EXDATE/RDATE lines but MUST NOT contain
 *    DTSTART; the start lives in the `start` field instead.
 *  - EXDATE entries need the same TZID and time-of-day as the start, exactly
 *    as in ICS. A bare date excludes nothing.
 */
export function buildGoogleEvent(schedule, firstDate, lastDate) {
  const { timeZone = 'America/Toronto' } = schedule;
  const recurrence = [
    `RRULE:FREQ=WEEKLY;BYDAY=${schedule.days.map((d) => DAY_TO_GOOGLE[d]).join(',')}`
      + `;UNTIL=${toCompactUtc(lastDate, schedule.startTime, timeZone)}`,
  ];

  for (const date of schedule.excludedDates || []) {
    recurrence.push(`EXDATE;TZID=${timeZone}:${date.replace(/-/g, '')}T${
      String(schedule.startTime.hour).padStart(2, '0')}${
      String(schedule.startTime.minute).padStart(2, '0')}00`);
  }
  for (const date of schedule.addedDates || []) {
    recurrence.push(`RDATE;TZID=${timeZone}:${date.replace(/-/g, '')}T${
      String(schedule.startTime.hour).padStart(2, '0')}${
      String(schedule.startTime.minute).padStart(2, '0')}00`);
  }

  return {
    summary: schedule.summary,
    location: schedule.location,
    description: schedule.description,
    start: { dateTime: toLocalDateTime(firstDate, schedule.startTime), timeZone },
    end: { dateTime: toLocalDateTime(firstDate, schedule.endTime), timeZone },
    recurrence,
  };
}

export class GoogleCalendarProvider extends BaseProvider {
  constructor() {
    super({
      id: 'google',
      label: 'Add to Google Calendar',
      isAvailable: false,
      unavailableReason:
        'Needs a Google Cloud OAuth client ID. See the setup notes in '
        + 'src/providers/google-provider.js. Use the .ics download for now: '
        + 'Google imports it fine.',
    });
  }

  async exportSchedules() {
    // Refuse clearly instead of faking success.
    return {
      ok: false,
      providerId: this.id,
      eventCount: 0,
      error: this.unavailableReason,
    };
  }
}
