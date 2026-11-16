// Verba 2.0 — словарь и карточки с интервальным повторением.
// Бизнес-логика (уровни, интервалы, очередь, проверка ответов, синхронизация, формат данных)
// перенесена из 1.0 без изменений. Новое — только интерфейс поверх неё.
'use strict';

// ==========================================================
// Модель и SRS (без изменений с 1.0)
// ==========================================================
const POS = {
  verb: 'Глаголы', noun: 'Существительные', adj: 'Прилагательные',
  expr: 'Выражения', prep: 'Предлоги',
};
const POS_ONE = { verb: 'глагол', noun: 'существительное', adj: 'прилагательное', expr: 'выражение', prep: 'предлог' };
const POS_COLOR = { verb: 'var(--blue)', noun: 'var(--purple)', adj: 'var(--orange)', expr: 'var(--pink)', prep: 'var(--yellow)' };
// Уровни: 0 — новое, 1..4 — повторение, 5 — изучено. Интервал в днях после верного ответа.
const INTERVALS = [0, 1, 3, 7, 16];
const LEARNED = 5;
const LAST_LEVEL = 4;
const LEVEL_NAMES = ['Новое', 'Уровень 1', 'Уровень 2', 'Уровень 3', 'Уровень 4', 'Изучено'];
const LV = i => `var(--lv${Math.min(i, LEARNED)})`;
const STORE_KEY = 'verba.v1';
const DATA_REPO = 'metulaimmensa/verba-data';
const DATA_FILE = 'words.json';

let db = load();
function load() {
  let d = null;
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) d = JSON.parse(raw); } catch (e) { /* пусто */ }
  d = d || { words: [], tenses: ['presente', 'continuo'], settings: { token: '', newPerSession: 10 }, deleted: [] };
  d.settings = d.settings || { token: '', newPerSession: 10 };
  if (d.settings.haptics === undefined) d.settings.haptics = true;
  d.deleted = d.deleted || [];
  d.tenses = d.tenses || ['presente', 'continuo'];
  return d;
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { toast('Не удалось сохранить'); } }

// ---------- Утилиты ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const stripAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = s => s.toLowerCase().trim().replace(/[¡!¿?.,;]/g, '').replace(/\s+/g, ' ');
const sortKey = s => stripAccents(s.toLowerCase().replace(/^(el|la|los|las)\s+/, '')).replace(/[^a-zñ0-9 ]/g, '');
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
const daysUntil = d => Math.round((new Date(d) - new Date(today())) / 86400000);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function dueLabel(w) {
  if (w.level >= LEARNED) return 'изучено';
  if (w.level === 0) return 'новое';
  const diff = daysUntil(w.due);
  if (diff <= 0) return 'сейчас';
  if (diff === 1) return 'завтра';
  return `через ${diff} дн.`;
}
function dueDate(w) {
  if (w.level >= LEARNED) return 'не нужно — слово изучено';
  if (w.level === 0) return 'в ближайшей сессии';
  const diff = daysUntil(w.due);
  const d = new Date(w.due + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return diff <= 0 ? `сегодня (${d})` : `${d}, ${dueLabel(w)}`;
}

// Сравнение ответа: 'ok' | 'accent' (верно, но без тильды) | 'bad'
function compare(input, expected) {
  const variants = String(expected).split(/[\/;]| или /).map(norm).filter(Boolean);
  const a = norm(input);
  if (!a) return 'bad';
  if (variants.includes(a)) return 'ok';
  if (variants.map(stripAccents).includes(stripAccents(a))) return 'accent';
  return 'bad';
}
function touch(w) { w.updated = Date.now(); }

function addWord(data) {
  const w = {
    id: uid(), es: data.es.trim(), ru: data.ru.trim(), pos: data.pos || 'noun',
    examples: data.examples || [], lesson: data.lesson || '', source: data.source || 'app',
    level: data.level ?? 0, due: data.due || today(),
    needsFill: data.needsFill ?? !(data.examples && data.examples.length),
    created: Date.now(), updated: Date.now(),
  };
  db.words.push(w); save(); return w;
}

function conjFor(w) {
  if (w.pos !== 'verb') return null;
  // Пары вроде «preguntar / contestar»: спрягаем обе части и склеиваем
  if (w.es.includes(' / ')) {
    const parts = w.es.split(' / ').map(p => conjFor({ ...w, es: p.trim() }));
    if (parts.some(p => !p)) return null;
    const c = parts[0];
    for (const t of Object.keys(c.tenses)) {
      c.tenses[t] = c.tenses[t].map((f, i) => ({ ...f, form: parts.map(p => p.tenses[t][i].form).join(' / '), alt: null }));
    }
    return c;
  }
  // Для фраз вроде «soler fumar» спрягаем первое слово
  const first = w.es.split(/\s+/)[0];
  const rest = w.es.split(/\s+/).slice(1).join(' ');
  const c = conjugate(first);
  if (!c) return null;
  if (w.conj) {
    for (const t of Object.keys(w.conj)) {
      if (c.tenses[t]) c.tenses[t] = c.tenses[t].map((f, i) => ({ ...f, form: w.conj[t][i] || f.form }));
    }
  }
  if (rest) {
    for (const t of Object.keys(c.tenses)) c.tenses[t] = c.tenses[t].map(f => ({ ...f, form: `${f.form} ${rest}`, alt: f.alt ? `${f.alt} ${rest}` : null }));
  }
  return c;
}
// Регулярная форма для подсветки неправильных (оранжевым)
function regularForm(inf, i) {
  const base = inf.replace(/se$/, '');
  const end = base.slice(-2).replace('ír', 'ir'); const st = base.slice(0, -2);
  const e = { ar: ['o', 'as', 'a', 'amos', 'áis', 'an'], er: ['o', 'es', 'e', 'emos', 'éis', 'en'], ir: ['o', 'es', 'e', 'imos', 'ís', 'en'] }[end];
  return e ? st + e[i] : null;
}

// Новое время: все глаголы падают на последний уровень, чтобы прогнать их с новой формой
function enableTense(t) {
  if (db.tenses.includes(t)) return;
  db.tenses.push(t);
  for (const w of db.words) {
    if (w.pos === 'verb' && w.level > 0) { w.level = LAST_LEVEL; w.due = today(); touch(w); }
  }
  save();
}

function buildSession() {
  const t = today();
  const due = db.words.filter(w => w.level > 0 && w.level < LEARNED && w.due <= t);
  const fresh = db.words.filter(w => w.level === 0).slice(0, db.settings.newPerSession);
  const queue = shuffle([...due, ...fresh]).map(w => w.id);
  return {
    queue, total: queue.length, done: 0, current: null, state: 'ask', result: null,
    stats: { answered: 0, correct: 0, again: 0, learned: 0, levelUps: 0 }, history: [],
  };
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function checkAnswer(w, form) {
  const res = { main: compare(form.main, w.es), forms: [], tense: null };
  const c = conjFor(w);
  if (c && form.tense) {
    res.tense = form.tense;
    res.forms = c.tenses[res.tense].map((f, i) => {
      const exp = f.alt ? `${f.form} / ${f.alt}` : f.form;
      return { expected: exp, got: form.forms[i] || '', r: compare(form.forms[i] || '', exp) };
    });
  }
  res.allOk = res.main !== 'bad' && res.forms.every(f => f.r !== 'bad');
  res.hasAccent = res.main === 'accent' || res.forms.some(f => f.r === 'accent');
  return res;
}

function applyResult(w, outcome) {
  // outcome: 'repeat' (верно → уровень выше), 'learned', 'wrong'
  if (outcome === 'learned') { w.level = LEARNED; w.due = ''; }
  else if (outcome === 'repeat') {
    w.level = Math.min(w.level + 1, LEARNED);
    w.due = w.level >= LEARNED ? '' : addDays(today(), INTERVALS[w.level]);
  } else {
    // Неверно: уровень не меняется, слово вернётся в этой же сессии
    w.due = today();
  }
  touch(w); save();
}

// ==========================================================
// Тактильная отдача
// ==========================================================
// Без сборщика плагины Capacitor не регистрируются в Capacitor.Plugins,
// поэтому зовём нативный мост напрямую.
const Cap = window.Capacitor;
const isNative = !!(Cap && typeof Cap.nativePromise === 'function' && window.androidBridge);
function nativeCall(plugin, method, opts = {}) {
  if (!isNative) return null;
  try { return Cap.nativePromise(plugin, method, opts).catch(() => null); } catch (e) { return null; }
}
function haptic(kind) {
  if (!db.settings.haptics) return;
  try {
    if (isNative) {
      if (kind === 'light') nativeCall('Haptics', 'impact', { style: 'LIGHT' });
      else if (kind === 'soft') nativeCall('Haptics', 'impact', { style: 'MEDIUM' });
      else if (kind === 'strong') nativeCall('Haptics', 'impact', { style: 'HEAVY' });
      else if (kind === 'success') nativeCall('Haptics', 'notification', { type: 'SUCCESS' });
      else if (kind === 'error') nativeCall('Haptics', 'notification', { type: 'ERROR' });
    } else if (navigator.vibrate) {
      navigator.vibrate({ light: 8, soft: 14, strong: 24, success: [12, 40, 12], error: [30, 50, 30] }[kind] || 8);
    }
  } catch (e) { /* без вибрации */ }
}

// ==========================================================
// Иконки (единый набор, stroke)
// ==========================================================
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  book: '<path d="M4 19V5.5A2.5 2.5 0 0 1 6.5 3H20v14H6.5A2.5 2.5 0 0 0 4 19.5 2.5 2.5 0 0 0 6.5 22H20"/>',
  cards: '<rect x="8" y="3" width="12" height="15" rx="2.5"/><path d="M4.5 7.5v10.5A3 3 0 0 0 7.5 21H15"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<path d="M4 7h9M18 7h2M4 17h3M12 17h8"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="9.5" cy="17" r="2.3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  sync: '<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  learned: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16 10"/>',
  fill: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  conj: '<path d="M4 5h16M4 10h10M4 15h16M4 20h10"/>',
  sort: '<path d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 21h14"/>',
  vibrate: '<rect x="8" y="4" width="8" height="16" rx="2"/><path d="M4 8v8M20 8v8"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

// ==========================================================
// Состояние интерфейса
// ==========================================================
const ui = {
  tab: 'home',
  session: null,
  studying: false,
  dict: freshDict(),
};
function freshDict() {
  return {
    view: 'library', mode: 'all', q: '', title: 'Все слова',
    f: { pos: 'all', level: 'all', due: 'all', fill: 'all' }, sort: 'az',
    shown: 60, open: {}, scroll: 0,
  };
}

// ---------- Слои и кнопка «Назад» ----------
// Каждый открытый слой (лист, диалог, список словаря, сессия) кладёт запись в history.
// Переходы по истории асинхронны, поэтому новые записи добавляются только после того,
// как предыдущий откат завершился (иначе кнопка «Назад» теряет слой).
const layers = [];
let ignorePop = 0, afterUnwind = null;
function pushLayer(close) { layers.push(close); history.pushState({ verba: layers.length }, ''); }
function popLayer() { if (layers.length) history.back(); }
window.addEventListener('popstate', () => {
  if (ignorePop > 0) {
    ignorePop--;
    if (!ignorePop && afterUnwind) { const f = afterUnwind; afterUnwind = null; f(); }
    return;
  }
  const close = layers.pop();
  if (close) close();
});
function unwindLayers(then) {
  const n = layers.length;
  if (!n) { then && then(); return; }
  while (layers.length) layers.pop()();
  ignorePop = 1; afterUnwind = then || null; history.go(-n);
}

// ==========================================================
// Рендер
// ==========================================================
const app = $('#app');
function render(opts = {}) {
  document.body.classList.toggle('studying', ui.studying);
  $$('.nav-btn[data-tab]').forEach(b => {
    const on = b.dataset.tab === ui.tab;
    b.classList.toggle('active', on);
    on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
  });
  updateBadge();
  if (ui.studying) { app.innerHTML = renderStudy(); bindStudy(); return; }
  const screens = { home: renderHome, dict: renderDict, add: renderAdd, settings: renderSettings };
  app.innerHTML = renderTop() + `<main class="${opts.animate ? 'view-enter' : ''}">${screens[ui.tab]()}</main>`;
  bindCommon();
  ({ home: bindHome, dict: bindDict, add: bindAdd, settings: bindSettings })[ui.tab]();
}

function renderTop() {
  const label = { home: dateLabel(), dict: 'словарь', add: 'новое слово', settings: 'настройки' }[ui.tab];
  return `<header class="top" id="top"><div><div class="brand">verba.</div><div class="brand-sub">${esc(label)}</div></div></header>`;
}
function dateLabel() {
  const s = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function counts() {
  const t = today();
  const due = db.words.filter(w => w.level > 0 && w.level < LEARNED && w.due <= t).length;
  const newAll = db.words.filter(w => w.level === 0).length;
  const fresh = Math.min(newAll, db.settings.newPerSession);
  const learned = db.words.filter(w => w.level >= LEARNED).length;
  const fill = db.words.filter(w => w.needsFill).length;
  const byLevel = LEVEL_NAMES.map((_, i) => db.words.filter(w => Math.min(w.level, LEARNED) === i).length);
  return { due, fresh, newAll, learned, fill, byLevel, total: db.words.length };
}
function updateBadge() {
  const b = $('#nav-study');
  const n = ui.session && ui.session.queue.length ? ui.session.queue.length : counts().due + counts().fresh;
  let badge = $('.badge', b);
  if (n > 0 && !ui.studying) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'badge'; b.appendChild(badge); }
    badge.textContent = n > 99 ? '99+' : n;
  } else if (badge) badge.remove();
  b.setAttribute('aria-label', n ? `Учить, карточек: ${n}` : 'Учить');
}

// ---------- Главная ----------
function renderHome() {
  const c = counts();
  const verbs = db.words.filter(w => w.pos === 'verb').length;
  const seg = c.byLevel.map((n, i) => n ? `<i style="flex-grow:${n};background:${LV(i)}" title="${LEVEL_NAMES[i]}: ${n}"></i>` : '').join('');
  if (!c.total) {
    return `<div class="empty"><div class="ei" style="--c:var(--berry)">${icon('book')}</div><b>Пока пусто</b>Подтяни слова через синхронизацию в настройках или добавь первое.<br><br>
      <div class="row"><button class="btn" data-go="settings">Настройки</button><button class="btn primary" data-go="add">Добавить</button></div></div>`;
  }
  return `
    <h1 class="title">¡Hola!</h1>
    <p class="sub">${c.due + c.fresh ? `Сегодня ${c.due + c.fresh} ${plural(c.due + c.fresh, 'карточка', 'карточки', 'карточек')}. Жми «Учить».` : 'На сегодня всё пройдено.'}</p>
    <section class="hero" aria-label="Прогресс">
      <div class="ey">Твой прогресс</div>
      <div class="big-stats">
        <div><b style="color:var(--yellow)">${c.due}</b><span>повторить</span></div>
        <div><b style="color:var(--blue)">${c.fresh}</b><span>новых сегодня</span></div>
        <div><b style="color:var(--mint)">${c.learned}</b><span>изучено</span></div>
      </div>
      <div class="total-line"><span>Всего слов: <b style="color:var(--text)">${c.total}</b></span><span>${Math.round(c.learned / c.total * 100)}% изучено</span></div>
      <div class="seg" role="img" aria-label="Распределение по уровням">${seg}</div>
      <div class="legend">${c.byLevel.map((n, i) => n ? `<span><i style="background:${LV(i)}"></i>${LEVEL_NAMES[i]} <b>${n}</b></span>` : '').join('')}</div>
    </section>
    <div class="section">Быстрые действия</div>
    <div class="quick">
      <button data-quick="dict" style="--c:var(--blue)"><span class="qi">${icon('book', 'sm')}</span><b>Мой словарь</b><small>${c.total} ${plural(c.total, 'слово', 'слова', 'слов')}</small></button>
      <button data-quick="review" style="--c:var(--yellow)"><span class="qi">${icon('repeat', 'sm')}</span><b>Повторение</b><small>${c.due ? `${c.due} ждут сейчас` : 'всё повторено'}</small></button>
      <button data-quick="add" style="--c:var(--berry)"><span class="qi">${icon('plus', 'sm')}</span><b>Добавить слово</b><small>спряжение строится само</small></button>
      <button data-quick="verbs" style="--c:var(--purple)"><span class="qi">${icon('conj', 'sm')}</span><b>Глаголы</b><small>${verbs} со спряжением</small></button>
    </div>
    ${update.available ? `<div class="notice upd"><span class="ni">${icon('download', 'sm')}</span><p><b>Вышла новая версия</b></p><a href="${APK_URL}" class="lnk">Скачать</a></div>` : ''}
    ${c.fill ? `<div class="notice"><span class="ni">${icon('fill', 'sm')}</span><p><b>${c.fill}</b> ${plural(c.fill, 'слово ждёт', 'слова ждут', 'слов ждут')} примеров</p><button data-quick="fill">К словам</button></div>` : ''}
  `;
}
function bindHome() {
  $$('[data-quick]').forEach(b => b.addEventListener('click', () => {
    haptic('light');
    const k = b.dataset.quick;
    if (k === 'add') return goTab('add');
    if (k === 'dict') return goTab('dict');
    if (k === 'review') return openList({ mode: 'review', title: 'Повторение', f: { due: 'now' } }, true);
    if (k === 'verbs') return openList({ mode: 'all', title: POS.verb, f: { pos: 'verb' } }, true);
    if (k === 'fill') return openList({ mode: 'all', title: 'Дополнить', f: { fill: 'need' } }, true);
  }));
}

// ---------- Словарь: библиотека ----------
function renderDict() {
  return ui.dict.view === 'library' ? renderLibrary() : renderList();
}
function renderLibrary() {
  const c = counts();
  const posList = Object.keys(POS).map(p => [p, db.words.filter(w => w.pos === p).length]).filter(([, n]) => n);
  const colls = [
    ['all', 'Все слова', c.total, 'var(--berry)'],
    ['review', 'Повторение', c.due, 'var(--yellow)'],
    ['learned', 'Изучено', c.learned, 'var(--mint)'],
    ['fill', 'Дополнить', c.fill, 'var(--purple)'],
  ];
  return `
    <h1 class="title">Моя библиотека</h1>
    <p class="sub">${c.total} ${plural(c.total, 'слово', 'слова', 'слов')} · ${posList.length} ${plural(posList.length, 'раздел', 'раздела', 'разделов')}</p>
    <div class="search-wrap">${icon('search', 'sm')}<input class="input" id="lib-q" type="search" placeholder="Поиск по-испански или по-русски" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Поиск по словарю"></div>
    <div class="collections">${colls.map(([k, n, v, col]) => `<button class="coll" data-coll="${k}" style="--c:${col}"><b>${v}</b><span>${n}</span></button>`).join('')}</div>
    <div class="section">Части речи</div>
    <div class="cat-list">${posList.map(([p, n]) => `<button class="cat-row" data-cat="${p}" style="--c:${POS_COLOR[p]}"><span class="dot"></span>${POS[p]}<span class="n">${n}</span>${icon('chev', 'sm')}</button>`).join('')}</div>
  `;
}

// ---------- Словарь: Smart Dictionary ----------
const FILTERS = {
  pos: { label: 'Тип', all: 'Все типы', opts: () => Object.keys(POS).map(p => [p, POS[p], POS_COLOR[p]]) },
  level: { label: 'Уровень', all: 'Все уровни', opts: () => LEVEL_NAMES.map((n, i) => [String(i), n, LV(i)]) },
  due: { label: 'Повтор', all: 'Любой срок', opts: () => [['now', 'Нужно сейчас', 'var(--yellow)'], ['week', 'В течение недели', 'var(--blue)'], ['later', 'Позже', 'var(--muted)']] },
  fill: { label: 'Заполненность', all: 'Все', opts: () => [['need', 'Нужно дополнить', 'var(--purple)'], ['full', 'Заполнены', 'var(--mint)']] },
};
const SORTS = [['az', 'А → Я (A–Z)'], ['za', 'Я → А (Z–A)'], ['added', 'Сначала новые'], ['due', 'По дате повтора'], ['level', 'По уровню']];

function openList(preset, fromOutside) {
  const d = freshDict();
  d.view = 'list';
  d.mode = preset.mode || 'all';
  d.title = preset.title || 'Все слова';
  d.q = preset.q || '';
  Object.assign(d.f, preset.f || {});
  if (d.mode === 'review') d.sort = 'due';
  ui.dict = d;
  if (fromOutside) { ui.tab = 'dict'; }
  pushLayer(() => { ui.dict.view = 'library'; ui.dict.q = ''; if (ui.tab === 'dict' && !ui.studying) render({ animate: true }); });
  render({ animate: true });
  window.scrollTo(0, 0);
}

function matches(w) {
  const d = ui.dict, f = d.f, t = today();
  if (d.q) {
    const q = d.q.toLowerCase().trim();
    const hay = (w.es + ' ' + w.ru + ' ' + (w.notes || '')).toLowerCase();
    if (!hay.includes(q) && !stripAccents(hay).includes(stripAccents(q))) return false;
  }
  if (d.mode === 'review' && !(w.level > 0 && w.level < LEARNED)) return false;
  if (f.pos !== 'all' && w.pos !== f.pos) return false;
  if (f.level !== 'all' && Math.min(w.level, LEARNED) !== +f.level) return false;
  if (f.due !== 'all') {
    if (!(w.level > 0 && w.level < LEARNED)) return false;
    const diff = daysUntil(w.due);
    if (f.due === 'now' && w.due > t) return false;
    if (f.due === 'week' && !(diff > 0 && diff <= 7)) return false;
    if (f.due === 'later' && diff <= 7) return false;
  }
  if (f.fill === 'need' && !w.needsFill) return false;
  if (f.fill === 'full' && w.needsFill) return false;
  return true;
}
function sorted(list) {
  const s = ui.dict.sort;
  const by = {
    az: (a, b) => sortKey(a.es).localeCompare(sortKey(b.es), 'es'),
    za: (a, b) => sortKey(b.es).localeCompare(sortKey(a.es), 'es'),
    added: (a, b) => (b.created || 0) - (a.created || 0) || sortKey(a.es).localeCompare(sortKey(b.es), 'es'),
    due: (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.level - b.level,
    level: (a, b) => a.level - b.level || sortKey(a.es).localeCompare(sortKey(b.es), 'es'),
  }[s];
  return list.sort(by);
}
const letterOf = w => { const k = sortKey(w.es); const ch = k.charAt(0).toUpperCase(); return /[A-ZÑ]/.test(ch) ? ch : '#'; };

function renderList() {
  const d = ui.dict;
  const active = Object.values(d.f).filter(v => v !== 'all').length;
  return `
    <div class="list-head">
      <button class="icon-btn plain" data-act="lib-back" aria-label="Назад к библиотеке">${icon('back')}</button>
      <h1 class="title">${esc(d.title)}</h1>
    </div>
    <div class="search-wrap">${icon('search', 'sm')}<input class="input" id="list-q" type="search" value="${esc(d.q)}" placeholder="Поиск по-испански или по-русски" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Поиск"></div>
    <div class="segmented" role="tablist">${[['all', 'Все слова'], ['cats', 'Категории'], ['review', 'Повторение']].map(([k, n]) => `<button role="tab" aria-selected="${d.mode === k}" class="${d.mode === k ? 'active' : ''}" data-mode="${k}">${n}</button>`).join('')}</div>
    <div class="chips filters">
      ${Object.entries(FILTERS).filter(([k]) => !(d.mode === 'cats' && k === 'pos')).map(([k, F]) => {
        const v = d.f[k]; const opt = F.opts().find(o => o[0] === v);
        return `<button class="chip ${v !== 'all' ? 'on' : ''}" data-filter="${k}">${v !== 'all' ? esc(opt[1]) : F.label} <span aria-hidden="true">▾</span></button>`;
      }).join('')}
      <button class="chip" data-filter="sort">${icon('sort')}${esc(SORTS.find(s => s[0] === d.sort)[1])}</button>
      ${active ? `<button class="chip reset" data-act="reset">Сбросить</button>` : ''}
    </div>
    <div id="list-area">${renderListArea()}</div>
  `;
}

function renderListArea() {
  const d = ui.dict;
  const list = sorted(db.words.filter(matches));
  if (!list.length) {
    const hasFilters = Object.values(d.f).some(v => v !== 'all') || d.q;
    return `<div class="empty"><div class="ei">${icon('search')}</div><b>Ничего не нашлось</b>${hasFilters ? 'Похоже, фильтры противоречат друг другу или запросу.<br><br><button class="btn" data-act="reset">Сбросить фильтры</button>' : 'Здесь пока нет слов.'}</div>`;
  }
  let html = `<div class="count-line"><span>${list.length} ${plural(list.length, 'слово', 'слова', 'слов')}</span>${d.mode === 'review' ? '<span>ближайшие сверху</span>' : ''}</div>`;
  if (d.mode === 'cats') {
    const groups = Object.keys(POS).map(p => [p, list.filter(w => w.pos === p)]).filter(([, l]) => l.length);
    html += groups.map(([p, l]) => {
      const open = d.open[p] || (d.q && l.length <= 30);
      return `<div class="group ${open ? 'open' : ''}" style="--c:${POS_COLOR[p]}">
        <button class="group-head" data-group="${p}" aria-expanded="${!!open}"><span class="dot"></span>${POS[p]}<span class="n">${l.length}</span>${icon('chev', 'sm')}</button>
        ${open ? `<div class="group-body">${l.slice(0, d.open[p + ':n'] || 80).map(rowHtml).join('')}${l.length > (d.open[p + ':n'] || 80) ? `<div class="more"><button class="btn ghost" data-more-group="${p}">Ещё ${l.length - (d.open[p + ':n'] || 80)}</button></div>` : ''}</div>` : ''}
      </div>`;
    }).join('');
    return html;
  }
  const withLetters = d.mode === 'all' && (d.sort === 'az' || d.sort === 'za') && !d.q;
  const shown = list.slice(0, d.shown);
  let last = null; let rows = '';
  for (const w of shown) {
    if (withLetters) { const L = letterOf(w); if (L !== last) { rows += `<div class="letter-head" data-letter="${L}">${L}</div>`; last = L; } }
    rows += rowHtml(w);
  }
  if (list.length > d.shown) rows += `<div class="more" id="sentinel"><span class="small muted">Загружаю ещё…</span></div>`;
  let az = '';
  if (withLetters && list.length > 40) {
    const present = new Set(list.map(letterOf));
    const letters = 'ABCDEFGHIJLMNÑOPQRSTUVYZ'.split('');
    if (d.sort === 'za') letters.reverse();
    az = `<div class="az" aria-label="Алфавитный указатель"><div class="az-inner">${letters.map(L => `<button data-az="${L}" class="${present.has(L) ? '' : 'dim'}" aria-label="Буква ${L}">${L}</button>`).join('')}</div></div>`;
  }
  return html + `<div class="list-wrap"><div class="word-list">${rows}</div>${az}</div>`;
}
function rowHtml(w) {
  const lv = Math.min(w.level, LEARNED);
  return `<button class="word-item" data-word="${w.id}" style="--lc:${LV(lv)}" aria-label="${esc(w.es)} — ${esc(w.ru)}, ${LEVEL_NAMES[lv]}">
    <span class="bar"></span>
    <span class="w"><span class="es">${esc(w.es)}${w.needsFill ? '<span class="tag fill">дополнить</span>' : ''}</span><span class="ru">${esc(w.ru)}</span></span>
    <span class="meta"><span class="st">${dueLabel(w)}</span><span>${POS_ONE[w.pos] || ''}</span></span>
  </button>`;
}

function bindDict() {
  const d = ui.dict;
  if (d.view === 'library') {
    const q = $('#lib-q');
    q.addEventListener('input', () => {
      if (!q.value.trim()) return;
      openList({ mode: 'all', title: 'Поиск', q: q.value });
      const n = $('#list-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length);
    });
    $$('[data-coll]').forEach(b => b.addEventListener('click', () => {
      haptic('light');
      const k = b.dataset.coll;
      if (k === 'all') openList({ mode: 'all', title: 'Все слова' });
      if (k === 'review') openList({ mode: 'review', title: 'Повторение', f: { due: 'now' } });
      if (k === 'learned') openList({ mode: 'all', title: 'Изучено', f: { level: String(LEARNED) } });
      if (k === 'fill') openList({ mode: 'all', title: 'Дополнить', f: { fill: 'need' } });
    }));
    $$('[data-cat]').forEach(b => b.addEventListener('click', () => { haptic('light'); openList({ mode: 'all', title: POS[b.dataset.cat], f: { pos: b.dataset.cat } }); }));
    return;
  }
  $('[data-act=lib-back]').addEventListener('click', popLayer);
  const q = $('#list-q');
  let t;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { d.q = q.value; d.shown = 60; refreshList(); }, 120); });
  $$('[data-mode]').forEach(b => b.addEventListener('click', () => {
    if (d.mode === b.dataset.mode) return;
    haptic('light');
    d.mode = b.dataset.mode; d.shown = 60;
    if (d.mode === 'review') d.sort = 'due'; else if (d.sort === 'due') d.sort = 'az';
    if (d.mode === 'cats') d.f.pos = 'all';
    render();
  }));
  $$('[data-filter]').forEach(b => b.addEventListener('click', () => { haptic('light'); openFilterSheet(b.dataset.filter); }));
  bindListArea();
}
function bindListArea() {
  const d = ui.dict;
  $$('[data-act=reset]').forEach(b => b.addEventListener('click', () => { d.f = { pos: 'all', level: 'all', due: 'all', fill: 'all' }; d.q = ''; d.shown = 60; render(); }));
  $$('[data-group]').forEach(b => b.addEventListener('click', () => { haptic('light'); d.open[b.dataset.group] = !d.open[b.dataset.group]; refreshList(); }));
  $$('[data-more-group]').forEach(b => b.addEventListener('click', () => { const p = b.dataset.moreGroup; d.open[p + ':n'] = (d.open[p + ':n'] || 80) + 200; refreshList(); }));
  bindRows();
  bindAZ();
}
function bindRows() {
  const d = ui.dict;
  $$('#list-area [data-word]').forEach(b => { if (b._b) return; b._b = 1; b.addEventListener('click', () => { haptic('light'); openDetail(b.dataset.word); }); });
  const s = $('#sentinel');
  if (s && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { io.disconnect(); d.shown += 80; growRows(); } }, { rootMargin: '600px' });
    io.observe(s);
  }
}
// Дорисовываем строки, не трогая фильтры и алфавитный указатель
function growRows() {
  const wl = $('.word-list'); if (!wl) return refreshList(true);
  const tmp = document.createElement('div'); tmp.innerHTML = renderListArea();
  const nw = $('.word-list', tmp); if (!nw) return;
  wl.replaceWith(nw); bindRows();
}
function refreshList(keepScroll) {
  const area = $('#list-area'); if (!area) return;
  const y = window.scrollY;
  area.innerHTML = renderListArea();
  const fl = $('.filters'); if (fl) { const tmp = document.createElement('div'); tmp.innerHTML = renderList(); fl.replaceWith($('.filters', tmp)); $$('.filters [data-filter]').forEach(b => b.addEventListener('click', () => { haptic('light'); openFilterSheet(b.dataset.filter); })); }
  bindListArea();
  if (keepScroll) window.scrollTo(0, y);
}
function bindAZ() {
  const az = $('.az'); if (!az) return;
  let bubble = null, lastL = null;
  const jump = L => {
    if (!L || L === lastL) return; lastL = L;
    const d = ui.dict;
    const list = sorted(db.words.filter(matches));
    const idx = list.findIndex(w => letterOf(w) === L);
    if (idx < 0) return;
    haptic('light');
    if (!bubble) { bubble = document.createElement('div'); bubble.className = 'az-bubble'; document.body.appendChild(bubble); }
    bubble.textContent = L;
    if (idx + 30 > d.shown) { d.shown = idx + 60; growRows(); }
    const el = $(`.letter-head[data-letter="${L}"]`);
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70);
  };
  const at = e => { const p = e.touches ? e.touches[0] : e; const el = document.elementFromPoint(p.clientX, p.clientY); return el && el.dataset && el.dataset.az; };
  const end = () => { lastL = null; if (bubble) { bubble.remove(); bubble = null; } };
  az.addEventListener('pointerdown', e => { az.setPointerCapture(e.pointerId); jump(at(e)); });
  az.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') jump(at(e)); });
  az.addEventListener('pointerup', end); az.addEventListener('pointercancel', end);
  window.addEventListener('pointerup', end, { once: true, capture: true });
  az.addEventListener('pointerdown', () => window.addEventListener('pointerup', end, { once: true, capture: true }));
}

function openFilterSheet(key) {
  const d = ui.dict;
  let title, opts, cur;
  if (key === 'sort') { title = 'Сортировка'; opts = SORTS.map(([k, n]) => [k, n, null]); cur = d.sort; }
  else { const F = FILTERS[key]; title = F.label; opts = [['all', F.all, null], ...F.opts()]; cur = d.f[key]; }
  openSheet(`<p class="sheet-title">${title}</p>${opts.map(([k, n, c]) => `<button class="opt" data-v="${k}" style="${c ? `--c:${c}` : ''}">${c ? '<span class="dot"></span>' : ''}${esc(n)}${k === cur ? `<span class="chk">${icon('check', 'sm')}</span>` : ''}</button>`).join('')}`, sheet => {
    $$('[data-v]', sheet).forEach(b => b.addEventListener('click', () => {
      haptic('light');
      if (key === 'sort') d.sort = b.dataset.v; else d.f[key] = b.dataset.v;
      d.shown = 60;
      closeSheet(); refreshList();
    }));
  });
}

// ---------- Нижние листы и диалоги ----------
let sheetEl = null;
function openSheet(inner, bind) {
  // Если лист уже открыт — меняем содержимое на месте, запись в истории остаётся одна
  if (sheetEl) {
    const sh = $('.sheet', sheetEl);
    sh.innerHTML = GRIP + inner;
    sh.scrollTop = 0;
    bind && bind(sh);
    return sheetEl;
  }
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${GRIP}${inner}</div>`;
  $('#layer').appendChild(wrap);
  sheetEl = wrap;
  wrap.addEventListener('click', e => { if (e.target === wrap) closeSheet(); });
  bindSheetDrag(wrap);
  pushLayer(() => animateClose(wrap));
  bind && bind($('.sheet', wrap));
  return wrap;
}
const GRIP = '<div class="grip-zone" data-close aria-label="Закрыть: потяни вниз или нажми"><div class="grip"></div></div>';
// Лист уезжает вниз — зеркально тому, как выезжает при открытии
function animateClose(wrap) {
  if (sheetEl === wrap) sheetEl = null;
  if (reduceMotion()) return wrap.remove();
  const sh = $('.sheet', wrap);
  const from = sh.style.transform || 'translateY(0px)';
  sh.style.animation = 'none';
  sh.style.transform = from;
  void sh.offsetHeight;
  sh.style.transition = 'transform 260ms cubic-bezier(.4, 0, .9, .5)';
  sh.style.transform = 'translateY(105%)';
  wrap.style.transition = 'background 260ms';
  wrap.style.background = 'rgba(5, 8, 18, 0)';
  setTimeout(() => wrap.remove(), 270);
}
// Свайп вниз: за «пипку» — всегда, за содержимое — когда лист прокручен до верха
function bindSheetDrag(wrap) {
  const sh = $('.sheet', wrap);
  let y0 = null, x0 = 0, dy = 0, dragging = false, fromGrip = false, t0 = 0, crossed = false;
  const limit = () => Math.min(105, sh.offsetHeight * 0.1875);
  const start = (x, y, target) => {
    if (target.closest('input, textarea, select')) return;
    fromGrip = !!target.closest('.grip-zone');
    if (!fromGrip && sh.scrollTop > 0) return;
    y0 = y; x0 = x; dy = 0; dragging = false; crossed = false; t0 = performance.now();
  };
  const move = (x, y, e) => {
    if (y0 === null) return;
    const my = y - y0, mx = x - x0;
    if (!dragging) {
      if (Math.abs(my) < 6 && Math.abs(mx) < 6) return;
      if (my <= 0 || Math.abs(mx) > Math.abs(my) || (!fromGrip && sh.scrollTop > 0)) { y0 = null; return; }
      dragging = true; sh.style.animation = 'none'; sh.style.transition = 'none'; sh.style.userSelect = 'none';
    }
    dy = Math.max(0, my);
    sh.style.transform = `translateY(${dy}px)`;
    wrap.style.background = `rgba(5, 8, 18, ${(0.6 * (1 - Math.min(1, dy / sh.offsetHeight))).toFixed(3)})`;
    if (dy > limit() && !crossed) { crossed = true; haptic('light'); }
    if (dy <= limit()) crossed = false;
    if (e.cancelable) e.preventDefault();
  };
  const end = () => {
    if (y0 === null) return;
    const was = dragging; y0 = null; dragging = false;
    if (!was) return;
    wrap._dragged = true; setTimeout(() => (wrap._dragged = false), 60);
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > limit() || (v > 0.6 && dy > 40)) return closeSheet();
    sh.style.transition = 'transform 300ms var(--spring)';
    sh.style.transform = '';
    wrap.style.background = '';
  };
  sh.addEventListener('touchstart', e => start(e.touches[0].clientX, e.touches[0].clientY, e.target), { passive: true });
  sh.addEventListener('touchmove', e => move(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
  sh.addEventListener('touchend', end);
  sh.addEventListener('touchcancel', end);
  sh.addEventListener('mousedown', e => {
    start(e.clientX, e.clientY, e.target);
    const mm = ev => move(ev.clientX, ev.clientY, ev);
    const mu = () => { end(); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  });
  // После перетаскивания клик по кнопке под пальцем не срабатывает
  sh.addEventListener('click', e => {
    if (wrap._dragged) { e.stopPropagation(); e.preventDefault(); return; }
    if (e.target.closest('[data-close]')) closeSheet();
  }, true);
}
function closeSheet() { if (sheetEl) popLayer(); }

function confirmDialog(title, text, okLabel, onOk) {
  const wrap = document.createElement('div');
  wrap.className = 'dialog-wrap';
  wrap.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="row"><button class="btn" data-no>Отмена</button><button class="btn primary" data-yes>${esc(okLabel)}</button></div></div>`;
  $('#layer').appendChild(wrap);
  let action = null, closed = false;
  // Действие выполняется после того, как диалог закрыт и его запись снята с истории
  pushLayer(() => { closed = true; wrap.remove(); if (action) { const a = action; action = null; setTimeout(a, 0); } });
  $('[data-no]', wrap).addEventListener('click', popLayer);
  wrap.addEventListener('click', e => { if (e.target === wrap) popLayer(); });
  $('[data-yes]', wrap).addEventListener('click', () => { if (closed || action) return; action = onOk; popLayer(); });
}

let toastTimer;
function toast(msg, action) {
  $$('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  document.body.appendChild(t);
  if (action) $('button', t).addEventListener('click', () => { t.remove(); action.fn(); });
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), action ? 5000 : 2600);
}

// ---------- Карточка слова ----------
function openDetail(id, editing) {
  const w = db.words.find(x => x.id === id); if (!w) return;
  if (editing) return openSheet(renderEdit(w), sheet => bindEdit(sheet, w));
  openSheet(renderDetail(w), sheet => {
    $$('[data-setlevel]', sheet).forEach(b => b.addEventListener('click', () => {
      const lv = +b.dataset.setlevel;
      if (Math.min(w.level, LEARNED) === lv) return;
      haptic('soft');
      w.level = lv; w.due = lv >= LEARNED ? '' : lv === 0 ? today() : addDays(today(), INTERVALS[lv]); touch(w); save();
      $$('[data-setlevel]', sheet).forEach(x => x.classList.toggle('active', +x.dataset.setlevel === lv));
      $('.status-pill', sheet).outerHTML = statusPill(w);
      $('[data-due]', sheet).textContent = dueDate(w);
      afterDataChange();
    }));
    $('[data-act=edit]', sheet).addEventListener('click', () => { haptic('light'); openDetail(id, true); });
    $('[data-act=del]', sheet).addEventListener('click', () => confirmDialog(`Удалить «${w.es}»?`, 'Слово пропадёт из словаря и прогресса.', 'Удалить', () => deleteWord(w)));
    $('[data-act=close]', sheet).addEventListener('click', closeSheet);
  });
}
const statusPill = w => `<span class="status-pill" style="--lc:${LV(w.level)}"><i></i>${LEVEL_NAMES[Math.min(w.level, LEARNED)]}</span>`;
function renderDetail(w) {
  const c = conjFor(w);
  const inf = w.es.split(/\s+/)[0];
  const conjHtml = c ? db.tenses.filter(t => c.tenses[t]).map(t => `
      <div class="section">${TENSE_LABELS[t]}</div>
      <table class="ctab">${c.tenses[t].map((f, i) => {
        const irr = t === 'presente' && !w.es.includes(' / ') && regularForm(inf, i) && !f.form.endsWith(regularForm(inf, i)) && !f.form.split(' ').pop().startsWith(regularForm(inf, i));
        return `<tr><td>${esc(f.person)}</td><td class="${irr ? 'irr' : ''}">${esc(f.form)}${f.alt ? `<div class="small muted">${esc(f.alt)}</div>` : ''}</td></tr>`;
      }).join('')}</table>`).join('') + (db.tenses.includes('presente') ? '<p class="small muted" style="margin-top:8px">Оранжевым — формы, которые отличаются от обычных окончаний.</p>' : '') : '';
  return `
    <div class="small muted">${esc(POS[w.pos] || '')}${w.lesson ? ' · ' + esc(w.lesson) : ''}</div>
    <p class="detail-es">${esc(w.es)}</p>
    <div class="detail-ru">${esc(w.ru)}</div>
    <div class="detail-meta">${statusPill(w)}${w.needsFill ? '<span class="tag fill">дополнить</span>' : ''}<span class="tag pos">${esc(POS_ONE[w.pos] || '')}</span></div>
    <p class="small muted" style="margin:10px 0 0">Следующее повторение: <span data-due>${esc(dueDate(w))}</span></p>
    ${w.examples.length ? `<div class="section">Примеры</div>${w.examples.map(e => `<div class="ex"><div class="es">${esc(e.es)}</div><div class="ru">${esc(e.ru)}</div></div>`).join('')}` : ''}
    ${conjHtml}
    ${w.notes ? `<div class="section">Заметка</div><div class="small">${esc(w.notes)}</div>` : ''}
    <div class="section">Уровень</div>
    <div class="lv-picker">${LEVEL_NAMES.map((n, i) => `<button class="${Math.min(w.level, LEARNED) === i ? 'active' : ''}" data-setlevel="${i}" style="--lc:${LV(i)}"><i></i>${n}</button>`).join('')}</div>
    <div class="sheet-actions">
      <button class="btn" data-act="edit">${icon('edit', 'sm')}Изменить</button>
      <button class="btn danger" data-act="del" aria-label="Удалить слово">${icon('trash', 'sm')}</button>
      <button class="btn primary" data-act="close">Готово</button>
    </div>`;
}
function renderEdit(w) {
  return `
    <p class="sheet-title">Изменить слово</p>
    <label class="field"><span>По-испански</span><input class="input" id="e-es" value="${esc(w.es)}" autocapitalize="off" spellcheck="false"></label>
    <label class="field"><span>Перевод</span><input class="input" id="e-ru" value="${esc(w.ru)}"></label>
    <div class="field"><span>Раздел</span><div class="pos-pick">${Object.keys(POS).map(p => `<button class="chip ${w.pos === p ? 'active' : ''}" data-pos="${p}" style="--c:${POS_COLOR[p]}"><span class="dot"></span>${POS_ONE[p]}</button>`).join('')}</div></div>
    <label class="field"><span>Примеры: строка по-испански, следующая — перевод</span><textarea class="input" id="e-ex">${esc(w.examples.map(e => e.es + '\n' + e.ru).join('\n'))}</textarea></label>
    <label class="field"><span>Заметка</span><textarea class="input" id="e-notes" style="min-height:64px">${esc(w.notes || '')}</textarea></label>
    <div class="sheet-actions"><button class="btn" data-act="cancel">Отмена</button><button class="btn primary" data-act="save">Сохранить</button></div>`;
}
function bindEdit(sheet, w) {
  let pos = w.pos;
  $$('[data-pos]', sheet).forEach(b => b.addEventListener('click', () => { pos = b.dataset.pos; haptic('light'); $$('[data-pos]', sheet).forEach(x => x.classList.toggle('active', x === b)); }));
  $('[data-act=cancel]', sheet).addEventListener('click', () => openDetail(w.id));
  $('[data-act=save]', sheet).addEventListener('click', () => {
    const es = $('#e-es', sheet).value.trim(), ru = $('#e-ru', sheet).value.trim();
    if (!es || !ru) return toast('Нужны слово и перевод');
    w.es = es; w.ru = ru; w.pos = pos;
    w.examples = parseExamples($('#e-ex', sheet).value);
    const notes = $('#e-notes', sheet).value.trim();
    if (notes) w.notes = notes; else delete w.notes;
    w.needsFill = !w.examples.length;
    touch(w); save(); haptic('success');
    afterDataChange(); openDetail(w.id);
    toast('Сохранено');
  });
}
function parseExamples(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const out = []; for (let i = 0; i < lines.length; i += 2) out.push({ es: lines[i], ru: lines[i + 1] || '' });
  return out;
}
function deleteWord(w) {
  const idx = db.words.indexOf(w);
  db.words.splice(idx, 1); db.deleted.push(w.id); save();
  closeSheet(); afterDataChange();
  haptic('soft');
  toast(`«${w.es}» удалено`, { label: 'Отменить', fn: () => { db.words.splice(idx, 0, w); db.deleted = db.deleted.filter(x => x !== w.id); touch(w); save(); afterDataChange(); } });
}
function afterDataChange() {
  if (ui.studying) return;
  if (ui.tab === 'dict' && ui.dict.view === 'list') refreshList(true);
  else render();
}

// ---------- Добавление ----------
let addPos = 'verb';
function renderAdd() {
  return `
    <h1 class="title">Новое слово</h1>
    <p class="sub">Спряжение строится само. Без примеров слово получит метку «дополнить».</p>
    <label class="field"><span>По-испански</span><input class="input" id="f-es" autocapitalize="off" spellcheck="false" placeholder="например, bailar"></label>
    <label class="field"><span>Перевод</span><input class="input" id="f-ru" placeholder="танцевать"></label>
    <div class="field"><span>Раздел</span><div class="pos-pick">${Object.keys(POS).map(p => `<button class="chip ${addPos === p ? 'active' : ''}" data-pos="${p}" style="--c:${POS_COLOR[p]}"><span class="dot"></span>${POS_ONE[p]}</button>`).join('')}</div></div>
    <div id="f-preview"></div>
    <label class="field"><span>Примеры (необязательно): строка по-испански, следующая — перевод</span><textarea class="input" id="f-ex" placeholder="Tengo que trabajar.&#10;Мне надо работать."></textarea></label>
    <button class="btn primary block" data-act="save-word">${icon('plus', 'sm')}Добавить</button>`;
}
function bindAdd() {
  const fes = $('#f-es');
  const prev = () => {
    const p = $('#f-preview');
    if (addPos !== 'verb' || !fes.value.trim()) { p.innerHTML = ''; return; }
    const c = conjugate(fes.value.trim().split(/\s+/)[0]);
    p.innerHTML = c ? `<div class="preview"><div class="lbl">Presente</div>${c.tenses.presente.map(f => esc(f.form)).join(', ')}</div>` : '';
  };
  fes.addEventListener('input', prev);
  $$('[data-pos]').forEach(b => b.addEventListener('click', () => { addPos = b.dataset.pos; haptic('light'); $$('[data-pos]').forEach(x => x.classList.toggle('active', x === b)); prev(); }));
  $('[data-act=save-word]').addEventListener('click', () => {
    const es = fes.value.trim(), ru = $('#f-ru').value.trim();
    if (!es || !ru) { haptic('error'); toast('Нужны слово и перевод'); return; }
    if (db.words.some(x => norm(x.es) === norm(es))) { haptic('error'); toast('Такое слово уже есть'); return; }
    const w = addWord({ es, ru, pos: addPos, examples: parseExamples($('#f-ex').value) });
    haptic('success');
    render();
    toast(`«${es}» добавлено`, { label: 'Открыть', fn: () => openDetail(w.id) });
  });
}

// ---------- Настройки ----------
function renderSettings() {
  const last = db.settings.lastSync ? new Date(db.settings.lastSync).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ещё не было';
  return `
    <h1 class="title">Настройки</h1>
    <p class="sub">Обучение, синхронизация и данные</p>
    <div class="section">Обучение</div>
    <div class="set-group">
      <div class="set-row"><div class="tx"><b>Новых слов за сессию</b><p>Сколько новых карточек подмешивать</p></div>
        <div class="stepper"><button data-step="-1" aria-label="Меньше">−</button><output id="s-new">${db.settings.newPerSession}</output><button data-step="1" aria-label="Больше">+</button></div></div>
      ${Object.keys(TENSE_LABELS).map(t => `<div class="set-row"><div class="tx"><b>${TENSE_LABELS[t]}</b><p>${t === 'presente' ? 'Настоящее время' : 'Только герундий (estar + gerundio)'}</p></div><label class="switch"><input type="checkbox" data-tense="${t}" ${db.tenses.includes(t) ? 'checked' : ''} aria-label="${TENSE_LABELS[t]}"><i></i></label></div>`).join('')}
    </div>
    <p class="small muted" style="margin:8px 4px 0">Включаешь новое время — все глаголы уходят на последний уровень повторения.</p>
    <div class="section">Интерфейс</div>
    <div class="set-group">
      <div class="set-row"><div class="tx"><b>Тактильная отдача</b><p>Лёгкая вибрация при действиях и ответах.</p></div><label class="switch"><input type="checkbox" id="s-haptics" ${db.settings.haptics ? 'checked' : ''} aria-label="Тактильная отдача"><i></i></label></div>
    </div>
    <div class="section">Синхронизация</div>
    <div class="set-group" style="padding-bottom:14px">
      <div class="set-row" style="border:0"><div class="tx"><b>GitHub</b><p>${DATA_REPO} · последняя: ${esc(last)}</p></div></div>
      <label class="field"><span>Токен доступа</span><input class="input" id="s-token" type="password" value="${esc(db.settings.token)}" autocomplete="off" placeholder="github_pat_…"></label>
      <div class="row compact"><button class="btn" data-act="save-token">Сохранить</button><button class="btn primary" data-act="sync" id="sync-btn">Синхронизировать</button></div>
    </div>
    <div class="section">Обновление</div>
    <div class="set-group">
      <div class="set-row"><img src="icon.png" alt="" class="app-icon"><div class="tx"><b>verba. 2.0</b><p id="upd-status">${esc(updateText())}</p></div></div>
      <div class="set-row" style="border:0;padding-top:0"><a class="btn ${update.available ? 'primary' : ''} block" href="${APK_URL}" data-act="download">${icon('download', 'sm')}${update.available ? 'Скачать новую версию' : 'Скачать последнюю сборку'}</a></div>
    </div>
    <p class="small muted" style="margin:8px 4px 0">Откроется браузер и скачает verba.apk. Устанавливай поверх — слова и прогресс останутся.</p>
    <div class="section">Данные</div>
    <div class="set-group">
      <div class="set-row"><div class="tx"><b>Экспорт JSON</b><p>Все слова с прогрессом одним файлом</p></div><button class="icon-btn" data-act="export" aria-label="Экспорт">${icon('download', 'sm')}</button></div>
      <div class="set-row"><div class="tx"><b>Импорт JSON</b><p>Слияние с текущими: новее — побеждает</p></div><button class="icon-btn" data-act="import" aria-label="Импорт">${icon('upload', 'sm')}</button><input type="file" id="s-file" accept="application/json,.json" hidden></div>
    </div>
    <p class="small muted" style="text-align:center;margin:22px 0 0">verba. 2.0${update.build ? ' · ' + esc(update.build.sha) : ''} · ${db.words.length} ${plural(db.words.length, 'слово', 'слова', 'слов')}</p>`;
}
function bindSettings() {
  $$('[data-step]').forEach(b => b.addEventListener('click', () => {
    db.settings.newPerSession = Math.max(0, Math.min(100, db.settings.newPerSession + +b.dataset.step)); save();
    $('#s-new').textContent = db.settings.newPerSession; haptic('light'); updateBadge();
  }));
  $$('[data-tense]').forEach(el => el.addEventListener('change', () => {
    haptic('light');
    if (el.checked) {
      el.checked = false;
      confirmDialog('Включить время?', 'Все глаголы, которые ты уже учил, уйдут на последний уровень повторения, чтобы прогнать их с новой формой.', 'Включить', () => {
        enableTense(el.dataset.tense); render(); toast('Время добавлено, глаголы — на последний уровень');
      });
    } else { db.tenses = db.tenses.filter(t => t !== el.dataset.tense); save(); }
  }));
  $('#s-haptics').addEventListener('change', e => { db.settings.haptics = e.target.checked; save(); haptic('soft'); });
  $('[data-act=save-token]').addEventListener('click', () => { db.settings.token = $('#s-token').value.trim(); save(); haptic('success'); toast('Токен сохранён'); });
  $('[data-act=sync]').addEventListener('click', sync);
  $('[data-act=export]').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(db.words, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'verba-words.json'; a.click();
  });
  $('[data-act=import]').addEventListener('click', () => $('#s-file').click());
  $('#s-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : data.words;
      if (!Array.isArray(incoming)) throw new Error('нет списка слов');
      const r = mergeWords(incoming, data.deleted || []);
      save(); render(); haptic('success');
      toast(`Импорт: новых ${r.added}, обновлено ${r.updated}`);
    } catch (err) { haptic('error'); toast('Не удалось прочитать файл: ' + err.message); }
  });
}
function mergeWords(incoming, deletedIn) {
  const deleted = new Set([...(db.deleted || []), ...(deletedIn || [])]);
  const map = new Map(db.words.map(w => [w.id, w]));
  let added = 0, updated = 0;
  for (const w of incoming) {
    if (!w || !w.id || !w.es || deleted.has(w.id)) continue;
    const cur = map.get(w.id);
    if (!cur) { map.set(w.id, w); added++; }
    else if ((w.updated || 0) > (cur.updated || 0)) { map.set(w.id, w); updated++; }
  }
  db.words = [...map.values()].filter(w => !deleted.has(w.id));
  db.deleted = [...deleted];
  return { added, updated };
}

// ==========================================================
// Учебная сессия
// ==========================================================
let startLock = false;
function startStudy() {
  if (startLock) return;
  startLock = true; setTimeout(() => (startLock = false), 600);
  const fab = $('#nav-study');
  fab.classList.add('pressed'); haptic('light');
  setTimeout(() => fab.classList.remove('pressed'), 110);
  setTimeout(() => {
    // Активная сессия восстанавливается, иначе — новая очередь по прежним правилам
    if (!ui.session || !ui.session.queue.length) ui.session = buildSession();
    if (!ui.session.total) { ui.session = null; return noCards(); }
    $$('.toast').forEach(t => t.remove());
    unwindLayers(() => {
      ui.studying = true;
      pushLayer(() => exitStudy(true));
      render();
      window.scrollTo(0, 0);
    });
  }, reduceMotion() ? 0 : 140);
}
function noCards() {
  const c = counts();
  openSheet(`<div class="empty" style="padding:24px 8px 8px"><div class="ei" style="--c:var(--mint)">${icon('learned')}</div><b>На сегодня всё</b>${c.total ? 'Карточек на повторение нет, новые закончились. Загляни завтра или добавь слова.' : 'Словарь пуст. Синхронизируй слова или добавь первое.'}</div>
    <div class="row"><button class="btn" data-a="dict">Словарь</button><button class="btn primary" data-a="add">Добавить слово</button></div>`, sheet => {
    $('[data-a=dict]', sheet).addEventListener('click', () => goTab('dict'));
    $('[data-a=add]', sheet).addEventListener('click', () => goTab('add'));
  });
}
function exitStudy(fromPop) {
  ui.studying = false;
  if (ui.session && !ui.session.queue.length) ui.session = null; // завершённую не храним
  render({ animate: true });
  window.scrollTo(0, 0);
}

function currentWord() {
  const s = ui.session; if (!s) return null;
  while (s.queue.length) {
    const w = db.words.find(x => x.id === s.queue[0]);
    if (w) return w;
    s.queue.shift();
  }
  return null;
}

function renderStudy() {
  const s = ui.session;
  const w = currentWord();
  if (!w) return renderDone();
  const c = conjFor(w);
  if (s.current !== w.id) {
    s.current = w.id; s.state = 'ask'; s.result = null; s.mainInput = ''; s.dontKnow = false;
    const tenses = c ? db.tenses.filter(t => c.tenses[t]) : [];
    s.tense = tenses.length ? tenses[Math.floor(Math.random() * tenses.length)] : null;
  }
  const res = s.result;
  const pos = s.done + 1;
  const pct = s.total ? (s.done / s.total) * 100 : 0;
  const mark = r => r ? (r === 'ok' ? 'right' : r === 'accent' ? 'accent' : 'wrong') : '';
  const dis = s.state === 'ask' ? '' : 'disabled';
  const lv = Math.min(w.level, LEARNED);

  let conjHtml = '';
  if (c && s.tense) {
    conjHtml = `<div class="conj"><div class="tl">${TENSE_LABELS[s.tense]}</div>${c.tenses[s.tense].map((f, i) => {
      const r = res && res.forms[i];
      return `<label for="cf${i}">${esc(f.person)}</label><input class="input ${mark(r && r.r)}" id="cf${i}" data-form="${i}" value="${r ? esc(r.got) : ''}" autocomplete="off" autocapitalize="off" spellcheck="false" ${dis}>
        ${r && r.r !== 'ok' ? `<div class="fix ${r.r === 'bad' ? 'bad' : 'warn'}">${esc(r.expected)}</div>` : ''}`;
    }).join('')}</div>`;
  }

  let verdict = '', actions;
  if (s.state === 'ask') {
    actions = `<button class="btn primary block" data-act="check">Проверить</button>
      <button class="btn ghost block" data-act="dontknow">Не помню — показать</button>`;
  } else if (res.allOk) {
    verdict = res.hasAccent ? `<div class="verdict warn">${icon('check', 'sm')}Верно, но проверь тильды</div>` : `<div class="verdict ok">${icon('check', 'sm')}Верно</div>`;
    actions = `<div class="row"><button class="btn" data-act="again">${icon('back', 'sm')}Ещё раз</button><button class="btn mint" data-act="repeat">Помню${icon('chev', 'sm')}</button></div>
      <button class="btn ghost block" data-act="learned">${icon('learned', 'sm')}Уже знаю — в изученные</button>
      <div class="swipe-hint">или смахни: ← ещё раз · помню →</div>`;
  } else {
    verdict = `<div class="verdict bad">${s.dontKnow ? 'Запоминай' : 'Неверно'} — вернётся в этой сессии</div>`;
    actions = `<button class="btn primary block" data-act="next">${icon('back', 'sm')}Дальше</button><div class="swipe-hint">или смахни влево</div>`;
  }

  return `
  <div class="study">
    <div class="study-top">
      <button class="icon-btn" data-act="exit" aria-label="Выйти из сессии">${icon('close', 'sm')}</button>
      <div class="counter">${Math.min(pos, s.total)} <span>/ ${s.total}</span></div>
      <div class="spacer"></div>
      <span class="tag pos">${esc(POS_ONE[w.pos] || '')}</span>
      <button class="icon-btn" data-act="undo" aria-label="Отменить последний ответ" ${s.history.length ? '' : 'disabled style="opacity:.35"'}>${icon('undo', 'sm')}</button>
    </div>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${s.total}" aria-valuenow="${s.done}"><i style="width:${pct}%"></i></div>
    <div class="stack">
      ${s.queue.length > 1 ? '<div class="stack-under" aria-hidden="true"></div>' : ''}
      <div class="flash ${s.state === 'result' ? 'revealed' : ''}" id="flash" style="--lc:${LV(lv)}">
        <div class="tint" id="tint"></div><div class="stamp r">Помню</div><div class="stamp l">Ещё раз</div>
        <div class="head">
          <div class="pos-l"><i></i>${LEVEL_NAMES[lv]}</div>
          <div class="prompt">${esc(w.ru)}</div>
          <div class="hint">${s.state === 'ask' ? (c && s.tense ? 'Напиши по-испански и проспрягай' : 'Напиши по-испански') : ''}</div>
        </div>
        <div class="ans">
          <input class="input ${mark(res && res.main)}" id="ans-main" aria-label="Ответ по-испански" placeholder="по-испански…" value="${res ? esc(s.mainInput) : ''}" autocomplete="off" autocapitalize="off" spellcheck="false" ${dis}>
          ${res && res.main === 'accent' ? `<div class="fix warn">с тильдами: ${esc(w.es)}</div>` : ''}
          ${conjHtml}
        </div>
        <div class="reveal ${s.state === 'result' ? 'open' : ''}" id="reveal"><div><div class="reveal-in">
          ${s.state === 'result' ? `<div class="answer-line">${esc(w.es)}</div>${verdict}
          ${w.examples.length ? w.examples.slice(0, 2).map(e => `<div class="ex"><div class="es">${esc(e.es)}</div><div class="ru">${esc(e.ru)}</div></div>`).join('') : ''}` : ''}
        </div></div></div>
      </div>
      <div class="study-actions">${actions}</div>
    </div>
  </div>`;
}

function renderDone() {
  const st = ui.session.stats;
  return `<div class="study"><div class="done">
    <div class="badge-ok seq" style="animation-delay:0ms">${icon('check')}</div>
    <h2 class="seq" style="animation-delay:120ms">¡Buen trabajo!</h2>
    <p class="muted seq" style="animation-delay:200ms;margin:0">Сессия закончена, прогресс сохранён.</p>
    <div class="done-stats">
      ${[['answered', 'пройдено карточек', 'var(--berry)'], ['correct', 'верных ответов', 'var(--mint)'], ['again', 'отправлено на повтор', 'var(--yellow)'], ['levelUps', 'сменили уровень', 'var(--blue)']]
        .map(([k, n, c], i) => `<div class="seq" style="--c:${c};animation-delay:${280 + i * 90}ms"><b data-count="${st[k]}">0</b><span>${n}</span></div>`).join('')}
    </div>
    <div class="btns seq" style="animation-delay:660ms">
      <button class="btn primary block" data-act="finish">На главную</button>
      ${counts().due + counts().fresh ? '<button class="btn block" data-act="more">Продолжить</button>' : ''}
    </div>
  </div></div>`;
}

function collectForm() {
  return {
    main: ($('#ans-main') || {}).value || '',
    forms: $$('[data-form]').map(i => i.value),
    tense: ui.session.tense,
  };
}

// Записываем снимок до изменения, чтобы отмена восстанавливала и данные, и очередь
function snapshot(w) {
  const s = ui.session;
  s.history.push({
    id: w.id, level: w.level, due: w.due, updated: w.updated,
    queue: [...s.queue], done: s.done, stats: { ...s.stats },
    result: s.result, mainInput: s.mainInput, tense: s.tense, dontKnow: s.dontKnow,
  });
  if (s.history.length > 30) s.history.shift();
}
function undo() {
  const s = ui.session; const h = s.history.pop(); if (!h) return;
  const w = db.words.find(x => x.id === h.id);
  if (w) { w.level = h.level; w.due = h.due; touch(w); save(); }
  s.queue = h.queue; s.done = h.done; s.stats = h.stats;
  s.current = h.id; s.state = 'result'; s.result = h.result; s.mainInput = h.mainInput; s.tense = h.tense; s.dontKnow = h.dontKnow;
  haptic('soft'); render();
  toast('Ответ отменён');
}

function decide(outcome, dir) {
  const s = ui.session; const w = currentWord();
  if (!w || s.state !== 'result' || s.busy) return;
  if (outcome !== 'wrong' && !s.result.allOk) return;
  s.busy = true;
  snapshot(w);
  const before = Math.min(w.level, LEARNED);
  s.stats.answered++;
  if (outcome === 'wrong') {
    applyResult(w, 'wrong');
    s.stats.again++;
    const id = s.queue.shift();
    const posn = Math.min(s.queue.length, 3 + Math.floor(Math.random() * 3));
    s.queue.splice(posn, 0, id);
    haptic('soft');
  } else {
    applyResult(w, outcome);
    s.stats.correct++;
    if (outcome === 'learned') s.stats.learned++;
    s.queue.shift(); s.done++;
    haptic('strong');
  }
  const after = Math.min(w.level, LEARNED);
  if (after !== before) { s.stats.levelUps++; levelFlag(before, after); }
  s.current = null;
  const go = () => { s.busy = false; if (!s.queue.length || !currentWord()) { haptic('success'); } render(); window.scrollTo(0, 0); };
  const card = $('#flash');
  if (card && dir && !reduceMotion()) {
    const x = dir > 0 ? window.innerWidth * 1.2 : -window.innerWidth * 1.2;
    card.style.transition = 'transform 260ms cubic-bezier(.4,0,.6,1), opacity 260ms';
    card.style.transform = `translateX(${x}px) rotate(${dir * 14}deg)`;
    card.style.opacity = '0';
    setTimeout(go, 240);
  } else go();
}
function levelFlag(a, b) {
  $$('.lv-flag').forEach(x => x.remove());
  const f = document.createElement('div');
  f.className = 'lv-flag';
  f.innerHTML = `<i style="background:${LV(a)}"></i>${LEVEL_NAMES[a]} → <i style="background:${LV(b)}"></i>${LEVEL_NAMES[b]}`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1500);
}

function bindStudy() {
  const s = ui.session;
  const act = (name, fn) => $$(`[data-act=${name}]`).forEach(b => b.addEventListener('click', fn));
  act('exit', popLayer);
  act('undo', undo);
  act('finish', popLayer);
  act('more', () => { ui.session = buildSession(); if (!ui.session.total) { ui.session = null; return popLayer(); } haptic('light'); render(); });
  if (!currentWord()) {
    $$('[data-count]').forEach((el, i) => countUp(el, +el.dataset.count, 320 + i * 90));
    return;
  }
  const check = dontKnow => {
    if (s.state !== 'ask') return;
    const f = dontKnow ? { main: '', forms: [], tense: s.tense } : collectForm();
    s.mainInput = f.main; s.dontKnow = !!dontKnow;
    s.result = checkAnswer(currentWord(), f); s.state = 'result';
    render();
    const card = $('#flash');
    if (s.result.allOk) { haptic('success'); card.classList.add('ok-glow'); setTimeout(() => card.classList.remove('ok-glow'), 340); }
    else { haptic(dontKnow ? 'soft' : 'error'); if (!dontKnow) { card.classList.add('shake'); setTimeout(() => card.classList.remove('shake'), 240); } }
  };
  act('check', () => check(false));
  act('dontknow', () => check(true));
  act('repeat', () => decide('repeat', 1));
  act('learned', () => decide('learned', 1));
  act('again', () => decide('wrong', -1));
  act('next', () => decide('wrong', -1));

  const inputs = $$('.ans .input:not([disabled])');
  inputs.forEach((inp, i) => inp.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (inputs[i + 1]) inputs[i + 1].focus(); else check(false);
  }));
  if (s.state === 'ask' && inputs[0]) setTimeout(() => inputs[0].focus({ preventScroll: true }), 30);
  bindSwipe();
}
function countUp(el, to, delay) {
  if (reduceMotion() || !to) { el.textContent = to; return; }
  setTimeout(() => {
    const t0 = performance.now(), dur = 520;
    const step = t => { const p = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }, delay);
}

// Свайп-стек: только после раскрытия, с порогом и без конфликта с вертикальной прокруткой
function bindSwipe() {
  const s = ui.session; const card = $('#flash'); if (!card) return;
  const surface = $('.study');
  const tint = $('#tint'), sr = $('.stamp.r', card), sl = $('.stamp.l', card);
  const canRight = () => s.state === 'result' && s.result.allOk;
  const canLeft = () => s.state === 'result';
  const TH = Math.min(90, window.innerWidth * 0.21);
  let x0 = 0, y0 = 0, dx = 0, active = false, decided = null, crossed = false, id = null;
  // Тянуть можно за любую точку экрана, кроме кнопок и полей
  surface.addEventListener('pointerdown', e => {
    if (s.state !== 'result' || e.target.closest('button, input, a')) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; active = true; decided = null; crossed = false; id = e.pointerId;
  });
  surface.addEventListener('pointermove', e => {
    if (!active || e.pointerId !== id) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = Math.abs(mx) > Math.abs(my) * 1.3 ? 'x' : 'y';
      if (decided === 'y') { active = false; return; }
      surface.setPointerCapture(id); card.classList.add('dragging');
    }
    dx = mx;
    if (dx > 0 && !canRight()) dx = dx * 0.25;
    if (dx < 0 && !canLeft()) dx = dx * 0.25;
    const rot = reduceMotion() ? 0 : dx / 22;
    card.style.transform = `translateX(${dx}px) rotate(${rot}deg)`;
    const k = Math.min(1, Math.abs(dx) / TH);
    tint.style.background = dx > 0 ? 'var(--mint)' : 'var(--pink)';
    tint.style.opacity = (k * 0.14).toFixed(3);
    sr.style.opacity = dx > 0 && canRight() ? k : 0;
    sl.style.opacity = dx < 0 ? k : 0;
    const over = (dx > TH && canRight()) || (dx < -TH && canLeft());
    if (over && !crossed) { crossed = true; haptic('soft'); }
    if (!over) crossed = false;
  });
  const release = e => {
    if (!active || (e && e.pointerId !== id)) return;
    active = false; card.classList.remove('dragging');
    if (dx > TH && canRight()) return decide('repeat', 1);
    if (dx < -TH && canLeft()) return decide('wrong', -1);
    card.style.transition = 'transform 320ms var(--spring)';
    card.style.transform = '';
    tint.style.opacity = 0; sr.style.opacity = 0; sl.style.opacity = 0;
    setTimeout(() => { card.style.transition = ''; }, 330);
  };
  surface.addEventListener('pointerup', release);
  surface.addEventListener('pointercancel', release);
}
document.addEventListener('keydown', e => {
  if (!ui.studying || !ui.session || ui.session.state !== 'result' || e.key !== 'Enter') return;
  e.preventDefault();
  ui.session.result.allOk ? decide('repeat', 1) : decide('wrong', -1);
});

// ==========================================================
// Обновления: сравниваем свою сборку с последним релизом на GitHub
// ==========================================================
const APK_URL = 'https://github.com/metulaimmensa/verba/releases/latest/download/verba.apk';
const update = { build: null, remote: null, available: false, checked: false, error: false };
function updateText() {
  if (!update.build) return 'Сборка без отметки версии (браузер или старая установка)';
  const d = new Date(update.build.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  if (update.available) return `У тебя сборка от ${d}. На GitHub есть новее.`;
  if (update.error) return `Сборка от ${d}. Проверить обновления не вышло — нет сети?`;
  return update.checked ? `Сборка от ${d}. Это последняя версия.` : `Сборка от ${d}. Проверяю обновления…`;
}
async function checkUpdate() {
  try {
    const r = await fetch('build.json', { cache: 'no-store' });
    if (r.ok) update.build = await r.json();
  } catch (e) { /* сборка из браузера */ }
  try {
    const r = await fetch('https://api.github.com/repos/metulaimmensa/verba/releases/tags/latest', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const rel = await r.json();
    const m = /build:\s*([0-9a-f]{7,40})/.exec(rel.body || '');
    update.remote = m ? m[1].slice(0, 7) : null;
    update.available = !!(update.build && update.remote && update.remote !== update.build.sha);
  } catch (e) { update.error = true; }
  update.checked = true;
  if (!ui.studying && (ui.tab === 'home' || ui.tab === 'settings')) {
    if (ui.tab === 'settings') { const el = $('#upd-status'); if (el) el.textContent = updateText(); if (update.available) render(); }
    else if (update.available) render();
  }
}

// ==========================================================
// Синхронизация с приватным репозиторием (формат не менялся)
// ==========================================================
async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${db.settings.token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}
const b64encode = s => btoa(unescape(encodeURIComponent(s)));
const b64decode = s => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));

let syncing = false;
async function sync() {
  if (syncing) return;
  if (!db.settings.token) { goTab('settings'); toast('Сначала вставь GitHub-токен'); return; }
  syncing = true;
  const btn = $('#sync-btn'); if (btn) { btn.disabled = true; btn.classList.add('spin'); }
  try {
    const remoteFile = await gh(DATA_FILE);
    let remote = { words: [], deleted: [] };
    if (remoteFile) remote = JSON.parse(b64decode(remoteFile.content));
    const deleted = new Set([...(db.deleted || []), ...(remote.deleted || [])]);
    const map = new Map();
    for (const w of [...remote.words, ...db.words]) {
      if (deleted.has(w.id)) continue;
      const cur = map.get(w.id);
      if (!cur || (w.updated || 0) > (cur.updated || 0)) map.set(w.id, w);
    }
    db.words = [...map.values()];
    db.deleted = [...deleted];
    if (remote.tenses) db.tenses = [...new Set([...db.tenses, ...remote.tenses])];
    const body = JSON.stringify({ words: db.words, deleted: db.deleted, tenses: db.tenses, updated: Date.now() }, null, 1);
    await gh(DATA_FILE, {
      method: 'PUT',
      body: JSON.stringify({ message: 'Синхронизация из приложения', content: b64encode(body), sha: remoteFile ? remoteFile.sha : undefined }),
    });
    db.settings.lastSync = Date.now(); save();
    haptic('success');
    if (!ui.studying) render();
    toast(`Синхронизировано: ${db.words.length} ${plural(db.words.length, 'слово', 'слова', 'слов')}`);
  } catch (err) {
    haptic('error');
    toast('Ошибка синхронизации: ' + err.message);
  } finally {
    syncing = false;
    const b = $('#sync-btn'); if (b) { b.disabled = false; b.classList.remove('spin'); }
  }
}

// ==========================================================
// Навигация и старт
// ==========================================================
function bindCommon() {
  $$('[data-go]').forEach(b => b.addEventListener('click', () => goTab(b.dataset.go)));
}
function goTab(tab) {
  unwindLayers(() => {
    if (tab === 'dict') ui.dict = freshDict();
    ui.tab = tab;
    render({ animate: true });
    window.scrollTo(0, 0);
  });
}

$$('.nav [data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
$$('.nav-btn[data-tab]').forEach(b => b.addEventListener('click', () => {
  haptic('light');
  if (ui.tab === b.dataset.tab && !layers.length) { window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); return; }
  goTab(b.dataset.tab);
}));
$('#nav-study').addEventListener('click', startStudy);
// Системная кнопка «Назад»: закрывает верхний слой, потом ведёт на главную, потом выходит
if (isNative) {
  try {
    Cap.addListener('App', 'backButton', () => {
      if (layers.length) popLayer();
      else if (ui.tab !== 'home') goTab('home');
      else nativeCall('App', 'exitApp');
    });
  } catch (e) { /* без плагина App */ }
}
window.addEventListener('scroll', () => { const t = $('#top'); if (t) t.classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });
if (reduceMotion()) document.documentElement.classList.add('reduce-motion');

// Первый запуск: подхватываем слова, вшитые в сборку
(async () => {
  if (!db.words.length) {
    try {
      const r = await fetch('data/seed.json');
      if (r.ok) { const seed = await r.json(); db.words = seed.words || []; save(); }
    } catch (e) { /* без сида */ }
  }
  render();
  checkUpdate();
})();
