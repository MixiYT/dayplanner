'use strict';
/* Интерфейс ежедневника. Данные и логика живут в ядре (Rust): здесь только показ и ввод. */

// ---------- мост к Rust и к Android ----------
const TAURI = window.__TAURI__;
const IS_DEMO = !TAURI;

/* Время всегда берём с часов устройства: на Android ядро может не знать часовой пояс. */
const localIso = () => { const d = new Date(); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
async function api(cmd, args = {}, now = null) {
  if (IS_DEMO) return demo.api(cmd, args, now);
  return TAURI.core.invoke('api', { cmd, args, now: now || localIso() });
}
async function native(cmd, args = {}) {
  if (IS_DEMO) return null;
  try { return await TAURI.core.invoke('plugin:planner-native|native', { cmd, args }); } catch (_) { return null; }
}
function errText(e) { return typeof e === 'string' ? e : (e && e.message) || 'Что-то пошло не так'; }

// ---------- утилиты ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const todayStr = () => ymd(new Date());
const hhmm = (iso) => iso.slice(11, 16);
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const longDate = (d) => { const t = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }); return t.charAt(0).toUpperCase() + t.slice(1); };
function plural(n, [a, b, c]) {
  const m = Math.abs(n) % 100, k = m % 10;
  return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c;
}

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

const ICONS = {
  today: '<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M8 14l2.5 2.5L16 12"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M10 17h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
};
function svg(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[name];
  return s;
}

// ---------- состояние ----------
const S = {
  tab: 'today', view: 'day', date: todayStr(),
  settings: {}, cats: [], filterCat: null,
  board: { period: 'week', roomOnly: false }, token: 0,
};
const catById = (id) => S.cats.find((c) => c.id === id);
const catColor = (id) => (catById(id) || {}).color || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6750A4';

const EMOJI = ['🔔', '⏰', '💊', '💼', '📞', '📧', '🛒', '🏋️', '🏃', '🧘', '📖', '🎓', '✍️', '💻', '🧹', '🍳', '🚗', '✈️', '🎂', '🎁', '💳', '🏠', '🐕', '🌱',
  '❤️', '⭐', '🎯', '🎵', '🎮', '☕', '💧', '😴', '🦷', '🩺', '🧾', '📅', '📦', '🛠️', '🔑', '👶'];
const ACCENTS = ['#6750A4', '#1A73E8', '#009688', '#2E9E5B', '#F9A825', '#F4511E', '#E91E63', '#8E24AA', '#546E7A'];
const THEMES = [
  ['material', 'Material', 'Мягкие тона от акцента'],
  ['amoled', 'AMOLED', 'Чистый чёрный'],
  ['glass', 'Liquid glass', 'Стекло и размытие'],
  ['simple', 'Simple', 'Спокойно и плоско'],
];
const STATUS_TEXT = {
  upcoming: 'Впереди', due: 'Пора выполнить', done_on_time: 'Выполнено вовремя', done_late: 'Выполнено с опозданием',
  missed: 'Не выполнено', skipped: 'Пропущено',
};
const ALERT_TEXT = { notification: 'Уведомление', alarm: 'Будильник', full_screen: 'На весь экран' };
const ALERT_ICON = { notification: '🔔', alarm: '⏰', full_screen: '📱' };

// ---------- оформление ----------
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function applyTheme() {
  const s = S.settings;
  const theme = s.theme || 'material';
  const accent = /^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : '#6750A4';
  let scheme = s.mode === 'light' ? 'light' : s.mode === 'dark' ? 'dark' : (darkQuery.matches ? 'dark' : 'light');
  if (theme === 'amoled') scheme = 'dark';
  const r = document.documentElement;
  r.dataset.theme = theme; r.dataset.scheme = scheme;
  r.style.setProperty('--accent', accent);
  r.style.setProperty('--on-accent', luminance(accent) > 0.4 ? '#161616' : '#ffffff');
  Background.set({ mode: s.bg || 'none', intensity: (Number(s.bg_intensity) || 0) / 100, accent, dark: scheme === 'dark' });
}
darkQuery.addEventListener?.('change', () => { if ((S.settings.mode || 'auto') === 'auto') applyTheme(); });

async function setSetting(key, value, rerender = false) {
  S.settings[key] = value;
  await api('settings.set', { key, value: String(value) });
  applyTheme();
  syncSoon();
  if (rerender) render();
}

// ---------- сообщения ----------
function toast(text, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, text);
  $('#toast-root').append(t);
  setTimeout(() => t.remove(), kind === 'gold' ? 4200 : 2600);
}
const $ = (s, r = document) => r.querySelector(s);

// ---------- связь с Android: будильники и виджеты ----------
let syncTimer = 0;
function syncSoon() { clearTimeout(syncTimer); syncTimer = setTimeout(syncNative, 400); }
async function syncNative() {
  if (IS_DEMO) return;
  try {
    const [alarms, widget] = await Promise.all([api('alarms', { days: 30, limit: 200 }), api('widget')]);
    await native('sync', { alarms: JSON.stringify(alarms), widget: JSON.stringify(widget) });
  } catch (_) { /* не критично: повторим при следующем изменении */ }
}
/* Действия «Выполнено»/«Пропустить», нажатые в уведомлении, пока приложение было закрыто. */
async function drainNativeActions() {
  const res = await native('drain');
  const items = (res && res.items) || [];
  let changed = false;
  for (const a of items) {
    try { await api(a.kind === 'skip' ? 'skip' : 'complete', { reminder_id: a.reminder_id, at: a.at }, a.ts || null); changed = true; } catch (_) { /* уже отмечено */ }
  }
  if (changed) { syncSoon(); pushScoreSoon(); }
  return changed;
}
let pushTimer = 0;
function pushScoreSoon() {
  const s = S.settings;
  if (IS_DEMO || s['online.registered'] !== 'true' || !(s['online.server'] || '').trim()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => api('online.push').catch(() => {}), 1500);
}

// ---------- общие действия ----------
async function doComplete(item) {
  try {
    const out = await api('complete', { reminder_id: item.reminder_id, at: item.at });
    toast(`+${out.points} ${plural(out.points, ['очко', 'очка', 'очков'])}`);
    out.unlocked.forEach((a) => toast(`${a.icon} Достижение: ${a.title} (+${a.reward})`, 'gold'));
    if (navigator.vibrate) navigator.vibrate(out.unlocked.length ? [30, 40, 30] : 20);
    syncSoon(); pushScoreSoon();
  } catch (e) { toast(errText(e), 'bad'); }
  render();
}
async function doUndo(item) {
  try { await api('undo', { reminder_id: item.reminder_id, at: item.at }); syncSoon(); pushScoreSoon(); } catch (e) { toast(errText(e), 'bad'); }
  render();
}
async function doSkip(item) {
  try { await api('skip', { reminder_id: item.reminder_id, at: item.at }); syncSoon(); } catch (e) { toast(errText(e), 'bad'); }
  render();
}

// ---------- нижний лист ----------
function openSheet(title, body, onClose) {
  const close = () => { back.remove(); sheet.remove(); document.removeEventListener('keydown', esc); if (onClose) onClose(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const back = h('div', { class: 'backdrop', onclick: close });
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Закрыть', onclick: close }, '✕')),
    body);
  document.body.append(back, sheet);
  document.addEventListener('keydown', esc);
  return close;
}
function confirmSheet(text, action, onYes) {
  const close = openSheet('Подтвердите', h('div', { class: 'stack' },
    h('p', {}, text),
    h('div', { class: 'actions' },
      h('button', { class: 'btn danger', onclick: async () => { close(); await onYes(); } }, action),
      h('button', { class: 'btn', onclick: () => close() }, 'Отмена'))));
}

// ---------- шапка и навигация ----------
const TABS = [['today', 'Сегодня', 'today'], ['reminders', 'Дела', 'list'], ['progress', 'Успехи', 'trophy'], ['settings', 'Настройки', 'settings']];
function drawChrome() {
  const titles = { today: 'Ежедневник', reminders: 'Все напоминания', progress: 'Успехи и рейтинг', settings: 'Настройки' };
  $('#top').replaceChildren(h('h1', {}, titles[S.tab]));
  $('#nav').replaceChildren(...TABS.map(([id, label, icon]) =>
    h('button', { 'aria-current': S.tab === id ? 'page' : null, onclick: () => { S.tab = id; render(); } }, svg(icon), label)));
}

async function render() {
  const token = ++S.token;
  drawChrome();
  const view = $('#view');
  let node;
  try {
    S.cats = await api('categories.list');
    if (S.tab === 'today') node = await viewToday();
    else if (S.tab === 'reminders') node = await viewReminders();
    else if (S.tab === 'progress') node = await viewProgress();
    else node = await viewSettings();
  } catch (e) { node = h('div', { class: 'card empty' }, h('div', { class: 'big' }, '⚠️'), h('p', {}, errText(e))); }
  if (token !== S.token) return;
  const keep = view.scrollTop;
  view.replaceChildren(node);
  view.scrollTop = keep;
  $$('.fab').forEach((f) => f.remove());
  if (S.tab === 'today' || S.tab === 'reminders') {
    document.body.append(h('button', { class: 'fab', 'aria-label': 'Добавить', onclick: addChooser }, '+'));
  }
}
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function addChooser() {
  const close = openSheet('Что добавить?', h('div', { class: 'stack' },
    h('button', { class: 'btn primary', onclick: () => { close(); reminderSheet(null); } }, '🔔 Напоминание'),
    h('button', { class: 'btn', onclick: () => { close(); scheduleSheet(null); } }, '🗓️ Занятие в расписании')));
}

// ---------- вкладка «Сегодня» ----------
async function viewToday() {
  const date = S.date;
  const isToday = date === todayStr();
  const d = fromYmd(date);
  const step = S.view === 'week' ? 7 : 1;
  const bar = h('div', { class: 'datebar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => { S.date = ymd(addDays(d, -step)); render(); } }, '‹'),
    h('h2', {}, S.view === 'week' ? 'Неделя' : longDate(d)),
    !isToday || S.view === 'week' ? h('button', { class: 'btn small', onclick: () => { S.date = todayStr(); render(); } }, 'Сегодня') : null,
    h('button', { class: 'icon-btn', 'aria-label': 'Вперёд', onclick: () => { S.date = ymd(addDays(d, step)); render(); } }, '›'));
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Вид' },
    ...[['day', 'День'], ['week', 'Неделя']].map(([v, l]) =>
      h('button', { role: 'radio', 'aria-checked': String(S.view === v), onclick: () => { S.view = v; render(); } }, l)));
  const body = S.view === 'week' ? await weekBody() : await dayBody();
  return h('div', { class: 'stack' }, bar, seg, body);
}

function itemRow(i, { showDate = false } = {}) {
  const done = i.status === 'done_on_time' || i.status === 'done_late';
  return h('div', { class: 'item', 'data-status': i.status },
    h('button', { class: 'check', 'aria-pressed': String(done), 'aria-label': done ? 'Снять отметку' : 'Отметить выполненным', onclick: () => (done ? doUndo(i) : doComplete(i)) }, done ? '✓' : ''),
    h('button', { class: 'item grow', style: 'padding:0;background:none;border:0;border-top:0', onclick: () => itemSheet(i) },
      h('span', { class: 'ico' }, i.icon),
      h('span', { class: 'grow' },
        h('span', { class: 'title', style: done ? 'text-decoration:line-through;opacity:.65' : '' }, i.title),
        h('span', { class: 'muted small', style: 'display:block' },
          `${showDate ? fromYmd(i.at.slice(0, 10)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ', ' : ''}${hhmm(i.at)} · ${STATUS_TEXT[i.status]}`)),
      i.category_id ? h('span', { class: 'dot', style: `background:${catColor(i.category_id)}`, title: (catById(i.category_id) || {}).name }) : null,
      h('span', { 'aria-hidden': 'true', title: ALERT_TEXT[i.alert] }, ALERT_ICON[i.alert])));
}

async function dayBody() {
  const date = S.date;
  const [day, pending, stats] = await Promise.all([api('day', { date }), api('pending'), api('stats')]);
  const nodes = [];
  if (date === todayStr()) {
    const old = pending.filter((p) => p.at.slice(0, 10) < date);
    if (old.length) {
      nodes.push(h('div', { class: 'card alert-card' },
        h('div', { class: 'title' }, `Не отмечено: ${old.length}`),
        ...old.slice(0, 3).map((i) => itemRow(i, { showDate: true })),
        old.length > 3 ? h('div', { class: 'muted small', style: 'padding-top:6px' }, `и ещё ${old.length - 3} — откройте «Дела» или предыдущие дни`) : null));
    }
  }
  const total = day.items.length;
  const done = day.items.filter((i) => i.status === 'done_on_time' || i.status === 'done_late').length;
  if (total) {
    nodes.push(h('div', { class: 'card', style: 'padding:14px 16px' },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, `Выполнено ${done} из ${total}`),
        stats.current_streak ? h('span', {}, `🔥 ${stats.current_streak} ${plural(stats.current_streak, ['день', 'дня', 'дней'])}`) : null),
      h('div', { class: 'progress-line', style: 'margin-top:10px' }, h('i', { style: `width:${Math.round((done / total) * 100)}%` }))));
  }
  nodes.push(h('div', { class: 'section-title' }, 'Дела'));
  nodes.push(total
    ? h('div', { class: 'card list' }, ...day.items.map((i) => itemRow(i)))
    : h('div', { class: 'card empty' }, h('div', { class: 'big' }, '🌤️'), h('b', {}, 'На этот день дел нет'), h('p', {}, 'Нажмите «+», чтобы добавить напоминание.')));
  nodes.push(h('div', { class: 'section-title' }, 'Расписание'));
  nodes.push(day.entries.length
    ? timetable(day.entries, date === todayStr())
    : h('div', { class: 'card empty' }, h('b', {}, 'Занятий нет'), h('p', {}, 'Добавьте занятие на этот день недели или на конкретную дату.'),
      h('button', { class: 'btn', onclick: () => scheduleSheet(null, { date }) }, 'Добавить занятие')));
  return h('div', { class: 'stack' }, nodes);
}

/* Раскладка пересекающихся занятий по дорожкам */
function layoutBlocks(entries) {
  const items = entries.map((e) => ({ e, s: toMin(e.start) / 60, f: toMin(e.end) / 60 })).sort((a, b) => a.s - b.s || a.f - b.f);
  const out = []; let cluster = []; let clusterEnd = -1;
  const flush = () => {
    const ends = [];
    cluster.forEach((it) => {
      let l = ends.findIndex((x) => x <= it.s);
      if (l < 0) { l = ends.length; ends.push(it.f); } else ends[l] = it.f;
      it.lane = l;
    });
    cluster.forEach((it) => { it.lanes = ends.length; });
    out.push(...cluster); cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.f);
  }
  if (cluster.length) flush();
  return out;
}
function hourRange(entries, extraHours = []) {
  let lo = 8, hi = 20;
  entries.forEach((e) => { lo = Math.min(lo, Math.floor(toMin(e.start) / 60)); hi = Math.max(hi, Math.ceil(toMin(e.end) / 60)); });
  extraHours.forEach((x) => { lo = Math.min(lo, Math.floor(x)); hi = Math.max(hi, Math.ceil(x + 0.5)); });
  return [Math.max(0, lo), Math.min(24, hi)];
}
function blockEl(b, lo, onclick) {
  const e = b.e;
  const color = e.color || catColor(e.category_id);
  return h('button', {
    class: 'block', style: `--lane:${b.lane};--lanes:${b.lanes};--top:${b.s - lo};--len:${b.f - b.s};--c:${color}`,
    onclick: () => onclick(e), title: `${e.title} ${e.start}–${e.end}`,
  }, h('b', {}, `${e.icon} ${e.title}`), h('span', {}, `${e.start}–${e.end}${e.location ? ' · ' + e.location : ''}`));
}
function timetable(entries, showNow) {
  const [lo, hi] = hourRange(entries);
  const n = hi - lo;
  const hours = h('div', { class: 'tt-hours' }, ...Array.from({ length: n + 1 }, (_, i) =>
    h('span', { style: `top:calc(${i} * var(--hh))` }, `${pad(lo + i)}:00`)));
  const track = h('div', { class: 'tt-track' }, h('div', { class: 'tt-lanes' }, ...layoutBlocks(entries).map((b) => blockEl(b, lo, (e) => scheduleSheet(e)))));
  if (showNow) {
    const now = new Date(); const nh = now.getHours() + now.getMinutes() / 60;
    if (nh >= lo && nh <= hi) track.append(h('div', { class: 'nowline', style: `top:calc(${nh - lo} * var(--hh))` }));
  }
  return h('div', { class: 'card tt', style: `--n:${n}` }, hours, track);
}

async function weekBody() {
  const week = await api('week', { date: S.date });
  const all = week.days.flatMap((d) => d.entries);
  const pinHours = week.days.flatMap((d) => d.items.map((i) => toMin(hhmm(i.at)) / 60));
  const [lo, hi] = hourRange(all, pinHours);
  const n = hi - lo;
  const today = todayStr();
  const cells = [h('div', { class: 'dayhead' })];
  week.days.forEach((d, i) => cells.push(h('button', {
    class: `dayhead${d.date === today ? ' today' : ''}`, onclick: () => { S.date = d.date; S.view = 'day'; render(); },
    'aria-label': `Открыть ${longDate(fromYmd(d.date))}`,
  }, WD_SHORT[i], h('b', {}, fromYmd(d.date).getDate()))));
  cells.push(h('div', { class: 'hourcol' }, ...Array.from({ length: n + 1 }, (_, i) => h('span', { style: `top:calc(${i} * var(--hh))` }, `${pad(lo + i)}`))));
  week.days.forEach((d) => {
    const col = h('div', { class: `col${d.date === today ? ' today' : ''}${d.items.length ? ' has-pins' : ''}` },
      h('div', { class: 'lanes' }, ...layoutBlocks(d.entries).map((b) => blockEl(b, lo, (e) => scheduleSheet(e)))));
    let lastY = -99;
    d.items.forEach((i) => {
      const nat = (toMin(hhmm(i.at)) / 60 - lo) * 46;
      const y = Math.max(nat, lastY + 26); lastY = y;
      const done = i.status === 'done_on_time' || i.status === 'done_late';
      col.append(h('button', {
        class: 'pin', 'data-status': i.status, style: `top:${y}px;--c:${catColor(i.category_id)}`,
        title: `${hhmm(i.at)} ${i.title}`, onclick: () => itemSheet(i),
      }, done ? '✓' : i.icon));
    });
    cells.push(col);
  });
  return h('div', { class: 'card tt week', style: `--n:${n}` }, h('div', { class: 'week-inner' }, cells));
}

function itemSheet(i) {
  const done = i.status === 'done_on_time' || i.status === 'done_late';
  const close = openSheet(i.title, h('div', { class: 'stack' },
    h('div', { class: 'row' }, h('span', { class: 'ico', style: 'font-size:30px' }, i.icon),
      h('div', {}, h('div', {}, `${fromYmd(i.at.slice(0, 10)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, ${hhmm(i.at)}`),
        h('div', { class: 'muted' }, `${STATUS_TEXT[i.status]} · ${ALERT_TEXT[i.alert]}`))),
    i.notes ? h('p', { class: 'muted' }, i.notes) : null,
    h('div', { class: 'actions' },
      done ? h('button', { class: 'btn primary', onclick: () => { close(); doUndo(i); } }, 'Снять отметку')
        : h('button', { class: 'btn primary', onclick: () => { close(); doComplete(i); } }, 'Выполнено'),
      !done && i.status !== 'skipped' ? h('button', { class: 'btn', onclick: () => { close(); doSkip(i); } }, 'Пропустить') : null,
      i.status === 'skipped' ? h('button', { class: 'btn', onclick: () => { close(); doUndo(i); } }, 'Вернуть') : null,
      h('button', { class: 'btn', onclick: async () => { close(); reminderSheet((await api('reminders.list')).find((r) => r.id === i.reminder_id)); } }, 'Изменить'))));
}

// ---------- вкладка «Дела» ----------
function repeatText(r) {
  const t = r.start.slice(11, 16);
  switch (r.repeat.type) {
    case 'daily': return `Каждый день в ${t}`;
    case 'weekdays': return `${r.repeat.days.map((d) => WD_SHORT[d - 1]).join(', ')} в ${t}`;
    case 'monthly': return `Каждый месяц, ${Number(r.start.slice(8, 10))}-го в ${t}`;
    default: return `${fromYmd(r.start.slice(0, 10)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}, ${t}`;
  }
}
async function viewReminders() {
  const all = await api('reminders.list', { archived: true });
  const shown = all.filter((r) => S.filterCat === null || r.category_id === S.filterCat);
  const chips = h('div', { class: 'chips scroll' },
    h('button', { class: 'chip', 'aria-pressed': String(S.filterCat === null), onclick: () => { S.filterCat = null; render(); } }, 'Все'),
    ...S.cats.map((c) => h('button', { class: 'chip', 'aria-pressed': String(S.filterCat === c.id), onclick: () => { S.filterCat = c.id; render(); } }, `${c.icon} ${c.name}`)));
  const active = shown.filter((r) => !r.archived), arch = shown.filter((r) => r.archived);
  const row = (r) => h('button', { class: 'item', onclick: () => reminderSheet(r) },
    h('span', { class: 'ico' }, r.icon),
    h('span', { class: 'grow' }, h('span', { class: 'title', style: 'display:block' }, r.title), h('span', { class: 'muted small' }, repeatText(r))),
    r.category_id ? h('span', { class: 'dot', style: `background:${catColor(r.category_id)}` }) : null,
    h('span', { title: ALERT_TEXT[r.alert] }, ALERT_ICON[r.alert]));
  return h('div', { class: 'stack' }, chips,
    active.length ? h('div', { class: 'card list' }, ...active.map(row))
      : h('div', { class: 'card empty' }, h('div', { class: 'big' }, '📝'), h('b', {}, 'Напоминаний пока нет'), h('p', {}, 'Создайте первое: укажите время, иконку и способ напоминания.'),
        h('button', { class: 'btn primary', onclick: () => reminderSheet(null) }, 'Создать напоминание')),
    arch.length ? [h('div', { class: 'section-title' }, 'В архиве'), h('div', { class: 'card list', style: 'opacity:.75' }, ...arch.map(row))] : null);
}

// ---------- редакторы ----------
function iconPicker(initial, onPick) {
  let value = initial;
  const input = h('input', { class: 'input', value: initial, maxlength: '8', 'aria-label': 'Иконка', style: 'text-align:center;font-size:22px;width:70px' });
  const grid = h('div', { class: 'emoji-grid' });
  const paint = () => {
    grid.replaceChildren(...EMOJI.map((e) => h('button', { type: 'button', 'aria-pressed': String(e === value), 'aria-label': e, onclick: () => { value = e; input.value = e; onPick(e); paint(); } }, e)));
  };
  input.addEventListener('input', () => { value = input.value; onPick(value); paint(); });
  paint();
  return h('div', { class: 'stack' }, h('div', { class: 'row' }, input, h('span', { class: 'muted small' }, 'Выберите или вставьте свой эмодзи')), grid);
}
const field = (label, control) => h('label', { class: 'field' }, label, control);
function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  const paint = () => wrap.replaceChildren(...options.map(([v, l]) =>
    h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), onclick: () => { value = v; onChange(v); paint(); } }, l)));
  paint();
  return wrap;
}
const GRACE = [[0, 'Точно в срок'], [15, '15 минут'], [30, '30 минут'], [60, '1 час'], [180, '3 часа'], [720, '12 часов'], [1440, 'Весь день']];

function reminderSheet(existing, preset = {}) {
  const now = new Date();
  const base = existing || {
    id: 0, title: '', notes: '', icon: '🔔', category_id: null, alert: 'notification', repeat: { type: 'none' },
    repeat_until: null, grace_minutes: 60, archived: false,
    start: `${preset.date || S.date}T${pad(Math.min(23, now.getHours() + 1))}:00:00`,
  };
  const r = JSON.parse(JSON.stringify(base));
  let date = r.start.slice(0, 10), time = r.start.slice(11, 16);
  const title = h('input', { value: r.title, placeholder: 'Например, выпить таблетки', maxlength: '200', autofocus: true });
  const notes = h('textarea', { class: 'input', placeholder: 'Заметка (необязательно)', rows: '2' }, r.notes);
  notes.value = r.notes;
  const dateIn = h('input', { type: 'date', value: date, onchange: (e) => { date = e.target.value; } });
  const timeIn = h('input', { type: 'time', value: time, onchange: (e) => { time = e.target.value; } });
  const catSel = h('select', { onchange: (e) => { r.category_id = e.target.value ? Number(e.target.value) : null; } },
    h('option', { value: '' }, 'Без категории'),
    ...S.cats.map((c) => h('option', { value: c.id, selected: c.id === r.category_id }, `${c.icon} ${c.name}`)));
  const graceSel = h('select', { onchange: (e) => { r.grace_minutes = Number(e.target.value); } },
    ...GRACE.map(([v, l]) => h('option', { value: v, selected: v === r.grace_minutes }, l)));
  if (!GRACE.some(([v]) => v === r.grace_minutes)) graceSel.prepend(h('option', { value: r.grace_minutes, selected: true }, `${r.grace_minutes} мин`));
  const untilIn = h('input', { type: 'date', value: r.repeat_until || '', onchange: (e) => { r.repeat_until = e.target.value || null; } });
  const repeatBox = h('div', { class: 'stack' });
  const paintRepeat = () => {
    const kids = [segmented([['none', 'Один раз'], ['daily', 'Каждый день'], ['weekdays', 'По дням'], ['monthly', 'Раз в месяц']], r.repeat.type, (v) => {
      r.repeat = v === 'weekdays' ? { type: 'weekdays', days: (r.repeat.days && r.repeat.days.length) ? r.repeat.days : [1, 2, 3, 4, 5] } : { type: v };
      paintRepeat();
    })];
    if (r.repeat.type === 'weekdays') {
      kids.push(h('div', { class: 'chips' }, ...WD_SHORT.map((l, i) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(r.repeat.days.includes(i + 1)),
        onclick: () => { const s = new Set(r.repeat.days); s.has(i + 1) ? s.delete(i + 1) : s.add(i + 1); r.repeat.days = [...s].sort(); paintRepeat(); },
      }, l))));
    }
    if (r.repeat.type !== 'none') kids.push(field('Повторять до (необязательно)', untilIn));
    repeatBox.replaceChildren(...kids);
  };
  paintRepeat();

  const save = async () => {
    r.title = title.value; r.notes = notes.value;
    if (!date || !time) { toast('Укажите дату и время', 'bad'); return; }
    r.start = `${date}T${time}:00`;
    if (r.repeat.type === 'none') r.repeat_until = null;
    try {
      await api('reminders.save', { reminder: r });
      close(); syncSoon(); toast(existing ? 'Сохранено' : 'Напоминание создано');
      if (!existing) permissionHint(r.alert);
      render();
    } catch (e) { toast(errText(e), 'bad'); }
  };
  const body = h('div', { class: 'stack' },
    iconPicker(r.icon, (v) => { r.icon = v || '🔔'; }),
    field('Название', title), notes,
    h('div', { class: 'two' }, field('Дата', dateIn), field('Точное время', timeIn)),
    h('div', { class: 'field' }, 'Как напомнить', segmented([['notification', '🔔 Уведомление'], ['alarm', '⏰ Будильник'], ['full_screen', '📱 На весь экран']], r.alert, (v) => { r.alert = v; })),
    h('div', { class: 'field' }, 'Повтор', repeatBox),
    h('div', { class: 'two' }, field('Категория', catSel), field('Засчитать «вовремя», если отметить в течение', graceSel)),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: save }, 'Сохранить'),
      existing ? h('button', { class: 'btn', onclick: async () => { await api('reminders.archive', { id: r.id, archived: !r.archived }); close(); syncSoon(); render(); } }, r.archived ? 'Вернуть из архива' : 'В архив') : null,
      existing ? h('button', { class: 'btn danger', onclick: () => confirmSheet('Удалить напоминание? История выполнения и очки сохранятся.', 'Удалить', async () => { await api('reminders.delete', { id: r.id }); close(); syncSoon(); render(); }) }, 'Удалить') : null));
  const close = openSheet(existing ? 'Изменить напоминание' : 'Новое напоминание', body);
}

function scheduleSheet(existing, preset = {}) {
  const dateStr = preset.date || S.date;
  const wdOf = (s) => ((fromYmd(s).getDay() + 6) % 7) + 1;
  const e = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: 0, title: '', weekday: wdOf(dateStr), date: null, start: '09:00', end: '10:30', color: null, icon: '📚', location: '', category_id: null,
  };
  let weekly = !e.date;
  const title = h('input', { value: e.title, placeholder: 'Например, лекция по физике', maxlength: '200' });
  const place = h('input', { value: e.location, placeholder: 'Аудитория, адрес или ссылка' });
  const startIn = h('input', { type: 'time', value: e.start, onchange: (x) => { e.start = x.target.value; } });
  const endIn = h('input', { type: 'time', value: e.end, onchange: (x) => { e.end = x.target.value; } });
  const wdSel = h('select', { onchange: (x) => { e.weekday = Number(x.target.value); } },
    ...WEEKDAYS.map((l, i) => h('option', { value: i + 1, selected: e.weekday === i + 1 }, l)));
  const dateIn = h('input', { type: 'date', value: e.date || dateStr, onchange: (x) => { e.date = x.target.value; } });
  const catSel = h('select', { onchange: (x) => { e.category_id = x.target.value ? Number(x.target.value) : null; } },
    h('option', { value: '' }, 'Без категории'),
    ...S.cats.map((c) => h('option', { value: c.id, selected: c.id === e.category_id }, `${c.icon} ${c.name}`)));
  const colorIn = h('input', { type: 'color', value: e.color || catColor(e.category_id), onchange: (x) => { e.color = x.target.value; } });
  const whenBox = h('div', {});
  const paintWhen = () => whenBox.replaceChildren(weekly ? field('День недели', wdSel) : field('Дата', dateIn));
  paintWhen();
  const save = async () => {
    e.title = title.value; e.location = place.value; e.start = startIn.value; e.end = endIn.value;
    if (weekly) { e.date = null; e.weekday = Number(wdSel.value); } else { e.weekday = null; e.date = dateIn.value; }
    try { await api('schedule.save', { entry: e }); close(); syncSoon(); toast('Сохранено'); render(); } catch (err) { toast(errText(err), 'bad'); }
  };
  const body = h('div', { class: 'stack' },
    iconPicker(e.icon, (v) => { e.icon = v || '📚'; }),
    field('Название', title),
    segmented([['w', 'Каждую неделю'], ['d', 'В конкретный день']], weekly ? 'w' : 'd', (v) => { weekly = v === 'w'; paintWhen(); }),
    whenBox,
    h('div', { class: 'two' }, field('Начало', startIn), field('Конец', endIn)),
    field('Место', place),
    h('div', { class: 'two' }, field('Категория', catSel), field('Цвет', colorIn)),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: save }, 'Сохранить'),
      existing ? h('button', { class: 'btn danger', onclick: () => confirmSheet('Удалить это занятие из расписания?', 'Удалить', async () => { await api('schedule.delete', { id: e.id }); close(); syncSoon(); render(); }) }, 'Удалить') : null));
  const close = openSheet(existing ? 'Изменить занятие' : 'Новое занятие', body);
}

function categorySheet(existing) {
  const c = existing ? { ...existing } : { id: 0, name: '', color: '#6750A4', icon: '📁' };
  const name = h('input', { value: c.name, placeholder: 'Название категории', maxlength: '40' });
  const color = h('input', { type: 'color', value: c.color, onchange: (x) => { c.color = x.target.value; } });
  const close = openSheet(existing ? 'Изменить категорию' : 'Новая категория', h('div', { class: 'stack' },
    iconPicker(c.icon, (v) => { c.icon = v || '📁'; }), field('Название', name), field('Цвет', color),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: async () => { c.name = name.value; try { await api('categories.save', { category: c }); close(); render(); } catch (e) { toast(errText(e), 'bad'); } } }, 'Сохранить'),
      existing ? h('button', { class: 'btn danger', onclick: () => confirmSheet('Удалить категорию? Напоминания останутся без категории.', 'Удалить', async () => { await api('categories.delete', { id: c.id }); close(); render(); }) }, 'Удалить') : null)));
}

/* Подсказка про разрешения Android после создания будильника или полноэкранного напоминания */
async function permissionHint(alert) {
  if (IS_DEMO || alert === 'notification') return;
  const st = await native('status');
  if (st && (st.exactAlarms === false || st.fullScreen === false || st.notifications === false)) {
    toast('Для будильника нужны разрешения: Настройки → Android', 'gold');
  }
}

// ---------- вкладка «Успехи» ----------
async function viewProgress() {
  const [stats, ach] = await Promise.all([api('stats'), api('achievements')]);
  const hero = h('div', { class: 'card hero' },
    h('div', { class: 'ring', style: `--p:${Math.round(stats.level_progress * 100)}` }, h('div', {}, h('div', {}, h('b', {}, stats.level), h('span', {}, 'уровень')))),
    h('div', { class: 'grow' }, h('div', { style: 'font-size:22px;font-weight:700' }, `${stats.points} ${plural(stats.points, ['очко', 'очка', 'очков'])}`),
      h('div', { class: 'muted' }, `До следующего уровня ещё ${Math.max(0, Math.ceil(((stats.level) ** 2) * 50 - stats.points))}`)));
  const stat = (v, l) => h('div', { class: 'card stat' }, h('b', {}, v), h('span', { class: 'muted small' }, l));
  const grid = h('div', { class: 'statgrid' },
    stat(`🔥 ${stats.current_streak}`, 'дней подряд'), stat(stats.best_streak, 'лучшая серия'),
    stat(stats.total_done, 'выполнено'), stat(stats.on_time, 'вовремя'), stat(stats.missed, 'не выполнено'), stat(stats.skipped, 'пропущено'));
  const unlocked = ach.filter((a) => a.unlocked).length;
  const achGrid = h('div', { class: 'achgrid' }, ...ach.map((a) => h('div', { class: `card ach${a.unlocked ? '' : ' locked'}` },
    h('span', { class: 'ico' }, a.icon), h('b', {}, a.title), h('span', { class: 'muted small' }, a.description),
    a.unlocked ? h('span', { class: 'small', style: 'color:var(--ok)' }, `Получено · +${a.reward}`)
      : h('div', {}, h('div', { class: 'progress-line' }, h('i', { style: `width:${Math.round((a.progress / a.target) * 100)}%` })),
        h('span', { class: 'muted small' }, `${a.progress} из ${a.target} · награда ${a.reward}`)))));
  const boardBox = h('div', { class: 'stack' });
  const nodes = [hero, grid,
    h('div', { class: 'section-title' }, `Достижения: ${unlocked} из ${ach.length}`), achGrid,
    h('div', { class: 'section-title' }, 'Рейтинг'), boardBox];
  loadBoard(boardBox);
  return h('div', { class: 'stack' }, nodes);
}
async function loadBoard(box) {
  const s = S.settings;
  if (IS_DEMO) { box.replaceChildren(h('div', { class: 'card empty' }, h('p', {}, 'Рейтинг работает только в приложении.'))); return; }
  if (!(s['online.server'] || '').trim() || s['online.registered'] !== 'true') {
    box.replaceChildren(h('div', { class: 'card empty' }, h('div', { class: 'big' }, '🏆'), h('b', {}, 'Сравните себя с другими'),
      h('p', {}, 'Укажите адрес сервера и ник в настройках, чтобы попасть в рейтинг.'),
      h('button', { class: 'btn primary', onclick: () => { S.tab = 'settings'; render(); } }, 'Открыть настройки')));
    return;
  }
  const controls = h('div', { class: 'stack' },
    segmented([['week', 'Неделя'], ['all', 'Всё время']], S.board.period, (v) => { S.board.period = v; loadBoard(box); }),
    (s['online.room'] || '').trim() ? h('div', { class: 'chips' }, h('button', { class: 'chip', 'aria-pressed': String(S.board.roomOnly), onclick: () => { S.board.roomOnly = !S.board.roomOnly; loadBoard(box); } }, `Только комната «${s['online.room']}»`)) : null);
  box.replaceChildren(controls, h('div', { class: 'card empty muted' }, 'Загрузка…'));
  try {
    await api('online.push').catch(() => {});
    const res = await api('online.leaderboard', { period: S.board.period, room_only: S.board.roomOnly });
    const rows = res.entries.map((e) => h('div', { class: `item${e.me ? ' me' : ''}` },
      h('span', { class: 'rank' }, e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, e.nickname), h('span', { class: 'muted small', style: 'display:block' }, `уровень ${e.level} · 🔥 ${e.streak} · 🏅 ${e.achievements}`)),
      h('b', {}, e.points)));
    box.replaceChildren(controls, rows.length ? h('div', { class: 'card list board' }, ...rows) : h('div', { class: 'card empty muted' }, 'Пока никого нет'),
      res.me && res.me.rank > res.entries.length ? h('div', { class: 'card list board' }, h('div', { class: 'item me' }, h('span', { class: 'rank' }, res.me.rank), h('span', { class: 'grow title' }, 'Вы'), h('b', {}, res.me.points))) : null);
  } catch (e) {
    box.replaceChildren(controls, h('div', { class: 'card empty' }, h('p', {}, errText(e)), h('button', { class: 'btn', onclick: () => loadBoard(box) }, 'Повторить')));
  }
}

// ---------- вкладка «Настройки» ----------
async function viewSettings() {
  S.settings = await api('settings.get');
  const s = S.settings;
  const themeCards = h('div', { class: 'themes' }, ...THEMES.map(([id, name, desc]) => {
    const prevStyle = { material: 'background:color-mix(in srgb,var(--accent) 12%,#fff)', amoled: 'background:#000', glass: 'background:linear-gradient(135deg,var(--accent),#00bcd4)', simple: 'background:#f1f1f3' }[id];
    const bar = { material: 'background:var(--accent)', amoled: 'background:#1e1e22', glass: 'background:rgba(255,255,255,.45)', simple: 'background:#fff;border:1px solid #d8d8dd' }[id];
    return h('button', { class: 'theme-card', 'aria-pressed': String((s.theme || 'material') === id), onclick: () => setSetting('theme', id, true) },
      h('div', { class: 'prev', style: prevStyle }, h('i', { style: `top:10px;${bar}` }), h('i', { style: `top:32px;width:60%;${bar}` })),
      h('b', {}, name), h('div', { class: 'muted small' }, desc));
  }));
  const accentBox = h('div', { class: 'swatches' }, ...ACCENTS.map((c) => h('button', { class: 'swatch', style: `--c:${c}`, 'aria-label': c, 'aria-pressed': String((s.accent || '').toLowerCase() === c.toLowerCase()), onclick: () => setSetting('accent', c, true) })),
    h('input', { type: 'color', value: s.accent || '#6750A4', 'aria-label': 'Свой цвет', style: 'width:38px;height:38px;border-radius:50%;padding:0;border:0', onchange: (e) => setSetting('accent', e.target.value.toUpperCase(), true) }));
  const bgChips = h('div', { class: 'chips' }, ...Background.modes.map(([id, name]) => h('button', { class: 'chip', 'aria-pressed': String((s.bg || 'none') === id), onclick: () => setSetting('bg', id, true) }, name)));
  const intensity = h('input', { type: 'range', min: '10', max: '100', value: s.bg_intensity || '60', 'aria-label': 'Яркость фона', oninput: (e) => { S.settings.bg_intensity = e.target.value; applyTheme(); }, onchange: (e) => setSetting('bg_intensity', e.target.value) });

  const catRows = S.cats.map((c) => h('button', { class: 'item', onclick: () => categorySheet(c) }, h('span', { class: 'ico' }, c.icon), h('span', { class: 'grow title' }, c.name), h('span', { class: 'dot', style: `background:${c.color}` })));

  const nodes = [
    IS_DEMO ? h('div', { class: 'card alert-card' }, h('b', {}, 'Демо-режим'), h('div', { class: 'muted small' }, 'Интерфейс открыт в браузере без Rust-ядра: данные хранятся только в этом браузере.')) : null,
    h('div', { class: 'section-title' }, 'Тема'), themeCards,
    h('div', { class: 'section-title' }, 'Светлая или тёмная'),
    segmented([['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']], s.mode || 'auto', (v) => setSetting('mode', v)),
    h('div', { class: 'section-title' }, 'Акцентный цвет'), accentBox,
    h('div', { class: 'section-title' }, 'Анимированный фон'), bgChips, h('div', { style: 'margin-top:12px' }, field('Яркость', intensity)),
    h('div', { class: 'section-title' }, 'Категории'), h('div', { class: 'card list' }, ...catRows,
      h('button', { class: 'item', onclick: () => categorySheet(null) }, h('span', { class: 'ico' }, '+'), h('span', { class: 'grow title' }, 'Добавить категорию'))),
    h('div', { class: 'section-title' }, 'Рейтинг'), onlineCard(),
  ];
  if (!IS_DEMO) nodes.push(h('div', { class: 'section-title' }, 'Android'), await androidCard());
  return h('div', { class: 'stack' }, nodes);
}

function onlineCard() {
  const s = S.settings;
  const server = h('input', { value: s['online.server'] || '', placeholder: 'https://example.com:8787', inputmode: 'url', autocapitalize: 'off' });
  const nick = h('input', { value: s['online.nickname'] || '', placeholder: 'Ваш ник', maxlength: '24' });
  const room = h('input', { value: s['online.room'] || '', placeholder: 'Например, друзья (необязательно)', maxlength: '32' });
  const registered = s['online.registered'] === 'true';
  return h('div', { class: 'card', style: 'padding:14px' }, h('div', { class: 'stack' },
    field('Адрес сервера рейтинга', server), field('Ник', nick), field('Комната (общий рейтинг для своих)', room),
    h('div', { class: 'actions', style: 'margin-top:0' },
      h('button', { class: 'btn primary', onclick: async () => {
        try {
          await api('settings.set', { key: 'online.server', value: server.value.trim() });
          await api('settings.set', { key: 'online.room', value: room.value.trim() });
          if (!registered) await api('online.register', { nickname: nick.value });
          await api('online.push');
          toast(registered ? 'Сохранено' : 'Вы в рейтинге'); render();
        } catch (e) { toast(errText(e), 'bad'); }
      } }, registered ? 'Сохранить и отправить очки' : 'Войти в рейтинг'),
      registered ? h('button', { class: 'btn', onclick: async () => { await api('online.logout'); render(); } }, 'Выйти') : null),
    h('p', { class: 'muted small' }, 'Сервер находится в папке server проекта. Очки считаются на вашем устройстве и отправляются на сервер.')));
}

async function androidCard() {
  const st = await native('status');
  if (!st) return h('div', { class: 'card empty muted small' }, 'Настройки Android доступны только на телефоне.');
  const row = (ok, title, desc, kind) => h('div', { class: 'item' },
    h('span', { class: 'ico' }, ok ? '✅' : '⚠️'), h('span', { class: 'grow' }, h('span', { class: 'title', style: 'display:block' }, title), h('span', { class: 'muted small' }, desc)),
    ok ? null : h('button', { class: 'btn small', onclick: async () => { await native('request', { kind }); setTimeout(render, 800); } }, 'Разрешить'));
  return h('div', { class: 'card list' },
    row(st.notifications, 'Уведомления', 'Нужны для любых напоминаний', 'notifications'),
    row(st.exactAlarms, 'Точные будильники', 'Чтобы напоминание сработало ровно в назначенную минуту', 'exactAlarms'),
    row(st.fullScreen, 'Уведомления на весь экран', 'Чтобы напоминание появлялось поверх экрана блокировки', 'fullScreen'),
    row(st.batteryOk, 'Работа в фоне', 'Отключите экономию батареи для приложения, иначе на некоторых телефонах напоминания задерживаются', 'battery'));
}

// ---------- запуск ----------
async function boot() {
  try { S.settings = await api('settings.get'); } catch (_) { S.settings = {}; }
  applyTheme();
  await render();
  if (!IS_DEMO) {
    await drainNativeActions();
    syncNative();
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) return;
      const changed = await drainNativeActions();
      syncSoon();
      if (changed || S.tab === 'today') render();
    });
    setInterval(() => { if (!document.hidden && S.tab === 'today') render(); }, 60000);
  } else {
    setInterval(() => { if (!document.hidden && S.tab === 'today' && !$('.sheet')) render(); }, 60000);
  }
}
boot();
