// Verba — словарь и карточки с интервальным повторением.
'use strict';

// ---------- Константы ----------
const POS = {
  verb: 'Глаголы', noun: 'Существительные', adj: 'Прилагательные',
  expr: 'Выражения', prep: 'Предлоги',
};
// Уровни: 0 — новое, 1..4 — повторение, 5 — изучено. Интервал в днях после верного ответа.
const INTERVALS = [0, 1, 3, 7, 16];
const LEARNED = 5;
const LAST_LEVEL = 4;
const LEVEL_NAMES = ['Новое', 'Уровень 1', 'Уровень 2', 'Уровень 3', 'Уровень 4', 'Изучено'];
const LEVEL_COLORS = ['#6d6458', '#c9785b', '#d99a4e', '#d9bf5a', '#9cbf62', '#5f9e7a'];
const STORE_KEY = 'verba.v1';
const DATA_REPO = 'metulaimmensa/verba-data';
const DATA_FILE = 'words.json';

// ---------- Состояние ----------
let db = load();
let ui = { tab: 'study', dictPos: 'all', dictQuery: '', session: null };

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* пусто */ }
  return { words: [], tenses: ['presente', 'continuo'], settings: { token: '', newPerSession: 10 }, deleted: [] };
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { toast('Не удалось сохранить'); } }

// ---------- Утилиты ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const stripAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = s => s.toLowerCase().trim().replace(/[¡!¿?.,;]/g, '').replace(/\s+/g, ' ');

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}

function dueLabel(w) {
  if (w.level >= LEARNED) return 'изучено';
  if (w.level === 0) return 'новое';
  const diff = Math.round((new Date(w.due) - new Date(today())) / 86400000);
  if (diff <= 0) return 'сейчас';
  if (diff === 1) return 'завтра';
  return `через ${diff} дн.`;
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

// ---------- Слова ----------
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
    // Ручные формы из данных имеют приоритет над движком
    for (const t of Object.keys(w.conj)) {
      if (c.tenses[t]) c.tenses[t] = c.tenses[t].map((f, i) => ({ ...f, form: w.conj[t][i] || f.form }));
    }
  }
  if (rest) {
    for (const t of Object.keys(c.tenses)) c.tenses[t] = c.tenses[t].map(f => ({ ...f, form: `${f.form} ${rest}`, alt: f.alt ? `${f.alt} ${rest}` : null }));
  }
  return c;
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

// ---------- Сессия изучения ----------
function buildSession() {
  const t = today();
  const due = db.words.filter(w => w.level > 0 && w.level < LEARNED && w.due <= t);
  const fresh = db.words.filter(w => w.level === 0).slice(0, db.settings.newPerSession);
  const queue = shuffle([...due, ...fresh]).map(w => w.id);
  return { queue, total: queue.length, done: 0, current: null, state: 'ask', result: null };
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function checkAnswer(w, form) {
  const res = { main: compare(form.main, w.es), forms: [], tense: null };
  const c = conjFor(w);
  if (c) {
    // Каждый раз спрашиваем одно из включённых времён, по очереди
    const tenses = db.tenses.filter(t => c.tenses[t]);
    res.tense = form.tense;
    const expected = c.tenses[res.tense];
    res.forms = expected.map((f, i) => {
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
    if (w.level === 0) w.level = 0;
    w.due = today();
  }
  touch(w); save();
}

// ---------- Рендер ----------
function render() {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  const v = $('#view');
  if (ui.tab === 'study') v.innerHTML = ui.session ? renderCard() : renderStudyHome();
  if (ui.tab === 'dict') v.innerHTML = renderDict();
  if (ui.tab === 'add') v.innerHTML = renderAdd();
  if (ui.tab === 'settings') v.innerHTML = renderSettings();
  bind();
}

function renderStudyHome() {
  const t = today();
  const due = db.words.filter(w => w.level > 0 && w.level < LEARNED && w.due <= t).length;
  const fresh = Math.min(db.words.filter(w => w.level === 0).length, db.settings.newPerSession);
  const learned = db.words.filter(w => w.level >= LEARNED).length;
  const counts = LEVEL_NAMES.map((_, i) => db.words.filter(w => Math.min(w.level, LEARNED) === i).length);
  const total = db.words.length || 1;
  const fill = db.words.filter(w => w.needsFill).length;
  return `
    <h2>Сегодня</h2>
    <div class="stats">
      <div class="stat"><b>${due}</b><span>повторить</span></div>
      <div class="stat"><b>${fresh}</b><span>новых</span></div>
      <div class="stat"><b>${learned}</b><span>изучено</span></div>
    </div>
    <div class="card">
      <div class="small muted">Слов всего: ${db.words.length}</div>
      <div class="levels">${counts.map((n, i) => `<i style="width:${n / total * 100}%;background:${LEVEL_COLORS[i]}"></i>`).join('')}</div>
      <div class="small muted">${counts.map((n, i) => n ? `${LEVEL_NAMES[i]}: ${n}` : '').filter(Boolean).join(' · ')}</div>
    </div>
    <button class="btn primary block" data-act="start" ${due + fresh ? '' : 'disabled'}>Начать — ${due + fresh} карт.</button>
    ${fill ? `<p class="small muted" style="margin-top:14px">${fill} слов ждут дозаполнения (перевод, примеры). Напиши Claude «дозаполни Verba».</p>` : ''}
    ${!db.words.length ? `<div class="empty"><b>Пока пусто</b>Подтяни слова в настройках или добавь первое.</div>` : ''}
  `;
}

function renderCard() {
  const s = ui.session;
  if (!s.queue.length) {
    return `<div class="empty"><b>Готово</b>Пройдено карточек: ${s.done}.<br><br>
      <button class="btn primary" data-act="finish">На главную</button></div>`;
  }
  const w = db.words.find(x => x.id === s.queue[0]);
  if (!w) { s.queue.shift(); return renderCard(); }
  const c = conjFor(w);
  if (s.current !== w.id) {
    s.current = w.id; s.state = 'ask'; s.result = null;
    const tenses = c ? db.tenses.filter(t => c.tenses[t]) : [];
    s.tense = tenses.length ? tenses[Math.floor(Math.random() * tenses.length)] : null;
  }
  const res = s.result;
  const pct = s.total ? (s.done / s.total) * 100 : 0;
  const mark = r => r ? (r === 'ok' ? 'right' : r === 'accent' ? 'accent' : 'wrong') : '';
  const disabled = s.state === 'ask' ? '' : 'disabled';

  let conjHtml = '';
  if (c && s.tense) {
    const rows = c.tenses[s.tense];
    conjHtml = `<div class="small muted" style="margin-top:16px;text-align:left">${TENSE_LABELS[s.tense]}</div>
      <div class="conj">${rows.map((f, i) => {
        const r = res && res.forms[i];
        const val = r ? esc(r.got) : '';
        return `<label>${esc(f.person)}</label><input class="answer ${mark(r && r.r)}" data-form="${i}" value="${val}" autocomplete="off" autocapitalize="off" spellcheck="false" ${disabled}>
          ${r && r.r !== 'ok' ? `<div class="fix ${r.r === 'bad' ? 'bad' : 'warn'}">${esc(r.expected)}</div>` : ''}`;
      }).join('')}</div>`;
  }

  let footer;
  if (s.state === 'ask') {
    footer = `<button class="btn primary block" data-act="check" style="margin-top:16px">Проверить</button>
      <button class="btn ghost block" data-act="dontknow" style="margin-top:8px">Не помню</button>`;
  } else if (res.allOk) {
    footer = `<div class="verdict ok">Верно${res.hasAccent ? ' — но проверь тильды' : ''}</div>
      <div class="row"><button class="btn" data-act="repeat">Буду повторять</button><button class="btn ok" data-act="learned">Изучил</button></div>`;
  } else {
    footer = `<div class="verdict bad">Неверно — вернётся в этой сессии</div>
      <button class="btn primary block" data-act="next">Дальше</button>`;
  }

  return `
    <div class="progress"><i style="width:${pct}%"></i></div>
    <div class="card flash">
      <div class="pos">${esc(POS[w.pos] || '')}</div>
      <div class="prompt">${esc(w.ru)}</div>
      <div class="lvl">${LEVEL_NAMES[Math.min(w.level, LEARNED)]} · осталось ${s.queue.length}</div>
    </div>
    <input class="answer ${mark(res && res.main)}" id="ans-main" placeholder="По-испански…" value="${res ? esc(s.mainInput) : ''}" autocomplete="off" autocapitalize="off" spellcheck="false" ${disabled}>
    ${res && res.main !== 'ok' ? `<div class="fix ${res.main === 'bad' ? 'bad' : 'warn'}" style="margin-left:4px">${esc(w.es)}</div>` : ''}
    ${conjHtml}
    ${footer}
    ${res && w.examples.length ? `<div style="margin-top:16px">${w.examples.slice(0, 2).map(e => `<div class="ex"><div>${esc(e.es)}</div><div class="ru">${esc(e.ru)}</div></div>`).join('')}</div>` : ''}
  `;
}

function renderDict() {
  const q = stripAccents(ui.dictQuery.toLowerCase());
  const list = db.words
    .filter(w => ui.dictPos === 'all' || w.pos === ui.dictPos)
    .filter(w => !q || stripAccents((w.es + ' ' + w.ru).toLowerCase()).includes(q))
    .sort((a, b) => a.es.localeCompare(b.es, 'es'));
  const chips = [['all', 'Все'], ...Object.entries(POS)];
  return `
    <input class="search" id="dict-q" placeholder="Поиск по-испански или по-русски" value="${esc(ui.dictQuery)}">
    <div class="chips">${chips.map(([k, n]) => `<button class="chip ${ui.dictPos === k ? 'active' : ''}" data-pos="${k}">${n}</button>`).join('')}</div>
    <div class="small muted" style="margin:4px 2px 10px">${list.length} слов</div>
    ${list.map(w => `
      <div class="word-item" data-word="${w.id}">
        <div class="bar" style="background:${LEVEL_COLORS[Math.min(w.level, LEARNED)]}"></div>
        <div class="w"><div class="es">${esc(w.es)}${w.needsFill ? '<span class="tag">дозаполнить</span>' : ''}</div><div class="ru">${esc(w.ru)}</div></div>
        <div class="due">${dueLabel(w)}</div>
      </div>`).join('') || '<div class="empty">Ничего не нашлось</div>'}
  `;
}

function renderDetail(w) {
  const c = conjFor(w);
  const conjHtml = c ? db.tenses.filter(t => c.tenses[t]).map(t => `
      <h3>${TENSE_LABELS[t]}</h3>
      <table class="ctab">${c.tenses[t].map(f => `<tr><td>${esc(f.person)}</td><td>${esc(f.form)}${f.alt ? `<div class="small muted">${esc(f.alt)}</div>` : ''}</td></tr>`).join('')}</table>`).join('') : '';
  return `
    <div class="sheet" data-act="close-sheet"><div class="panel" data-stop>
      <div class="small muted">${esc(POS[w.pos])}${w.lesson ? ' · ' + esc(w.lesson) : ''}</div>
      <p class="big-es">${esc(w.es)}</p>
      <div style="font-size:18px;margin-top:4px">${esc(w.ru)}</div>
      <div class="small muted" style="margin-top:6px">${LEVEL_NAMES[Math.min(w.level, LEARNED)]} · ${dueLabel(w)}</div>
      ${w.examples.length ? `<h3>Примеры</h3>${w.examples.map(e => `<div class="ex"><div>${esc(e.es)}</div><div class="ru">${esc(e.ru)}</div></div>`).join('')}` : ''}
      ${conjHtml}
      ${w.notes ? `<h3>Заметка</h3><div class="small">${esc(w.notes)}</div>` : ''}
      <h3>Уровень</h3>
      <div class="chips">${LEVEL_NAMES.map((n, i) => `<button class="chip ${Math.min(w.level, LEARNED) === i ? 'active' : ''}" data-setlevel="${i}" data-id="${w.id}">${n}</button>`).join('')}</div>
      <div class="row" style="margin-top:14px">
        <button class="btn" data-act="close-sheet">Закрыть</button>
        <button class="btn ghost" data-del="${w.id}" style="color:var(--bad)">Удалить</button>
      </div>
    </div></div>`;
}

function renderAdd() {
  return `
    <h2>Новое слово</h2>
    <label class="field"><span>По-испански</span><input id="f-es" autocapitalize="off" spellcheck="false"></label>
    <label class="field"><span>Перевод</span><input id="f-ru"></label>
    <label class="field"><span>Раздел</span><select id="f-pos">${Object.entries(POS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
    <label class="field"><span>Примеры (необязательно): строка по-испански, следующая — перевод</span><textarea id="f-ex" placeholder="Tengo que trabajar.&#10;Мне надо работать."></textarea></label>
    <div id="f-preview"></div>
    <button class="btn primary block" data-act="save-word">Добавить</button>
    <p class="small muted" style="margin-top:12px">Без примеров слово ляжет с пометкой «дозаполнить», Claude допишет при следующей синхронизации. Спряжение глаголов строится само.</p>
  `;
}

function renderSettings() {
  const last = db.settings.lastSync ? new Date(db.settings.lastSync).toLocaleString('ru-RU') : 'никогда';
  const allTenses = Object.keys(TENSE_LABELS);
  return `
    <h2>Настройки</h2>
    <h3>Синхронизация</h3>
    <label class="field"><span>GitHub-токен (доступ к ${DATA_REPO})</span><input id="s-token" type="password" value="${esc(db.settings.token)}" autocomplete="off"></label>
    <div class="row"><button class="btn primary" data-act="save-token">Сохранить</button><button class="btn" data-act="sync">Синхронизировать</button></div>
    <p class="small muted">Последняя синхронизация: ${last}</p>
    <h3>Сессия</h3>
    <label class="field"><span>Новых слов за сессию</span><input id="s-new" type="number" min="0" max="100" value="${db.settings.newPerSession}"></label>
    <h3>Времена глаголов</h3>
    ${allTenses.map(t => `<label class="field" style="display:flex;gap:10px;align-items:center"><input type="checkbox" data-tense="${t}" ${db.tenses.includes(t) ? 'checked' : ''} style="width:auto"> ${TENSE_LABELS[t]}</label>`).join('')}
    <p class="small muted">Включаешь новое время — все глаголы уходят на последний уровень повторения.</p>
    <h3>Данные</h3>
    <div class="row"><button class="btn" data-act="export">Экспорт JSON</button></div>
  `;
}

// ---------- События ----------
function bind() {
  const v = $('#view');
  v.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', onAct));
  v.querySelectorAll('[data-pos]').forEach(el => el.addEventListener('click', () => { ui.dictPos = el.dataset.pos; render(); }));
  v.querySelectorAll('[data-word]').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.word)));
  const q = $('#dict-q');
  if (q) q.addEventListener('input', () => { ui.dictQuery = q.value; const pos = q.selectionStart; render(); const n = $('#dict-q'); n.focus(); n.setSelectionRange(pos, pos); });
  const main = $('#ans-main');
  if (main && !main.disabled) {
    main.focus();
    v.querySelectorAll('input.answer').forEach((inp, i, all) => inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (all[i + 1]) all[i + 1].focus(); else onAct({ currentTarget: { dataset: { act: 'check' } } }); }
    }));
  }
  const nw = $('#s-new');
  if (nw) nw.addEventListener('change', () => { db.settings.newPerSession = Math.max(0, +nw.value || 0); save(); });
  v.querySelectorAll('[data-tense]').forEach(el => el.addEventListener('change', () => {
    if (el.checked) { enableTense(el.dataset.tense); toast('Время добавлено, глаголы — на последний уровень'); }
    else { db.tenses = db.tenses.filter(t => t !== el.dataset.tense); save(); }
  }));
  const fes = $('#f-es'), fpos = $('#f-pos');
  if (fes) {
    const prev = () => {
      const p = $('#f-preview');
      if (fpos.value !== 'verb' || !fes.value.trim()) { p.innerHTML = ''; return; }
      const c = conjugate(fes.value.trim().split(/\s+/)[0]);
      p.innerHTML = c ? `<div class="card small"><span class="muted">Спряжение:</span> ${c.tenses.presente.map(f => esc(f.form)).join(', ')}</div>` : '';
    };
    fes.addEventListener('input', prev); fpos.addEventListener('change', prev);
  }
}

function openDetail(id) {
  const w = db.words.find(x => x.id === id); if (!w) return;
  const wrap = document.createElement('div'); wrap.innerHTML = renderDetail(w);
  const sheet = wrap.firstElementChild; document.body.appendChild(sheet);
  sheet.addEventListener('click', e => {
    if (e.target.closest('[data-setlevel]')) {
      const b = e.target.closest('[data-setlevel]'); const lv = +b.dataset.setlevel;
      w.level = lv; w.due = lv >= LEARNED ? '' : lv === 0 ? today() : addDays(today(), INTERVALS[lv]); touch(w); save();
      sheet.remove(); openDetail(id); render(); return;
    }
    if (e.target.closest('[data-del]')) {
      if (confirm(`Удалить «${w.es}»?`)) { db.words = db.words.filter(x => x.id !== id); (db.deleted ||= []).push(id); save(); sheet.remove(); render(); }
      return;
    }
    if (e.target.dataset.act === 'close-sheet' || !e.target.closest('[data-stop]')) sheet.remove();
  });
}

function collectForm() {
  return {
    main: ($('#ans-main') || {}).value || '',
    forms: [...document.querySelectorAll('[data-form]')].map(i => i.value),
    tense: ui.session.tense,
  };
}

function onAct(e) {
  const act = e.currentTarget.dataset.act;
  const s = ui.session;
  const w = s && db.words.find(x => x.id === s.queue[0]);
  switch (act) {
    case 'start': ui.session = buildSession(); render(); break;
    case 'finish': ui.session = null; render(); break;
    case 'check':
    case 'dontknow': {
      if (!w || s.state !== 'ask') return;
      const f = act === 'dontknow' ? { main: '', forms: [], tense: s.tense } : collectForm();
      s.mainInput = f.main;
      s.result = checkAnswer(w, f); s.state = 'result'; render(); break;
    }
    case 'repeat':
    case 'learned':
      applyResult(w, act); s.queue.shift(); s.done++; s.current = null; render(); break;
    case 'next': {
      applyResult(w, 'wrong');
      // Вернуть слово через 3–5 карточек
      const id = s.queue.shift(); const pos = Math.min(s.queue.length, 3 + Math.floor(Math.random() * 3));
      s.queue.splice(pos, 0, id); s.current = null; render(); break;
    }
    case 'save-word': {
      const es = $('#f-es').value.trim(), ru = $('#f-ru').value.trim();
      if (!es || !ru) { toast('Нужны слово и перевод'); return; }
      const lines = $('#f-ex').value.split('\n').map(l => l.trim()).filter(Boolean);
      const examples = []; for (let i = 0; i < lines.length; i += 2) examples.push({ es: lines[i], ru: lines[i + 1] || '' });
      if (db.words.some(x => norm(x.es) === norm(es))) { toast('Такое слово уже есть'); return; }
      addWord({ es, ru, pos: $('#f-pos').value, examples });
      toast(`«${es}» добавлено`); render(); break;
    }
    case 'save-token': db.settings.token = $('#s-token').value.trim(); save(); toast('Токен сохранён'); break;
    case 'sync': sync(); break;
    case 'export': {
      const blob = new Blob([JSON.stringify(db.words, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'verba-words.json'; a.click(); break;
    }
  }
}

// ---------- Синхронизация с приватным репозиторием ----------
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

async function sync() {
  if (!db.settings.token) { ui.tab = 'settings'; render(); toast('Сначала вставь GitHub-токен'); return; }
  const btn = $('#btn-sync'); btn.classList.add('spin');
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
    db.settings.lastSync = Date.now(); save(); render();
    toast(`Синхронизировано: ${db.words.length} слов`);
  } catch (err) {
    toast('Ошибка синхронизации: ' + err.message);
  } finally { btn.classList.remove('spin'); }
}

// ---------- Старт ----------
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { ui.tab = b.dataset.tab; render(); }));
$('#btn-sync').addEventListener('click', sync);

// Первый запуск: подхватываем слова, вшитые в сборку
(async () => {
  if (!db.words.length) {
    try {
      const r = await fetch('data/seed.json');
      if (r.ok) { const seed = await r.json(); db.words = seed.words || []; save(); }
    } catch (e) { /* без сида */ }
  }
  render();
})();
