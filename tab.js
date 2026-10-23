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

const CONTENT_TYPE_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

function extFromContentType(contentType) {
  if (!contentType) return null;
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return CONTENT_TYPE_EXT[mime] || null;
}

function extFromUrl(url) {
  const match = new URL(url).pathname.match(/\.([a-zA-Z0-9]{2,4})$/);
  return match ? match[1].toLowerCase() : 'jpg';
}

function getPhotoId(url) {
  const match = url.match(/(\d+)\.\w+(?:\?.*)?$/);
  return match ? match[1] : null;
}

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
    const url = images[i];
    let writable = null;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type');
      const blob = await response.blob();
      const ext = extFromContentType(contentType) || extFromUrl(url);
      const photoId = getPhotoId(url) || String(i + 1);
      const filename = `${i + 1}-${photoId}.${ext}`;
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      writable = null;
      downloaded++;
    } catch (err) {
      if (writable) await writable.abort().catch(() => {});
      failures.push({ index: i + 1, error: err.message || String(err) });
    }
    renderProgress(downloaded, images.length, failures);
  }
}

function showMain(job) {
  mainView.hidden = false;
  renderStatus(job.images, job.displayedCount);

  if (job.images.length === 0) {
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

  // The job record is only ever needed once, by this tab, right now — drop it so
  // repeated clicks on the toolbar icon don't accumulate session-storage entries.
  chrome.storage.session.remove(jobId).catch(() => {});

  if (job.status === 'unsupported') {
    showUnsupported();
    return;
  }

  if (job.status === 'error') {
    showError();
    return;
  }

  showMain(job);
}

init().catch((err) => {
  console.error('TradeMe image downloader: failed to initialize', err);
  showError();
});
