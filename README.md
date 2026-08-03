# Carleton Schedule to Calendar

A Chrome extension that turns your Carleton Central class schedule into a
calendar file, with reading week, holidays, and Carleton's schedule swaps
already handled.

Works with Outlook, Google Calendar, and Apple Calendar.

## Using it

Log in to Carleton Central, click the extension icon, pick your term, and hit
**Review & export**. It finds the schedule page itself.

The preview opens in a tab so you can check everything before exporting.

## Why the dates matter

Carleton Central gives one date range per class, like `Sep 09, 2026 - Dec 11,
2026`. Repeating your classes weekly across that span is wrong in both
directions: it shows classes on days you have none, and misses classes you do
have.

This handles the real academic calendar. Statutory closures and reading weeks
are excluded, Remembrance Day is not (Carleton holds classes that day), and the
days campus runs a different weekday's schedule are applied in both directions,
so classes that gain a session get one and classes that lose one don't appear.

Anything uncertain is flagged in the preview for you to confirm.

## Building it yourself

```
npm install
node tools/build.mjs
```

That produces `dist/`. In Chrome at `chrome://extensions`, turn on **Developer
mode**, click **Load unpacked**, and choose the `dist` folder.

```
npm test              # unit tests
node tools/e2e.mjs    # loads the built extension into real Chrome
```

`dist/` is generated. Chrome cannot resolve imports that escape the extension
root, so the build copies `src/` in as `lib/` and rewrites the paths.

## Term dates

Bundled with the extension, so it makes no network calls. Fall 2025, Winter
2026, Summer 2026, Fall 2026, and Winter 2027 are included. Any other term
Carleton lists can still be opened and exported, but repeats weekly without
excluding breaks; it is marked in the term dropdown and the preview says so.

To add a term, edit
[`src/calendar/carleton-terms.js`](src/calendar/carleton-terms.js) using
<https://calendar.carleton.ca/academicyear/>. That file documents the format and
the reasoning behind it.

## Privacy

No network calls, no analytics, no data leaves the browser. The schedule is read
only when you click the icon, held in session storage, and discarded when Chrome
closes. Student name and number are stripped immediately after parsing.

See [PRIVACY.md](PRIVACY.md).

## Note

Unofficial. Not affiliated with, endorsed by, or supported by Carleton
University. Check important dates against Carleton's academic calendar.

MIT licensed.
