import { LISTING_URL_PATTERN, sortPhotosBySlide } from './lib/download-helpers.js';

const LOG_PREFIX = '[TMHD]';

// Injected directly into the listing tab via chrome.scripting.executeScript.
// Must be fully self-contained — no references to anything outside this function,
// including LOG_PREFIX above — so it logs with its own inline literal instead.
// These logs show up in the *listing tab's* DevTools console, not the service
// worker's, since this function runs in the page.
async function extractImageUrls() {
  const LOG_PREFIX = '[TMHD]';

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

  console.log(`${LOG_PREFIX} extractImageUrls: starting`);

  const addressEl = document.querySelector('.property-info__address');
  const address = addressEl ? addressEl.textContent.trim().replace(/\s+/g, ' ') : null;
  console.log(`${LOG_PREFIX} address parsed as:`, address);

  let displayedCount = null;
  const viewImagesBtn = document.querySelector('button[aria-label="View images"]');
  if (viewImagesBtn) {
    const match = viewImagesBtn.textContent.match(/(\d+)\s*Images?/i);
    if (match) displayedCount = parseInt(match[1], 10);
  }
  console.log(`${LOG_PREFIX} displayedCount parsed as:`, displayedCount, '(raw button text:', viewImagesBtn ? viewImagesBtn.textContent : '<button not found>', ')');

  if (!document.querySelector('.platinum-hero-carousel')) {
    console.log(`${LOG_PREFIX} .platinum-hero-carousel not found on this page — returning noGallery`);
    // Distinct from "found 0 images on a real listing" — this listing's photo
    // gallery isn't in the one DOM shape this extension knows how to read,
    // which is a meaningfully different thing to tell the user.
    return { photos: [], displayedCount, noGallery: true, address };
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
  console.log(`${LOG_PREFIX} baseline scan (before any clicks) found`, uniquePhotos.size, 'unique photo(s)');

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
    if (!container) {
      console.log(`${LOG_PREFIX} carousel container disappeared mid-loop at click`, clicks, '— stopping');
      break;
    }
    const arrowBtn = container.querySelector(
      '.platinum-hero-carousel__arrow--right .platinum-hero-carousel__arrow-btn'
    );
    if (!arrowBtn) {
      console.log(`${LOG_PREFIX} next-arrow button not found at click`, clicks, '— stopping');
      break;
    }

    const beforeUrls = scanSlides(container).map((photo) => photo.url);
    arrowBtn.click();
    clicks++;

    const pollStart = Date.now();
    let pollChanged = false;
    while (Date.now() - pollStart < pollTimeoutMs) {
      const currentUrls = scanSlides(container).map((photo) => photo.url);
      const changed =
        currentUrls.length !== beforeUrls.length ||
        currentUrls.some((url, i) => url !== beforeUrls[i]);
      if (changed) {
        pollChanged = true;
        break;
      }
      await sleep(pollIntervalMs);
    }

    // Whether the poll changed something or timed out, re-scan everything
    // currently mounted and merge — treating a timeout as a no-op, not a stop.
    const sizeBefore = uniquePhotos.size;
    mergeMountedSlides(uniquePhotos);
    const gained = uniquePhotos.size - sizeBefore;
    staleClicks = gained > 0 ? 0 : staleClicks + 1;
    console.log(
      `${LOG_PREFIX} click ${clicks}/${maxClicks}:`,
      pollChanged ? 'DOM changed within poll' : `poll timed out after ${pollTimeoutMs}ms`,
      '— unique photos now', uniquePhotos.size, displayedCount !== null ? `/ ${displayedCount}` : '(total unknown)',
      gained > 0 ? `(+${gained} new)` : `(no new photo, staleClicks=${staleClicks})`
    );
  }

  console.log(
    `${LOG_PREFIX} extractImageUrls: done after`, clicks, 'click(s) —',
    uniquePhotos.size, 'unique photo(s) found, displayedCount =', displayedCount,
    ', stopped because:',
    displayedCount !== null && uniquePhotos.size >= displayedCount
      ? 'reached displayed count'
      : clicks >= maxClicks
        ? 'hit maxClicks safety cap'
        : staleClicks >= maxStaleClicks
          ? 'hit maxStaleClicks (no new photos for several clicks in a row)'
          : 'carousel container/arrow disappeared'
  );

  // Sorting happens back in background.js (see the click handler below) using
  // the shared, unit-tested sortPhotosBySlide — return the raw deduped photos
  // (with id/url/slideNumber) rather than duplicating that logic in here.
  return { photos: Array.from(uniquePhotos.values()), displayedCount, noGallery: false, address };
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
  console.log(`${LOG_PREFIX} result tab`, closedTabId, 'closed — cleaning up abandoned job', jobId);
  delete resultTabJobs[closedTabId];
  await chrome.storage.session.set({ resultTabJobs }).catch(() => {});
  await chrome.storage.session.remove(jobId).catch(() => {});
});

// Writes the job and opens its result tab. Used for every outcome (unsupported, ok,
// error) so there's exactly one place that can fail to show the user feedback.
async function openResultTab(job) {
  console.log(`${LOG_PREFIX} openResultTab: writing job and opening result tab —`, job);
  try {
    await chrome.storage.session.set({ [job.jobId]: job });
    const resultTab = await chrome.tabs.create({ url: chrome.runtime.getURL(`tab.html?job=${job.jobId}`) });
    console.log(`${LOG_PREFIX} openResultTab: result tab opened, tabId =`, resultTab && resultTab.id);
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
  console.log(`${LOG_PREFIX} toolbar icon clicked — tabId:`, tab.id, 'url:', tab.url);

  if (!tab.id) return;
  if (tabsInFlight.has(tab.id)) {
    console.log(`${LOG_PREFIX} tab`, tab.id, 'already has an extraction in flight — ignoring this click');
    return;
  }

  const jobId = crypto.randomUUID();

  // A missing tab.url (as well as a non-matching one) must still route through the
  // "unsupported" view rather than silently doing nothing.
  if (!tab.url || !LISTING_URL_PATTERN.test(tab.url)) {
    console.log(`${LOG_PREFIX} URL did not match LISTING_URL_PATTERN — job`, jobId, 'is unsupported');
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
  console.log(`${LOG_PREFIX} job`, jobId, '— injecting extractImageUrls into tab', tab.id, 'at', new Date().toISOString());
  const extractionStart = Date.now();
  let job;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractImageUrls,
    });
    console.log(`${LOG_PREFIX} job`, jobId, `— executeScript resolved after ${Date.now() - extractionStart}ms; injection =`, injection);
    // A thrown/failed injection can surface as a missing or result-less entry here
    // rather than a rejected promise — treat that the same as a caught error so it
    // never gets conflated with "found 0 images on a real listing".
    if (!injection || !injection.result) {
      console.log(`${LOG_PREFIX} job`, jobId, '— no usable injection result, treating as error');
      job = { jobId, status: 'error' };
    } else if (injection.result.noGallery) {
      // Distinct from "ok, found 0 images" — the page didn't have the expected
      // gallery markup at all, which reads to the user very differently.
      job = { jobId, status: 'no_gallery', address: injection.result.address };
    } else {
      const images = sortPhotosBySlide(injection.result.photos).map((photo) => ({
        url: photo.url,
        id: photo.id,
      }));
      job = {
        jobId,
        status: 'ok',
        images,
        displayedCount: injection.result.displayedCount,
        address: injection.result.address,
      };
      console.log(`${LOG_PREFIX} job`, jobId, '— extraction ok:', images.length, 'image(s), displayedCount =', injection.result.displayedCount, ', address =', injection.result.address);
    }
  } catch (err) {
    // Injection genuinely failed (tab navigated away, page blocked it, etc.) — this
    // must stay distinguishable from "found 0 images on a real listing".
    console.error(`${LOG_PREFIX} job`, jobId, `— extraction threw after ${Date.now() - extractionStart}ms:`, err);
    job = { jobId, status: 'error' };
  } finally {
    tabsInFlight.delete(tab.id);
    // Same best-effort reasoning as above: if the tab closed mid-extraction,
    // this must not throw and discard the already-computed `job`.
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {});
  }

  console.log(`${LOG_PREFIX} job`, jobId, `— total time from click to result: ${Date.now() - extractionStart}ms, final status:`, job.status);
  await openResultTab(job);
});
