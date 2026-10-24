const $ = s => document.querySelector(s);
const body = document.body;
const still = /still/.test(location.search);
const reduced = still || matchMedia('(prefers-reduced-motion: reduce)').matches;

// буквы имени — по отдельности, чтобы «вставали» по очереди
for (const el of document.querySelectorAll('[data-split]')) {
  const t = el.textContent; el.textContent = ''; el.setAttribute('aria-label', t);
  [...t].forEach((c, i) => {
    const s = document.createElement('span'); s.className = 'ch'; s.textContent = c; s.style.setProperty('--i', i);
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

// плитки: свечение за пальцем и «волна» при нажатии
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

// поделиться / QR
const toast = msg => { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2200); };
$('#share').addEventListener('click', async () => {
  const data = { title: 'Азизбек Ботиров — аллерголог-иммунолог', text: 'Аллерголог-иммунолог и педиатр. Все соцсети врача:', url: location.href.split('#')[0] };
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

// подпись лопнувшей пыльцы
const tag = $('#tag');
function showTag(info, x, y) {
  tag.innerHTML = `<b>${info.ru}</b><i>${info.la}</i> · пыльца`;
  const w = tag.offsetWidth / 2 + 10;
  tag.style.left = Math.min(innerWidth - w, Math.max(w, x)) + 'px';
  tag.style.top = Math.max(90, y) + 'px';
  tag.classList.remove('on'); void tag.offsetWidth; tag.classList.add('on');
  clearTimeout(showTag.t); showTag.t = setTimeout(() => tag.classList.remove('on'), 1900);
}

// 3D-сцена
let scene = null, tapped = false;
(async () => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('no webgl2');
    const { createScene } = await import('./scene.js?v=2');
    scene = createScene($('#gl'), {
      hero: $('#hero'), portrait: 'assets/doctor.webp', reduced, still, noPortrait: /noportrait/.test(location.search),
      onReady: () => body.classList.add('ready'),
      onIntro: k => { setMag(k); if (k > .42) go(); },
      onBurst: (info, x, y) => showTag(info, x, y),
    });
    if (location.search.includes('debug')) window.__scene = scene;
    if (!reduced) {
      setTimeout(() => { if (!tapped) body.classList.add('hinting'); }, 3600);
      setTimeout(() => { if (!tapped && scene) scene.burstAt(innerWidth * .9, innerHeight * .28, true); }, 5200);
    }
  } catch (e) {
    console.warn(e);
    body.classList.add('nogl'); go(); setMag(1);
  }
})();

// касание фона — «иммунный ответ»
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
