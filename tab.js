import { extFromContentType, extFromUrl } from './lib/download-helpers.js';

const unsupportedView = document.getElementById('unsupported-view');
const expiredView = document.getElementById('expired-view');
const errorView = document.getElementById('error-view');
const noGalleryView = document.getElementById('no-gallery-view');
const mainView = document.getElementById('main-view');
const statusText = document.getElementById('status-text');
const pickFolderBtn = document.getElementById('pick-folder-btn');
const retryBtn = document.getElementById('retry-btn');
const progressView = document.getElementById('progress-view');
const progressText = document.getElementById('progress-text');
const failuresSection = document.getElementById('failures-section');
const failuresList = document.getElementById('failures-list');

function showUnsupported() {
  unsupportedView.hidden = false;
}

function showExpired() {
  expiredView.hidden = false;
}

function showError() {
  errorView.hidden = false;
}

function showNoGallery() {
  noGalleryView.hidden = false;
}

function renderStatus(images, displayedCount) {
  if (displayedCount !== null && images.length < displayedCount) {
    // Only warn on an undercount — finding more than the page's displayed
    // total (e.g. an extra floorplan slide the carousel also exposes) isn't a
    // problem worth a warning.
    statusText.textContent = `Found ${images.length} of ${displayedCount} images`;
    statusText.className = 'warning';
  } else if (displayedCount === null) {
    // The page's own photo count couldn't be read, so there's nothing to compare
    // against — say so rather than implying this count is verified complete.
    statusText.textContent = `Found ${images.length} images (total count unavailable)`;
    statusText.className = 'warning';
  } else {
    statusText.textContent = `Found ${images.length} images`;
    statusText.className = '';
  }
}

function renderProgress(downloaded, total, failures) {
  progressView.hidden = false;
  if (downloaded + failures.length >= total) {
    if (failures.length > 0) {
      progressText.textContent = `Done. Downloaded ${downloaded} of ${total} images — ${failures.length} failed.`;
      progressText.className = 'warning';
    } else {
      progressText.textContent = `Done. Downloaded ${downloaded} of ${total} images.`;
      progressText.className = '';
    }
  } else {
    progressText.textContent = `Downloading… ${downloaded + failures.length} / ${total}`;
  }
  if (failures.length > 0) {
    failuresSection.hidden = false;
    failuresList.innerHTML = '';
    failures.forEach((failure) => {
      const li = document.createElement('li');
      li.textContent = `#${failure.index}: ${failure.error}`;
      failuresList.appendChild(li);
    });
  }
}

async function downloadAll(images, dirHandle) {
  const failures = [];
  let downloaded = 0;
  if (images.length === 0) {
    renderProgress(0, 0, failures);
    return;
  }
  for (let i = 0; i < images.length; i++) {
    const { url, id } = images[i];
    const photoId = id || String(i + 1);
    let fileHandle = null;
    let writable = null;
    let filename = null;
    let createdNewFile = false;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 15000);
    try {
      const response = await fetch(url, { signal: abortController.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type');
      // A 200 with a non-image body (e.g. an HTML error/captive-portal page)
      // must not be treated as a successful photo download.
      if (contentType && !contentType.toLowerCase().startsWith('image/')) {
        throw new Error(`Unexpected content-type: ${contentType}`);
      }
      const blob = await response.blob();
      const ext = extFromContentType(contentType) || extFromUrl(url);
      filename = `${i + 1}-${photoId}.${ext}`;
      // Re-running into the same folder reuses this exact filename — check
      // whether it already exists *before* touching it, so a failure below
      // never deletes a good file left by an earlier successful run. Only a
      // definite "not found" counts as new; any other error here (e.g. a
      // transient permission/IO error) is treated as "leave it alone".
      createdNewFile = await dirHandle.getFileHandle(filename).then(
        () => false,
        (err) => err.name === 'NotFoundError'
      );
      fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      writable = null;
      downloaded++;
    } catch (err) {
      if (writable) await writable.abort().catch(() => {});
      // Only clean up a file this attempt actually created — never remove one
      // that predates this run.
      if (fileHandle && createdNewFile) await dirHandle.removeEntry(filename).catch(() => {});
      const message = err.name === 'AbortError' ? 'Timed out' : err.message || String(err);
      failures.push({ index: i + 1, error: message });
    } finally {
      clearTimeout(timeoutId);
    }
    renderProgress(downloaded, images.length, failures);
  }
}

function showMain(job) {
  mainView.hidden = false;
  renderStatus(job.images, job.displayedCount);

  if (job.images.length === 0) {
    // Nothing worth protecting against a reload — clean up now.
    chrome.storage.session.remove(job.jobId).catch(() => {});
    pickFolderBtn.hidden = true;
    return;
  }

  let picking = false;

  async function startPick() {
    if (picking) return;
    picking = true;
    try {
      // Request write access up front in the same prompt — asking for it later
      // (implicitly, via getFileHandle/createWritable) risks a second permission
      // request after the click's transient user activation has expired.
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      // Only clean up the job once the user has actually committed to a folder —
      // keeping it until now means an accidental reload (or cancelling the
      // picker) while still deciding doesn't lose the whole carousel-driven
      // photo list and force redoing it.
      chrome.storage.session.remove(job.jobId).catch(() => {});
      // A prior cancel/failure attempt may have left an error message showing —
      // restore the normal "Found N images" status now that a folder was picked.
      renderStatus(job.images, job.displayedCount);
      pickFolderBtn.hidden = true;
      retryBtn.hidden = true;
      await downloadAll(job.images, dirHandle);
    } catch (err) {
      if (err.name === 'AbortError') {
        statusText.textContent = 'No folder selected.';
      } else {
        statusText.textContent = 'Could not access the folder.';
      }
      statusText.className = 'error';
      pickFolderBtn.hidden = true;
      retryBtn.hidden = false;
    } finally {
      picking = false;
    }
  }

  pickFolderBtn.addEventListener('click', startPick);
  retryBtn.addEventListener('click', startPick);
}

async function init() {
  const jobId = new URLSearchParams(location.search).get('job');
  if (!jobId) {
    showExpired();
    return;
  }

  const stored = await chrome.storage.session.get(jobId);
  const job = stored[jobId];
  if (!job) {
    showExpired();
    return;
  }

  // 'unsupported'/'error' jobs carry nothing worth protecting against a reload —
  // clean them up immediately. An 'ok' job is cleaned up later, by showMain, once
  // the user has actually committed to a folder (see showMain/startPick).
  if (job.status === 'unsupported') {
    chrome.storage.session.remove(jobId).catch(() => {});
    showUnsupported();
    return;
  }

  if (job.status === 'error') {
    chrome.storage.session.remove(jobId).catch(() => {});
    showError();
    return;
  }

  if (job.status === 'no_gallery') {
    chrome.storage.session.remove(jobId).catch(() => {});
    showNoGallery();
    return;
  }

  showMain(job);
}

init().catch((err) => {
  console.error('TradeMe image downloader: failed to initialize', err);
  showError();
});
