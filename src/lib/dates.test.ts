import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, isoDate } from './dates.ts';

test('formats dates the way the landing page prints them', () => {
  assert.equal(formatDate(new Date('2026-09-26')), '26 Sep 2026');
  assert.equal(formatDate(new Date('2026-09-09')), '9 Sep 2026');
  assert.equal(formatDate(new Date('2027-01-01')), '1 Jan 2027');
});

test('isoDate gives the datetime attribute', () => {
  assert.equal(isoDate(new Date('2026-09-09')), '2026-09-09');
});
