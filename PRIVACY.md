# Privacy Policy

**Carleton Schedule to Calendar**
Last updated: August 3, 2026

## Summary

This extension does not collect, store, transmit, or sell any personal data. It
makes no network requests of any kind. Everything happens inside your browser.

## What the extension reads

When you click the extension icon while viewing your Student Detail Schedule on
Carleton Central, it reads that page to find:

- course codes, section identifiers, and course titles
- meeting days, start and end times
- building and room, or the online delivery marker
- instructor names, CRNs, and credit values as printed on the page

Your name and student number appear on that page. They are discarded immediately
after the page is read and are never included in the calendar file, written to
storage, or displayed anywhere in the extension.

## Where that data goes

The schedule is held in `chrome.storage.session`, which exists only in memory,
solely to pass it from the popup to the review tab. It is cleared when you close
Chrome. Nothing is written to disk, nothing is synced to a Google account, and
nothing is sent anywhere.

The calendar file you download is generated locally and saved by your own
browser to your own device.

## What the extension does not do

- No servers. The extension has no backend and contacts no external service.
- No analytics, telemetry, tracking, or crash reporting.
- No accounts, logins, or identifiers.
- No advertising, and no sale or transfer of data to anyone.
- No access to any website other than `central.carleton.ca`.

## Permissions and why they exist

**`scripting`** reads the schedule table from your Carleton Central page after
you click the extension icon. No script runs until you do.

**`storage`** passes the schedule from the popup to the review tab using
session-only, in-memory storage.

**`host_permissions: https://central.carleton.ca/*`** is the only site the
extension can read. Your schedule lives behind Carleton's login, so the page has
to be read in your own authenticated session.

## Third parties

There are none. The extension bundles no third-party code, loads no remote
scripts, and uses no external libraries at runtime.

## Changes

Material changes to this policy will be published in this file, and the "last
updated" date above will change.

## Contact

Questions or concerns: <https://github.com/PhoenixStuempel>

## Disclaimer

This is an unofficial tool. It is not affiliated with, endorsed by, or supported
by Carleton University.
