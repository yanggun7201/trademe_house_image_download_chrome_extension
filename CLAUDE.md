# CLAUDE.md

Chrome extension (Manifest V3) that downloads all photos from a TradeMe
residential property listing page to a user-chosen folder, and shows the
property address on the result page.

## Architecture
- `background.js` — service worker. Toolbar click handler + the injected
  `extractImageUrls` function (runs in the listing tab, must stay fully
  self-contained — no imports, no references outside itself — since it's
  passed to `chrome.scripting.executeScript` by reference). Drives the photo
  carousel by clicking "next" and polling, since TradeMe only mounts ~3 slides
  in the DOM at a time; no network API reliably exposes the full photo list.
- `tab.js` / `tab.html` — the result page opened per click. Reads the job from
  `chrome.storage.session`, shows the address/status, drives the folder picker
  and the download loop.
- `lib/download-helpers.js` — pure, DOM-free helpers (URL pattern, extension
  inference, slide sort) shared between the extension (`<script type="module">`)
  and `lib/download-helpers.test.js` (`node --test`, no build step, no
  `package.json` dependencies beyond `"type": "module"`).
- Debug logging is prefixed `[TMHD]` throughout — `extractImageUrls`'s logs
  show up in the **listing tab's** console (it runs in the page), not the
  service worker's.

## Known open items
- Only verified against one premium-tier residential listing. The
  `.platinum-hero-carousel` and `.property-info__address` selectors haven't
  been checked against a non-premium or rental listing, which may differ.
- No bundler/build step on purpose — keep it that way unless there's a real
  need; ES modules work natively in both Chrome extension pages and Node.

## Three Man Team
Available agents: Arch (ARCHITECT.md), Val (ARCHITECT-REVIEWER.md), Bob (BUILDER.md), Richard (REVIEWER.md)
Flow: Arch → Val (brief review loop) → Bob → Richard
Handoff files: written to `handoff/` directory (ARCHITECT-BRIEF.md, ARCHITECT-BRIEF-REVIEW-FEEDBACK.md, BUILD-LOG.md, REVIEW-REQUEST.md, REVIEW-FEEDBACK.md, QUALITY-CHECK.md, SESSION-CHECKPOINT.md)
On session start: always run `/start-three-man` before any other work.
Critical rule: All agents must run in foreground (never set run_in_background: true).
If not installed: https://github.com/mywave-agent-coe/mywave-claude-skills
