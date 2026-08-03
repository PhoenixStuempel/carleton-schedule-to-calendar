/**
 * ICS file provider, the shipping path.
 * Produces a .ics that Outlook, Google Calendar, and Apple Calendar all import.
 */

import { BaseProvider } from './provider.js';
import { buildCalendar, buildUid } from '../calendar/ics.js';

export class IcsProvider extends BaseProvider {
  constructor() {
    super({ id: 'ics', label: 'Download .ics file', isAvailable: true });
  }

  /**
   * @param {import('./provider.js').ClassSchedule[]} schedules
   * @param {object} [options]
   * @param {string} [options.dtstamp] - fixed stamp for deterministic tests
   * @returns {Promise<import('./provider.js').ExportResult & {content?: string, filename?: string}>}
   */
  async exportSchedules(schedules, options = {}) {
    const problems = this.validate(schedules);
    if (problems.length) {
      return { ok: false, providerId: this.id, eventCount: 0, error: problems.join('; ') };
    }

    const content = buildCalendar(
      schedules.map((schedule) => ({
        summary: schedule.summary,
        location: schedule.location,
        description: schedule.description,
        days: schedule.days,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        termStart: schedule.termStart,
        termEnd: schedule.termEnd,
        excludedDates: schedule.excludedDates || [],
        addedDates: schedule.addedDates || [],
        uid: buildUid([schedule.id || schedule.summary, schedule.days.join(''), schedule.termStart]),
      })),
      { dtstamp: options.dtstamp },
    );

    return {
      ok: true,
      providerId: this.id,
      eventCount: schedules.length,
      content,
      filename: options.filename || 'carleton-schedule.ics',
    };
  }
}
