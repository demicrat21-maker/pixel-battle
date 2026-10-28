import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, onChildAdded, onChildChanged, onChildRemoved, onValue,
  update, set, serverTimestamp, onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, W, H, PALETTE, DEFAULT_COOLDOWN, isConfigured } from "./config.js";
import { BoardView, paletteButtons } from "./board.js";

const $ = id => document.getElementById(id);
const statusEl = $('status'), placeBtn = $('place'), placeLabel = $('placeLabel'), bar = $('bar');

function setStatus(t, warn) { statusEl.textContent = t; statusEl.classList.toggle('warn', !!warn); }

if (!isConfigured()) {
  document.body.innerHTML = `<div class="notice"><h2>Сайт ещё не настроен</h2>
  <p>Открой файл <code>js/config.js</code> и вставь туда конфиг своего проекта Firebase. Подробности в <code>README.md</code>.</p></div>`;
  throw new Error('Firebase не настроен');
}

// ---------- холст ----------
let color = 5;
const view = new BoardView({
  stage: $('stage'), canvas: $('board'), W, H, palette: PALETTE,
  onSelect: c => { $('coords').textContent = `x ${c.x}, y ${c.y}`; $('hint').style.opacity = 0; updateBtn(); }
});
view.ghostColor = color;
paletteButtons($('palette'), PALETTE, color, i => { color = i; view.ghostColor = i; view.redraw(); });
$('zin').onclick = () => view.zoomCenter(1.5);
$('zout').onclick = () => view.zoomCenter(1 / 1.5);
$('zfit').onclick = () => view.fit();

// ---------- firebase ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let uid = null, connected = false, banned = false, locked = false;
let cooldown = DEFAULT_COOLDOWN, lastPlaced = 0, offset = 0, count = 0;

const now = () => Date.now() + offset;

function updateBtn() {
  const left = lastPlaced + cooldown - now();
  bar.style.width = 0;
  if (!connected || !uid) { placeBtn.disabled = true; placeLabel.textContent = 'Нет связи'; return; }
  if (banned) { placeBtn.disabled = true; placeLabel.textContent = 'Ты заблокирован'; return; }
  if (locked) { placeBtn.disabled = true; placeLabel.textContent = 'Холст закрыт'; return; }
  if (left > 0) {
    placeBtn.disabled = true; placeLabel.textContent = `Жди ${Math.ceil(left / 1000)} с`;
    bar.style.width = Math.max(0, 100 - left / cooldown * 100) + '%';
    return;
  }
  placeBtn.disabled = !view.sel;
  placeLabel.textContent = view.sel ? 'Поставить пиксель' : 'Выбери клетку';
}
setInterval(updateBtn, 200);

// пиксели
const parseKey = k => { const m = /^(\d+)_(\d+)$/.exec(k); return m ? [+m[1], +m[2]] : null; };
const boardRef = ref(db, 'board');
function applyCell(snap) {
  const p = parseKey(snap.key); const v = snap.val();
  if (!p || !v || typeof v.c !== 'number') return;
  view.setPixel(p[0], p[1], v.c | 0);
}
onChildAdded(boardRef, s => { count++; $('count').textContent = count; applyCell(s); });
onChildChanged(boardRef, applyCell);
onChildRemoved(boardRef, s => {
  count = Math.max(0, count - 1); $('count').textContent = count;
  const p = parseKey(s.key); if (p) view.setPixel(p[0], p[1], 0);
});

// настройки от админа
onValue(ref(db, 'config'), s => {
  const c = s.val() || {};
  cooldown = typeof c.cooldown === 'number' ? c.cooldown : DEFAULT_COOLDOWN;
  locked = c.locked === true;
  const a = $('announce');
  if (c.announcement) { a.textContent = c.announcement; a.hidden = false; } else a.hidden = true;
  view.resize(); updateBtn();
});

onValue(ref(db, '.info/serverTimeOffset'), s => { offset = s.val() || 0; });
onValue(ref(db, 'online'), s => { $('online').textContent = s.size; });

onValue(ref(db, '.info/connected'), s => {
  connected = s.val() === true;
  setStatus(connected ? 'На связи' : 'Нет связи с сервером', !connected);
  if (connected && uid) goOnline();
  updateBtn();
});

function goOnline() {
  const r = ref(db, 'online/' + uid);
  onDisconnect(r).remove().then(() => set(r, true)).catch(() => {});
}

onAuthStateChanged(auth, user => {
  if (!user) return;
  uid = user.uid;
  if (connected) goOnline();
  onValue(ref(db, `users/${uid}/last`), s => { lastPlaced = s.val() || 0; updateBtn(); });
  onValue(ref(db, 'banned/' + uid), s => { banned = s.exists(); updateBtn(); });
  const saved = localStorage.getItem('pb_nick');
  if (saved) { $('nick').value = saved; set(ref(db, `users/${uid}/name`), saved).catch(() => {}); }
  updateBtn();
});
signInAnonymously(auth).catch(e => {
  console.error(e);
  setStatus('Не удалось войти: включи Anonymous в Firebase Auth', true);
});

// ник
let nickTimer;
$('nick').addEventListener('input', () => {
  clearTimeout(nickTimer);
  nickTimer = setTimeout(() => {
    const v = $('nick').value.trim().slice(0, 20);
    try { localStorage.setItem('pb_nick', v); } catch {}
    if (uid && v) set(ref(db, `users/${uid}/name`), v).catch(() => {});
  }, 600);
});

// ---------- поставить пиксель ----------
async function place() {
  if (placeBtn.disabled || !view.sel) return;
  const { x, y } = view.sel;
  if (view.getPixel(x, y) === color && color !== 0) { setStatus('Тут уже этот цвет'); return; }
  lastPlaced = now(); updateBtn();          // сразу запускаем таймер
  try {
    await update(ref(db), {
      [`board/${x}_${y}`]: { c: color, u: uid, t: serverTimestamp() },
      [`users/${uid}/last`]: serverTimestamp()
    });
    setStatus('Пиксель поставлен');
  } catch (e) {
    console.warn(e);
    setStatus(banned ? 'Ты заблокирован' : locked ? 'Холст закрыт админом' : 'Сервер не принял пиксель — подожди кулдаун', true);
  }
}
placeBtn.onclick = place;

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || !view.sel) return;
  const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (mv) {
    e.preventDefault();
    view.select({ x: Math.min(W - 1, Math.max(0, view.sel.x + mv[0])), y: Math.min(H - 1, Math.max(0, view.sel.y + mv[1])) });
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.tagName !== 'BUTTON') { e.preventDefault(); place(); }
});
