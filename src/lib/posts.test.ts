import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePosts, type Card } from './posts.ts';

const card = (slug: string, date: string): Card => ({
  slug,
  title: slug,
  description: '',
  date: new Date(date),
  image: { src: `/${slug}/og.jpg`, width: 1200, height: 630 },
});

test('merges both sources, newest first', () => {
  const posts = mergePosts(
    [card('8631-stars', '2026-09-09'), card('generative-dataviz', '2026-09-26')],
    [card('vr-sky', '2026-10-01')],
  );
  assert.deepEqual(posts.map((p) => p.slug), ['vr-sky', 'generative-dataviz', '8631-stars']);
});

test('posts on the same day keep a stable order', () => {
  const posts = mergePosts([card('b', '2026-09-09'), card('a', '2026-09-09')], []);
  assert.deepEqual(posts.map((p) => p.slug), ['a', 'b']);
});

test('refuses two posts with the same slug', () => {
  assert.throws(
    () => mergePosts([card('8631-stars', '2026-09-09')], [card('8631-stars', '2026-10-01')]),
    /8631-stars.*public\/8631-stars.*src\/posts\/8631-stars/s,
  );
});
