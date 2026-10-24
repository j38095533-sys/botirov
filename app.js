import { THEMES, DEFAULT_THEME } from './themes.js?v=3';
import { mqttSession, b64d } from './mqtt-lite.js?v=3';
import { TOPIC, BROKERS, PUB_KEY } from './keys.js?v=3';

const $ = s => document.querySelector(s);
const body = document.body;
const params = new URLSearchParams(location.search);
const still = params.has('still');
const reduced = still || matchMedia('(prefers-reduced-motion: reduce)').matches;
if (still) body.classList.add('instant');

// буквы имени — по отдельности, чтобы «вставали» по очереди
for (const el of document.querySelectorAll('[data-split]')) {
  const t = el.textContent; el.textContent = ''; el.setAttribute('aria-label', t);
  el.style.setProperty('--n', t.length);
  [...t].forEach((c, i) => {
    const s = document.createElement('span'); s.className = 'ch'; s.textContent = c;
    s.style.setProperty('--i', i); s.style.setProperty('--p', t.length > 1 ? i / (t.length - 1) : 0);
    s.setAttribute('aria-hidden', 'true'); el.append(s);
  });
}

let went = false;
function go() {
  if (went) return; went = true; body.classList.add('go');
  for (const b of document.querySelectorAll('[data-count]')) {
    const to = +b.dataset.count, suf = b.dataset.suffix || '', t0 = performance.now() + 550;
    const tick = now => {
      const k = Math.min(1, Math.max(0, (now - t0) / 1400)), e = 1 - Math.pow(1 - k, 3);
      b.textContent = Math.round(to * e) + (k >= 1 ? suf : '');
      if (k < 1) requestAnimationFrame(tick);
    };
    b.textContent = '0'; requestAnimationFrame(tick);
  }
}

// увеличение «микроскопа» в шапке
const mag = $('#mag'), bar = document.querySelector('.hud .bar i');
const fmt = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function setMag(k) {
  const m = 12000 * Math.pow(1500 / 12000, k);
  mag.textContent = '×' + fmt(Math.round(m / 50) * 50);
  bar.style.width = (34 * Math.sqrt(m / 1500)) + 'px';
}

/* ---------- тема ---------- */
const CFG_KEY = 'botirov-theme';
const readCfg = () => { try { const c = JSON.parse(localStorage.getItem(CFG_KEY)); return c && THEMES[c.t] ? c : null; } catch (e) { return null; } };
const saveCfg = c => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) { /* приватный режим */ } };
const urlTheme = THEMES[params.get('theme')] ? params.get('theme') : null;
let cfg = readCfg();
let themeId = urlTheme || cfg?.t || DEFAULT_THEME;
let scene = null;

function applyUi(t) {
  const r = document.documentElement.style;
  r.setProperty('--acc1', t.acc[0]); r.setProperty('--acc2', t.acc[1]);
  $('#hudtxt').textContent = t.hud;
  $('#hint').textContent = t.hint;
}
applyUi(THEMES[themeId]);

function setTheme(id) {
  if (!THEMES[id] || id === themeId) return;
  themeId = id;
  if (scene) scene.setTheme(id); else applyUi(THEMES[id]);
}

// выбор врача приходит подписанным: без его ключа подменить фон нельзя
const enc = new TextEncoder();
let pubKey = null;
async function verify(text) {
  try {
    const m = JSON.parse(text);
    if (!THEMES[m.t] || typeof m.ts !== 'number' || typeof m.s !== 'string') return null;
    pubKey ??= await crypto.subtle.importKey('raw', b64d(PUB_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, b64d(m.s), enc.encode(m.t + '|' + m.ts));
    return ok ? { t: m.t, ts: m.ts, s: m.s } : null;
  } catch (e) { return null; }
}
async function syncTheme() {
  if (urlTheme || still || !window.crypto?.subtle || !window.WebSocket) return;
  const seen = [];
  const sessions = await Promise.all(BROKERS.map((url, i) => mqttSession(url, {
    topic: TOPIC, timeout: 8000,
    onMessage: async (_, payload) => {
      const m = await verify(payload);
      if (!m) return;
      if (!seen[i] || m.ts > seen[i].ts) seen[i] = m;
      if (!cfg || m.ts > cfg.ts) { cfg = m; saveCfg(m); setTheme(m.t); }
    },
  })));
  // если у брокера выбор врача потерялся — возвращаем его (подпись та же, подделать нельзя)
  setTimeout(() => sessions.forEach((s, i) => {
    if (!s) return;
    if (cfg && (!seen[i] || seen[i].ts < cfg.ts)) s.publish(TOPIC, JSON.stringify(cfg), true);
    setTimeout(() => s.close(), 500);
  }), 3500);
}

/* ---------- плитки, «Поделиться», QR ---------- */
for (const t of document.querySelectorAll('.tile')) {
  const pos = e => {
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px');
    return r;
  };
  t.addEventListener('pointermove', pos);
  t.addEventListener('pointerdown', e => {
    const r = pos(e); t.classList.add('on');
    const rp = document.createElement('span'); rp.className = 'ripple';
    rp.style.left = (e.clientX - r.left) + 'px'; rp.style.top = (e.clientY - r.top) + 'px';
    t.append(rp); setTimeout(() => rp.remove(), 800);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) t.addEventListener(ev, () => setTimeout(() => t.classList.remove('on'), 180));
}
const toast = msg => { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2200); };
$('#share').addEventListener('click', async () => {
  const data = { title: 'Азизбек Ботиров — аллерголог-иммунолог', text: 'Аллерголог-иммунолог и педиатр. Все соцсети врача:', url: location.origin + location.pathname };
  try {
    if (navigator.share) { await navigator.share(data); return; }
    await navigator.clipboard.writeText(data.url); toast('Ссылка скопирована');
  } catch (e) { if (e && e.name !== 'AbortError') toast(data.url); }
});
const sheet = $('#sheet');
$('#qrbtn').addEventListener('click', () => { sheet.hidden = false; });
$('#sheetclose').addEventListener('click', () => { sheet.hidden = true; });
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.hidden = true; });
addEventListener('keydown', e => { if (e.key === 'Escape') sheet.hidden = true; });

// подпись того, что лопнуло
const tag = $('#tag');
function showTag(label, x, y) {
  tag.innerHTML = `<b>${label.t}</b><i>${label.s}</i>`;
  const w = tag.offsetWidth / 2 + 10;
  tag.style.left = Math.min(innerWidth - w, Math.max(w, x)) + 'px';
  tag.style.top = Math.max(90, y) + 'px';
  tag.classList.remove('on'); void tag.offsetWidth; tag.classList.add('on');
  clearTimeout(showTag.t); showTag.t = setTimeout(() => tag.classList.remove('on'), 1900);
}

/* ---------- 3D ---------- */
let tapped = false;
(async () => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('no webgl2');
    const { createScene } = await import('./scene.js?v=3');
    scene = createScene($('#gl'), {
      reduced, still, theme: themeId,
      onTheme: t => applyUi(t),
      onIntro: k => {
        setMag(k);
        if (!body.classList.contains('ready')) body.classList.add('ready');
        if (k > .12) body.classList.add('reveal');
        if (k > .42) go();
      },
      onBurst: (label, x, y) => showTag(label, x, y),
    });
    if (params.has('debug')) window.__scene = scene;
    // портрет и текст не ждут 3D: на слабом телефоне шейдеры могут собираться дольше
    setTimeout(() => body.classList.add('ready', 'reveal'), 1400);
    setTimeout(go, 2400);
    if (!reduced) {
      setTimeout(() => { if (!tapped) body.classList.add('hinting'); }, 3600);
      setTimeout(() => { if (!tapped && scene) scene.burstAt(innerWidth * .9, innerHeight * .28, true); }, 5200);
    }
  } catch (e) {
    console.warn(e);
    body.classList.add('nogl', 'reveal'); go(); setMag(1);
  }
  syncTheme();
})();

// касание фона
let down = null;
addEventListener('pointerdown', e => {
  if (e.target.closest('a,button,.sheet')) { down = null; return; }
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
}, { passive: true });
addEventListener('pointerup', e => {
  if (!down || !scene) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
  down = null;
  if (moved > 12 || dt > 600) return;
  scene.skipIntro();
  if (scene.burstAt(e.clientX, e.clientY) && !tapped) { tapped = true; setTimeout(() => body.classList.remove('hinting'), 1200); }
}, { passive: true });
addEventListener('pointercancel', () => { down = null; });
