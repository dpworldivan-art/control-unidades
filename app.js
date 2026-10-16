/* Control de unidades — registro rápido con cola local.
   El registro se guarda primero en el equipo (instantáneo) y se envía a la hoja cuando hay señal. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const API = (window.CTRL_CFG && window.CTRL_CFG.api) || '';
const TOKEN = (window.CTRL_CFG && window.CTRL_CFG.token) || '';
const hasApi = () => /^https?:\/\//.test(API);
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const isoWeek = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

/* ---------- almacenamiento local (IndexedDB) ---------- */
const idb = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const q = indexedDB.open('ctrl-unidades', 1);
    q.onupgradeneeded = () => { q.result.createObjectStore('meta'); q.result.createObjectStore('rec', { keyPath: 'id' }); };
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  }));
  const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const r = fn(t.objectStore(store)); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
  return {
    get: (s, k) => tx(s, 'readonly', o => o.get(k)),
    put: (s, v, k) => tx(s, 'readwrite', o => o.put(v, k)),
    del: (s, k) => tx(s, 'readwrite', o => o.delete(k)),
    all: s => tx(s, 'readonly', o => o.getAll())
  };
})();
const mem = {}; // respaldo si IndexedDB no está disponible
async function metaGet(k) { try { return await idb.get('meta', k); } catch (e) { return mem[k]; } }
async function metaPut(k, v) { try { await idb.put('meta', v, k); } catch (e) { mem[k] = v; } }
async function recPut(r) { try { await idb.put('rec', r); } catch (e) {} }
async function recDel(id) { try { await idb.del('rec', id); } catch (e) {} }

/* ---------- configuración ---------- */
const DEF = { foto_obligatoria: true, pasajeros_max: 120, pasajeros_alerta_min: 5, minutos_duplicado: 90, tolerancia_capacidad_pct: 10, noche_desde: 19, noche_hasta: 4, mostrar_ibao: true };
let CF = null, R = { ...DEF }, PL = new Map(), PCODES = [], RU = [], RBY = new Map(), cfgAt = 0;
const S = { ctrl: '', trq: '', turno: 'DIA', mov: 'Entrada', placa: '', ruta: '', touched: false, foto: null, fotoUrl: '', extras: {} };
let RECS = [], defs = [];

const opDay = () => ymd(new Date(Date.now() - Number(R.noche_hasta) * 3600e3));
const autoTurno = () => { const h = new Date().getHours(); return (h >= Number(R.noche_desde) || h < Number(R.noche_hasta)) ? 'NOCHE' : 'DIA'; };

function applyConfig(cfg) {
  CF = cfg; R = { ...DEF, ...(cfg.reglas || {}) };
  PL = new Map(cfg.placas.map(r => [r[0], { prov: r[1], cap: r[2], ibao: r[3], rutas: r[4] || [], ceco: r[5] }]));
  PCODES = cfg.placas.map(r => r[0]);
  RU = cfg.rutas.map(([n, z, c]) => ({ n, z, c, k: norm(n) }));
  RBY = new Map(RU.map(r => [r.k, r]));
  fillStart();
  buildFields();
  const el = $('foot-cfg'); if (el) el.textContent = 'Catálogos ' + (cfg.version || '') + (cfgAt ? ' · ' + new Date(cfgAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '');
}

function fillStart() {
  const sc = $('s-ctrl'), st = $('s-trq'), pc = sc.value || S.ctrl, pt = st.value || S.trq;
  sc.innerHTML = '<option value="">Selecciona</option>';
  CF.controladores.forEach(c => { const o = document.createElement('option'); o.value = c.n; o.textContent = c.n; sc.appendChild(o); });
  sc.value = CF.controladores.some(c => c.n === pc) ? pc : '';
  fillTrq(pt);
  $('go').disabled = !(sc.value && st.value);
}
function fillTrq(sel) {
  const st = $('s-trq'), c = CF.controladores.find(x => x.n === $('s-ctrl').value);
  st.innerHTML = '<option value="">Selecciona</option>';
  CF.tranqueras.filter(t => !c || !c.tranqueras.length || c.tranqueras.includes(t.id) || c.tranqueras.includes(t.n)).forEach(t => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.n; st.appendChild(o); });
  st.value = [...st.options].some(o => o.value === sel) ? sel : '';
}
$('s-ctrl').onchange = () => { fillTrq(''); $('go').disabled = true; };
$('s-trq').onchange = () => { $('go').disabled = !($('s-ctrl').value && $('s-trq').value); };
$('go').onclick = () => { S.ctrl = $('s-ctrl').value; S.trq = $('s-trq').value; S.turno = autoTurno(); ls.set('ctrl_sess', { ctrl: S.ctrl, trq: S.trq }); showMain(); };
$('chg').onclick = () => { $('v-main').hidden = true; $('v-start').hidden = false; $('s-ctrl').value = S.ctrl; fillTrq(S.trq); $('s-trq').value = S.trq; $('go').disabled = !(S.ctrl && S.trq); };

function showMain() {
  $('v-start').hidden = true; $('v-main').hidden = false;
  $('w-name').textContent = S.ctrl;
  const t = CF.tranqueras.find(x => x.id === S.trq); $('w-trq').textContent = t ? t.n : S.trq;
  setSeg('seg-turno', S.turno); setSeg('seg-mov', S.mov); renderList(); recompute();
}

/* ---------- segmentados ---------- */
function setSeg(id, v) { document.querySelectorAll('#' + id + ' button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(v)))); }
function bindSeg(id, fn) { $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; setSeg(id, b.dataset.v); fn(b.dataset.v); }); }
bindSeg('seg-mov', v => { S.mov = v; recompute(); renderList(); });
bindSeg('seg-turno', v => { S.turno = v; renderList(); });

/* ---------- campos dinámicos (hoja Campos) ---------- */
function resolveOpts(s) { s = String(s || '').trim(); if (s[0] === '@') return (CF.listas[s.slice(1)] || []).slice(); return s ? s.split('|').map(x => x.trim()).filter(Boolean) : []; }
function buildFields() {
  const P = $('fields-p'), M = $('fields-m'); P.innerHTML = ''; M.innerHTML = '';
  defs = CF.campos.filter(c => c.activo).sort((a, b) => a.orden - b.orden);
  S.extras = {};
  defs.forEach(c => {
    const w = document.createElement('div'); w.className = 'field'; w.id = 'cf-' + c.id;
    const lb = document.createElement('span'); lb.className = 'lbl'; lb.textContent = c.etiqueta + (c.obligatorio ? ' *' : ''); w.appendChild(lb);
    let ctl;
    const opts = c.tipo === 'sino' ? ['Sí', 'No'] : (c.tipo === 'lista' ? resolveOpts(c.opciones) : []);
    if ((c.tipo === 'lista' || c.tipo === 'sino') && opts.length && opts.length <= 4) {
      ctl = document.createElement('div'); ctl.className = 'seg';
      opts.forEach(o => { const b = document.createElement('button'); b.type = 'button'; b.dataset.v = o; b.textContent = o; b.setAttribute('aria-pressed', 'false'); ctl.appendChild(b); });
      ctl.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setField(c.id, b.dataset.v); });
    } else if (c.tipo === 'lista' || c.tipo === 'sino') {
      ctl = document.createElement('select'); ctl.innerHTML = '<option value="">—</option>';
      opts.forEach(o => { const op = document.createElement('option'); op.value = o; op.textContent = o; ctl.appendChild(op); });
      ctl.addEventListener('change', () => setField(c.id, ctl.value));
    } else {
      ctl = document.createElement('input'); ctl.type = 'text'; ctl.autocomplete = 'off';
      if (c.tipo === 'numero') ctl.inputMode = 'decimal';
      ctl.addEventListener('input', () => { S.extras[c.id] = ctl.value.trim(); recompute(); });
    }
    ctl.id = 'cfc-' + c.id; w.appendChild(ctl);
    (c.seccion === 'principal' ? P : M).appendChild(w);
    setField(c.id, c.defecto || '', true);
  });
  $('more').hidden = !M.children.length;
  updateVisibility();
}
function setField(id, v, silent) {
  S.extras[id] = v; const ctl = $('cfc-' + id); if (!ctl) return;
  if (ctl.classList.contains('seg')) ctl.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  else ctl.value = v;
  if (!silent) { updateVisibility(); recompute(); }
}
function visible(c) { if (!c.visible_si) return true; const m = String(c.visible_si).match(/^\s*([\w-]+)\s*(!=|=)\s*(.*)$/); if (!m) return true; const val = String(S.extras[m[1]] ?? ''); return m[2] === '=' ? val === m[3].trim() : val !== m[3].trim(); }
function updateVisibility() { defs.forEach(c => { const w = $('cf-' + c.id); if (w) w.hidden = !visible(c); }); }
function resetFields() { defs.forEach(c => setField(c.id, c.defecto || '', true)); updateVisibility(); }

/* ---------- foto ---------- */
const photoBtn = $('photo-btn'), fotoIn = $('foto');
photoBtn.addEventListener('click', () => fotoIn.click());
async function comprimir(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bmp = await createImageBitmap(file); }
  let b = null;
  for (const [lado, q] of [[960, 0.6], [960, 0.45], [800, 0.4], [640, 0.4]]) {
    const k = Math.min(1, lado / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    b = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    if (b.size <= 100000) break;   // objetivo: ~100 KB o menos por foto
  }
  return b;
}
fotoIn.addEventListener('change', async () => {
  const f = fotoIn.files && fotoIn.files[0]; if (!f) return;
  try {
    S.foto = await comprimir(f);
    if (S.fotoUrl) URL.revokeObjectURL(S.fotoUrl);
    S.fotoUrl = URL.createObjectURL(S.foto); showPhoto();
    $('placa').focus();
  } catch (e) { toast('No se pudo leer la foto. Intenta de nuevo.'); }
  fotoIn.value = ''; recompute();
});
function showPhoto() {
  const ok = !!S.foto;
  $('photo-empty').hidden = ok; $('photo-ok').hidden = !ok; photoBtn.classList.toggle('has', ok);
  if (ok) { $('photo-img').src = S.fotoUrl; $('photo-meta').textContent = 'Foto lista (' + Math.round(S.foto.size / 1024) + ' KB). Toca para repetir.'; }
}

/* ---------- placa ---------- */
const pl = $('placa');
function hideMenu(id) { $(id).hidden = true; $(id).innerHTML = ''; }
pl.addEventListener('input', () => { const v = pl.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); pl.value = v; onPlate(v, true); });
pl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $(S.ruta ? 'pasajeros' : 'ruta').focus(); } });
pl.addEventListener('blur', () => setTimeout(() => hideMenu('m-placa'), 150));
function activos() { return RECS.filter(r => r.estado === 'pend' || r.estado === 'ok'); }
function lastRouteToday(p) { let b = null; activos().forEach(r => { if (r.doc.placa === p && (!b || r.doc.ts > b.ts)) b = r.doc; }); return b && b.ruta; }
function badge(txt, cls) { const s = document.createElement('span'); s.className = 'badge ' + (cls || ''); s.textContent = txt; return s; }
function onPlate(v, advance) {
  S.placa = v; $('plen').textContent = v.length + '/6';
  const info = PL.get(v), box = $('pinfo'); hideMenu('m-placa');
  if (v.length < 6) {
    box.hidden = true;
    if (!S.touched) setRuta(''); renderChips([]);
    if (v.length >= 2) {
      const m = []; for (const c of PCODES) if (c.startsWith(v)) m.push(c);
      if (m.length < 5) for (const c of PCODES) if (!c.startsWith(v) && c.includes(v)) m.push(c);
      const mm = $('m-placa');
      m.slice(0, 5).forEach(c => {
        const b = document.createElement('button'); b.type = 'button';
        const a = document.createElement('span'); a.className = 'm1'; a.textContent = c;
        const z = document.createElement('span'); z.className = 'm2'; z.textContent = PL.get(c).prov || '';
        b.append(a, z); b.addEventListener('pointerdown', ev => { ev.preventDefault(); pl.value = c; onPlate(c, true); }); mm.appendChild(b);
      });
      mm.hidden = !mm.children.length;
    }
  } else if (info) {
    box.className = 'pinfo'; box.hidden = false; box.innerHTML = '';
    const a = document.createElement('b'); a.textContent = info.prov || 'Proveedor sin nombre en el maestro'; box.appendChild(a);
    const bd = document.createElement('div'); bd.className = 'badges';
    if (R.mostrar_ibao) bd.appendChild(info.ibao === 'Sí' ? badge('IBAO: registrada', 'ok') : info.ibao === 'No' ? badge('IBAO: no registrada', 'no') : badge('IBAO: sin dato'));
    if (info.cap) bd.appendChild(badge('Capacidad ' + info.cap));
    box.appendChild(bd);
    const rs = []; const lt = lastRouteToday(v); if (lt) rs.push(lt); info.rutas.forEach(r => { if (!rs.includes(r)) rs.push(r); });
    if (!S.touched && rs[0]) setRuta(rs[0]);
    renderChips(rs.slice(0, 3));
    const cd = defs.find(d => d.columna === 'CECO'); if (cd && info.ceco && resolveOpts(cd.opciones).includes(info.ceco)) setField(cd.id, info.ceco);
    if (advance) $(S.ruta ? 'pasajeros' : 'ruta').focus();
  } else {
    box.className = 'pinfo new'; box.hidden = false; box.innerHTML = '';
    const a = document.createElement('b'); a.textContent = 'Placa nueva: no está en el maestro';
    const s = document.createElement('span'); s.textContent = 'Se guarda igual con su foto y queda en "Por mapear".';
    box.append(a, s); renderChips([]); if (advance) $('ruta').focus();
  }
  recompute();
}

/* ---------- ruta ---------- */
const ru = $('ruta');
function setRuta(v) { S.ruta = v; ru.value = v; const r = RBY.get(norm(v)); $('zona').textContent = r && r.z ? 'Zona: ' + r.z : ''; document.querySelectorAll('#chips .chip').forEach(c => c.setAttribute('aria-pressed', String(c.textContent === v))); }
function renderChips(list) {
  const c = $('chips'); c.innerHTML = ''; if (list.length < 2) return;
  list.forEach(r => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = r; b.setAttribute('aria-pressed', String(r === S.ruta)); b.onclick = () => { S.touched = true; setRuta(r); recompute(); $('pasajeros').focus(); }; c.appendChild(b); });
}
function rutaMatches(q) {
  const t = norm(q).split(/\s+/).filter(Boolean); if (!t.length) return [];
  const o = RU.filter(r => t.every(x => r.k.includes(x)));
  o.sort((a, b) => (b.k.startsWith(t[0]) - a.k.startsWith(t[0])) || a.n.length - b.n.length); return o.slice(0, 6);
}
ru.addEventListener('input', () => {
  S.touched = true; setRuta(ru.value);
  const m = rutaMatches(ru.value), mm = $('m-ruta'); mm.innerHTML = '';
  if (m.length && !(m.length === 1 && m[0].n === ru.value)) {
    m.forEach(x => {
      const b = document.createElement('button'); b.type = 'button';
      const a = document.createElement('span'); a.textContent = x.n; const z = document.createElement('span'); z.className = 'm2'; z.textContent = x.z; b.append(a, z);
      b.addEventListener('pointerdown', ev => { ev.preventDefault(); S.touched = true; setRuta(x.n); hideMenu('m-ruta'); recompute(); $('pasajeros').focus(); }); mm.appendChild(b);
    });
    mm.hidden = false;
  } else mm.hidden = true;
  recompute();
});
ru.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!$('m-ruta').hidden) { const x = rutaMatches(ru.value)[0]; if (x) { S.touched = true; setRuta(x.n); } } hideMenu('m-ruta'); recompute(); $('pasajeros').focus(); } });
ru.addEventListener('blur', () => setTimeout(() => hideMenu('m-ruta'), 150));

/* ---------- pasajeros y validación ---------- */
const px = $('pasajeros');
px.addEventListener('input', () => { px.value = px.value.replace(/\D/g, '').slice(0, 3); recompute(); });
px.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
$('reg').onclick = submit;
function recent() { const lim = Date.now() - Number(R.minutos_duplicado) * 60000; return activos().filter(r => r.doc.placa === S.placa && r.doc.mov === S.mov && r.doc.ts > lim).sort((a, b) => b.doc.ts - a.doc.ts)[0]; }
function recompute() {
  if ($('v-main').hidden) return;
  const n = px.value === '' ? null : Number(px.value), info = PL.get(S.placa), w = [];
  const okPlate = /^[A-Z0-9]{6}$/.test(S.placa), okRuta = S.ruta.trim().length > 0, okN = n !== null && n <= Number(R.pasajeros_max);
  const okFoto = !R.foto_obligatoria || !!S.foto;
  const dup = okPlate ? recent() : null;
  if (dup) { const t = new Date(dup.doc.ts); w.push(['Ya registrada a las ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ' (' + dup.doc.mov + ', ' + dup.doc.ruta + '). Si es otro viaje, registra igual.', 0]); }
  if (okRuta && !RBY.has(norm(S.ruta))) w.push(['Ruta fuera del catálogo: se guarda como ruta nueva.', 0]);
  if (n !== null && n > Number(R.pasajeros_max)) w.push(['Más de ' + R.pasajeros_max + ' pasajeros: revisa el número.', 1]);
  const cap = info && info.cap;
  if (n !== null && cap && n > Math.round(cap * (1 + Number(R.tolerancia_capacidad_pct) / 100)) && okN) w.push(['Supera la capacidad de la unidad (' + cap + ').', 0]);
  if (n !== null && n < Number(R.pasajeros_alerta_min) && okN) w.push([n === 0 ? 'Cero pasajeros: confirma que el bus ingresó vacío.' : 'Solo ' + n + ' pasajeros: confirma el número.', 0]);
  const ww = $('warns'); ww.innerHTML = ''; w.forEach(([t, bad]) => { const d = document.createElement('div'); d.className = 'warn' + (bad ? ' bad' : ''); d.textContent = t; ww.appendChild(d); });
  const occ = $('occ');
  if (n !== null && cap && okN) { const pct = Math.round(n / cap * 100); occ.hidden = false; $('bar').className = 'bar' + (pct > 100 ? ' over' : ''); $('bar').firstElementChild.style.width = Math.min(pct, 100) + '%'; $('occ-t').textContent = 'Ocupación ' + pct + '% de ' + cap + ' asientos'; } else occ.hidden = true;
  const falt = defs.filter(c => c.obligatorio && visible(c) && String(S.extras[c.id] ?? '').trim() === '');
  const ok = okPlate && okRuta && okN && okFoto && !falt.length;
  const b = $('reg'); b.disabled = !ok; b.textContent = dup ? 'Registrar otro viaje' : 'Registrar unidad'; b.classList.toggle('again', !!dup && ok);
  photoBtn.classList.toggle('req', !!R.foto_obligatoria);
  const miss = [!okFoto && 'foto', !okPlate && 'placa (6 caracteres)', !okRuta && 'ruta', !okN && 'pasajeros'].filter(Boolean).concat(falt.map(c => c.etiqueta));
  $('hint').textContent = ok ? 'Enter en pasajeros también registra' : 'Falta: ' + miss.join(', ');
}

/* ---------- guardar ---------- */
const newId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
async function submit() {
  if ($('reg').disabled) return;
  const now = new Date(), info = PL.get(S.placa), can = RBY.get(norm(S.ruta));
  const extras = {}; defs.forEach(c => { const v = S.extras[c.id]; if (visible(c) && v !== undefined && String(v) !== '') extras[c.columna || c.etiqueta] = v; });
  const doc = {
    id: newId(), ts: now.getTime(), fecha: ymd(now), hora: pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
    dia: opDay(), semana: isoWeek(now), ctrl: S.ctrl, trq: S.trq, turno: S.turno, mov: S.mov, placa: S.placa,
    ruta: can ? can.n : S.ruta.trim(), zona: can ? can.z : '', pas: Number(px.value), ibao: info ? info.ibao : '', nueva: !info, extras
  };
  const rec = { id: doc.id, estado: 'pend', doc, foto: S.foto || null, intentos: 0 };
  RECS.push(rec); await recPut(rec);
  lastId = rec.id; toast(S.placa + ' registrada · ' + doc.pas + ' pasajeros', true);
  resetForm(); renderList(); setStatus(); setTimeout(sync, 400);
}
function resetForm() {
  S.placa = ''; S.touched = false; pl.value = ''; $('plen').textContent = '0/6'; px.value = ''; $('pinfo').hidden = true; renderChips([]); setRuta('');
  S.foto = null; if (S.fotoUrl) URL.revokeObjectURL(S.fotoUrl); S.fotoUrl = ''; showPhoto();
  resetFields(); $('more').open = false; recompute();
  // primer paso del siguiente bus: la foto (si es obligatoria) o la placa
  (R.foto_obligatoria ? photoBtn : pl).focus();
}

/* ---------- envío (cola) ---------- */
let syncing = false, netOk = true, retryT = null, lastId = null, authErr = false;
const toB64 = blob => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1]); f.onerror = rej; f.readAsDataURL(blob); });
async function post(payload) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, token: TOKEN }), signal: ctl.signal });
    return await r.json();
  } finally { clearTimeout(to); }
}
async function sync() {
  if (syncing || !hasApi()) { setStatus(); return; }
  syncing = true; clearTimeout(retryT); setStatus();
  try {
    for (;;) {
      const pend = RECS.filter(r => r.estado === 'pend').sort((a, b) => a.doc.ts - b.doc.ts).slice(0, 6);
      const an = RECS.filter(r => r.estado === 'anul').slice(0, 30);
      if (!pend.length && !an.length) break;
      if (pend.length) {
        const regs = []; for (const r of pend) { const o = { ...r.doc }; if (r.foto) o.fotoB64 = await toB64(r.foto); regs.push(o); }
        const res = await post({ action: 'registrar', registros: regs });
        if (!res.ok) { if (res.error === 'token') authErr = true; throw new Error(res.error || 'servidor'); }
        authErr = false; let fallo = false;
        for (const x of res.resultados) { const r = RECS.find(q => q.id === x.id); if (!r) continue; if (x.ok) { r.estado = 'ok'; r.foto = null; } else { r.intentos++; fallo = true; } await recPut(r); }
        if (fallo) throw new Error('registro rechazado');
      }
      if (an.length) {
        const res = await post({ action: 'anular', ids: an.map(r => r.id) });
        if (!res.ok) throw new Error(res.error || 'servidor');
        for (const x of res.resultados) { const r = RECS.find(q => q.id === x.id); if (r && x.ok) { r.estado = 'anulado'; await recPut(r); } }
      }
      netOk = true; renderList(); setStatus();
    }
    netOk = true;
  } catch (e) { netOk = false; retryT = setTimeout(sync, 12000); }
  finally { syncing = false; setStatus(); renderList(); }
}
function setStatus() {
  const n = RECS.filter(r => r.estado === 'pend' || r.estado === 'anul').length;
  let cls = '', txt;
  if (!hasApi()) { cls = 'off'; txt = n ? n + ' guardados solo en este equipo (falta configurar el servidor)' : 'Modo prueba: sin servidor'; }
  else if (authErr) { cls = 'off'; txt = 'Código de acceso inválido (' + n + ' pendientes)'; }
  else if (n && syncing) { cls = 'wait'; txt = 'Enviando ' + n + '…'; }
  else if (n) { cls = netOk ? 'wait' : 'off'; txt = n + ' pendientes' + (netOk ? '' : ' · sin señal'); }
  else { txt = 'Todo enviado'; }
  document.querySelectorAll('[data-dot]').forEach(d => d.className = 'dot ' + cls);
  document.querySelectorAll('[data-stat]').forEach(s => s.textContent = txt);
}
window.addEventListener('online', () => { sync(); refreshConfig(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { sync(); refreshConfig(); } });
setInterval(() => { if (RECS.some(r => r.estado === 'pend' || r.estado === 'anul')) sync(); }, 20000);

async function refreshConfig(force) {
  if (!hasApi() || (!force && Date.now() - cfgAt < 10 * 60000)) return;
  try {
    const r = await fetch(API + (API.includes('?') ? '&' : '?') + 'action=config&token=' + encodeURIComponent(TOKEN));
    const j = await r.json();
    if (j.ok && j.config) {
      cfgAt = Date.now(); await metaPut('config', { cfg: j.config, at: cfgAt });
      if (!CF || CF.version !== j.config.version) { const idle = !S.placa && !px.value; if (idle || $('v-main').hidden) applyConfig(j.config); else pendingCfg = j.config; }
    }
  } catch (e) { /* sin señal: se queda la configuración guardada */ }
}
let pendingCfg = null;

/* ---------- toast, anular ---------- */
let toastT = null;
function toast(msg, undo) {
  const t = $('toast'); t.innerHTML = ''; const s = document.createElement('span'); s.textContent = msg; t.appendChild(s);
  if (undo) { const b = document.createElement('button'); b.textContent = 'Deshacer'; b.onclick = () => { if (lastId) anular(lastId); t.hidden = true; }; t.appendChild(b); }
  t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 6000);
}
async function anular(id) {
  const r = RECS.find(x => x.id === id); if (!r) return;
  if (r.estado === 'pend') { RECS = RECS.filter(x => x.id !== id); await recDel(id); }
  else if (r.estado === 'ok') { r.estado = 'anul'; await recPut(r); setTimeout(sync, 200); }
  renderList(); setStatus(); recompute();
}

/* ---------- lista y contadores ---------- */
function renderList() {
  if ($('v-main').hidden) return;
  const all = activos().filter(r => r.doc.dia === opDay() && r.doc.trq === S.trq).sort((a, b) => b.doc.ts - a.doc.ts);
  const turno = all.filter(r => r.doc.turno === S.turno && r.doc.mov === S.mov);
  const pax = turno.reduce((a, r) => a + r.doc.pas, 0);
  $('k-bus').textContent = turno.length; $('k-pax').textContent = pax.toLocaleString('es-PE'); $('k-avg').textContent = turno.length ? Math.round(pax / turno.length) : '–';
  $('l-sub').textContent = S.mov + ' · turno ' + (S.turno === 'DIA' ? 'día' : 'noche');
  $('foot-day').textContent = 'Día operativo ' + opDay();
  const L = $('list'); L.innerHTML = '';
  if (!all.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'Aún no hay registros en esta tranquera. El primero aparece aquí apenas lo guardes.'; L.appendChild(d); return; }
  all.slice(0, 12).forEach(r => {
    const d = r.doc, row = document.createElement('div'); row.className = 'row';
    const t = document.createElement('span'); t.className = 't'; t.textContent = d.hora.slice(0, 5);
    const p = document.createElement('span'); p.className = 'p'; p.textContent = d.placa;
    const tags = document.createElement('span'); tags.className = 'tags';
    const tm = document.createElement('span'); tm.className = 'tag'; tm.textContent = d.mov === 'Entrada' ? 'E' : 'S'; tags.appendChild(tm);
    if (r.estado === 'pend') { const q = document.createElement('span'); q.className = 'tag p'; q.textContent = 'sin enviar'; tags.appendChild(q); }
    if (d.nueva) { const q = document.createElement('span'); q.className = 'tag p'; q.textContent = 'placa nueva'; tags.appendChild(q); }
    const n = document.createElement('span'); n.className = 'n'; n.textContent = d.pas;
    const x = document.createElement('button'); x.className = 'link'; x.textContent = 'Anular';
    let arm = false, tmr; x.onclick = () => { if (!arm) { arm = true; x.textContent = '¿Seguro?'; x.classList.add('arm'); tmr = setTimeout(() => { arm = false; x.textContent = 'Anular'; x.classList.remove('arm'); }, 3000); } else { clearTimeout(tmr); anular(r.id); } };
    const rr = document.createElement('span'); rr.className = 'r'; rr.textContent = d.ruta;
    row.append(t, p, tags, n, x, rr); L.appendChild(row);
  });
}

/* ---------- arranque ---------- */
(async function init() {
  try { RECS = (await idb.all('rec')) || []; } catch (e) { RECS = []; }
  const limite = Date.now() - 3 * 864e5;
  for (const r of RECS.filter(r => (r.estado === 'ok' || r.estado === 'anulado') && r.doc.ts < limite)) await recDel(r.id);
  RECS = RECS.filter(r => !((r.estado === 'ok' || r.estado === 'anulado') && r.doc.ts < limite));
  const saved = await metaGet('config');
  if (saved && saved.cfg) { cfgAt = saved.at || 0; applyConfig(saved.cfg); }
  else {
    try { const r = await fetch('seed.json'); if (!r.ok) throw new Error('sin semilla'); applyConfig(await r.json()); }
    catch (e) { await refreshConfig(true); }   // sin copia inicial: se descargan de la hoja (requiere señal la primera vez)
    if (!CF) $('cfg-note').textContent = 'No se pudieron cargar los catálogos. Abre la app una vez con señal.';
  }
  const sess = ls.get('ctrl_sess');
  if (CF && sess && CF.controladores.some(c => c.n === sess.ctrl) && CF.tranqueras.some(t => t.id === sess.trq)) { S.ctrl = sess.ctrl; S.trq = sess.trq; S.turno = autoTurno(); showMain(); }
  else $('v-start').hidden = false;
  $('cfg-note').textContent = hasApi() ? '' : 'Modo prueba: falta configurar el servidor en config.js. Los registros quedan solo en este equipo.';
  setStatus(); refreshConfig(true); sync();
  setInterval(() => { refreshConfig(); if (pendingCfg && !S.placa && !px.value) { applyConfig(pendingCfg); pendingCfg = null; } }, 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
})();
