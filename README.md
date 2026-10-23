# TradeMe House Image Downloader

Chrome extension that downloads all property photos from a TradeMe residential
listing page in one click, saving them to a folder the user picks.

## Why

TradeMe listing pages render their photo gallery with JavaScript, which makes
it tedious to save every image by hand (right-click → save one at a time).

## How it works

1. Click the extension's toolbar icon while viewing a TradeMe residential
   listing page.
2. The extension detects the listing, scans the page for all photo URLs, and
   asks you to pick a destination folder.
3. All photos are downloaded into that folder.

## Status

Early development — see `handoff/BUILD-LOG.md` for current progress
(Three Man Team workflow).
