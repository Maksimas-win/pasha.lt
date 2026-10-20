/** Import published parish events without deriving services from a date or title. */
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const C = require('../../js/pascha-core.js');

export const FEED_URL = 'https://bukiski-hram.net/data/assistant-services.json';
export const TIMEZONE = 'Europe/Vilnius';
export const MAX_FEED_BYTES = 2_000_000;
export const MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
export const DOWNLOAD_TIMEOUT_MS = 15 * 1000;

const LANGUAGES = ['ru', 'lt', 'en', 'pl', 'de', 'uk'];
const SOURCES = new Set(['parish-calendar', 'parish-confirmed']);
const CONTROL = /[\u0000-\u001f\u007f]/;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
});

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message) {
  throw new Error(`Parish feed: ${message}`);
}

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function timestamp(value, label) {
  const match = typeof value === 'string' && TIMESTAMP.exec(value);
  if (!match || !calendarDate(match[1]) || !Number.isFinite(Date.parse(value))) {
    fail(`${label} must be a valid ISO timestamp with an explicit time zone`);
  }
  return Date.parse(value);
}

function metadata(feed, now, fresh) {
  if (!object(feed) || feed.schemaVersion !== 1 || feed.timezone !== TIMEZONE || !Array.isArray(feed.events)) {
    fail('expected schemaVersion 1, Europe/Vilnius and an events array');
  }
  const generatedAt = timestamp(feed.generatedAt, 'generatedAt');
  const sourceUpdatedAt = timestamp(feed.sourceUpdatedAt, 'sourceUpdatedAt');
  if (sourceUpdatedAt > generatedAt + FUTURE_TOLERANCE_MS) {
    fail('sourceUpdatedAt is later than generatedAt');
  }
  if (fresh) {
    for (const [label, value] of [['generatedAt', generatedAt], ['sourceUpdatedAt', sourceUpdatedAt]]) {
      if (now - value > MAX_AGE_MS) fail(`${label} is older than 48 hours`);
      if (value - now > FUTURE_TOLERANCE_MS) fail(`${label} is more than 5 minutes in the future`);
    }
  }
  return { generatedAt, sourceUpdatedAt };
}

function translations(value, label, optional = false) {
  if (optional && (value === undefined || value === null || (object(value) && Object.keys(value).length === 0))) return undefined;
  if (!object(value) || LANGUAGES.some(lang => typeof value[lang] !== 'string' || !value[lang].trim())) {
    fail(`${label} requires nonempty ru, lt, en, pl, de and uk text`);
  }
  return Object.fromEntries(LANGUAGES.map(lang => [lang, value[lang]]));
}

function isPaschaDate(value) {
  const pascha = C.orthodoxPascha(Number(value.slice(0, 4)));
  return pascha !== null && C.iso(pascha) === value;
}

function excluded(event) {
  for (const key of ['cancelled', 'canceled', 'allDay', 'timePending', 'published']) {
    if (event[key] !== undefined && typeof event[key] !== 'boolean') fail(`${key} must be a boolean`);
  }
  if (event.cancelled || event.canceled || event.allDay || event.timePending || event.published === false) return true;
  if (event.status === undefined) return false;
  if (typeof event.status !== 'string') fail('status must be a string when present');
  // The current published feed has no status field. An explicit nonpublic,
  // unconfirmed or cancelled status must never turn into a published service.
  return !['published', 'confirmed'].includes(event.status.toLowerCase());
}

/** Validate the whole feed before returning a replacement snapshot. */
export function normalizeParishFeed(feed, { now = Date.now(), existingSnapshot = null } = {}) {
  if (!Number.isFinite(now)) fail('now must be a finite epoch timestamp');
  const currentTimes = metadata(feed, now, true);
  if (existingSnapshot !== null) {
    const oldTimes = metadata(existingSnapshot, now, false);
    if (existingSnapshot.sourceURL !== FEED_URL) fail('existing snapshot has a different sourceURL');
    for (const key of ['generatedAt', 'sourceUpdatedAt']) {
      if (currentTimes[key] < oldTimes[key]) fail(`refusing regression of ${key}`);
    }
  }

  const ids = new Set();
  const events = [];
  for (const event of feed.events) {
    if (!object(event)) fail('every event must be an object');
    if (typeof event.id !== 'string' || !event.id.trim() || event.id.length > 200 || CONTROL.test(event.id)) fail('invalid event id');
    if (ids.has(event.id)) fail(`duplicate event id ${JSON.stringify(event.id)}`);
    ids.add(event.id);
    if (!SOURCES.has(event.source)) fail(`unapproved event source for ${JSON.stringify(event.id)}`);
    if (excluded(event)) continue;
    if (!calendarDate(event.date)) fail(`invalid date for ${JSON.stringify(event.id)}`);
    const hasFeastDate = event.feastDate !== undefined && event.feastDate !== null;
    if (hasFeastDate && !calendarDate(event.feastDate)) fail(`invalid feastDate for ${JSON.stringify(event.id)}`);
    // Select an already published event on Pascha itself, or an explicitly
    // linked vigil. This does not invent a service or fill in a missing date.
    if (!isPaschaDate(event.date) && !(hasFeastDate && isPaschaDate(event.feastDate))) continue;

    if (typeof event.startTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.startTime)) {
      fail(`invalid date or startTime for ${JSON.stringify(event.id)}`);
    }
    const startMs = timestamp(event.start, `start for ${JSON.stringify(event.id)}`);
    const parts = Object.fromEntries(clock.formatToParts(new Date(startMs)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const localDate = `${parts.year}-${parts.month}-${parts.day}`;
    const localTime = `${parts.hour}:${parts.minute}`;
    if (localDate !== event.date || localTime !== event.startTime || parts.second !== '00' || startMs % 1000 !== 0) {
      fail(`date/startTime does not match start in Europe/Vilnius for ${JSON.stringify(event.id)}`);
    }
    const item = {
      id: event.id, date: event.date,
      ...(hasFeastDate ? { feastDate: event.feastDate } : {}),
      start: event.start, startTime: event.startTime,
      title: translations(event.title, `title for ${JSON.stringify(event.id)}`)
    };
    for (const key of ['subtitle', 'note']) {
      const value = translations(event[key], `${key} for ${JSON.stringify(event.id)}`, true);
      if (value !== undefined) item[key] = value;
    }
    if (event.kind !== undefined) {
      if (typeof event.kind !== 'string' || !event.kind.trim() || event.kind.length > 80 || CONTROL.test(event.kind)) fail(`invalid kind for ${JSON.stringify(event.id)}`);
      item.kind = event.kind;
    }
    item.source = event.source;
    events.push(item);
  }
  events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id, 'en'));
  return {
    schemaVersion: 1, timezone: TIMEZONE, sourceURL: FEED_URL,
    generatedAt: feed.generatedAt, sourceUpdatedAt: feed.sourceUpdatedAt, events
  };
}

async function boundedJson(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_FEED_BYTES) fail('JSON exceeds the 2 MB limit');
    chunks.push(bytes);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  try { return JSON.parse(text); } catch { fail('response is not valid JSON'); }
}

export async function readReviewedFeed(path) {
  return boundedJson(createReadStream(path));
}

/** Fixed public origin only: no credentials, redirects or unrestricted URL option. */
export async function downloadParishFeed({ fetchImpl = globalThis.fetch, timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > DOWNLOAD_TIMEOUT_MS) fail('download timeout must be at most 15 seconds');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Parish feed download timed out')), timeoutMs);
  try {
    const response = await fetchImpl(FEED_URL, {
      method: 'GET', headers: { Accept: 'application/json' },
      credentials: 'omit', redirect: 'error', cache: 'no-cache', signal: controller.signal
    });
    if (response.status !== 200 || response.redirected || (response.url && response.url !== FEED_URL)) fail('download did not return HTTP 200 from the fixed source');
    if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) fail('download is not served as JSON');
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_FEED_BYTES)) fail('download exceeds the 2 MB limit or has an invalid Content-Length');
    if (!response.body) fail('download has no body');
    return await boundedJson(response.body);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** A failed download or validation leaves the previous snapshot byte-for-byte intact. */
export async function syncParishSchedule({ outputPath, inputPath = null, now, fetchImpl } = {}) {
  if (typeof outputPath !== 'string' || !outputPath) fail('outputPath is required');
  const feed = inputPath === null ? await downloadParishFeed({ fetchImpl }) : await readReviewedFeed(inputPath);
  const checkedAt = now === undefined ? Date.now() : now;
  // Validate first, before creating even the temporary output or lock file.
  normalizeParishFeed(feed, { now: checkedAt });
  await mkdir(dirname(outputPath), { recursive: true });
  const lockPath = join(dirname(outputPath), `.${basename(outputPath)}.lock`);
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') fail('another import holds the snapshot lock; no file was changed');
    throw error;
  }
  let tempPath;
  try {
    let existingSnapshot = null;
    try { existingSnapshot = await readReviewedFeed(outputPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const snapshot = normalizeParishFeed(feed, { now: checkedAt, existingSnapshot });
    tempPath = join(dirname(outputPath), `.${basename(outputPath)}.${randomUUID()}.tmp`);
    const file = await open(tempPath, 'wx', 0o644);
    try {
      await file.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      await file.sync();
    } finally { await file.close(); }
    await rename(tempPath, outputPath);
    tempPath = undefined;
    return snapshot;
  } finally {
    if (tempPath) await unlink(tempPath).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
