# CLAUDE.md

Chrome extension (Manifest V3) that downloads all photos from a TradeMe
property listing page (any category) to a user-chosen folder, and shows the
property address on the result page.

## Architecture
- `background.js` — service worker. Toolbar click handler + the injected
  `extractImageUrls` function (runs in the listing tab, must stay fully
  self-contained — no imports, no references outside itself — since it's
  passed to `chrome.scripting.executeScript` by reference). Handles two
  different TradeMe gallery components depending on listing tier:
  - **Premium ("platinum-hero-carousel")**: virtualized, only ~3 slides ever
    mounted in the DOM at once. Must click "next" and poll to reveal the rest
    — no network API reliably exposes the full photo list for this type.
  - **Standard (`tm-gallery-thumbnail-slider`)**: not virtualized — every
    photo's thumbnail is already in the static DOM. No clicking needed; just
    read every thumbnail's photo ID and rewrite the URL to the `plus` (full)
    size variant. Simpler and more reliable than the premium path when it's
    available, so it's tried as the fallback whenever `.platinum-hero-carousel`
    isn't found.
  - If neither is found, the result is `noGallery: true` (distinct from "found
    0 images on a real listing").
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
- `LISTING_URL_PATTERN` matches any `/a/property/.../listing/<id>` URL
  (not scoped to "residential" — that was too narrow, missed e.g. "new-homes").
- Two gallery components are now handled (premium carousel, standard
  thumbnail slider — see Architecture above), both confirmed against real
  listings. If a listing shows "isn't in a layout this extension recognizes
  yet" (`noGallery`), it's a third, not-yet-seen component — get the live DOM
  (ask the user to right-click → Inspect on the photo area) rather than
  guessing a selector.
- `.property-info__address` has only been confirmed on the premium-tier
  listing; not yet confirmed whether the standard-tier page uses the same
  class for its address heading.
- No bundler/build step on purpose — keep it that way unless there's a real
  need; ES modules work natively in both Chrome extension pages and Node.

## Three Man Team
Available agents: Arch (ARCHITECT.md), Val (ARCHITECT-REVIEWER.md), Bob (BUILDER.md), Richard (REVIEWER.md)
Flow: Arch → Val (brief review loop) → Bob → Richard
Handoff files: written to `handoff/` directory (ARCHITECT-BRIEF.md, ARCHITECT-BRIEF-REVIEW-FEEDBACK.md, BUILD-LOG.md, REVIEW-REQUEST.md, REVIEW-FEEDBACK.md, QUALITY-CHECK.md, SESSION-CHECKPOINT.md)
On session start: always run `/start-three-man` before any other work.
Critical rule: All agents must run in foreground (never set run_in_background: true).
If not installed: https://github.com/mywave-agent-coe/mywave-claude-skills
