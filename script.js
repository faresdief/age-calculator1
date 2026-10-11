'use strict';

/* ==========================================================================
   Professional Age Dashboard — main application

   Update tiers (so the page does as little work as possible):
   1. STATIC     birth weekday, jubilees, ages 20/30/40, Hijri birth date.
                 Computed ONCE when the birth date or the language changes.
   2. PER-MINUTE years / months / days / hours / minutes, totals, water, sleep,
                 progress, countdown, Hijri age, family ages. Only when the
                 wall-clock minute changes (or on a forced refresh).
   3. PER-SECOND seconds, total seconds, heartbeats, breaths.

   Every DOM write goes through a setter that skips unchanged values.
   Needs (loaded before): i18n.js, effects.js, share-card.js
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const root = document.documentElement;

const calcBtn = $('calcBtn'), shareBtn = $('shareBtn'), themeToggleBtn = $('themeToggleBtn'), installBtn = $('installBtn'), clearBtn = $('clearBtn');
const birthDateInput = $('birthDate'), mainDashboard = $('mainDashboard'), errorMessage = $('errorMessage'), langSelect = $('langSelect');
const progressBar = $('progressBar');
const personForm = $('personForm'), personName = $('personName'), personDate = $('personDate'), peopleList = $('peopleList'), peopleEmpty = $('peopleEmpty');
const toastEl = $('toast');

const STORAGE_KEY = 'ageDash.v1';
const DEBOUNCE_MS = 300;   // quiet time required after the last edit of the date / language inputs
const MIN_YEAR = 1900;     // oldest accepted birth year
const MAX_PEOPLE = 12;
const MAX_NAME = 24;

/* ---------- Local storage (everything stays on the device; every access is guarded) ---------- */

const store = {
    read() {
        try {
            const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
        } catch (e) { return {}; }
    },
    patch(part) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign(store.read(), part))); } catch (e) { /* private mode / quota */ }
    },
    clear() {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    }
};

/* ---------- Locale helpers: formatters are built once per language and reused ---------- */

const LOCALES = { ar: 'ar-EG', en: 'en-US', fr: 'fr-FR', es: 'es-ES', de: 'de-DE', ru: 'ru-RU' };
const DATE_OPTIONS = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
const HIJRI = 'islamic-umalqura';
const formatterCache = new Map();

const hijriSupported = (() => {
    try { return new Intl.DateTimeFormat('en-u-ca-' + HIJRI).resolvedOptions().calendar === HIJRI; } catch (e) { return false; }
})();
const hijriParts = hijriSupported
    ? new Intl.DateTimeFormat('en-u-ca-' + HIJRI + '-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric' })
    : null;

function getFormatters(lang) {
    let f = formatterCache.get(lang);
    if (!f) {
        const locale = LOCALES[lang] || LOCALES.en;
        f = {
            nf: new Intl.NumberFormat(locale),
            df: new Intl.DateTimeFormat(locale, DATE_OPTIONS),
            hf: hijriSupported ? new Intl.DateTimeFormat(locale + '-u-ca-' + HIJRI, { day: 'numeric', month: 'long', year: 'numeric' }) : null
        };
        formatterCache.set(lang, f);
    }
    return f;
}

/* ---------- Date maths ---------- */

/** Calendar difference birth -> at (same borrow rules the counter always used). */
function ymd(birth, at) {
    let y = at.getFullYear() - birth.getFullYear(), m = at.getMonth() - birth.getMonth(), d = at.getDate() - birth.getDate();
    if (d < 0) { d += new Date(at.getFullYear(), at.getMonth(), 0).getDate(); m--; }
    if (m < 0) { m += 12; y--; }
    return { y, m, d };
}

const dayNumber = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;

function daysToBirthday(birth, now) {
    const today = dayNumber(now);
    let next = Date.UTC(now.getFullYear(), birth.getMonth(), birth.getDate()) / 86400000;
    if (next < today) next = Date.UTC(now.getFullYear() + 1, birth.getMonth(), birth.getDate()) / 86400000;
    return Math.round(next - today);
}

/** Gregorian Date -> { y, m, d } in the Umm al-Qura Hijri calendar. */
function toHijri(date) {
    let y = 0, m = 0, d = 0;
    for (const p of hijriParts.formatToParts(date)) {
        if (p.type === 'year') y = +p.value; else if (p.type === 'month') m = +p.value; else if (p.type === 'day') d = +p.value;
    }
    return { y, m, d };
}

/** Hijri age (calendar difference) between a Hijri birth date and a Gregorian "now". */
function hijriAge(birthH, now) {
    const nh = toHijri(now);
    let y = nh.y - birthH.y, m = nh.m - birthH.m, d = nh.d - birthH.d;
    if (d < 0) {
        // the day before the 1st of the current Hijri month is the last day of the previous one: its day number = month length
        const prevMonthLength = toHijri(new Date(now.getFullYear(), now.getMonth(), now.getDate() - nh.d, 12)).d;
        d += prevMonthLength; m--;
    }
    if (m < 0) { m += 12; y--; }
    return { y, m, d };
}

/** "3 y, 2 m" style text; zero parts are skipped. */
function fmtYMD(y, m, d) {
    const T = texts[state.lang], parts = [];
    if (y) parts.push(y + ' ' + T.u.y);
    if (m) parts.push(m + ' ' + T.u.m);
    if (d || !parts.length) parts.push(d + ' ' + T.u.d);
    return parts.join(T.sep);
}

/* ---------- DOM writers: cached text nodes, written only when the value changed ---------- */

function textField(target) {
    const el = typeof target === 'string' ? $(target) : target;
    let node = el.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) {
        el.textContent = '';
        node = el.appendChild(document.createTextNode(''));
    }
    let last = node.data;
    return (value) => {
        const text = String(value);
        if (text !== last) { last = text; node.data = text; }
    };
}

const FIELD_IDS = {
    years: 'resYears', months: 'resMonths', days: 'resDays', hours: 'resHours', minutes: 'resMinutes', seconds: 'resSeconds',
    totalWeeks: 'totalWeeks', totalDays: 'totalDays', totalHours: 'totalHours', totalSeconds: 'totalSeconds',
    heartBeats: 'heartBeats', totalBreaths: 'totalBreaths', waterConsumed: 'waterConsumed', sleepHours: 'sleepHours',
    birthDayName: 'birthDayName', silverJubilee: 'silverJubilee', goldJubilee: 'goldJubilee',
    age20Date: 'age20Date', age30Date: 'age30Date', age40Date: 'age40Date',
    hijriBirth: 'hijriBirth', hijriAge: 'hijriAge',
    countdownText: 'countdownText', progressText: 'progressBar'
};

const fields = {};
for (const key in FIELD_IDS) fields[key] = textField(FIELD_IDS[key]);

fields.progressWidth = (() => {
    let last = '';
    return (width) => { if (width !== last) { last = width; progressBar.style.width = width; } };
})();

/** Applies a { fieldName: value } batch to the DOM. */
function commit(values) {
    for (const key in values) fields[key](values[key]);
}

// Static labels (titles, captions, buttons): element lookups happen once, not on every language switch
const translatable = Object.keys(elementsToTranslate).map((id) => ({ set: textField(id), t: elementsToTranslate[id] }));
const placeholderTargets = Object.keys(placeholders).map((id) => ({ el: $(id), t: placeholders[id] }));

if (!hijriSupported) { $('titleHijri').hidden = true; $('hijriBlock').hidden = true; }

/* ---------- State ---------- */

const state = {
    lang: 'ar',
    birth: null,       // Date at local midnight of the birth day
    birthMs: 0,
    birthHijri: null,  // { y, m, d } of the birth day in the Hijri calendar
    armed: false,      // the user pressed the start button (or a saved date was restored)
    shown: false,      // dashboard visible and the live counter wanted
    minuteKey: -1,     // last wall-clock minute rendered by the per-minute tier
    errorKey: null,
    people: []         // [{ id, name, birth: 'YYYY-MM-DD', birthDate: Date }]
};

let timerId = 0;       // the ONLY recurring timer of the page (setTimeout chain, never setInterval)
let rafId = 0;

/* ---------- Small utilities ---------- */

function debounce(fn, wait) {
    let t = 0;
    const wrapped = (...args) => {
        clearTimeout(t);
        t = setTimeout(() => { t = 0; fn(...args); }, wait);
    };
    wrapped.cancel = () => { clearTimeout(t); t = 0; };
    return wrapped;
}

let toastTimer = 0;
function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

/** Reads a YYYY-MM-DD string. Returns { birth } or { error: 'empty' | 'invalid' | 'future' }. */
function readBirth(value) {
    if (!value) return { error: 'empty' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: 'invalid' };
    // Build the date from its parts in LOCAL time. `new Date("YYYY-MM-DD")` is parsed as UTC,
    // which shifts the day by one for users west of Greenwich.
    const [y, mo, d] = value.split('-').map(Number);
    if (!(y >= MIN_YEAR) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return { error: 'invalid' };
    const birth = new Date(y, mo - 1, d);
    if (birth > new Date()) return { error: 'future' };
    return { birth };
}

/* ---------- Tier 1: static values (birth date + language only) ---------- */

function renderStatic() {
    const { df, hf } = getFormatters(state.lang), b = state.birth;
    const y = b.getFullYear(), m = b.getMonth(), d = b.getDate();
    const at = (addYears) => df.format(new Date(y + addYears, m, d));
    const values = {
        birthDayName: texts[state.lang].days[b.getDay()],
        silverJubilee: at(25), goldJubilee: at(50),
        age20Date: at(20), age30Date: at(30), age40Date: at(40)
    };
    if (hf) values.hijriBirth = hf.format(b);
    commit(values);
}

/* ---------- Tiers 2 + 3: live values ---------- */

/** Pure calculation (no DOM). `full` adds the per-minute tier. */
function compute(nowMs, full) {
    const T = texts[state.lang], { nf } = getFormatters(state.lang);
    const now = new Date(nowMs);
    const ts = Math.floor((nowMs - state.birthMs) / 1000);   // total seconds lived

    // Tier 3 — every tick
    const values = {
        seconds: now.getSeconds(),
        totalSeconds: nf.format(ts),
        heartBeats: nf.format(Math.floor(ts * 1.25)),         // 75 beats / minute
        totalBreaths: nf.format(Math.floor(ts * 16 / 60))     // 16 breaths / minute
    };

    // Tier 2 — only when the wall-clock minute changed (or the caller forces it)
    if (full) {
        const b = state.birth;
        const age = ymd(b, now);
        values.years = age.y; values.months = age.m; values.days = age.d;
        values.hours = now.getHours(); values.minutes = now.getMinutes();

        const tm = Math.floor(ts / 60), th = Math.floor(tm / 60), td = Math.floor(th / 24), tw = Math.floor(th / 168);
        values.totalHours = nf.format(th);
        values.totalDays = nf.format(td);
        values.totalWeeks = nf.format(tw);
        values.waterConsumed = nf.format(Math.floor(td * 2.5)) + T.l;
        values.sleepHours = nf.format(Math.floor(td * 8));

        const last = new Date(now.getFullYear(), b.getMonth(), b.getDate());
        if (now < last) last.setFullYear(now.getFullYear() - 1);
        const next = new Date(last.getFullYear() + 1, b.getMonth(), b.getDate());
        const pct = Math.min(100, Math.max(0, ((now - last) / (next - last)) * 100)).toFixed(1) + '%';
        values.progressWidth = pct;
        values.progressText = pct;

        let cm = next.getMonth() - now.getMonth(), cd = next.getDate() - now.getDate();
        const ch = 23 - now.getHours();
        if (cd < 0) { cd += new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); cm--; }
        if (cm < 0) cm += 12;
        values.countdownText = T.pat.replace('{m}', cm).replace('{d}', cd).replace('{h}', ch);

        if (state.birthHijri) {
            const h = hijriAge(state.birthHijri, now);
            values.hijriAge = fmtYMD(h.y, h.m, h.d);
        }
    }
    return values;
}

function render(nowMs, force) {
    const minuteKey = Math.floor(nowMs / 60000);
    const full = force || minuteKey !== state.minuteKey;
    if (full) {
        state.minuteKey = minuteKey;
        if (!force) Effects.stopCountUp();          // a minute rolled over mid count-up: show the real numbers, not stale targets
    }
    const values = compute(nowMs, full);
    commit(values);                                 // one batch of writes, unchanged values are skipped inside
    if (full) renderPeople(new Date(nowMs));        // family ages change at most once a minute
    return values;
}

/* ---------- Live loop: one timer, aligned to the wall-clock second, DOM writes inside rAF ---------- */

const msToNextSecond = () => 1000 - (Date.now() % 1000) + 2;
const liveWanted = () => state.shown || state.people.length > 0;

function tickTimer() {
    timerId = setTimeout(tickTimer, msToNextSecond());   // re-armed from the wall clock: no drift, no overlapping timers
    if (!rafId) rafId = requestAnimationFrame(paintFrame);
}

function paintFrame() {
    rafId = 0;
    const now = Date.now();
    if (state.shown) {
        render(now, false);
    } else {
        const key = Math.floor(now / 60000);               // only the family list is on screen
        if (key !== state.minuteKey) { state.minuteKey = key; renderPeople(new Date(now)); }
    }
}

function stopLive() {
    clearTimeout(timerId);
    cancelAnimationFrame(rafId);
    timerId = rafId = 0;
}

function startLive() {
    stopLive();                                   // always clear the previous loop before creating a new one
    if (liveWanted() && !document.hidden) timerId = setTimeout(tickTimer, msToNextSecond());
}

/** Starts the loop if something needs it and it is not running; stops it when nothing does. */
function refreshLive() {
    if (!liveWanted()) stopLive();
    else if (!timerId) startLive();
}

// Nothing runs while the tab is in the background; the counter catches up the moment it is visible again
document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopLive(); return; }
    if (state.shown) render(Date.now(), false); else renderPeople(new Date());
    startLive();
});

/* ---------- Family & comparison ---------- */

const rows = new Map();   // person id -> { el, age(), meta() }

function hueOf(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
}

function buildRow(p) {
    const el = document.createElement('div');
    el.className = 'person';
    el.dataset.id = p.id;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = (Array.from(p.name)[0] || '?').toUpperCase();
    avatar.style.setProperty('--hue', hueOf(p.name));

    const main = document.createElement('div');
    main.className = 'person-main';
    const nameEl = document.createElement('div');
    nameEl.className = 'person-name';
    nameEl.textContent = p.name;                    // user text is always set as text, never as HTML
    const ageEl = document.createElement('div');
    ageEl.className = 'person-age';
    const metaEl = document.createElement('div');
    metaEl.className = 'person-meta';
    main.append(nameEl, ageEl, metaEl);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn';
    btn.dataset.remove = p.id;
    btn.textContent = '✕';

    el.append(avatar, main, btn);
    return { el, btn, name: p.name, age: textField(ageEl), meta: textField(metaEl) };
}

function labelRemoveButtons() {
    const word = texts[state.lang].remove;
    for (const row of rows.values()) row.btn.setAttribute('aria-label', word + ' ' + row.name);
}

function syncPeopleEmpty() {
    peopleEmpty.hidden = state.people.length > 0;
}

function renderPeople(now) {
    if (!state.people.length) return;
    const T = texts[state.lang];
    for (const p of state.people) {
        const row = rows.get(p.id);
        if (!row) continue;
        const a = ymd(p.birthDate, now);
        row.age(fmtYMD(a.y, a.m, a.d));

        const n = daysToBirthday(p.birthDate, now);
        let meta = n === 0 ? T.bToday : T.nextB.replace('{n}', n);
        if (state.birth) {
            const delta = dayNumber(state.birth) - dayNumber(p.birthDate);   // > 0: the person was born earlier than me
            if (delta === 0) meta += ' · ' + T.same;
            else {
                const gap = delta > 0 ? ymd(p.birthDate, state.birth) : ymd(state.birth, p.birthDate);
                meta += ' · ' + (delta > 0 ? T.older : T.younger).replace('{x}', fmtYMD(gap.y, gap.m, gap.d));
            }
        }
        row.meta(meta);
    }
}

function mountPerson(p, animate) {
    const row = buildRow(p);
    if (!animate) row.el.style.animation = 'none';
    rows.set(p.id, row);
    peopleList.appendChild(row.el);
}

function savePeople() {
    store.patch({ people: state.people.map(({ id, name, birth }) => ({ id, name, birth })) });
}

function addPerson(p) {
    state.people.push(p);
    mountPerson(p, true);
    syncPeopleEmpty();
    labelRemoveButtons();
    renderPeople(new Date());
    savePeople();
    refreshLive();
}

function removePerson(id) {
    const i = state.people.findIndex((p) => p.id === id);
    if (i < 0) return;
    state.people.splice(i, 1);
    const row = rows.get(id);
    rows.delete(id);
    if (row) {
        const done = () => row.el.remove();
        if (Effects.reduceMotion.matches || !row.el.animate) done();
        else row.el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(18px)' }], { duration: 220, easing: 'ease-in' }).onfinish = done;
    }
    syncPeopleEmpty();
    savePeople();
    refreshLive();
}

/** Validates what comes out of localStorage: it is user-editable, so nothing is trusted. */
function sanitizePeople(raw) {
    const out = [];
    if (!Array.isArray(raw)) return out;
    for (const r of raw) {
        if (out.length >= MAX_PEOPLE) break;
        if (!r || typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.birth !== 'string') continue;
        const name = r.name.trim().slice(0, MAX_NAME);
        const res = readBirth(r.birth);
        if (!name || res.error) continue;
        out.push({ id: r.id.slice(0, 24), name, birth: r.birth, birthDate: res.birth });
    }
    return out;
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

personForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const T = texts[state.lang];
    const name = personName.value.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
    const res = readBirth(personDate.value);
    if (!name || res.error === 'empty') { toast(T.needPerson); return; }
    if (res.error) { toast(T[res.error]); return; }
    if (state.people.length >= MAX_PEOPLE) { toast(T.maxPeople); return; }
    addPerson({ id: newId(), name, birth: personDate.value, birthDate: res.birth });
    personName.value = '';
    personDate.value = '';
    personName.focus();
});

peopleList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (btn) removePerson(btn.dataset.remove);
});

/* ---------- Screen state ---------- */

function showError(key) {
    Effects.stopCountUp();
    state.shown = false;
    state.errorKey = key;
    mainDashboard.classList.remove('is-visible');
    errorMessage.textContent = texts[state.lang][key];
    errorMessage.classList.add('is-visible');
    refreshLive();                                // the old code kept updating a hidden dashboard here
}

function applyBirth(birth) {
    const wasShown = state.shown;
    Effects.stopCountUp();                        // never leave an old count-up writing stale numbers
    state.birth = birth;
    state.birthMs = birth.getTime();
    state.birthHijri = hijriSupported ? toHijri(birth) : null;
    state.errorKey = null;
    state.shown = true;
    errorMessage.classList.remove('is-visible');
    mainDashboard.classList.add('is-visible');

    renderStatic();                               // once per birth date
    const values = render(Date.now(), true);      // first full paint of the live values
    startLive();                                  // (re)starts the single timer

    if (!wasShown) {                              // dashboard just appeared: the numbers roll up
        Effects.countUp(['years', 'months', 'days', 'hours', 'minutes'].map((k) => ({ set: fields[k], to: values[k] })));
    }
}

/* ---------- Language ---------- */

function syncLanguage(persist) {
    const lang = langSelect.value;
    if (lang === state.lang) return;
    state.lang = lang;
    if (persist) store.patch({ lang });

    const dir = (lang === 'ar') ? 'rtl' : 'ltr';
    if (root.lang !== lang) root.lang = lang;
    if (root.dir !== dir) root.dir = dir;
    document.title = texts[lang].docTitle;

    for (const item of translatable) item.set(item.t[lang]);
    for (const item of placeholderTargets) {
        item.el.placeholder = item.t[lang];
        item.el.setAttribute('aria-label', item.t[lang]);
    }
    labelRemoveButtons();
    if (state.errorKey) errorMessage.textContent = texts[lang][state.errorKey];
    if (state.shown) { renderStatic(); render(Date.now(), true); } else renderPeople(new Date());
}

/* ---------- Theme ---------- */

let themeTimer = 0;
function applyTheme(theme, persist) {
    root.classList.add('theme-anim');             // colour transitions exist only while the theme is switching
    root.classList.toggle('dark-theme', theme === 'dark');
    root.classList.toggle('light-theme', theme === 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f1f5f9' : '#0f172a');
    if (persist) store.patch({ theme });
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => root.classList.remove('theme-anim'), 300);
}

themeToggleBtn.addEventListener('click', () => {
    applyTheme(root.classList.contains('light-theme') ? 'dark' : 'light', true);
    const icon = themeToggleBtn.firstElementChild;
    if (icon && icon.animate && !Effects.reduceMotion.matches) {
        icon.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 520, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
});

// Follow the operating-system theme only while the user has not chosen one explicitly
if (window.matchMedia) {
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        if (!store.read().theme) applyTheme(e.matches ? 'light' : 'dark', false);
    });
}

/* ---------- Save as image ---------- */

const stripColon = (s) => s.replace(/\s*[:：]\s*$/, '');

function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function saveImage() {
    const T = texts[state.lang], L = state.lang, E = elementsToTranslate;
    if (!state.shown) { toast(T.empty); return; }
    shareBtn.disabled = true;
    try {
        const now = Date.now(), v = compute(now, true), { df } = getFormatters(L);
        const blob = await ShareCard.render({
            theme: root.classList.contains('light-theme') ? 'light' : 'dark',
            dir: root.dir,
            family: getComputedStyle(document.body).fontFamily,
            title: E.lblTitle[L],
            stamp: df.format(now),
            years: v.years, yearsLabel: E.lblY[L],
            months: v.months, monthsLabel: E.lblM[L],
            days: v.days, daysLabel: E.lblD[L],
            stats: [
                { value: v.totalDays, label: stripColon(E.lblTotD[L]) },
                { value: v.heartBeats, label: stripColon(E.lblHeart[L]) },
                { value: v.totalBreaths, label: stripColon(E.lblBreaths[L]) },
                { value: v.sleepHours + ' ' + E.lblH[L], label: stripColon(E.lblSleep[L]) }
            ],
            hijri: v.hijriAge ? { label: stripColon(E.lblHijriAge[L]), value: v.hijriAge } : null,
            countdown: { label: stripColon(E.lblCountdownText[L]), value: v.countdownText },
            footer: /^https?:$/.test(location.protocol) ? location.host : E.lblTitle[L]
        });
        if (!blob) throw new Error('canvas.toBlob returned null');

        const t = new Date(now), pad = (n) => String(n).padStart(2, '0');
        const filename = `age-card-${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}.png`;
        const file = new File([blob], filename, { type: 'image/png' });

        // On phones open the share sheet (WhatsApp, Instagram...); on desktop just download the file
        const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
        if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
            try { await navigator.share({ files: [file], title: E.lblTitle[L] }); return; }
            catch (err) { if (err && err.name === 'AbortError') return; /* otherwise fall back to a download */ }
        }
        download(blob, filename);
        toast(T.saved);
    } catch (err) {
        console.error(err);
    } finally {
        shareBtn.disabled = false;
    }
}

/* ---------- Events (each listener is registered exactly once) ---------- */

const onLanguageInput = debounce(() => syncLanguage(true), DEBOUNCE_MS);

// Runs DEBOUNCE_MS after the last edit of the date field, never on every keystroke
const onBirthInput = debounce(() => {
    if (!state.armed) return;                     // the first reveal belongs to the start button
    const res = readBirth(birthDateInput.value);
    if (res.error === 'empty' || res.error === 'invalid') return;   // half-typed date: keep the current results
    if (res.error) { showError(res.error); return; }
    applyBirth(res.birth);
    store.patch({ birth: birthDateInput.value });
}, DEBOUNCE_MS);

birthDateInput.addEventListener('input', onBirthInput);
birthDateInput.addEventListener('change', onBirthInput);
langSelect.addEventListener('change', onLanguageInput);

calcBtn.addEventListener('click', () => {
    onBirthInput.cancel();                        // an explicit click wins over any pending debounced update
    onLanguageInput.cancel();
    syncLanguage(true);
    state.armed = true;

    const res = readBirth(birthDateInput.value);
    if (res.error) { showError(res.error); return; }
    applyBirth(res.birth);
    store.patch({ birth: birthDateInput.value });
    Effects.confetti();
});

shareBtn.addEventListener('click', saveImage);

clearBtn.addEventListener('click', () => {
    if (!window.confirm(texts[state.lang].confirmClear)) return;
    store.clear();
    Effects.stopCountUp();
    onBirthInput.cancel();
    state.armed = false; state.shown = false; state.birth = null; state.birthHijri = null; state.errorKey = null;
    birthDateInput.value = '';
    mainDashboard.classList.remove('is-visible');
    errorMessage.classList.remove('is-visible');
    for (const row of rows.values()) row.el.remove();
    rows.clear();
    state.people = [];
    syncPeopleEmpty();
    stopLive();
    toast(texts[state.lang].cleared);
});

/* ---------- PWA: install button + service worker ---------- */

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();                           // we show our own button instead of the browser mini-bar
    installEvent = e;
    installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
    if (!installEvent) return;
    const e = installEvent;
    installEvent = null;
    installBtn.hidden = true;
    e.prompt();
    try { await e.userChoice; } catch (err) { /* ignore */ }
});
window.addEventListener('appinstalled', () => { installBtn.hidden = true; installEvent = null; });

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ }); });
}

/* ---------- Init ---------- */

(function init() {
    const t = new Date(), pad = (n) => String(n).padStart(2, '0');
    const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
    birthDateInput.max = today;
    personDate.max = today;

    // language: saved choice -> browser language -> Arabic (decided by the inline script in <head>)
    const boot = window.__boot || {};
    langSelect.value = boot.lang || 'ar';
    syncLanguage(false);

    // restore what was saved on this device
    const saved = store.read();
    state.people = sanitizePeople(saved.people);
    for (const p of state.people) mountPerson(p, false);
    syncPeopleEmpty();
    labelRemoveButtons();

    const res = typeof saved.birth === 'string' ? readBirth(saved.birth) : { error: 'empty' };
    if (!res.error) {
        birthDateInput.value = saved.birth;
        state.armed = true;
        applyBirth(res.birth);
    } else {
        renderPeople(new Date());
        refreshLive();
    }
})();
