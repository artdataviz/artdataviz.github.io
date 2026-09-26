import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPostHead, sitePath } from './post-head.ts';

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Every bit counts</title>
<meta name="description" content="Bars of ones &amp; zeros &mdash; measured in OKLCH.">
<!-- <meta property="article:published_time" content="1999-01-01"> -->
<meta property="article:published_time" content="2026-09-26">
<meta property="og:image" content="https://artdataviz.github.io/generative-dataviz/og.jpg" />
<meta property="og:image:width" content="1200" />
<meta property='og:image:height' content='630' />
<meta property="og:image:alt"
  content="A dark bar chart &middot; orange and purple." />
</head>
<body><svg><title>Not the page title</title></svg></body>
</html>`;

test('reads title, description, date and share image from the head', () => {
  assert.deepEqual(readPostHead(page), {
    title: 'Every bit counts',
    description: 'Bars of ones & zeros — measured in OKLCH.',
    published: '2026-09-26',
    image: 'https://artdataviz.github.io/generative-dataviz/og.jpg',
    imageWidth: 1200,
    imageHeight: 630,
    imageAlt: 'A dark bar chart · orange and purple.',
  });
});

test('ignores tags inside comments and elements after the head', () => {
  const head = readPostHead(page);
  assert.equal(head.published, '2026-09-26');
  assert.equal(head.title, 'Every bit counts');
});

test('leaves missing tags undefined', () => {
  assert.deepEqual(readPostHead('<html><head><title>CV</title></head></html>'), {
    title: 'CV',
    description: undefined,
    published: undefined,
    image: undefined,
    imageWidth: undefined,
    imageHeight: undefined,
    imageAlt: undefined,
  });
});

test('trims whitespace around the title', () => {
  assert.equal(readPostHead('<head><title>\n  8,631 stars\n</title></head>').title, '8,631 stars');
});

const site = 'https://artdataviz.github.io';

test('sitePath turns a same-site URL into a root-relative path', () => {
  assert.equal(sitePath('https://artdataviz.github.io/8631-stars/og.jpg', '8631-stars', site), '/8631-stars/og.jpg');
});

test('sitePath resolves a relative path against the post folder', () => {
  assert.equal(sitePath('og.jpg', '8631-stars', site), '/8631-stars/og.jpg');
  assert.equal(sitePath('/shared/card.jpg', '8631-stars', site), '/shared/card.jpg');
});

test('sitePath keeps images hosted elsewhere as full URLs', () => {
  assert.equal(sitePath('https://cdn.example.com/card.jpg', 'x', site), 'https://cdn.example.com/card.jpg');
});
