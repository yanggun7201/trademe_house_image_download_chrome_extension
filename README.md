# TradeMe House Image Downloader

Chrome extension that downloads all property photos from a TradeMe residential
listing page in one click, saving them to a folder the user picks.

## Why

TradeMe listing pages render their photo gallery with JavaScript, which makes
it tedious to save every image by hand (right-click → save one at a time).

## How it works

1. Click the extension's toolbar icon while viewing a TradeMe residential
   listing page.
2. The extension detects the listing, shows the property address, and scans
   the page for all photo URLs (driving the photo carousel if needed), and
   asks you to pick a destination folder.
3. All photos are downloaded into that folder as `{order}-{photoId}.{ext}`.

Keep the listing tab in the foreground (don't switch away) while the toolbar
badge shows `…` — Chrome throttles timers and animations in background tabs,
which can make the extraction take longer or stop early.

Re-running the extension on the same listing into the same folder overwrites
files that got the same name again; if the listing's photo order changed
between runs, some files from the earlier run may be left behind under their
old names.

## Install (unpacked, for development)

1. Open `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select this project's folder.

## Development

Run the unit tests for the pure helper functions (`lib/download-helpers.js`):

```
npm test
```

## Status

Working — smoke-tested against a live listing (extraction + download, folder
picker, address display) with no failures. Not yet checked against a
non-premium or rental listing, which may use different page markup for the
photo carousel and/or address.

Progress notes are kept in a local, gitignored `handoff/` directory (Three Man
Team workflow) and aren't part of this repository.
