import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, remove, onValue, onChildAdded, onChildChanged, onChildRemoved,
  query, orderByChild, equalTo, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, W, H, PALETTE, DEFAULT_COOLDOWN, isConfigured } from "./config.js";
import { BoardView, paletteButtons } from "./board.js";

const $ = id => document.getElementById(id);
const gate = $('gate');
const setStatus = (t, warn) => { $('status').textContent = t; $('status').classList.toggle('warn', !!warn); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

if (!isConfigured()) {
  gate.hidden = false;
  gate.innerHTML = `<h2>Сайт ещё не настроен</h2><p>Заполни <code>js/config.js</code> — см. <code>README.md</code>.</p>`;
  throw new Error('Firebase не настроен');
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
let started = false;

function showLogin() {
  gate.hidden = false; $('panel').hidden = true; $('logout').hidden = true;
  gate.innerHTML = `<h2>Вход в админку</h2><p>Войди через свой Google-аккаунт.</p><button class="btn primary" id="login">Войти через Google</button>`;
  $('login').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(e => {
    setStatus('Ошибка входа: ' + e.code, true);
  });
  setStatus('Нужен вход');
}

function showNotAdmin(user) {
  gate.hidden = false; $('panel').hidden = true; $('logout').hidden = false;
  gate.innerHTML = `<h2>Нет доступа</h2>
    <p>Аккаунт <b>${esc(user.email || '')}</b> не админ.</p>
    <p>Если это ты и сайт твой — открой Firebase Console → Realtime Database → Data, создай узел
    <code>admins</code>, внутри ключ <code>${esc(user.uid)}</code> со значением <code>true</code>, потом обнови страницу.</p>
    <button class="btn" id="copyUid">Скопировать мой ID</button>`;
  $('copyUid').onclick = () => navigator.clipboard?.writeText(user.uid).then(() => setStatus('ID скопирован'));
  setStatus('Нет прав', true);
}

$('logout').onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  if (!user || user.isAnonymous) { if (user) await signOut(auth); showLogin(); return; }
  let isAdmin = false;
  try { isAdmin = (await get(ref(db, 'admins/' + user.uid))).val() === true; } catch {}
  if (!isAdmin) { showNotAdmin(user); return; }
  gate.hidden = true; $('panel').hidden = false; $('logout').hidden = false;
  setStatus('Админ: ' + (user.email || user.uid));
  if (!started) { started = true; startPanel(user); }
});

// =====================================================
function startPanel(user) {
  const cells = new Map();          // "x_y" -> {c,u,t}
  let tool = 'inspect', color = 3, areaA = null, areaB = null;

  const view = new BoardView({ stage: $('stage'), canvas: $('board'), W, H, palette: PALETTE, onSelect });
  requestAnimationFrame(() => { view.resize(); view.fit(); });
  $('zin').onclick = () => view.zoomCenter(1.5);
  $('zout').onclick = () => view.zoomCenter(1 / 1.5);
  $('zfit').onclick = () => view.fit();
  paletteButtons($('palette'), PALETTE, color, i => { color = i; view.ghostColor = i; view.redraw(); });

  // рамка области
  view.overlays.push((ctx, v) => {
    if (!areaA) return;
    const b = areaB || areaA;
    const x0 = Math.min(areaA.x, b.x), y0 = Math.min(areaA.y, b.y), x1 = Math.max(areaA.x, b.x), y1 = Math.max(areaA.y, b.y);
    const [px, py, s] = v.cellRect(x0, y0);
    ctx.fillStyle = 'rgba(200,30,30,.18)'; ctx.fillRect(px, py, (x1 - x0 + 1) * s, (y1 - y0 + 1) * s);
    ctx.strokeStyle = '#c81e1e'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.strokeRect(px, py, (x1 - x0 + 1) * s, (y1 - y0 + 1) * s); ctx.setLineDash([]);
  });

  // ---------- данные ----------
  const boardRef = ref(db, 'board');
  const parseKey = k => { const m = /^(\d+)_(\d+)$/.exec(k); return m ? [+m[1], +m[2]] : null; };
  const onCell = s => {
    const p = parseKey(s.key), v = s.val(); if (!p || !v) return;
    cells.set(s.key, v); view.setPixel(p[0], p[1], v.c | 0);
    $('sPixels').textContent = cells.size;
    if (view.sel && view.sel.x === p[0] && view.sel.y === p[1]) showInspect(view.sel);
  };
  onChildAdded(boardRef, onCell);
  onChildChanged(boardRef, onCell);
  onChildRemoved(boardRef, s => {
    cells.delete(s.key); const p = parseKey(s.key); if (p) view.setPixel(p[0], p[1], 0);
    $('sPixels').textContent = cells.size;
    if (view.sel && p && view.sel.x === p[0] && view.sel.y === p[1]) showInspect(view.sel);
  });
  onValue(ref(db, 'online'), s => $('sOnline').textContent = s.size);

  let cfg = {};
  onValue(ref(db, 'config'), s => {
    cfg = s.val() || {};
    if (document.activeElement !== $('cd')) $('cd').value = Math.round((typeof cfg.cooldown === 'number' ? cfg.cooldown : DEFAULT_COOLDOWN) / 1000);
    if (document.activeElement !== $('ann')) $('ann').value = cfg.announcement || '';
    $('lock').textContent = cfg.locked ? 'Открыть холст' : 'Закрыть холст';
  });

  onValue(ref(db, 'banned'), async s => {
    const list = $('bans'); const bans = s.val() || {};
    const ids = Object.keys(bans);
    $('sBanned').textContent = ids.length;
    if (!ids.length) { list.innerHTML = '<li class="small">Пока никого</li>'; return; }
    list.innerHTML = '';
    for (const id of ids) {
      const name = (await get(ref(db, `users/${id}/name`))).val();
      const li = document.createElement('li');
      li.innerHTML = `<span>${name ? '<b>' + esc(name) + '</b><br>' : ''}<span class="small">${esc(id)}</span></span>`;
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Разбанить';
      b.onclick = () => remove(ref(db, 'banned/' + id)).then(() => setStatus('Разбанен'));
      li.appendChild(b); list.appendChild(li);
    }
  });

  // ---------- инструменты ----------
  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => {
    tool = b.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach(o => o.setAttribute('aria-pressed', o === b));
    $('palette').hidden = tool !== 'paint';
    $('areaBox').hidden = tool !== 'area';
    view.ghostColor = tool === 'paint' ? color : null;
    areaA = areaB = null; $('areaClear').disabled = true;
    $('toolHint').textContent = {
      inspect: 'Нажми на пиксель, чтобы узнать, кто его поставил.',
      paint: 'Админ рисует без кулдауна: просто нажимай на клетки.',
      area: 'Нажми на первый угол, потом на второй.'
    }[tool];
    view.redraw();
  });

  function onSelect(c) {
    if (tool === 'paint') {
      update(ref(db), { [`board/${c.x}_${c.y}`]: { c: color, u: user.uid, t: serverTimestamp() } })
        .catch(e => setStatus('Ошибка: ' + e.message, true));
    } else if (tool === 'area') {
      if (!areaA || areaB) { areaA = c; areaB = null; $('areaClear').disabled = true; }
      else { areaB = c; $('areaClear').disabled = false; }
      view.sel = null; view.redraw();
    }
    showInspect(c);
  }

  async function showInspect(c) {
    const key = `${c.x}_${c.y}`, v = cells.get(key);
    $('inspect').hidden = false;
    $('iXY').textContent = `(${c.x}, ${c.y})`;
    $('iColor').innerHTML = v ? `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;border:1px solid rgba(0,0,0,.3);background:${PALETTE[v.c] || '#fff'}"></span> ${PALETTE[v.c] || ''}` : 'пусто';
    $('iUid').textContent = v ? v.u : '—';
    $('iTime').textContent = v && v.t ? new Date(v.t).toLocaleString('ru-RU') : '—';
    $('iName').textContent = '…';
    ['iErase', 'iBan', 'iWipe'].forEach(id => $(id).disabled = !v);
    if (v) {
      const n = (await get(ref(db, `users/${v.u}/name`))).val();
      $('iName').textContent = n || 'без ника';
      $('iBan').disabled = v.u === user.uid;
    } else $('iName').textContent = '—';
  }

  const selCell = () => view.sel && cells.get(`${view.sel.x}_${view.sel.y}`);
  $('iErase').onclick = () => { if (view.sel) remove(ref(db, `board/${view.sel.x}_${view.sel.y}`)).then(() => setStatus('Стёрто')); };
  $('iBan').onclick = () => {
    const v = selCell(); if (!v) return;
    if (!confirm('Забанить этого игрока?')) return;
    set(ref(db, 'banned/' + v.u), { at: serverTimestamp(), by: user.uid }).then(() => setStatus('Игрок забанен'));
  };
  $('iWipe').onclick = async () => {
    const v = selCell(); if (!v) return;
    const snap = await get(query(boardRef, orderByChild('u'), equalTo(v.u)));
    const n = snap.size;
    if (!n || !confirm(`Стереть ${n} пикс. этого игрока?`)) return;
    const upd = {}; snap.forEach(ch => { upd['board/' + ch.key] = null; });
    await update(ref(db), upd); setStatus(`Стёрто пикселей: ${n}`);
  };

  $('areaReset').onclick = () => { areaA = areaB = null; $('areaClear').disabled = true; view.redraw(); };
  $('areaClear').onclick = async () => {
    if (!areaA || !areaB) return;
    const x0 = Math.min(areaA.x, areaB.x), y0 = Math.min(areaA.y, areaB.y), x1 = Math.max(areaA.x, areaB.x), y1 = Math.max(areaA.y, areaB.y);
    const upd = {};
    for (const k of cells.keys()) { const [x, y] = k.split('_').map(Number); if (x >= x0 && x <= x1 && y >= y0 && y <= y1) upd['board/' + k] = null; }
    const n = Object.keys(upd).length;
    if (!n) { setStatus('В области пусто'); return; }
    if (!confirm(`Стереть ${n} пикс. в области?`)) return;
    await update(ref(db), upd); setStatus(`Стёрто пикселей: ${n}`);
    areaA = areaB = null; $('areaClear').disabled = true; view.redraw();
  };

  // ---------- настройки ----------
  $('cdSave').onclick = () => {
    const s = Math.max(0, Math.min(3600, Math.round(+$('cd').value || 0)));
    set(ref(db, 'config/cooldown'), s * 1000).then(() => setStatus(`Кулдаун: ${s} с`));
  };
  $('annSave').onclick = () => set(ref(db, 'config/announcement'), $('ann').value.trim().slice(0, 200) || null).then(() => setStatus('Объявление обновлено'));
  $('annClear').onclick = () => remove(ref(db, 'config/announcement')).then(() => { $('ann').value = ''; setStatus('Объявление убрано'); });
  $('lock').onclick = () => { const v = !cfg.locked; set(ref(db, 'config/locked'), v).then(() => setStatus(v ? 'Холст закрыт' : 'Холст открыт')); };

  $('png').onclick = () => {
    const a = document.createElement('a');
    a.href = view.toPNG(8); a.download = `pixel-battle-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
    a.click();
  };
  $('wipeAll').onclick = async () => {
    if (!confirm('Точно очистить ВСЁ поле? Это нельзя отменить.')) return;
    if (prompt('Напиши ОЧИСТИТЬ для подтверждения') !== 'ОЧИСТИТЬ') return;
    await remove(boardRef); view.clearAll(); cells.clear(); $('sPixels').textContent = 0; setStatus('Поле очищено');
  };
}
