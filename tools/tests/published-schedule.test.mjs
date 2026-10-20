import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../js/pascha-core.js');
const site = JSON.parse(readFileSync(new URL('../../data/site.json', import.meta.url), 'utf8'));
const i18n = JSON.parse(readFileSync(new URL('../../data/i18n.json', import.meta.url), 'utf8'));
const languages = ['ru', 'lt', 'en', 'pl', 'de', 'uk'];
const names = text => Object.fromEntries(languages.map(lang => [lang, text]));
const events = [
  { id: 'night', date: '2027-05-01', feastDate: '2027-05-02', kind: 'paschal-night', start: '2027-05-01T20:30:00.000Z', startTime: '23:30', title: names('Published night service'), source: 'parish-calendar' },
  { id: 'morning', date: '2027-05-02', kind: 'typica', start: '2027-05-02T06:00:00.000Z', startTime: '09:00', title: names('Published Typica'), source: 'parish-calendar' }
];
const now = Date.parse('2026-10-20T21:00:00Z');

function fixture(updatedAt = now, selected = events) {
  const copy = structuredClone(site);
  copy.parishSchedule = {
    schemaVersion: 1, timezone: 'Europe/Vilnius', sourceURL: 'https://bukiski-hram.net/data/assistant-services.json',
    generatedAt: new Date(updatedAt).toISOString(), sourceUpdatedAt: new Date(updatedAt).toISOString(), events: structuredClone(selected)
  };
  return copy;
}
function context(data, instant = now, lang = 'ru') {
  return { site: data, state: C.getState(data, instant), t: i18n[lang], lang, locale: data.languages[lang].locale, scheduleHref: '#schedule' };
}

test('Published night and morning stay separate from the unconfirmed full template', () => {
  const data = fixture(), ctx = context(data);
  assert.equal(data.schedules['2027'].status, 'pending');
  assert.equal(ctx.state.schedule.status, 'published');
  assert.deepEqual(ctx.state.schedule.events.map(event => event.id), ['night', 'morning']);
  const rendered = C.renderSchedule(ctx);
  assert.match(rendered, /23:30/);
  assert.match(rendered, /09:00/);
  assert.doesNotMatch(rendered, /14:00|19:00|Расписание утверждено/);
  assert.equal(ctx.state.serviceStartMs, Date.parse(events[0].start));
});

test('Every language renders source titles, freshness and its parish page', () => {
  for (const lang of languages) {
    const ctx = context(fixture(), now, lang);
    const rendered = C.renderSchedule(ctx);
    assert.ok(rendered.includes(events[0].title[lang]));
    assert.ok(rendered.includes(i18n[lang].schedule.updatedLabel));
    assert.ok(rendered.includes(`https://bukiski-hram.net/${lang}/schedule.html`));
    assert.doesNotMatch(rendered, /undefined/);
  }
});

test('Stale or future-dated snapshots hide times and direct visitors to the parish', () => {
  for (const timestamp of [now - 48 * 3600000 - 1, now + 300001]) {
    const ctx = context(fixture(timestamp));
    assert.equal(ctx.state.schedule.status, 'stale');
    assert.equal(ctx.state.serviceStartMs, null);
    assert.doesNotMatch(C.renderSchedule(ctx) + C.renderHero(ctx), /23:30|09:00|14:00|19:00/);
    assert.ok(C.renderSchedule(ctx).includes(i18n.ru.schedule.staleText));
    assert.doesNotMatch(C.renderHero(ctx), /data-ics-start=/);
  }
});

test('A fresh published night drives countdown and ICS without importing the old template', () => {
  const instant = Date.parse('2027-05-01T12:00:00+03:00');
  const ctx = context(fixture(instant), instant);
  assert.equal(ctx.state.countdown.kind, 'service');
  assert.equal(ctx.state.countdown.targetMs, Date.parse(events[0].start));
  assert.match(C.renderHero(ctx), /data-ics-start="20270501T203000Z"/);
  assert.doesNotMatch(C.renderSchedule(ctx), /14:00|19:00/);
});

test('Already started services are removed from the upcoming list and the night greeting changes on time', () => {
  const instant = Date.parse(events[0].start);
  const ctx = context(fixture(instant), instant + 1);
  assert.equal(ctx.state.mode, 'B');
  assert.equal(ctx.state.serviceInProgress, true);
  const rendered = C.renderSchedule(ctx);
  assert.doesNotMatch(rendered, /Published night service/);
  assert.match(rendered, /Published Typica/);
});

test('No food-blessing hours are invented and an empty manual list has a useful message', () => {
  assert.ok(C.renderBlessing(context(fixture())).includes(i18n.ru.schedule.blessingText));
  const data = structuredClone(site);
  data.schedules['2027'] = { status: 'confirmed', items: [{ group: 'sunday', type: 'typika', day: 0, time: '09:00' }] };
  assert.ok(C.renderBlessing(context(data)).includes(i18n.ru.schedule.blessingText));
  assert.doesNotMatch(C.renderBlessing(context(data)), /<ul[^>]*><\/ul>/);
});

test('Removal or a new Paschal year never revives old published events', () => {
  const empty = context(fixture(now, []));
  assert.equal(empty.state.schedule.status, 'pending');
  assert.doesNotMatch(C.renderSchedule(empty), /23:30|09:00/);
  const next = Date.parse('2027-07-01T10:00:00Z');
  const ctx = context(fixture(next), next);
  assert.equal(ctx.state.year, 2028);
  assert.equal(ctx.state.schedule.status, 'pending');
  assert.doesNotMatch(C.renderSchedule(ctx), /Published night service/);
});

test('Published titles remain text when rendered', () => {
  const data = fixture();
  data.parishSchedule.events[0].title.ru = '<img src=x onerror=alert(1)>';
  const rendered = C.renderSchedule(context(data));
  assert.match(rendered, /&lt;img/);
  assert.doesNotMatch(rendered, /<img src=x/);
});
