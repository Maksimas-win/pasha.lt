/**
 * Проверки календарной логики. Запуск: node --test tools/tests/
 * Время задаётся явно (управляемая тестовая дата), системные часы не меняются.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../js/pascha-core.js');
const site = JSON.parse(readFileSync(new URL('../../data/site.json', import.meta.url), 'utf8'));
const i18n = JSON.parse(readFileSync(new URL('../../data/i18n.json', import.meta.url), 'utf8'));
const at = (s) => Date.parse(s);
const iso = C.iso;

/** Копия данных, где расписание 2027 года утверждено (для проверки режима с расписанием). */
function siteConfirmed(year) {
  const s = structuredClone(site);
  s.schedules[String(year)] = { status: 'confirmed', template: 'standard', source: 'test' };
  return s;
}
function render(siteData, now, lang = 'ru') {
  const state = C.getState(siteData, now);
  const ctx = { site: siteData, lang, t: i18n[lang], locale: siteData.languages[lang].locale, state, scheduleHref: '#schedule', meaningHref: '/ru/smysl-pashi.html' };
  return { state, hero: C.renderHero(ctx), cd: C.renderCountdown(ctx), sch: C.renderSchedule(ctx), ann: C.renderAnnounce(ctx) };
}

test('Даты православной Пасхи совпадают с независимой таблицей (2026–2040)', () => {
  // Источник: таблица Western/Orthodox Easter, soc-wus.org/ourchurch/calendar.html (проверено 13.10.2026)
  const table = { 2026: '04-12', 2027: '05-02', 2028: '04-16', 2029: '04-08', 2030: '04-28', 2031: '04-13', 2032: '05-02', 2033: '04-24', 2034: '04-09', 2035: '04-29', 2036: '04-20', 2037: '04-05', 2038: '04-25', 2039: '04-17', 2040: '05-06' };
  const western = { 2026: '04-05', 2027: '03-28', 2028: '04-16', 2029: '04-01', 2030: '04-21', 2031: '04-13', 2032: '03-28', 2033: '04-17', 2034: '04-09', 2035: '03-25', 2036: '04-13', 2037: '04-05', 2038: '04-25', 2039: '04-10', 2040: '04-01' };
  for (const y of Object.keys(table)) {
    assert.equal(iso(C.orthodoxPascha(+y)).slice(5), table[y], `Пасха ${y}`);
    assert.equal(iso(C.westernEaster(+y)).slice(5), western[y], `западная Пасха ${y}`);
  }
});

test('Пасха всегда воскресенье в окне 4 апреля — 8 мая (2020–2099)', () => {
  for (let y = 2020; y <= 2099; y++) {
    const p = C.orthodoxPascha(y);
    assert.equal(new Date(C.toUTC(p)).getUTCDay(), 0, `${y}: не воскресенье`);
    const md = p.m * 100 + p.d;
    assert.ok(md >= 404 && md <= 508, `${y}: ${iso(p)} вне окна`);
    const o = C.addDays(p, site.calendar.otdanieDaysAfter);
    assert.equal(new Date(C.toUTC(o)).getUTCDay(), 3, `${y}: Отдание не в среду`);
  }
});

test('Контрольная дата 13.10.2026: режим C, следующая Пасха 2 мая 2027, расписание уточняется', () => {
  const r = render(site, at('2026-10-13T15:00:00+03:00'));
  assert.equal(r.state.mode, 'C');
  assert.equal(iso(r.state.pascha), '2027-05-02');
  assert.equal(r.state.schedule.status, 'pending');
  assert.match(r.hero, /datetime="2027-05-02"/);
  assert.match(r.hero, /panel__day">2<\/span> <span class="panel__month">мая/);
  assert.match(r.ann, /2 мая 2027/);
  assert.match(r.sch, /Расписание уточняется/);
  assert.doesNotMatch(r.hero + r.sch + r.ann, /апреля 2026|11 апреля|12 апреля/);
  assert.equal(r.cd.includes('data-countdown-box'), false, 'в режиме C отсчёта нет');
  assert.match(r.hero, /28 марта 2027/, 'дата западной Пасхи указана');
});

test('Период приглашения начинается за 48 дней (Чистый понедельник 15.03.2027)', () => {
  assert.equal(C.getState(site, at('2027-03-14T23:59:00+02:00')).mode, 'C');
  assert.equal(C.getState(site, at('2027-03-15T00:00:00+02:00')).mode, 'A');
});

test('День перед Пасхой без утверждённого расписания: отсчёт до дня Пасхи, честное «уточняется»', () => {
  const r = render(site, at('2027-05-01T12:00:00+03:00'));
  assert.equal(r.state.mode, 'A');
  assert.equal(r.state.countdown.kind, 'feast');
  assert.equal(r.state.countdown.targetMs, at('2027-05-02T00:00:00+03:00'));
  assert.match(r.cd, /До дня Пасхи/);
  assert.match(r.sch, /Расписание уточняется/);
});

test('День перед Пасхой с утверждённым расписанием: отсчёт до начала службы в субботу 23:30', () => {
  const s = siteConfirmed(2027);
  const r = render(s, at('2027-05-01T12:00:00+03:00'));
  assert.equal(r.state.mode, 'A');
  assert.equal(r.state.countdown.kind, 'service');
  assert.equal(r.state.countdown.targetMs, at('2027-05-01T23:30:00+03:00'));
  assert.match(r.cd, /До начала пасхального богослужения/);
  assert.match(r.cd, /суббота, 1 мая 2027/);
  assert.match(r.sch, /Обедница/);
  assert.doesNotMatch(r.sch, /~\d|00:10|00:30|02:00/, 'нет выдуманного времени утрени и литургии');
  assert.match(r.sch, /затем/);
});

test('Момент начала службы: отсчёт исчезает, режим B, «служба идёт»', () => {
  const s = siteConfirmed(2027);
  const before = C.getState(s, at('2027-05-01T23:29:59+03:00'));
  const start = render(s, at('2027-05-01T23:30:00+03:00'));
  assert.equal(before.mode, 'A');
  assert.equal(start.state.mode, 'B');
  assert.equal(start.state.serviceInProgress, true);
  assert.equal(start.cd.includes('data-countdown-box'), false);
  assert.match(start.hero, /Христос<br>воскресе!/);
  assert.match(start.hero, /уже идёт/);
});

test('Наступление Пасхи и день Пасхи: приветствие, расписание дня ещё видно', () => {
  const s = siteConfirmed(2027);
  const r = render(s, at('2027-05-02T08:00:00+03:00'));
  assert.equal(r.state.mode, 'B');
  assert.equal(r.state.serviceInProgress, false);
  assert.equal(r.state.scheduleRelevant, true);
  assert.match(r.sch, /Обедница/);
  const next = render(s, at('2027-05-03T08:00:00+03:00'));
  assert.equal(next.state.scheduleRelevant, false);
  assert.match(next.sch, /Пасхальные дни продолжаются/);
});

test('День Отдания и следующий день', () => {
  const otd = render(site, at('2027-06-09T23:59:00+03:00'));
  assert.equal(otd.state.mode, 'B');
  assert.match(otd.hero, /9 июня 2027/);
  const after = render(site, at('2027-06-10T00:00:00+03:00'));
  assert.equal(after.state.mode, 'C');
  assert.equal(iso(after.state.pascha), '2028-04-16');
});

test('Смена года: 31.12 → 01.01 остаётся та же ближайшая Пасха', () => {
  const a = C.getState(site, at('2027-12-31T23:59:00+02:00'));
  const b = C.getState(site, at('2028-01-01T00:01:00+02:00'));
  assert.equal(iso(a.pascha), '2028-04-16');
  assert.equal(iso(b.pascha), '2028-04-16');
  assert.equal(a.mode, 'C'); assert.equal(b.mode, 'C');
});

test('Выход за поддерживаемый диапазон: нейтральное сообщение без даты', () => {
  const r = render(site, at('2099-07-01T12:00:00+03:00'));
  assert.equal(r.state.mode, 'unsupported');
  assert.match(r.hero, /пока не внесена/);
  assert.equal(r.sch.includes('2100'), false);
});

test('Часовой пояс Europe/Vilnius и переход на летнее время', () => {
  // Пасха 2027 — после перехода на летнее время (28.03.2027): UTC+3
  assert.equal(C.zonedToUtc({ y: 2027, m: 5, d: 1 }, '23:30', 'Europe/Vilnius'), at('2027-05-01T20:30:00Z'));
  // Зимнее время: UTC+2
  assert.equal(C.zonedToUtc({ y: 2027, m: 1, d: 10 }, '09:00', 'Europe/Vilnius'), at('2027-01-10T07:00:00Z'));
  // Ночь перехода 28.03.2027: 03:00 → 04:00. 04:30 местного = 01:30 UTC
  assert.equal(C.zonedToUtc({ y: 2027, m: 3, d: 28 }, '04:30', 'Europe/Vilnius'), at('2027-03-28T01:30:00Z'));
  // 2029: Пасха 8 апреля — после перехода (25.03.2029)
  assert.equal(C.getState(site, at('2029-01-01T12:00:00+02:00')).paschaStartMs, at('2029-04-08T00:00:00+03:00'));
  // Начало периода приглашения 2029 (19.02) — зимнее время
  assert.equal(C.getState(site, at('2029-01-01T12:00:00+02:00')).inviteStartMs, at('2029-02-19T00:00:00+02:00'));
});

test('Таймер не уходит в минус: после цели режим меняется, отсчёта нет', () => {
  for (const t of ['2027-05-02T00:00:00+03:00', '2027-05-02T00:00:01+03:00', '2027-05-20T12:00:00+03:00']) {
    const s = C.getState(site, at(t));
    assert.equal(s.countdown, null, t);
  }
});

test('Все языки отрисовываются без пропущенных подстановок', () => {
  const s = siteConfirmed(2027);
  for (const t of ['2026-10-13T12:00:00+03:00', '2027-04-20T12:00:00+03:00', '2027-05-01T23:45:00+03:00', '2027-05-10T12:00:00+03:00']) {
    for (const lang of Object.keys(i18n).filter((k) => !k.startsWith('_'))) {
      for (const data of [site, s]) {
        const r = render(data, at(t), lang);
        const all = r.hero + r.cd + r.sch + r.ann;
        assert.doesNotMatch(all, /\{\w+\}|undefined|NaN/, `${lang} ${t}`);
      }
    }
  }
});

test('Пасхальный круг: даты от Пасхи, отметка ближайшего дня, переход к следующему году после Троицы', () => {
  const c1 = C.getCycle(site, at('2026-10-13T12:00:00+03:00'));
  assert.equal(c1.year, 2027);
  assert.deepEqual(c1.items.map((i) => iso(i.date)), ['2027-03-15', '2027-04-25', '2027-05-02', '2027-05-11', '2027-06-09', '2027-06-10', '2027-06-20']);
  assert.equal(c1.items[0].status, 'next');
  const c2 = C.getCycle(site, at('2027-05-02T12:00:00+03:00'));
  assert.equal(c2.items.find((i) => i.id === 'pascha').status, 'today');
  assert.equal(c2.items.find((i) => i.id === 'palm').status, 'past');
  assert.equal(C.getCycle(site, at('2027-06-20T12:00:00+03:00')).year, 2027);
  assert.equal(C.getCycle(site, at('2027-06-21T00:30:00+03:00')).year, 2028);
});

test('Обедница нигде не названа литургией', () => {
  for (const lang of Object.keys(i18n).filter((k) => !k.startsWith('_'))) {
    assert.doesNotMatch(i18n[lang].types.typika.name, /liturg|литург|літург/i, lang);
  }
});
