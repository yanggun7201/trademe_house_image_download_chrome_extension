import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extFromContentType, extFromUrl, LISTING_URL_PATTERN } from './download-helpers.js';

test('extFromContentType: known mime types', () => {
  assert.equal(extFromContentType('image/jpeg'), 'jpg');
  assert.equal(extFromContentType('image/png'), 'png');
  assert.equal(extFromContentType('image/webp'), 'webp');
  assert.equal(extFromContentType('image/gif'), 'gif');
  assert.equal(extFromContentType('image/avif'), 'avif');
});

test('extFromContentType: is case-insensitive', () => {
  assert.equal(extFromContentType('IMAGE/JPEG'), 'jpg');
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

test('extFromUrl: throws on an invalid URL (caller is expected to catch it)', () => {
  assert.throws(() => extFromUrl('not-a-url'));
});

test('LISTING_URL_PATTERN: matches a real multi-segment listing URL', () => {
  // This exact shape (4 segments between residential/ and listing/) is what
  // round-1's Must-Fix bug failed to match — regression coverage for it.
  assert.match(
    'https://www.trademe.co.nz/a/property/residential/sale/auckland/north-shore-city/greenhithe/listing/6170684926',
    LISTING_URL_PATTERN
  );
});

test('LISTING_URL_PATTERN: matches a single-segment listing URL', () => {
  assert.match(
    'https://www.trademe.co.nz/a/property/residential/sale/listing/123456',
    LISTING_URL_PATTERN
  );
});

test('LISTING_URL_PATTERN: rejects a non-listing TradeMe page', () => {
  assert.doesNotMatch(
    'https://www.trademe.co.nz/a/property/residential/sale/auckland',
    LISTING_URL_PATTERN
  );
});

test('LISTING_URL_PATTERN: rejects a non-TradeMe host', () => {
  assert.doesNotMatch(
    'https://example.com/a/property/residential/sale/listing/123456',
    LISTING_URL_PATTERN
  );
});
