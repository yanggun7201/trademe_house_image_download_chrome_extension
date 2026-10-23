import { LISTING_URL_PATTERN, sortPhotosBySlide } from './lib/download-helpers.js';

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
    // Distinct from "found 0 images on a real listing" — this listing's photo
    // gallery isn't in the one DOM shape this extension knows how to read,
    // which is a meaningfully different thing to tell the user.
    return { photos: [], displayedCount, noGallery: true };
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

  // Sorting happens back in background.js (see the click handler below) using
  // the shared, unit-tested sortPhotosBySlide — return the raw deduped photos
  // (with id/url/slideNumber) rather than duplicating that logic in here.
  return { photos: Array.from(uniquePhotos.values()), displayedCount, noGallery: false };
}

// Guards against a double-click firing two concurrent extraction runs against the
// same source tab, which would both drive the carousel's next-arrow and interfere
// with each other's click-and-poll loop.
const tabsInFlight = new Set();

// Registered at the top level (not inside an event handler) so Chrome can wake a
// terminated service worker to deliver this event — a listener added dynamically
// inside openResultTab would vanish the moment the worker that created it is
// recycled, which is the common case since a user rarely closes the result tab
// within the same ~30s worker lifetime. The tabId->jobId mapping lives in
// chrome.storage.session (not an in-memory Map) for the same reason: it must
// survive a worker restart to still be there when this fires.
chrome.tabs.onRemoved.addListener(async (closedTabId) => {
  const { resultTabJobs } = await chrome.storage.session.get('resultTabJobs');
  const jobId = resultTabJobs && resultTabJobs[closedTabId];
  if (jobId === undefined) return;
  delete resultTabJobs[closedTabId];
  await chrome.storage.session.set({ resultTabJobs }).catch(() => {});
  await chrome.storage.session.remove(jobId).catch(() => {});
});

// Writes the job and opens its result tab. Used for every outcome (unsupported, ok,
// error) so there's exactly one place that can fail to show the user feedback.
async function openResultTab(job) {
  try {
    await chrome.storage.session.set({ [job.jobId]: job });
    const resultTab = await chrome.tabs.create({ url: chrome.runtime.getURL(`tab.html?job=${job.jobId}`) });
    // Cleans up a job if its result tab is ever closed without the user picking a
    // folder — tab.js already removes 'ok' jobs once a folder is committed, and
    // 'unsupported'/'error'/'no_gallery' jobs immediately, so this only matters
    // for the abandoned-tab case. See the top-level chrome.tabs.onRemoved listener.
    if (resultTab && resultTab.id !== undefined) {
      const { resultTabJobs } = await chrome.storage.session.get('resultTabJobs');
      await chrome.storage.session.set({
        resultTabJobs: { ...resultTabJobs, [resultTab.id]: job.jobId },
      });
    }
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
    } else if (injection.result.noGallery) {
      // Distinct from "ok, found 0 images" — the page didn't have the expected
      // gallery markup at all, which reads to the user very differently.
      job = { jobId, status: 'no_gallery' };
    } else {
      const images = sortPhotosBySlide(injection.result.photos).map((photo) => ({
        url: photo.url,
        id: photo.id,
      }));
      job = { jobId, status: 'ok', images, displayedCount: injection.result.displayedCount };
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
