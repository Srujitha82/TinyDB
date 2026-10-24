// Demo mode: an in-browser stand-in for the Flask/TinyDB API so the UI also works on GitHub Pages.
// Data lives in this browser's localStorage. The real TinyDB runs in backend/app.py.
(function () {
  const KEY = 'relieflog_demo_v1', NEEDS = ['food', 'medicine', 'water', 'blankets', 'shelter'];
  let db; try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  db = db || { households: [], supplies: [], distributions: [], nid: { h: 1, s: 1, d: 1 } };
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  const score = h => h.members + 3 * h.vulnerable.infants + 2 * h.vulnerable.elderly + (h.needs.includes('medicine') ? 2 : 0);
  const fail = (m, c = 400) => { const e = new Error(m); e.code = c; throw e; };
  const servedSet = () => new Set(db.distributions.map(d => d.home_id));
  function clean(d) {
    const family = String(d.family || '').trim(), zone = String(d.zone || '').trim().toUpperCase();
    const members = parseInt(d.members), elderly = parseInt(d.elderly || 0), infants = parseInt(d.infants || 0);
    if (!family) fail('Family name is required');
    if (!zone || zone.length > 3) fail('Zone is required (max 3 characters)');
    if (!(members >= 1)) fail('Members must be at least 1');
    if (!(elderly >= 0) || !(infants >= 0)) fail('Counts cannot be negative');
    const doc = { family, zone, members, needs: (d.needs || []).filter(n => NEEDS.includes(n)), vulnerable: { elderly, infants } };
    if (String(d.notes || '').trim()) doc.notes = String(d.notes).trim();
    return doc;
  }
  function seed() {
    const H = (family, zone, members, needs, elderly, infants, notes) => Object.assign({ family, zone, members, needs, vulnerable: { elderly, infants } }, notes ? { notes } : {});
    db = { households: [], supplies: [], distributions: [], nid: { h: 1, s: 1, d: 1 } };
    [H('Kumar', 'A', 5, ['food', 'medicine'], 1, 0), H('Fatima', 'A', 3, ['food', 'water'], 0, 0, 'two pets'), H('Joseph', 'B', 6, ['food', 'medicine', 'blankets'], 0, 2),
     H('Lakshmi', 'B', 2, ['water'], 2, 0, 'ground floor flooded'), H('Rahman', 'C', 4, ['food', 'shelter'], 0, 1), H('Devi', 'C', 7, ['food', 'medicine', 'water', 'blankets'], 1, 1)]
      .forEach(h => db.households.push({ id: db.nid.h++, ...h }));
    [['rice_kg', 200], ['medkits', 12], ['blankets', 30], ['water_l', 500]].forEach(([item, qty]) => db.supplies.push({ id: db.nid.s++, item, qty }));
  }
  const out = (data, query, status = 200) => ({ status, data: Object.assign(data, { query: 'demo · ' + query }) });

  window.demoApi = async function (path, opts = {}) {
    const m = (opts.method || 'GET').toUpperCase(), b = opts.body || {}, u = new URL('http://x' + path), p = u.pathname, a = u.searchParams;
    try {
      if (p === '/health') return { status: 200, data: { ok: true, tinydb: 'demo mode' } };
      if (p === '/households' && m === 'GET') {
        let rows = db.households, parts = [];
        if (a.get('zone')) { rows = rows.filter(h => h.zone === a.get('zone')); parts.push(`(Q.zone == '${a.get('zone')}')`); }
        if (a.get('need')) { rows = rows.filter(h => h.needs.includes(a.get('need'))); parts.push(`Q.needs.any(['${a.get('need')}'])`); }
        if (a.get('q')) { rows = rows.filter(h => h.family.toLowerCase().includes(a.get('q').toLowerCase())); parts.push(`Q.family.search('${a.get('q')}')`); }
        if (a.get('min_members')) { rows = rows.filter(h => h.members >= +a.get('min_members')); parts.push(`(Q.members >= ${a.get('min_members')})`); }
        const sv = servedSet();
        return out({ items: rows.map(h => ({ ...h, priority: score(h), served: sv.has(h.id) })) }, parts.length ? `households.search(${parts.join(' & ')})` : 'households.all()');
      }
      if (p === '/households' && m === 'POST') {
        const doc = clean(b);
        if (db.households.some(h => h.family === doc.family && h.zone === doc.zone)) fail('This household already exists in that zone', 409);
        const id = db.nid.h++; db.households.push({ id, ...doc }); save();
        return out({ id }, `households.insert(${JSON.stringify(doc)})`, 201);
      }
      let r = p.match(/^\/households\/(\d+)$/);
      if (r) {
        const i = +r[1], k = db.households.findIndex(h => h.id === i); if (k < 0) fail('Not found', 404);
        if (m === 'PUT') { db.households[k] = { id: i, ...clean(b) }; save(); return out({ id: i }, `households.update({...}, doc_ids=[${i}])`); }
        if (m === 'DELETE') { db.households.splice(k, 1); save(); return out({ ok: true }, `households.remove(doc_ids=[${i}])`); }
      }
      if (p === '/supplies' && m === 'GET') return out({ items: db.supplies }, 'supplies.all()');
      if (p === '/supplies' && m === 'POST') {
        const item = String(b.item || '').trim().toLowerCase().replace(/\s+/g, '_'), qty = parseInt(b.qty);
        if (!item || !(qty >= 1)) fail('Item name and a positive quantity are required');
        const s = db.supplies.find(x => x.item === item);
        if (s) s.qty += qty; else db.supplies.push({ id: db.nid.s++, item, qty }); save();
        return out({ ok: true }, s ? `supplies.update(add('qty', ${qty}), Q.item == '${item}')` : `supplies.insert({'item': '${item}', 'qty': ${qty}})`);
      }
      if (p === '/distribute' && m === 'POST') {
        const hid = parseInt(b.home_id), qty = parseInt(b.qty);
        if (!hid || !qty) fail('Choose a household and enter a quantity');
        const h = db.households.find(x => x.id === hid), s = db.supplies.find(x => x.item === b.item);
        if (!h) fail('Household not found', 404); if (!s) fail('Unknown supply item', 404);
        if (qty < 1) fail('Quantity must be positive'); if (s.qty < qty) fail(`Only ${s.qty} ${b.item} left in stock`, 409);
        s.qty -= qty; db.distributions.push({ id: db.nid.d++, home_id: hid, item: b.item, qty, ts: new Date().toISOString().slice(0, 19) }); save();
        return out({ ok: true }, `supplies.update(subtract('qty', ${qty}), Q.item == '${b.item}'); distributions.insert({'home_id': ${hid}, ...})`);
      }
      if (p === '/distributions') return out({ items: [...db.distributions].reverse().map(d => { const h = db.households.find(x => x.id === d.home_id); return { ...d, family: h ? h.family : '(removed)', zone: h ? h.zone : '-' }; }) }, 'distributions.all() + households.get(doc_id=...)  # manual join');
      if (p === '/stats') {
        const ids = new Set(db.households.map(h => h.id)), sv = [...servedSet()].filter(x => ids.has(x)), zones = {};
        db.households.forEach(h => zones[h.zone] = (zones[h.zone] || 0) + 1);
        const pend = db.households.filter(h => !sv.includes(h.id)).sort((x, y) => score(y) - score(x)).slice(0, 5).map(h => ({ ...h, priority: score(h) }));
        return out({ households: db.households.length, people: db.households.reduce((n, h) => n + h.members, 0), served: sv.length, distributions: db.distributions.length, zones, low_stock: db.supplies.filter(s => s.qty < 20), triage: pend }, 'households.all(); distributions.all(); sorted(pending, key=score)');
      }
      if (p === '/seed') { seed(); save(); return out({ ok: true }, 'db.drop_tables(); households.insert_multiple([...]); supplies.insert_multiple([...])'); }
      if (p === '/raw') {
        const t = k => Object.fromEntries(db[k].map(({ id, ...rest }) => [String(id), rest]));
        return out({ data: { households: t('households'), supplies: t('supplies'), distributions: t('distributions') }, path: 'browser localStorage (demo mode)' }, 'open(relieflog.json)  # same layout TinyDB writes to disk');
      }
      if (p === '/backup') {
        const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }), el = document.createElement('a');
        el.href = URL.createObjectURL(blob); el.download = 'relieflog-demo-backup.json'; el.click();
        return out({ ok: true }, 'download backup  # in the real app: shutil.copyfile(relieflog.json, backup.json)');
      }
      if (p === '/merge') fail('Merging files needs the real TinyDB backend (run the desktop app)');
      if (p === '/benchmark') fail('The benchmark measures real TinyDB, so it needs the backend (run the desktop app)');
      fail('Not found', 404);
    } catch (e) { return { status: e.code || 500, data: { error: e.message } }; }
  };
  window.demoHasData = () => db.households.length > 0;
})();
