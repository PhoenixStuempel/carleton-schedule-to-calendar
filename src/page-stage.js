/**
 * Works out which step of Carleton Central a page is.
 *
 * The popup stays open while the user logs in, picks a term, and lands on the
 * schedule, so it has to keep re-reading where they are. URLs are not enough:
 * Banner serves the login page, the term picker, and the schedule from the
 * same /prod/ paths, so the markup is what distinguishes them.
 *
 * Kept here rather than inline in the popup so it can be tested. The popup
 * injects an equivalent function into the page, since executeScript cannot
 * carry a closure.
 */

export const STAGE = Object.freeze({
  ELSEWHERE: 'elsewhere',
  LOGIN: 'login',
  TERM_PICKER: 'term-picker',
  SCHEDULE: 'schedule',
  CARLETON_OTHER: 'carleton-other',
});

/**
 * @param {Document} doc - the page to classify
 * @returns {string} one of STAGE, never ELSEWHERE (that is decided by host)
 */
export function detectStage(doc) {
  // The week-grid timetable uses the same table class as Detail Schedule, so
  // the meeting-times caption is the marker. Treating the timetable as the
  // schedule reports "no classes found" on a page plainly showing classes.
  const captions = [...doc.querySelectorAll('caption.captiontext')];
  if (captions.some((c) => /scheduled meeting times/i.test(c.textContent || ''))) {
    return STAGE.SCHEDULE;
  }

  if (doc.querySelector('select[name="term_in"]')) return STAGE.TERM_PICKER;

  // Any other Banner data page: signed in, just not where we need to be.
  if (doc.querySelector('table.datadisplaytable')) return STAGE.CARLETON_OTHER;

  const text = doc.body?.textContent || '';
  if (/user\s*id|password|sign\s*in/i.test(text)
    && doc.querySelector('input[type="password"]')) {
    return STAGE.LOGIN;
  }

  return STAGE.CARLETON_OTHER;
}
