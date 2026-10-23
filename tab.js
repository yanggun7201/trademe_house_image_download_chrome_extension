import { extFromContentType, extFromUrl } from './lib/download-helpers.js';

const unsupportedView = document.getElementById('unsupported-view');
const expiredView = document.getElementById('expired-view');
const errorView = document.getElementById('error-view');
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

function renderStatus(images, displayedCount) {
  if (displayedCount !== null && displayedCount !== images.length) {
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
    progressText.textContent = `Done. Downloaded ${downloaded} of ${total} images.`;
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
    let fileHandle = null;
    let writable = null;
    let filename = null;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type');
      const blob = await response.blob();
      const ext = extFromContentType(contentType) || extFromUrl(url);
      const photoId = id || String(i + 1);
      filename = `${i + 1}-${photoId}.${ext}`;
      fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      writable = null;
      downloaded++;
    } catch (err) {
      if (writable) await writable.abort().catch(() => {});
      // getFileHandle(..., {create: true}) creates the file immediately, so a
      // failure after that point would otherwise leave an empty file behind
      // that looks like a successful download.
      if (fileHandle && filename) await dirHandle.removeEntry(filename).catch(() => {});
      failures.push({ index: i + 1, error: err.message || String(err) });
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

  showMain(job);
}

init().catch((err) => {
  console.error('TradeMe image downloader: failed to initialize', err);
  showError();
});
