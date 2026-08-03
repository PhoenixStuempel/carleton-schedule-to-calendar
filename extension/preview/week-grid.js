/**
 * Week-grid layout for the schedule preview.
 *
 * Places each class as an absolutely-positioned block on a Mon–Sun × time
 * grid. Kept free of DOM concerns so the geometry is unit-testable: it takes
 * schedules and returns positioned blocks.
 */

export const GRID_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export const DAY_LABELS = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday',
  FR: 'Friday', SA: 'Saturday', SU: 'Sunday',
};

const minutesOf = (time) => time.hour * 60 + time.minute;

/**
 * Chooses the visible time window from the actual classes, padded to whole
 * hours, so an all-afternoon schedule doesn't render eight empty morning rows.
 */
export function computeTimeBounds(schedules, { padHours = 1, min = 7, max = 23 } = {}) {
  const active = schedules.filter((s) => s.enabled !== false && s.startTime && s.endTime);
  if (!active.length) return { startHour: 8, endHour: 18 };

  const earliest = Math.min(...active.map((s) => minutesOf(s.startTime)));
  const latest = Math.max(...active.map((s) => minutesOf(s.endTime)));

  return {
    startHour: Math.max(min, Math.floor(earliest / 60) - padHours),
    endHour: Math.min(max, Math.ceil(latest / 60) + padHours),
  };
}

/** Days that actually have classes, so weekends collapse when unused. */
export function visibleDays(schedules) {
  const used = new Set();
  for (const schedule of schedules) {
    if (schedule.enabled === false) continue;
    for (const day of schedule.days || []) used.add(day);
  }
  // Weekdays always show (an empty Wednesday is meaningful); weekends only when used.
  return GRID_DAYS.filter((day, index) => index < 5 || used.has(day));
}

/**
 * Detects classes that overlap in time on the same day, so they can be shown
 * side by side rather than stacked invisibly. Returns a column index and
 * column count per block.
 */
function assignColumns(blocks) {
  const byDay = new Map();
  for (const block of blocks) {
    if (!byDay.has(block.day)) byDay.set(block.day, []);
    byDay.get(block.day).push(block);
  }

  for (const dayBlocks of byDay.values()) {
    dayBlocks.sort((a, b) => a.startMinutes - b.startMinutes);

    // Group into clusters of mutually-overlapping blocks.
    let cluster = [];
    let clusterEnd = -1;

    const flush = () => {
      for (const block of cluster) block.columnCount = cluster.length;
      cluster = [];
    };

    for (const block of dayBlocks) {
      if (cluster.length && block.startMinutes >= clusterEnd) flush();

      block.column = cluster.length;
      cluster.push(block);
      clusterEnd = Math.max(clusterEnd, block.endMinutes);
    }
    flush();
  }
  return blocks;
}

/**
 * Builds positioned blocks for the week grid.
 *
 * @param {object[]} schedules
 * @param {object} [options]
 * @param {number} [options.startHour] / [options.endHour] - override bounds
 * @returns {{blocks: object[], days: string[], startHour: number, endHour: number, hours: number[]}}
 */
export function layoutWeek(schedules, options = {}) {
  const active = schedules.filter((s) => s.enabled !== false);
  const bounds = computeTimeBounds(active, options);
  const startHour = options.startHour ?? bounds.startHour;
  const endHour = options.endHour ?? bounds.endHour;
  const days = options.days || visibleDays(active);

  const totalMinutes = (endHour - startHour) * 60;
  const blocks = [];

  for (const schedule of active) {
    if (!schedule.startTime || !schedule.endTime) continue;

    const startMinutes = minutesOf(schedule.startTime);
    const endMinutes = minutesOf(schedule.endTime);

    for (const day of schedule.days || []) {
      if (!days.includes(day)) continue;

      blocks.push({
        id: `${schedule.id}-${day}`,
        scheduleId: schedule.id,
        day,
        dayIndex: days.indexOf(day),
        startMinutes,
        endMinutes,
        // Percentages so the grid scales with its container.
        topPercent: ((startMinutes - startHour * 60) / totalMinutes) * 100,
        heightPercent: ((endMinutes - startMinutes) / totalMinutes) * 100,
        column: 0,
        columnCount: 1,
        schedule,
        hasFlag: Boolean(schedule.addedDates?.length || schedule.flagged),
      });
    }
  }

  assignColumns(blocks);

  const hours = [];
  for (let hour = startHour; hour <= endHour; hour += 1) hours.push(hour);

  return { blocks, days, startHour, endHour, hours };
}

/** "14:35" -> "2:35 pm" for display. */
export function formatTime({ hour, minute }) {
  const meridiem = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, '0')} ${meridiem}`;
}

/** Short hour label for the time gutter. */
export function formatHour(hour) {
  const meridiem = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${meridiem}`;
}
