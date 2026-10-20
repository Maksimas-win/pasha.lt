import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FEED_URL, MAX_FEED_BYTES, MAX_AGE_MS, FUTURE_TOLERANCE_MS,
  normalizeParishFeed, readReviewedFeed, downloadParishFeed, syncParishSchedule
} from '../lib/parish-feed.mjs';

const NOW = Date.parse('2026-10-20T16:00:00Z');
const text = value => Object.fromEntries(['ru', 'lt', 'en', 'pl', 'de', 'uk'].map(lang => [lang, `${value} ${lang}`]));
const night = (extra = {}) => ({
  id: 'pascha-night', date: '2027-05-01', feastDate: '2027-05-02',
  start: '2027-05-01T20:30:00.000Z', startTime: '23:30',
  title: text('Published night service'), subtitle: text('Published feast'),
  kind: 'paschal-night', source: 'parish-calendar', ...extra
});
const day = (extra = {}) => ({
  id: 'pascha-day', date: '2027-05-02',
  start: '2027-05-02T06:00:00.000Z', startTime: '09:00',
  title: text('Published daytime service'), note: text('Published note'),
  source: 'parish-confirmed', ...extra
});
const feed = (events = [night(), day()], extra = {}) => ({
  schemaVersion: 1, timezone: 'Europe/Vilnius',
  generatedAt: '2026-10-20T15:30:00Z', sourceUpdatedAt: '2026-10-20T15:00:00Z',
  sourceURL: 'https://calendar.google.com/public/example.ics', events, ...extra
});
const normalize = (value, options = {}) => normalizeParishFeed(value, { now: NOW, ...options });
const jsonResponse = (data, headers = {}) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });

test('imports the explicitly linked eve and day with exact times, text, kind and provenance', () => {
  const input = feed([day(), night()]);
  const before = structuredClone(input);
  const result = normalize(input);
  assert.equal(result.sourceURL, FEED_URL);
  assert.equal(result.generatedAt, input.generatedAt);
  assert.equal(result.sourceUpdatedAt, input.sourceUpdatedAt);
  assert.deepEqual(result.events, [night(), day()]);
  assert.deepEqual(input, before, 'normalization must not mutate the source');
  assert.equal('kind' in result.events[1], false, 'do not derive a kind for the day service');
  assert.equal('feastDate' in result.events[1], false, 'the actual day event has no explicit feastDate; do not invent it');
});

test('does not infer a Paschal event from its title, kind or ordinary feastDate', () => {
  const missing = night(); delete missing.feastDate;
  const ordinary = night({ id: 'ordinary', feastDate: '2027-05-09' });
  assert.deepEqual(normalize(feed([missing, ordinary])).events, []);
});

test('excludes cancellations, all-day, time-pending and explicitly unpublished entries', () => {
  const flags = [
    { status: 'cancelled' }, { status: 'CANCELED' }, { cancelled: true },
    { allDay: true }, { timePending: true }, { published: false }, { status: 'draft' }
  ];
  const result = normalize(feed(flags.map((flag, i) => night({ id: `excluded-${i}`, ...flag }))));
  assert.deepEqual(result.events, []);
});

test('keeps separate services on the same eve without merging or templating them', () => {
  const earlier = night({ id: 'another-explicit-eve-service', start: '2027-05-01T18:00:00+03:00', startTime: '18:00', kind: 'evening' });
  assert.deepEqual(normalize(feed([day(), night(), earlier])).events, [earlier, night(), day()]);
});

test('rejects a wrong Vilnius clock, wrong local date and subminute start', () => {
  for (const extra of [
    { startTime: '22:30' }, { date: '2027-05-02' },
    { start: '2027-05-01T20:30:01Z' }, { start: '2027-05-01T20:30:00.001Z' }
  ]) assert.throws(() => normalize(feed([night(extra)])), /does not match start in Europe\/Vilnius/);
});

test('rejects rollover dates, missing time zones and malformed timestamps', () => {
  for (const extra of [
    { feastDate: '2027-02-29' }, { date: '2027-04-31' },
    { start: '2027-05-01T20:30:00' }, { start: '2027-05-01T24:30:00Z' }
  ]) assert.throws(() => normalize(feed([night(extra)])), /invalid|ISO timestamp/);
  assert.throws(() => normalize(feed([], { generatedAt: '2026-02-30T12:00:00Z' })), /valid ISO timestamp/);
});

test('freshness checks both original timestamps and does not refresh stale source data', () => {
  for (const field of ['generatedAt', 'sourceUpdatedAt']) {
    const other = field === 'generatedAt' ? { sourceUpdatedAt: new Date(NOW - MAX_AGE_MS - 1).toISOString() } : {};
    assert.throws(() => normalize(feed([], { ...other, [field]: new Date(NOW - MAX_AGE_MS - 1).toISOString() })), /older than 48 hours/);
    assert.throws(() => normalize(feed([], { [field]: new Date(NOW + FUTURE_TOLERANCE_MS + 1).toISOString() })), /future|later than generatedAt/);
  }
  const boundary = new Date(NOW - MAX_AGE_MS).toISOString();
  assert.deepEqual(normalize(feed([], { generatedAt: boundary, sourceUpdatedAt: boundary })).events, []);
});

test('refuses either metadata regression while accepting equal timestamps', () => {
  const existingSnapshot = normalize(feed());
  assert.throws(() => normalize(feed([], { generatedAt: '2026-10-20T15:20:00Z' }), { existingSnapshot }), /regression of generatedAt/);
  assert.throws(() => normalize(feed([], { sourceUpdatedAt: '2026-10-20T14:59:59Z' }), { existingSnapshot }), /regression of sourceUpdatedAt/);
  assert.deepEqual(normalize(feed([]), { existingSnapshot }).events, []);
});

test('rejects schema, time zone, source, duplicate IDs and incomplete translations', () => {
  assert.throws(() => normalize(feed([], { schemaVersion: 2 })), /schemaVersion/);
  assert.throws(() => normalize(feed([], { timezone: 'UTC' })), /Europe\/Vilnius/);
  assert.throws(() => normalize(feed([night({ source: 'generated-template' })])), /unapproved event source/);
  assert.throws(() => normalize(feed([night(), night({ status: 'cancelled' })])), /duplicate event id/);
  assert.throws(() => normalize(feed([night({ title: { ru: 'Only one language' } })])), /requires nonempty/);
  assert.throws(() => normalize(feed([night({ allDay: 'false' })])), /must be a boolean/);
});

test('copies optional translations and kind only when present and valid', () => {
  const event = night({ subtitle: {}, note: null }); delete event.kind;
  const result = normalize(feed([event])).events[0];
  assert.equal('subtitle' in result, false);
  assert.equal('note' in result, false);
  assert.equal('kind' in result, false);
  for (const kind of [null, '', ' ', 'a'.repeat(81), 'paschal-night\n']) {
    assert.throws(() => normalize(feed([night({ kind })])), /invalid kind/);
  }
});

test('download uses the fixed public endpoint without credentials or redirects', async () => {
  let call;
  const result = await downloadParishFeed({ fetchImpl: async (url, options) => {
    call = { url, options };
    return jsonResponse(feed());
  } });
  assert.equal(call.url, FEED_URL);
  assert.equal(call.options.credentials, 'omit');
  assert.equal(call.options.redirect, 'error');
  assert.equal(call.options.cache, 'no-cache');
  assert.ok(call.options.signal instanceof AbortSignal);
  assert.deepEqual(result, feed());
});

test('download rejects errors, non-JSON content, redirects and oversized declared or streamed bodies', async () => {
  await assert.rejects(downloadParishFeed({ fetchImpl: async () => new Response('failure', { status: 503 }) }), /HTTP 200/);
  await assert.rejects(downloadParishFeed({ fetchImpl: async () => new Response('<html/>', { headers: { 'content-type': 'text/html' } }) }), /not served as JSON/);
  await assert.rejects(downloadParishFeed({ fetchImpl: async () => Response.redirect('https://example.invalid/') }), /HTTP 200/);
  await assert.rejects(downloadParishFeed({ fetchImpl: async () => jsonResponse({}, { 'Content-Length': String(MAX_FEED_BYTES + 1) }) }), /2 MB/);
  await assert.rejects(downloadParishFeed({ fetchImpl: async () => jsonResponse({ padding: 'x'.repeat(MAX_FEED_BYTES) }) }), /2 MB/);
});

test('download timeout aborts an unfinished request', async () => {
  await assert.rejects(downloadParishFeed({ timeoutMs: 5, fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) }), /timed out/);
});

test('atomic sync preserves a good snapshot on failure and replaces removed events on success', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pasha-parish-feed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, 'parish-schedule.json');
  const inputPath = join(directory, 'reviewed.json');
  await writeFile(inputPath, JSON.stringify(feed()));
  await syncParishSchedule({ outputPath, inputPath, now: NOW });
  const original = await readFile(outputPath, 'utf8');

  for (const invalid of [
    feed([night({ startTime: '08:00' })]),
    feed([], { generatedAt: '2026-10-20T15:20:00Z' }),
    feed([], { sourceUpdatedAt: '2026-10-17T16:00:00Z' })
  ]) {
    await writeFile(inputPath, JSON.stringify(invalid));
    await assert.rejects(syncParishSchedule({ outputPath, inputPath, now: NOW }));
    assert.equal(await readFile(outputPath, 'utf8'), original);
  }
  await writeFile(inputPath, '{broken');
  await assert.rejects(syncParishSchedule({ outputPath, inputPath, now: NOW }), /valid JSON/);
  assert.equal(await readFile(outputPath, 'utf8'), original);

  await writeFile(inputPath, JSON.stringify(feed([day()], { generatedAt: '2026-10-20T15:40:00Z', sourceUpdatedAt: '2026-10-20T15:35:00Z' })));
  const result = await syncParishSchedule({ outputPath, inputPath, now: NOW });
  assert.deepEqual(result.events.map(event => event.id), ['pascha-day']);
  assert.equal(result.sourceUpdatedAt, '2026-10-20T15:35:00Z');
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), result);

  await writeFile(inputPath, JSON.stringify(feed([], { generatedAt: '2026-10-20T15:50:00Z', sourceUpdatedAt: '2026-10-20T15:45:00Z' })));
  assert.deepEqual((await syncParishSchedule({ outputPath, inputPath, now: NOW })).events, []);
  assert.deepEqual((await readdir(directory)).sort(), ['parish-schedule.json', 'reviewed.json']);
});

test('local reviewed files have the same byte limit and cannot bypass a concurrent writer', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pasha-parish-feed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, 'reviewed.json');
  const outputPath = join(directory, 'parish-schedule.json');
  await writeFile(inputPath, ' '.repeat(MAX_FEED_BYTES + 1));
  await assert.rejects(readReviewedFeed(inputPath), /2 MB/);
  await writeFile(inputPath, JSON.stringify(feed()));
  await writeFile(outputPath, 'existing bytes');
  await writeFile(join(directory, '.parish-schedule.json.lock'), 'held');
  await assert.rejects(syncParishSchedule({ outputPath, inputPath, now: NOW }), /snapshot lock/);
  assert.equal(await readFile(outputPath, 'utf8'), 'existing bytes');
});
