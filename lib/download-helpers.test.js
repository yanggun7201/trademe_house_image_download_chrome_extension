import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extFromContentType, extFromUrl } from './download-helpers.js';

test('extFromContentType: known mime types', () => {
  assert.equal(extFromContentType('image/jpeg'), 'jpg');
  assert.equal(extFromContentType('image/png'), 'png');
  assert.equal(extFromContentType('image/webp'), 'webp');
});

test('extFromContentType: strips charset/parameters', () => {
  assert.equal(extFromContentType('image/jpeg; charset=binary'), 'jpg');
});

test('extFromContentType: unknown or missing type returns null', () => {
  assert.equal(extFromContentType('application/octet-stream'), null);
  assert.equal(extFromContentType(null), null);
  assert.equal(extFromContentType(''), null);
});

test('extFromUrl: extracts extension from pathname', () => {
  assert.equal(extFromUrl('https://trademe.tmcdn.co.nz/photoserver/plus/123.jpg'), 'jpg');
  assert.equal(extFromUrl('https://trademe.tmcdn.co.nz/photoserver/plus/123.PNG'), 'png');
});

test('extFromUrl: ignores query string', () => {
  assert.equal(extFromUrl('https://trademe.tmcdn.co.nz/photoserver/plus/123.jpg?v=2'), 'jpg');
});

test('extFromUrl: falls back to jpg when no extension is present', () => {
  assert.equal(extFromUrl('https://trademe.tmcdn.co.nz/photoserver/plus/123'), 'jpg');
});
