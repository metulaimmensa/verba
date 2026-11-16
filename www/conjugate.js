// Verba — офлайн-спряжение испанских глаголов.
// Сейчас: presente de indicativo + gerundio (одна форма).
// Новые времена добавляются отдельными функциями в TENSES.

const PERSONS = ['yo', 'tú', 'él/ella/usted', 'nosotros', 'vosotros', 'ellos/ustedes'];
const REFL = ['me', 'te', 'se', 'nos', 'os', 'se'];

// Полностью неправильные в настоящем
const IRREGULAR_PRESENT = {
  ser: ['soy', 'eres', 'es', 'somos', 'sois', 'son'],
  estar: ['estoy', 'estás', 'está', 'estamos', 'estáis', 'están'],
  ir: ['voy', 'vas', 'va', 'vamos', 'vais', 'van'],
  haber: ['he', 'has', 'ha', 'hemos', 'habéis', 'han'],
  tener: ['tengo', 'tienes', 'tiene', 'tenemos', 'tenéis', 'tienen'],
  venir: ['vengo', 'vienes', 'viene', 'venimos', 'venís', 'vienen'],
  decir: ['digo', 'dices', 'dice', 'decimos', 'decís', 'dicen'],
  oír: ['oigo', 'oyes', 'oye', 'oímos', 'oís', 'oyen'],
  dar: ['doy', 'das', 'da', 'damos', 'dais', 'dan'],
  ver: ['veo', 'ves', 've', 'vemos', 'veis', 'ven'],
  reír: ['río', 'ríes', 'ríe', 'reímos', 'reís', 'ríen'],
  sonreír: ['sonrío', 'sonríes', 'sonríe', 'sonreímos', 'sonreís', 'sonríen'],
  freír: ['frío', 'fríes', 'fríe', 'freímos', 'freís', 'fríen'],
  oler: ['huelo', 'hueles', 'huele', 'olemos', 'oléis', 'huelen'],
  jugar: ['juego', 'juegas', 'juega', 'jugamos', 'jugáis', 'juegan'],
  caber: ['quepo', 'cabes', 'cabe', 'cabemos', 'cabéis', 'caben'],
};

// Неправильная только форма yo
const IRREGULAR_YO = {
  hacer: 'hago', poner: 'pongo', salir: 'salgo', traer: 'traigo', caer: 'caigo',
  valer: 'valgo', saber: 'sé', conocer: 'conozco', parecer: 'parezco',
  ofrecer: 'ofrezco', agradecer: 'agradezco', crecer: 'crezco', merecer: 'merezco',
  obedecer: 'obedezco', pertenecer: 'pertenezco', desaparecer: 'desaparezco',
  nacer: 'nazco', conducir: 'conduzco', traducir: 'traduzco', producir: 'produzco',
  reducir: 'reduzco', introducir: 'introduzco', proteger: 'protejo', coger: 'cojo',
  escoger: 'escojo', recoger: 'recojo', dirigir: 'dirijo', exigir: 'exijo',
  vencer: 'venzo', convencer: 'convenzo', distinguir: 'distingo',
  componer: 'compongo', proponer: 'propongo', suponer: 'supongo', disponer: 'dispongo',
  deshacer: 'deshago', satisfacer: 'satisfago', atraer: 'atraigo', distraer: 'distraigo',
};

const STEM = {
  ie: ['cerrar', 'comenzar', 'empezar', 'pensar', 'despertar', 'sentar', 'querer',
    'entender', 'perder', 'preferir', 'sentir', 'mentir', 'divertir', 'advertir',
    'consentir', 'defender', 'encender', 'gobernar', 'nevar', 'recomendar', 'calentar',
    'negar', 'fregar', 'regar', 'confesar', 'atravesar', 'merendar', 'apretar',
    'tropezar', 'sugerir', 'convertir', 'herir', 'hervir', 'atender', 'extender',
    'descender', 'tender', 'manifestar', 'despertarse', 'sentarse', 'divertirse'],
  ue: ['contar', 'costar', 'encontrar', 'mostrar', 'probar', 'recordar', 'soñar',
    'volar', 'acostar', 'aprobar', 'almorzar', 'colgar', 'rogar', 'volver', 'mover',
    'poder', 'llover', 'doler', 'morder', 'resolver', 'devolver', 'envolver', 'dormir',
    'morir', 'soler', 'torcer', 'reforzar', 'demostrar', 'sonar', 'tostar', 'renovar',
    'promover', 'acordar', 'consolar', 'forzar', 'apostar', 'comprobar', 'resolver'],
  i: ['pedir', 'servir', 'repetir', 'vestir', 'medir', 'seguir', 'conseguir',
    'perseguir', 'corregir', 'elegir', 'despedir', 'impedir', 'competir', 'rendir',
    'gemir', 'expedir'],
};

// Ударение на i/u в корне (enviar → envío)
const ACCENT_I = ['enviar', 'confiar', 'esquiar', 'fiar', 'vaciar', 'criar', 'guiar',
  'desviar', 'variar', 'ampliar', 'resfriar', 'espiar', 'liar'];
const ACCENT_U = ['continuar', 'actuar', 'graduar', 'evaluar', 'situar', 'acentuar', 'valuar'];

function stemType(base) {
  for (const t of ['ie', 'ue', 'i']) if (STEM[t].includes(base)) return t;
  return null;
}

// Меняет последнюю гласную корня, которая подходит под смену
function changeStem(stem, type) {
  const target = type === 'ie' || type === 'i' ? 'e' : 'o';
  const idx = stem.lastIndexOf(target);
  if (idx < 0) return stem;
  let repl = type;
  // errar/oler — редкие случаи в IRREGULAR_PRESENT
  return stem.slice(0, idx) + repl + stem.slice(idx + 1);
}

function splitReflexive(verb) {
  const v = verb.trim().toLowerCase();
  if (/(ar|er|ir|ír)se$/.test(v)) return { base: v.slice(0, -2), reflexive: true };
  return { base: v, reflexive: false };
}

function presentForms(base) {
  if (IRREGULAR_PRESENT[base]) return [...IRREGULAR_PRESENT[base]];

  // составные с неправильными: obtener, mantener, prevenir, convenir...
  for (const root of ['tener', 'venir', 'decir', 'hacer', 'poner']) {
    if (base !== root && base.endsWith(root) && (root === 'tener' || root === 'venir' || root === 'decir')) {
      const pre = base.slice(0, -root.length);
      return IRREGULAR_PRESENT[root].map(f => pre + f).map(f => fixCompoundAccent(f, root));
    }
  }

  const ending = base.slice(-2).replace('ír', 'ir');
  let stem = base.slice(0, -2);
  const endings = {
    ar: ['o', 'as', 'a', 'amos', 'áis', 'an'],
    er: ['o', 'es', 'e', 'emos', 'éis', 'en'],
    ir: ['o', 'es', 'e', 'imos', 'ís', 'en'],
  }[ending];
  if (!endings) return null;

  // -uir (construir): вставляем y, кроме nosotros/vosotros
  if (ending === 'ir' && stem.endsWith('u') && !stem.endsWith('gu') && !stem.endsWith('qu')) {
    return endings.map((e, i) => (i === 3 || i === 4) ? stem + e : stem + 'y' + e);
  }

  const type = stemType(base);
  const forms = endings.map((e, i) => {
    let s = stem;
    if (type && i !== 3 && i !== 4) s = changeStem(stem, type);
    if (ACCENT_I.includes(base) && i !== 3 && i !== 4) s = s.replace(/i$/, 'í');
    if (ACCENT_U.includes(base) && i !== 3 && i !== 4) s = s.replace(/u$/, 'ú');
    return s + e;
  });

  // форма yo: неправильная или орфографическая
  if (IRREGULAR_YO[base]) forms[0] = IRREGULAR_YO[base];
  else {
    if (base.endsWith('guir')) forms[0] = forms[0].replace(/guo$/, 'go');
    else if (/[gG](er|ir)$/.test(base)) forms[0] = forms[0].replace(/go$/, 'jo');
    else if (/[aeiou]c(er|ir)$/.test(base) && !['hacer', 'decir', 'mecer', 'cocer'].includes(base)) {
      forms[0] = forms[0].replace(/co$/, 'zco');
    } else if (/[^aeiou]c(er|ir)$/.test(base)) forms[0] = forms[0].replace(/co$/, 'zo');
  }
  // tener/venir-подобные уже обработаны; соединяем смену корня с -go у seguir и т. п.
  return forms;
}

function fixCompoundAccent(form, root) {
  // obtener: obtienes / obtén — в настоящем ударения как у корня, кроме 'decir' (predecir ок)
  return form;
}

function gerund(base) {
  const special = {
    ir: 'yendo', poder: 'pudiendo', decir: 'diciendo', venir: 'viniendo',
    reír: 'riendo', sonreír: 'sonriendo', freír: 'friendo', oír: 'oyendo',
    dormir: 'durmiendo', morir: 'muriendo', ser: 'siendo', ver: 'viendo',
    leer: 'leyendo', creer: 'creyendo', traer: 'trayendo', caer: 'cayendo',
    construir: 'construyendo', huir: 'huyendo',
  };
  if (special[base]) return special[base];
  for (const root of ['decir', 'venir', 'traer', 'caer']) {
    if (base.endsWith(root) && base !== root) return base.slice(0, -root.length) + special[root];
  }
  const ending = base.slice(-2);
  let stem = base.slice(0, -2);
  if (ending === 'ar') return stem + 'ando';
  // -ir со сменой корня e→ie / e→i: e→i в герундии; o→ue: o→u
  if (ending === 'ir' || ending === 'ír') {
    const t = stemType(base);
    if (t === 'ie' || t === 'i') stem = changeStem(stem, 'i');
    if (t === 'ue') { const k = stem.lastIndexOf('o'); if (k >= 0) stem = stem.slice(0, k) + 'u' + stem.slice(k + 1); }
  }
  if (/[aeiou]$/.test(stem) && !stem.endsWith('qu') && !stem.endsWith('gu')) return stem + 'yendo';
  if (stem.endsWith('ll') || stem.endsWith('ñ')) return stem + 'endo'; // bullir, gruñir
  return stem + 'iendo';
}

// Ставит ударение, когда к герундию приклеено местоимение: bañando + se → bañándose
function attachToGerund(g, pron) {
  const accented = g.replace(/ando$/, 'ándo').replace(/iendo$/, 'iéndo').replace(/yendo$/, 'yéndo');
  return accented + pron;
}

function conjugate(verb) {
  const { base, reflexive } = splitReflexive(verb);
  const present = presentForms(base);
  if (!present) return null;
  const g = gerund(base);
  return {
    infinitive: verb.trim().toLowerCase(),
    gerund: reflexive ? attachToGerund(g, 'se') : g,
    tenses: {
      presente: present.map((f, i) => ({
        person: PERSONS[i],
        form: reflexive ? `${REFL[i]} ${f}` : f,
      })),
      // Герундий не меняется по лицам — одна форма, estar спрягать не нужно
      continuo: [{ person: 'gerundio', form: reflexive ? attachToGerund(g, 'se') : g, alt: null }],
    },
  };
}

const TENSE_LABELS = { presente: 'Presente', continuo: 'Gerundio' };

if (typeof module !== 'undefined') module.exports = { conjugate, gerund, TENSE_LABELS, PERSONS };
