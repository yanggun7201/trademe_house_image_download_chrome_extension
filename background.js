import { LISTING_URL_PATTERN } from './lib/download-helpers.js';

// Injected directly into the listing tab via chrome.scripting.executeScript.
// Must be fully self-contained — no references to anything outside this function.
async function extractImageUrls() {
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getPhotoId(url) {
    const match = url.match(/(\d+)\.\w+(?:\?.*)?$/);
    return match ? match[1] : null;
  }

  function getSlideNumber(alt) {
    const match = alt && alt.match(/slide\s+(\d+)\s*$/i);
    return match ? parseInt(match[1], 10) : null;
  }

  function scanSlides(container) {
    const imgs = container.querySelectorAll(
      '.platinum-hero-carousel__slide img.platinum-hero-carousel__image'
    );
    return Array.from(imgs)
      .map((img) => ({
        id: getPhotoId(img.src),
        url: img.src,
        slideNumber: getSlideNumber(img.alt),
      }))
      .filter((photo) => photo.id);
  }

  let displayedCount = null;
  const viewImagesBtn = document.querySelector('button[aria-label="View images"]');
  if (viewImagesBtn) {
    const match = viewImagesBtn.textContent.match(/(\d+)\s*Images?/i);
    if (match) displayedCount = parseInt(match[1], 10);
  }

  if (!document.querySelector('.platinum-hero-carousel')) {
    return { images: [], displayedCount };
  }

  function mergeMountedSlides(uniquePhotos) {
    const container = document.querySelector('.platinum-hero-carousel');
    if (!container) return;
    scanSlides(container).forEach((photo) => {
      if (!uniquePhotos.has(photo.id)) uniquePhotos.set(photo.id, photo);
    });
  }

  const uniquePhotos = new Map();
  mergeMountedSlides(uniquePhotos);

  // displayedCount may fail to parse on an unexpected page layout; fall back to a
  // generous cap so the click loop still has a defined stop condition.
  const safetyTarget = displayedCount ?? 50;
  const maxClicks = safetyTarget + 5;
  const pollTimeoutMs = 2000;
  const pollIntervalMs = 100;
  // Only relevant when displayedCount couldn't be parsed: in that case the
  // size-based stop condition below never kicks in, so without this the loop
  // always burns the full click budget (up to ~110s) even on a tiny listing.
  // Scoped to the null-count case only — when displayedCount is known, a slow
  // CDN/transition could plausibly cause 3 real (not-yet-wrapped-around)
  // timeouts in a row, and the existing count-reached/click-cap conditions
  // already bound that case safely without this extra, coarser heuristic.
  const maxStaleClicks = 3;
  let clicks = 0;
  let staleClicks = 0;

  while (
    (displayedCount === null || uniquePhotos.size < displayedCount) &&
    clicks < maxClicks &&
    (displayedCount !== null || staleClicks < maxStaleClicks)
  ) {
    // Re-query the container and arrow each iteration rather than holding a stale
    // reference — the carousel is an Angular component that could re-render its wrapper.
    const container = document.querySelector('.platinum-hero-carousel');
    if (!container) break;
    const arrowBtn = container.querySelector(
      '.platinum-hero-carousel__arrow--right .platinum-hero-carousel__arrow-btn'
    );
    if (!arrowBtn) break;

    const beforeUrls = scanSlides(container).map((photo) => photo.url);
    arrowBtn.click();
    clicks++;

    const start = Date.now();
    while (Date.now() - start < pollTimeoutMs) {
      const currentUrls = scanSlides(container).map((photo) => photo.url);
      const changed =
        currentUrls.length !== beforeUrls.length ||
        currentUrls.some((url, i) => url !== beforeUrls[i]);
      if (changed) break;
      await sleep(pollIntervalMs);
    }

    // Whether the poll changed something or timed out, re-scan everything
    // currently mounted and merge — treating a timeout as a no-op, not a stop.
    const sizeBefore = uniquePhotos.size;
    mergeMountedSlides(uniquePhotos);
    staleClicks = uniquePhotos.size > sizeBefore ? 0 : staleClicks + 1;
  }

  // Items without a parsed slideNumber keep their discovery order, appended after
  // every item that does have one — explicit tie-breaking instead of comparing
  // two Infinity fallbacks (which would compute NaN and rely on stable-sort luck).
  const images = Array.from(uniquePhotos.values())
    .map((photo, index) => ({ photo, index }))
    .sort((a, b) => {
      const aHas = a.photo.slideNumber !== null;
      const bHas = b.photo.slideNumber !== null;
      if (aHas && bHas) return a.photo.slideNumber - b.photo.slideNumber;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a.index - b.index;
    })
    // {url, id} pairs so tab.js never needs its own copy of the photo-ID regex —
    // only this self-contained injected function needs one.
    .map(({ photo }) => ({ url: photo.url, id: photo.id }));

  return { images, displayedCount };
}

// Guards against a double-click firing two concurrent extraction runs against the
// same source tab, which would both drive the carousel's next-arrow and interfere
// with each other's click-and-poll loop.
const tabsInFlight = new Set();

// Writes the job and opens its result tab. Used for every outcome (unsupported, ok,
// error) so there's exactly one place that can fail to show the user feedback.
async function openResultTab(job) {
  try {
    await chrome.storage.session.set({ [job.jobId]: job });
    await chrome.tabs.create({ url: chrome.runtime.getURL(`tab.html?job=${job.jobId}`) });
  } catch (err) {
    // Nothing else can show the user feedback at this point (the tab that would
    // display it is exactly what failed to open) — at least don't leave an
    // unhandled rejection in the service worker.
    console.error('TradeMe image downloader: failed to open result tab', err);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  if (tabsInFlight.has(tab.id)) return;

  const jobId = crypto.randomUUID();

  // A missing tab.url (as well as a non-matching one) must still route through the
  // "unsupported" view rather than silently doing nothing.
  if (!tab.url || !LISTING_URL_PATTERN.test(tab.url)) {
    await openResultTab({ jobId, status: 'unsupported' });
    return;
  }

  tabsInFlight.add(tab.id);
  // Extraction can take many seconds (carousel click-and-poll) with no other
  // visible sign anything is happening — a badge on the icon is the cheapest
  // signal that the click registered and work is in progress. Best-effort only:
  // if the tab closed between the click and here, this rejects, and it must
  // never be allowed to take down the rest of the handler with it.
  await chrome.action.setBadgeText({ tabId: tab.id, text: '…' }).catch(() => {});
  let job;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractImageUrls,
    });
    // A thrown/failed injection can surface as a missing or result-less entry here
    // rather than a rejected promise — treat that the same as a caught error so it
    // never gets conflated with "found 0 images on a real listing".
    if (!injection || !injection.result) {
      job = { jobId, status: 'error' };
    } else {
      job = { jobId, status: 'ok', images: injection.result.images, displayedCount: injection.result.displayedCount };
    }
  } catch (err) {
    // Injection genuinely failed (tab navigated away, page blocked it, etc.) — this
    // must stay distinguishable from "found 0 images on a real listing".
    console.error('TradeMe image downloader: extraction failed', err);
    job = { jobId, status: 'error' };
  } finally {
    tabsInFlight.delete(tab.id);
    // Same best-effort reasoning as above: if the tab closed mid-extraction,
    // this must not throw and discard the already-computed `job`.
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {});
  }

  await openResultTab(job);
});
