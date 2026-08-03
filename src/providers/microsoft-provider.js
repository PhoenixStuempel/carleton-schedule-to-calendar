/**
 * Microsoft Outlook / Graph provider: SCAFFOLDED, NOT WIRED.
 *
 * WHY THIS ONE IS THE AWKWARD ONE
 * Graph has NO EXDATE equivalent. Excluding Thanksgiving from a weekly series
 * is a three-step dance:
 *   1. POST /me/events with the recurrence      -> series created
 *   2. GET /me/events/{id}/instances?...        -> list occurrences
 *   3. DELETE each unwanted occurrence          -> batch via POST /$batch
 * So one class is 1 + 1 + N requests, not one. exportSchedules must therefore
 * report PARTIAL success: some exclusions may fail while the series exists.
 *
 * Graph also wants WINDOWS timezone names ("Eastern Standard Time"), not IANA
 * ("America/Toronto"). Sending IANA silently shifts times.
 *
 * TO ENABLE
 * 1. Register an app in Entra ID (Azure AD); add a redirect URI of
 *    https://<extension-id>.chromiumapp.org/
 * 2. Request delegated scope Calendars.ReadWrite.
 * 3. Auth with chrome.identity.launchWebAuthFlow + PKCE.
 *    Do NOT use MSAL.js; it depends on browser APIs unavailable in MV3.
 * 4. Flip isAvailable to true and implement the three-step flow.
 */

import { BaseProvider } from './provider.js';

/** IANA -> Windows zone names. Graph rejects IANA in most contexts. */
const WINDOWS_TIME_ZONES = Object.freeze({
  'America/Toronto': 'Eastern Standard Time',
  'America/New_York': 'Eastern Standard Time',
  'America/Vancouver': 'Pacific Standard Time',
  'America/Edmonton': 'Mountain Standard Time',
  'America/Winnipeg': 'Central Standard Time',
  'America/Halifax': 'Atlantic Standard Time',
  'America/St_Johns': 'Newfoundland Standard Time',
});

const DAY_TO_GRAPH = {
  SU: 'sunday', MO: 'monday', TU: 'tuesday', WE: 'wednesday',
  TH: 'thursday', FR: 'friday', SA: 'saturday',
};

export function toWindowsTimeZone(ianaZone) {
  return WINDOWS_TIME_ZONES[ianaZone] || ianaZone;
}

/**
 * Maps a ClassSchedule to a Graph event body.
 * Note the absence of any exclusion field. That is the point: exclusions
 * cannot be expressed here and must be deleted as instances afterwards.
 */
export function buildGraphEvent(schedule, firstDate, lastDate) {
  const { timeZone = 'America/Toronto' } = schedule;
  const pad = (n) => String(n).padStart(2, '0');
  const time = (t) => `${pad(t.hour)}:${pad(t.minute)}:00`;

  return {
    subject: schedule.summary,
    body: { contentType: 'text', content: schedule.description || '' },
    location: { displayName: schedule.location || '' },
    start: { dateTime: `${firstDate}T${time(schedule.startTime)}`, timeZone: toWindowsTimeZone(timeZone) },
    end: { dateTime: `${firstDate}T${time(schedule.endTime)}`, timeZone: toWindowsTimeZone(timeZone) },
    recurrence: {
      pattern: {
        type: 'weekly',
        interval: 1,
        daysOfWeek: schedule.days.map((d) => DAY_TO_GRAPH[d]),
        firstDayOfWeek: 'sunday',
      },
      range: {
        type: 'endDate',
        startDate: firstDate,
        endDate: lastDate,
        recurrenceTimeZone: toWindowsTimeZone(timeZone),
      },
    },
  };
}

/**
 * Instances that must be DELETEd after the series is created, since Graph
 * cannot express exclusions declaratively.
 */
export function instancesToDelete(schedule) {
  return (schedule.excludedDates || []).map((date) => ({
    date,
    reason: 'Excluded: holiday, break, or schedule swap.',
  }));
}

export class MicrosoftCalendarProvider extends BaseProvider {
  constructor() {
    super({
      id: 'microsoft',
      label: 'Add to Outlook Calendar',
      isAvailable: false,
      unavailableReason:
        'Needs an Entra ID app registration. See the setup notes in '
        + 'src/providers/microsoft-provider.js. Use the .ics download for now: '
        + 'Outlook imports it, and the file already carries the timezone data '
        + 'Outlook needs.',
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
