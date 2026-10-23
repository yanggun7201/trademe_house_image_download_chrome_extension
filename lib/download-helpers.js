const CONTENT_TYPE_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export function extFromContentType(contentType) {
  if (!contentType) return null;
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return CONTENT_TYPE_EXT[mime] || null;
}

export function extFromUrl(url) {
  const match = new URL(url).pathname.match(/\.([a-zA-Z0-9]{2,4})$/);
  return match ? match[1].toLowerCase() : 'jpg';
}
