// Пульт врача: вход по паролю, выбор фона, подписанная команда сайту через MQTT.
import { THEME_LIST, THEMES, DEFAULT_THEME } from './themes.js?v=3';
import { mqttSession, b64e, b64d } from './mqtt-lite.js?v=3';
import { TOPIC, BROKERS, PUB_KEY, ENC_KEY } from './keys.js?v=3';

const $ = s => document.querySelector(s);
const enc = new TextEncoder();
const STORE = 'botirov-admin-key';
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
let priv = null, live = null, selected = null, sessions = [], pubKey = null;

const toast = (msg, bad = false) => {
  const el = $('#toast'); el.textContent = msg; el.classList.toggle('bad', bad); el.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 3200);
};

/* ---------- вход ---------- */
async function decryptKey(pw) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(ENC_KEY.salt), iterations: ENC_KEY.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(ENC_KEY.iv) }, aes, b64d(ENC_KEY.ct));   // неверный пароль → исключение
}
const importPriv = pkcs8 => crypto.subtle.importKey('pkcs8', pkcs8, ECDSA, false, ['sign']);

$('#lockform').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#enter'); btn.disabled = true; btn.textContent = 'Проверяю…'; $('#err').textContent = '';
  try {
    const pkcs8 = await decryptKey($('#pw').value.trim());
    priv = await importPriv(pkcs8);
    if ($('#remember').checked) try { localStorage.setItem(STORE, b64e(pkcs8)); } catch (e2) { /* приватный режим */ }
    openPanel();
  } catch (err) {
    $('#err').textContent = 'Неверный пароль';
  }
  btn.disabled = false; btn.textContent = 'Войти';
});
$('#logout').addEventListener('click', () => { try { localStorage.removeItem(STORE); } catch (e) { /* */ } location.reload(); });

/* ---------- панель ---------- */
function renderGrid() {
  $('#grid').innerHTML = THEME_LIST.map(t => `
    <button class="card" data-id="${t.id}" type="button">
      <img src="assets/themes/${t.id}.webp?v=3" alt="" loading="lazy">
      <span class="badge">На сайте</span>
      <span class="t">${t.name}</span><span class="d">${t.desc}</span>
    </button>`).join('');
  $('#grid').addEventListener('click', e => {
    const c = e.target.closest('.card'); if (!c) return;
    select(c.dataset.id);
    // на телефоне предпросмотр сверху — поднимаемся к нему, кнопка «Поставить» прилипла снизу
    if (matchMedia('(max-width: 859px)').matches) document.querySelector('.preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
function markLive() {
  const id = live?.t || DEFAULT_THEME;
  document.querySelectorAll('.card').forEach(c => c.classList.toggle('live', c.dataset.id === id));
  updateApply();
}
function select(id) {
  selected = id;
  document.querySelectorAll('.card').forEach(c => c.classList.toggle('sel', c.dataset.id === id));
  const url = `./?theme=${id}&preview`;
  if (!$('#frame').src.endsWith(url.slice(1))) $('#frame').src = url;
  $('#pvcap').textContent = `Предпросмотр: «${THEMES[id].name}»`;
  updateApply();
}
function updateApply() {
  const btn = $('#apply'), cur = live?.t || DEFAULT_THEME;
  if (!selected) { btn.disabled = true; return; }
  btn.disabled = selected === cur;
  btn.textContent = selected === cur ? 'Этот фон уже на сайте' : `Поставить «${THEMES[selected].name}» на сайт`;
}
function setStatus(text, cls = '') {
  $('#status').textContent = text;
  $('#statusbox').className = 'status ' + cls;
}

async function verify(text) {
  try {
    const m = JSON.parse(text);
    if (!THEMES[m.t] || typeof m.ts !== 'number') return null;
    pubKey ??= await crypto.subtle.importKey('raw', b64d(PUB_KEY), ECDSA, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, b64d(m.s), enc.encode(m.t + '|' + m.ts)) ? m : null;
  } catch (e) { return null; }
}
const waiters = new Set();
async function onMessage(_, payload) {
  const m = await verify(payload);
  if (!m) return;
  for (const w of waiters) w(m);
  if (!live || m.ts >= live.ts) {
    live = m; markLive();
    setStatus(`Сейчас на сайте: «${THEMES[m.t].name}»`, 'ok');
  }
}
async function connect() {
  sessions = await Promise.all(BROKERS.map(url => mqttSession(url, { topic: TOPIC, onMessage, timeout: 9000 })));
  return sessions.some(Boolean);
}

async function openPanel() {
  $('#lock').hidden = true; $('#panel').hidden = false;
  renderGrid(); markLive();
  const ok = await connect();
  if (!ok) setStatus('Нет связи с сервером. Проверьте интернет и обновите страницу', 'bad');
  setTimeout(() => {
    if (!live && ok) setStatus(`Сейчас на сайте стандартный фон: «${THEMES[DEFAULT_THEME].name}»`, 'ok');
    if (!selected) select(live?.t || DEFAULT_THEME);
  }, 2500);
}

$('#apply').addEventListener('click', async () => {
  if (!priv || !selected) return;
  const btn = $('#apply'); btn.disabled = true; btn.textContent = 'Ставлю…';
  try {
    if (!sessions.some(s => s?.alive())) await connect();
    const ts = Date.now();
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, enc.encode(selected + '|' + ts));
    const msg = JSON.stringify({ t: selected, ts, s: b64e(sig) });
    const echo = new Promise(res => {
      const w = m => { if (m.ts === ts) { waiters.delete(w); res(true); } };
      waiters.add(w); setTimeout(() => { waiters.delete(w); res(false); }, 7000);
    });
    let sent = 0;
    for (const s of sessions) if (s?.publish(TOPIC, msg, true)) sent++;
    if (!sent || !(await echo)) throw new Error('нет подтверждения');
    toast(`Готово! Фон «${THEMES[selected].name}» уже на сайте`);
  } catch (e) {
    toast('Не получилось: нет связи. Попробуйте ещё раз', true);
  }
  updateApply();
});

/* ---------- старт ---------- */
(async () => {
  if (!window.crypto?.subtle) { $('#err').textContent = 'Откройте пульт по ссылке https://…'; return; }
  let stored = null;
  try { stored = localStorage.getItem(STORE); } catch (e) { /* */ }
  if (stored) {
    try { priv = await importPriv(b64d(stored)); openPanel(); return; } catch (e) { /* ключ испорчен — спросим пароль */ }
  }
  $('#pw').focus();
})();
