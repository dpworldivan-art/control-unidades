/* Vista supervisor: solo lectura. Pide los datos al servidor con la clave de supervisores. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const API = (window.CTRL_CFG && window.CTRL_CFG.api) || '', TOKEN = (window.CTRL_CFG && window.CTRL_CFG.token) || '';
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
// columnas de cada registro que devuelve el servidor
const F = 0, H = 1, C = 2, T = 3, P = 4, U = 5, TID = 6, I = 7, N = 8, E = 9, FO = 10, R = 11, ID = 12, M = 13;
let D = null, clave = '';

async function pedir(desde, hasta) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'supervisor', token: TOKEN, clave, desde, hasta }) });
  return r.json();
}
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; setTimeout(() => { el.hidden = true; }, 3000); }

/* ---------- acceso ---------- */
async function entrar(auto) {
  clave = auto ? (ls.get('sv_clave') || '') : $('clave').value.trim();
  if (!clave) { $('s-login').hidden = false; return; }
  $('login-msg').textContent = 'Entrando…';
  try {
    const hoy = new Date(), d0 = new Date(hoy.getTime() - 6 * 864e5);
    const d = await pedir($('f-desde').value || ymd(d0), $('f-hasta').value || ymd(hoy));
    if (!d.ok) { $('login-msg').textContent = d.error === 'clave' ? 'Clave incorrecta.' : 'No se pudo entrar (' + d.error + ').'; ls.del('sv_clave'); $('s-login').hidden = false; return; }
    ls.set('sv_clave', clave); D = d; $('s-login').hidden = true; $('s-app').hidden = false;
    $('f-desde').value = d.desde; $('f-hasta').value = d.hasta; llenarFiltros(); pintar();
  } catch (e) { $('login-msg').textContent = 'Sin conexión con el servidor. Revisa la señal.'; $('s-login').hidden = false; }
}
$('entrar').onclick = () => entrar(false);
$('clave').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(false); });
$('salir').onclick = () => { ls.del('sv_clave'); location.reload(); };
async function recargar() {
  $('gen').textContent = 'Actualizando…';
  try { const d = await pedir($('f-desde').value, $('f-hasta').value); if (!d.ok) { toast(d.error === 'rango' ? 'El rango máximo es de 60 días.' : 'No se pudo actualizar.'); $('gen').textContent = 'Error'; return; } D = d; llenarFiltros(); pintar(); }
  catch (e) { toast('Sin conexión.'); $('gen').textContent = 'Sin conexión'; }
}
$('recargar').onclick = recargar;
$('f-desde').onchange = recargar; $('f-hasta').onchange = recargar;
['f-turno', 'f-trq', 'f-ctrl'].forEach(id => { $(id).onchange = pintar; });

function llenarFiltros() {
  const fill = (id, vals, todo) => { const s = $(id), cur = s.value; s.innerHTML = '<option value="">' + todo + '</option>'; [...new Set(vals)].filter(Boolean).sort().forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; s.appendChild(o); }); s.value = [...s.options].some(o => o.value === cur) ? cur : ''; };
  fill('f-trq', D.rows.map(r => r[T]).concat(D.turnos.map(t => t[2])), 'Todas'); fill('f-ctrl', D.rows.map(r => r[C]).concat(D.turnos.map(t => t[1])), 'Todos');
}
const filtros = () => ({ turno: $('f-turno').value, trq: $('f-trq').value, ctrl: $('f-ctrl').value });
function rowsF() { const f = filtros(); return D.rows.filter(r => r[E] !== 'ANULADO' && (!f.turno || r[U] === f.turno) && (!f.trq || r[T] === f.trq) && (!f.ctrl || r[C] === f.ctrl)); }
function turnosF() { const f = filtros(); return D.turnos.filter(t => (!f.turno || t[3] === f.turno) && (!f.trq || t[2] === f.trq) && (!f.ctrl || t[1] === f.ctrl)); }

/* ---------- utilidades ---------- */
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
const fmt = n => Number(n).toLocaleString('es-PE');
const hm = ts => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dur = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad(m % 60) + ' min'; };
function tabla(id, head, filas, opts) {
  const t = $(id); t.innerHTML = '';
  const th = el('tr'); head.forEach(h => th.appendChild(el('th', '', h))); const thead = el('thead'); thead.appendChild(th); t.appendChild(thead);
  const tb = el('tbody');
  if (!filas.length) { const tr = el('tr'), td = el('td', 'empty-t', 'Sin datos en este rango.'); td.colSpan = head.length; tr.appendChild(td); tb.appendChild(tr); }
  filas.forEach(f => { const tr = el('tr'); f.forEach((c, i) => { const td = el('td', (opts && opts.warn && opts.warn.includes(i) && Number(c) > 0) ? 'warnc' : '', c && c.txt !== undefined ? c.txt : c); if (c && c.bar !== undefined) { const b = el('span', 'bar2'); b.style.width = c.bar + 'px'; td.appendChild(b); } tr.appendChild(td); }); tb.appendChild(tr); });
  t.appendChild(tb);
}

/* ---------- pintar ---------- */
function pintar() {
  const rs = rowsF(), ts = turnosF();
  $('gen').textContent = 'Datos al ' + D.generado.slice(5, 16).replace('-', '/');
  const noIbao = rs.filter(r => r[I] !== 'Sí');
  const placasRev = new Set(noIbao.map(r => r[P]));
  const kp = $('kpis'); kp.innerHTML = '';
  [['Buses registrados', rs.length, ''], ['Turnos', ts.length, ''], ['Placas fuera de IBAO', placasRev.size, placasRev.size ? 'alert' : ''], ['Registros fuera de IBAO', noIbao.length, noIbao.length ? 'alert' : '']].forEach(([l, v, c]) => { const k = el('div', 'kpi ' + c); k.append(el('b', '', fmt(v)), el('span', '', l)); kp.appendChild(k); });
  $('n-rev').textContent = placasRev.size;

  // por día y turno
  const dias = {}; rs.forEach(r => { const d = dias[r[F]] = dias[r[F]] || { DIA: 0, NOCHE: 0, ibao: 0 }; d[r[U]] = (d[r[U]] || 0) + 1; if (r[I] !== 'Sí') d.ibao++; });
  const lista = Object.keys(dias).sort().reverse(), max = Math.max(1, ...lista.map(k => dias[k].DIA + dias[k].NOCHE));
  tabla('tb-dia', ['Día', 'Turno día', 'Turno noche', 'Total', 'Fuera de IBAO'], lista.map(k => [k, dias[k].DIA, dias[k].NOCHE, { txt: dias[k].DIA + dias[k].NOCHE, bar: Math.round((dias[k].DIA + dias[k].NOCHE) / max * 50) }, dias[k].ibao]), { warn: [4] });

  // por controlador (turnos con duración: buses por hora de sus turnos cerrados)
  const cs = {}; rs.forEach(r => { const c = cs[r[C]] = cs[r[C]] || { n: 0, ibao: 0, ms: 0, tn: 0, tb: 0 }; c.n++; if (r[I] !== 'Sí') c.ibao++; });
  ts.forEach(t => { const c = cs[t[1]] = cs[t[1]] || { n: 0, ibao: 0, ms: 0, tn: 0, tb: 0 }; c.tn++; if (t[6] && t[5]) { c.ms += t[6] - t[5]; c.tb += t[8]; } });
  tabla('tb-ctrl', ['Controlador', 'Turnos', 'Buses', 'Buses por hora', 'Fuera de IBAO'], Object.keys(cs).sort().map(k => { const c = cs[k]; return [k, c.tn, c.n, c.ms > 0 ? Math.round(c.tb / (c.ms / 3600e3)) : '–', c.ibao]; }), { warn: [4] });

  // por tranquera
  const qs = {}; rs.forEach(r => { const q = qs[r[T]] = qs[r[T]] || { DIA: 0, NOCHE: 0, ibao: 0 }; q[r[U]] = (q[r[U]] || 0) + 1; if (r[I] !== 'Sí') q.ibao++; });
  tabla('tb-trq', ['Tranquera', 'Turno día', 'Turno noche', 'Total', 'Fuera de IBAO'], Object.keys(qs).sort().map(k => [k, qs[k].DIA, qs[k].NOCHE, qs[k].DIA + qs[k].NOCHE, qs[k].ibao]), { warn: [4] });

  // turnos
  const ahora = Date.now();
  tabla('tb-tur', ['Día', 'Controlador', 'Tranquera', 'Turno', 'Inicio', 'Cierre', 'Duración', 'Buses', 'Estado'],
    ts.slice().sort((a, b) => b[5] - a[5]).map(t => { const largo = !t[6] && ahora - t[5] > 14 * 3600e3; return [t[4], t[1], t[2], t[3] === 'DIA' ? 'Día' : 'Noche', t[5] ? hm(t[5]) : '–', t[6] ? hm(t[6]) : '–', t[6] && t[5] ? dur(t[6] - t[5]) : (t[5] ? dur(ahora - t[5]) + '…' : '–'), t[8], largo ? 'ABIERTO > 14 h' : (t[7] === 'ABIERTO' ? 'Abierto' : 'Cerrado')]; }));
  revisar(noIbao);
}

/* ---------- placas por revisar ---------- */
function lev(a, b) { if (a === b) return 0; const m = a.length, n = b.length; if (Math.abs(m - n) > 1) return 9; let d = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= n; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } } return d[n]; }
const CONF = { O: '0', '0': 'O', I: '1', '1': 'I', B: '8', '8': 'B', S: '5', '5': 'S', Z: '2', '2': 'Z' };
function parecidas(p) {
  const out = []; for (const [c, prov, est] of D.master) { if (c === p) continue; const d = lev(p, c); if (d <= 1) out.push([c, prov, est, d]); }
  return out.slice(0, 4);
}
function revisar(noIbao) {
  const L = $('rev-list'); L.innerHTML = '';
  const g = {}; noIbao.forEach(r => { (g[r[P]] = g[r[P]] || []).push(r); });
  const ks = Object.keys(g).sort((a, b) => g[b].length - g[a].length || (g[b][g[b].length - 1][F] + g[b][g[b].length - 1][H]).localeCompare(g[a][g[a].length - 1][F] + g[a][g[a].length - 1][H]));
  $('rev-note').textContent = ks.length ? 'Placas registradas que no están activas en IBAO. Compara con la foto y avisa al controlador si fue un error de digitación.' : 'No hay placas fuera de IBAO en este rango. Todo cuadra.';
  ks.forEach(p => {
    const rs = g[p].slice().sort((a, b) => (a[F] + a[H]).localeCompare(b[F] + b[H])), ult = rs[rs.length - 1];
    const inactiva = rs.every(r => r[I] === 'Inactiva'), card = el('div', 'rev');
    const h = el('div', 'rev-h'); h.appendChild(el('span', 'p', p)); h.appendChild(el('span', 'tag ' + (inactiva ? 'warn' : 'bad'), inactiva ? 'inactiva en IBAO' : 'no está en IBAO')); h.appendChild(el('span', 'tag', rs.length + (rs.length === 1 ? ' registro' : ' registros'))); card.appendChild(h);
    const ctrls = [...new Set(rs.map(r => r[C]))].join(', '), trqs = [...new Set(rs.map(r => r[T]))].join(', ');
    card.appendChild(el('div', 'meta', 'Último: ' + ult[F] + ' ' + ult[H] + ' · ' + ctrls + ' · tranquera ' + trqs + ' · ' + (ult[U] === 'DIA' ? 'turno día' : 'turno noche') + ' · ruta ' + ult[R]));
    const sim = parecidas(p);
    if (sim.length && !inactiva) { const s = el('div', 'sim'); s.appendChild(el('span', '', '¿Quiso decir?')); sim.forEach(([c, prov, est]) => { const t = el('span', 'tag ok', c + (est !== 'ACTIVO' ? ' (inactiva)' : '')); t.title = prov; s.appendChild(t); }); card.appendChild(s); }
    const a = el('div', 'acts');
    const foto = rs.slice().reverse().find(r => /^https?:/.test(r[FO])); if (foto) { const l = el('a', '', 'Ver foto'); l.href = foto[FO]; l.target = '_blank'; l.rel = 'noopener'; a.appendChild(l); }
    const b = el('button', '', 'Copiar aviso para WhatsApp'); b.type = 'button';
    b.onclick = async () => {
      const dest = ult[C], sug = sim.length && !inactiva ? ' ¿Podría ser ' + sim[0][0] + '?' : '';
      const msg = 'Hola ' + dest + ', revisa la placa ' + p + ' que registraste el ' + ult[F] + ' a las ' + ult[H] + ' en la tranquera ' + ult[T] + ': ' + (inactiva ? 'figura inactiva en IBAO.' : 'no figura en IBAO.') + sug + ' Compárala con la foto y dime si fue error de digitación.' + (foto ? ' Foto: ' + foto[FO] : '');
      try { await navigator.clipboard.writeText(msg); toast('Aviso copiado. Pégalo en WhatsApp.'); } catch (e) { prompt('Copia este mensaje:', msg); }
    };
    a.appendChild(b); card.appendChild(a); L.appendChild(card);
  });
}

/* ---------- pestañas ---------- */
function tab(n) { [['t-res', 'p-res'], ['t-rev', 'p-rev'], ['t-tur', 'p-tur']].forEach(([t, p]) => { $(t).setAttribute('aria-pressed', String(t === n)); $(p).hidden = t !== n; }); }
$('t-res').onclick = () => tab('t-res'); $('t-rev').onclick = () => tab('t-rev'); $('t-tur').onclick = () => tab('t-tur');

if (ls.get('sv_clave')) entrar(true); else $('s-login').hidden = false;
})();
