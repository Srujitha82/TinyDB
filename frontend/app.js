const API = 'http://127.0.0.1:5050/api';
const NEEDS = ['food', 'medicine', 'water', 'blankets', 'shelter'];
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let editing = null, current = 'dashboard';

let DEMO = false;
async function api(path, opts = {}) {
  const t = performance.now(); let ok, status, data;
  if (DEMO) { const r = await window.demoApi(path, opts); status = r.status; ok = status < 400; data = r.data; }
  else {
    const res = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    ok = res.ok; status = res.status; data = await res.json().catch(() => ({}));
  }
  if (data.query) { $('#q').textContent = data.query; $('#ms').textContent = (performance.now() - t).toFixed(0) + ' ms'; }
  if (!ok) throw new Error(data.error || 'Request failed (' + status + ')');
  return data;
}
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(t._h); t._h = setTimeout(() => t.className = '', 2600); }
async function run(fn) { try { await fn(); } catch (e) { toast(e.message, true); } }
const tags = h => (h.needs || []).map(n => `<span class="tag${n === 'medicine' ? ' hot' : ''}">${esc(n)}</span>`).join('');

const views = {
  async dashboard(v) {
    const s = await api('/stats'); const max = Math.max(1, ...Object.values(s.zones));
    v.innerHTML = `<div class="grid g4">
      <div class="card stat"><b>${s.households}</b><span>Households registered</span></div>
      <div class="card stat"><b>${s.people}</b><span>People covered</span></div>
      <div class="card stat"><b>${s.served}/${s.households}</b><span>Households served</span></div>
      <div class="card stat"><b>${s.distributions}</b><span>Distributions logged</span></div></div>
      <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Urgent: serve these first</h2>${s.triage.length ? `<table><tr><th>Family</th><th>Zone</th><th>Needs</th><th>Score</th></tr>${s.triage.map(h => `<tr><td>${esc(h.family)}</td><td>${esc(h.zone)}</td><td>${tags(h)}</td><td><b>${h.priority}</b></td></tr>`).join('')}</table>` : '<div class="empty">Everyone registered has been served, or no data yet. Try "Load sample data" in Tools.</div>'}
      <p style="color:var(--mute);font-size:12px">Score = members + 3 per infant + 2 per elderly + 2 if medicine needed.</p></div>
      <div><div class="card"><h2>Households by zone</h2>${Object.entries(s.zones).map(([z, n]) => `<div class="zonebar"><b style="width:24px">${esc(z)}</b><i style="width:${n / max * 70}%"></i>${n}</div>`).join('') || '<div class="empty">No data</div>'}</div>
      <div class="card" style="margin-top:16px"><h2>Low stock (under 20)</h2>${s.low_stock.length ? s.low_stock.map(x => `<span class="tag hot">${esc(x.item)}: ${x.qty}</span>`).join('') : '<span class="tag good">All supplies healthy</span>'}</div></div></div>`;
  },

  async households(v) {
    v.innerHTML = `<div class="bar">
      <input id="f-q" placeholder="Search family…"><select id="f-zone"><option value="">All zones</option></select>
      <select id="f-need"><option value="">Any need</option>${NEEDS.map(n => `<option>${n}</option>`).join('')}</select>
      <input id="f-min" type="number" min="1" placeholder="Min members" style="width:130px">
      <button class="btn" id="add">＋ Add household</button></div><div id="form"></div><div class="card" id="list"></div>`;
    const load = async () => {
      const p = new URLSearchParams({ q: $('#f-q').value, zone: $('#f-zone').value, need: $('#f-need').value, min_members: $('#f-min').value });
      for (const [k, val] of [...p]) if (!val) p.delete(k);
      const zs = [...new Set((await api('/households')).items.map(h => h.zone))].sort(); const cur = $('#f-zone').value;
      const d = await api('/households?' + p);
      $('#f-zone').innerHTML = '<option value="">All zones</option>' + zs.map(z => `<option${z === cur ? ' selected' : ''}>${esc(z)}</option>`).join('');
      $('#list').innerHTML = d.items.length ? `<table><tr><th>Family</th><th>Zone</th><th>Members</th><th>Needs</th><th>Vulnerable</th><th>Status</th><th></th></tr>${d.items.map(h => `<tr>
        <td><b>${esc(h.family)}</b>${h.notes ? `<br><small style="color:var(--mute)">${esc(h.notes)}</small>` : ''}</td><td>${esc(h.zone)}</td><td>${h.members}</td><td>${tags(h)}</td>
        <td>${h.vulnerable.elderly} elderly, ${h.vulnerable.infants} infants</td><td>${h.served ? '<span class="tag good">served</span>' : '<span class="tag hot">pending</span>'}</td>
        <td><button class="btn ghost sm" data-edit="${h.id}">Edit</button> <button class="btn red sm" data-del="${h.id}">Delete</button></td></tr>`).join('')}</table>` : '<div class="empty">No households match.</div>';
      $('#list').onclick = e => {
        const ed = e.target.dataset.edit, dl = e.target.dataset.del;
        if (ed) { editing = d.items.find(h => h.id == ed); form(); }
        if (dl && confirm('Delete this household?')) run(async () => { await api('/households/' + dl, { method: 'DELETE' }); toast('Household deleted'); load(); });
      };
    };
    const form = () => {
      const h = editing || { family: '', zone: '', members: 1, needs: [], vulnerable: { elderly: 0, infants: 0 }, notes: '' };
      $('#form').innerHTML = `<form class="card" id="hf"><label>Family<input name="family" value="${esc(h.family)}" required></label>
        <label>Zone<input name="zone" value="${esc(h.zone)}" maxlength="3" required></label><label>Members<input name="members" type="number" min="1" value="${h.members}"></label>
        <label>Elderly / Infants<span style="display:flex;gap:6px"><input name="elderly" type="number" min="0" value="${h.vulnerable.elderly}" style="width:50%"><input name="infants" type="number" min="0" value="${h.vulnerable.infants}" style="width:50%"></span></label>
        <label class="full">Needs<span class="checks">${NEEDS.map(n => `<label><input type="checkbox" name="need" value="${n}"${h.needs.includes(n) ? ' checked' : ''}>${n}</label>`).join('')}</span></label>
        <label class="wide">Notes (optional field, no schema needed)<input name="notes" value="${esc(h.notes || '')}"></label>
        <span class="full"><button class="btn">${editing ? 'Save changes' : 'Add household'}</button> <button type="button" class="btn ghost" id="cancel">Cancel</button></span></form>`;
      $('#cancel').onclick = () => { editing = null; $('#form').innerHTML = ''; };
      $('#hf').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target);
        const body = { family: f.get('family'), zone: f.get('zone'), members: f.get('members'), elderly: f.get('elderly'), infants: f.get('infants'), notes: f.get('notes'), needs: f.getAll('need') };
        run(async () => { await api(editing ? '/households/' + editing.id : '/households', { method: editing ? 'PUT' : 'POST', body }); toast(editing ? 'Household updated' : 'Household added'); editing = null; $('#form').innerHTML = ''; load(); }); };
    };
    $('#add').onclick = () => { editing = null; form(); };
    ['#f-q', '#f-zone', '#f-need', '#f-min'].forEach(s => $(s).oninput = () => run(load));
    await load();
  },

  async supplies(v) {
    const [sp, hs] = await Promise.all([api('/supplies'), api('/households')]);
    v.innerHTML = `<div class="grid g2"><div class="card"><h2>Stock</h2><table><tr><th>Item</th><th>Quantity</th></tr>${sp.items.map(s => `<tr><td>${esc(s.item)}</td><td><b>${s.qty}</b> ${s.qty < 20 ? '<span class="tag hot">low</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">No stock yet</td></tr>'}</table>
      <h2 style="margin-top:18px">Add stock</h2><div class="bar"><input id="s-item" placeholder="Item (e.g. rice_kg)"><input id="s-qty" type="number" min="1" placeholder="Qty" style="width:90px"><button class="btn" id="s-add">Add</button></div></div>
      <div class="card"><h2>Distribute to a household</h2><div class="grid">
      <select id="d-home">${hs.items.map(h => `<option value="${h.id}">${esc(h.family)} (zone ${esc(h.zone)}${h.served ? ', served' : ''})</option>`).join('')}</select>
      <select id="d-item">${sp.items.map(s => `<option value="${esc(s.item)}">${esc(s.item)} (${s.qty} left)</option>`).join('')}</select>
      <input id="d-qty" type="number" min="1" placeholder="Quantity"><button class="btn" id="d-go">Give supplies</button></div></div></div>`;
    $('#s-add').onclick = () => run(async () => { await api('/supplies', { method: 'POST', body: { item: $('#s-item').value, qty: $('#s-qty').value } }); toast('Stock updated'); show('supplies'); });
    $('#d-go').onclick = () => run(async () => { await api('/distribute', { method: 'POST', body: { home_id: $('#d-home').value, item: $('#d-item').value, qty: $('#d-qty').value } }); toast('Distribution logged'); show('supplies'); });
  },

  async log(v) {
    const d = await api('/distributions');
    v.innerHTML = `<div class="card">${d.items.length ? `<table><tr><th>When</th><th>Family</th><th>Zone</th><th>Item</th><th>Qty</th></tr>${d.items.map(r => `<tr><td>${esc(r.ts.replace('T', ' '))}</td><td>${esc(r.family)}</td><td>${esc(r.zone)}</td><td>${esc(r.item)}</td><td>${r.qty}</td></tr>`).join('')}</table>` : '<div class="empty">Nothing distributed yet.</div>'}</div>
      <p style="color:var(--mute);font-size:13px">Each row joins <code>distributions</code> with <code>households</code> in Python, because TinyDB has no JOIN.</p>`;
  },

  async tools(v) {
    v.innerHTML = `<div class="grid g2"><div class="card"><h2>Data tools</h2><div class="grid">
      <button class="btn" id="t-seed">Load sample data (resets everything)</button>
      <button class="btn ghost" id="t-merge">Merge another volunteer's file…</button>
      <button class="btn ghost" id="t-backup">Back up database…</button>
      <button class="btn ghost" id="t-raw">Show raw JSON file</button></div></div>
      <div class="card"><h2>Performance test</h2><button class="btn" id="t-bench">Run benchmark (10,000 documents)</button><div id="bench" style="margin-top:12px"></div></div></div><div id="raw" style="margin-top:16px"></div>`;
    $('#t-seed').onclick = () => confirm('This deletes all current data. Continue?') && run(async () => { await api('/seed', { method: 'POST' }); toast('Sample data loaded'); });
    $('#t-merge').onclick = () => run(async () => { const p = DEMO ? 'demo.json' : window.relief ? await window.relief.pickJson() : prompt('Path to .json file'); if (!p) return;
      const r = await api('/merge', { method: 'POST', body: { path: p } }); toast(`Merged: ${r.added} added, ${r.skipped} skipped`); });
    $('#t-backup').onclick = () => run(async () => { const p = DEMO ? 'demo.json' : window.relief ? await window.relief.pickSave() : prompt('Save path (.json)'); if (!p) return;
      await api('/backup', { method: 'POST', body: { path: p } }); toast('Backup saved'); });
    $('#t-raw').onclick = () => run(async () => { const r = await api('/raw'); $('#raw').innerHTML = `<div class="card"><h2>${esc(r.path)}</h2><pre>${esc(JSON.stringify(r.data, null, 2))}</pre></div>`; });
    $('#t-bench').onclick = () => run(async () => { $('#bench').textContent = 'Running…'; const b = await api('/benchmark');
      $('#bench').innerHTML = `<table><tr><td>Insert 10,000 docs</td><td><b>${b.insert_10000_ms} ms</b></td></tr><tr><td>Scan: search(Q.id == 9999)</td><td><b>${b.scan_10000_ms} ms</b></td></tr><tr><td>get(doc_id=10000)</td><td><b>${b.doc_id_lookup_ms} ms</b></td></tr>
      <tr><td>200 inserts, plain JSONStorage</td><td><b>${b.plain_200_inserts_ms} ms</b></td></tr><tr><td>200 inserts, CachingMiddleware</td><td><b>${b.cached_200_inserts_ms} ms</b></td></tr></table>`; });
  }
};
const titles = { dashboard: 'Dashboard', households: 'Households', supplies: 'Supplies and Distribution', log: 'Distribution Log', tools: 'Tools and Performance' };
async function show(tab) {
  current = tab; editing = null;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#title').textContent = titles[tab];
  await run(() => views[tab]($('#view')));
}
$('#nav').innerHTML = Object.keys(titles).map(k => `<button data-tab="${k}">${titles[k]}</button>`).join('');
$('#nav').onclick = e => e.target.dataset.tab && show(e.target.dataset.tab);
(async function boot() {
  try {
    const c = new AbortController(); setTimeout(() => c.abort(), 1500);
    const h = await (await fetch(API + '/health', { signal: c.signal })).json();
    $('#dot').classList.add('ok'); $('#status').textContent = 'TinyDB ' + h.tinydb + ' online';
  } catch {
    DEMO = true; $('#dot').classList.add('ok'); $('#status').textContent = 'Demo mode: data stays in this browser';
    $('#title').insertAdjacentHTML('afterend', '<div class="card" style="margin:-6px 0 16px;font-size:13px">Demo mode: no backend found, so data is stored in your browser. Run the desktop app to use the real TinyDB backend.</div>');
    if (!window.demoHasData()) await window.demoApi('/seed', { method: 'POST' });
  }
  show('dashboard');
})();
