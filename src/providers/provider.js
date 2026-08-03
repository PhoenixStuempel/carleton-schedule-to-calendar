/**
 * Calendar provider abstraction.
 *
 * Only the ICS provider is wired today. Google and Microsoft adapters are
 * scaffolded against this same interface so they can be enabled later without
 * reshaping the pipeline.
 *
 * WHY THE SCHEDULE SHAPE IS STRUCTURED, NOT AN RRULE STRING
 * Microsoft Graph has NO EXDATE equivalent: excluding a holiday means creating
 * the series, GETting /instances, then DELETEing each unwanted occurrence.
 * Google accepts EXDATE in a recurrence[] array but forbids DTSTART there.
 * Only ICS wants a literal RRULE line.
 *
 * A structured schedule converts cleanly to all three; an RRULE string does
 * not convert back. So the pipeline carries structure and each provider
 * renders its own wire format.
 */

/**
 * @typedef {object} ClassSchedule
 * @property {string} id - stable identity (CRN + section + day pattern)
 * @property {string} summary
 * @property {string} [location]
 * @property {string} [description]
 * @property {string[]} days - ['MO','WE']
 * @property {{hour:number,minute:number}} startTime
 * @property {{hour:number,minute:number}} endTime
 * @property {string} termStart - ISO date
 * @property {string} termEnd - ISO date
 * @property {string[]} excludedDates - ISO dates with no class
 * @property {string[]} addedDates - ISO dates added by a schedule swap
 * @property {string} timeZone - IANA zone
 */

/**
 * @typedef {object} ExportResult
 * @property {boolean} ok
 * @property {string} providerId
 * @property {number} eventCount
 * @property {object[]} [failures] - per-event failures for partial success
 * @property {string} [error]
 */

/**
 * Every provider implements this shape.
 *
 * @typedef {object} CalendarProvider
 * @property {string} id
 * @property {string} label
 * @property {boolean} isAvailable - false for scaffolded-but-unwired providers
 * @property {string} [unavailableReason] - shown in the UI when not available
 * @property {(schedules: ClassSchedule[], options?: object) => Promise<ExportResult>} exportSchedules
 */

/** Base with shared validation, so each adapter only implements delivery. */
export class BaseProvider {
  constructor({ id, label, isAvailable = false, unavailableReason }) {
    this.id = id;
    this.label = label;
    this.isAvailable = isAvailable;
    this.unavailableReason = unavailableReason;
  }

  /**
   * Rejects malformed schedules loudly rather than emitting a calendar with
   * silently-wrong entries.
   */
  validate(schedules) {
    const problems = [];

    schedules.forEach((schedule, index) => {
      const where = schedule.summary || `entry ${index + 1}`;
      if (!schedule.days?.length) problems.push(`${where}: no meeting days`);
      if (!schedule.startTime || !schedule.endTime) problems.push(`${where}: missing start or end time`);
      if (!schedule.termStart || !schedule.termEnd) problems.push(`${where}: missing term dates`);

      if (schedule.startTime && schedule.endTime) {
        const start = schedule.startTime.hour * 60 + schedule.startTime.minute;
        const end = schedule.endTime.hour * 60 + schedule.endTime.minute;
        if (end <= start) problems.push(`${where}: ends at or before it starts`);
      }
    });

    return problems;
  }

  async exportSchedules() {
    throw new Error(`${this.id} does not implement exportSchedules()`);
  }
}
