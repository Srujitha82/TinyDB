"""ReliefLog backend: Flask REST API on top of TinyDB.
Every response that touches the database includes a 'query' string so the
frontend can show the exact TinyDB call (useful for the case-study demo)."""
import os, re, time, shutil, tempfile
from datetime import datetime
from collections import Counter
from importlib.metadata import version
from flask import Flask, jsonify, request
from tinydb import TinyDB, Query
from tinydb.operations import subtract, add
from tinydb.storages import JSONStorage
from tinydb.middlewares import CachingMiddleware

DB_PATH = os.environ.get('RELIEFLOG_DB', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'relieflog.json'))
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
db = TinyDB(DB_PATH, indent=2)
homes, stock, log = db.table('households'), db.table('supplies'), db.table('distributions')
Q = Query()
app = Flask(__name__)
NEEDS = ['food', 'medicine', 'water', 'blankets', 'shelter']

@app.before_request
def preflight():
    if request.method == 'OPTIONS':
        return '', 204

@app.after_request
def cors(r):  # renderer loads from file://, so allow cross-origin calls
    r.headers['Access-Control-Allow-Origin'] = '*'
    r.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    r.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
    return r

def err(msg, code=400):
    return jsonify(error=msg), code

def out(d):
    x = dict(d); x['id'] = d.doc_id; return x

def score(h):
    v = h.get('vulnerable', {})
    return h.get('members', 1) + 3 * v.get('infants', 0) + 2 * v.get('elderly', 0) + (2 if 'medicine' in h.get('needs', []) else 0)

def clean_home(d):
    family = str(d.get('family', '')).strip()
    zone = str(d.get('zone', '')).strip().upper()
    try:
        members = int(d.get('members', 0)); elderly = int(d.get('elderly', 0)); infants = int(d.get('infants', 0))
    except (TypeError, ValueError):
        raise ValueError('members, elderly and infants must be numbers')
    if not family: raise ValueError('Family name is required')
    if not zone or len(zone) > 3: raise ValueError('Zone is required (max 3 characters)')
    if members < 1: raise ValueError('Members must be at least 1')
    if elderly < 0 or infants < 0: raise ValueError('Counts cannot be negative')
    needs = [n for n in d.get('needs', []) if n in NEEDS]
    doc = {'family': family, 'zone': zone, 'members': members, 'needs': needs,
           'vulnerable': {'elderly': elderly, 'infants': infants}}
    if str(d.get('notes', '')).strip(): doc['notes'] = str(d['notes']).strip()   # optional field: schema-less
    return doc

@app.get('/api/health')
def health():
    return jsonify(ok=True, db=DB_PATH, tinydb=version('tinydb'))

# ---------- households (CRUD) ----------
@app.get('/api/households')
def list_homes():
    q, parts = None, []
    def and_(cond, text):
        nonlocal q
        q = cond if q is None else (q & cond); parts.append(text)
    zone = request.args.get('zone'); need = request.args.get('need')
    text = request.args.get('q', '').strip(); minm = request.args.get('min_members', type=int)
    if zone: and_(Q.zone == zone, f"(Q.zone == '{zone}')")
    if need: and_(Q.needs.any([need]), f"Q.needs.any(['{need}'])")
    if text: and_(Q.family.search(re.escape(text), flags=re.I), f"Q.family.search('{text}')")
    if minm: and_(Q.members >= minm, f"(Q.members >= {minm})")
    rows = homes.search(q) if q is not None else homes.all()
    served = {d['home_id'] for d in log.all()}
    res = [dict(out(h), priority=score(h), served=h.doc_id in served) for h in rows]
    query = f"households.search({' & '.join(parts)})" if parts else 'households.all()'
    return jsonify(items=res, query=query)

@app.post('/api/households')
def add_home():
    try: doc = clean_home(request.get_json(force=True))
    except ValueError as e: return err(str(e))
    if homes.contains((Q.family == doc['family']) & (Q.zone == doc['zone'])):
        return err('This household already exists in that zone', 409)
    i = homes.insert(doc)
    return jsonify(id=i, query=f"households.insert({doc})"), 201

@app.put('/api/households/<int:i>')
def edit_home(i):
    if not homes.contains(doc_id=i): return err('Not found', 404)
    try: doc = clean_home(request.get_json(force=True))
    except ValueError as e: return err(str(e))
    if 'notes' not in doc: homes.update(lambda d: d.pop('notes', None), doc_ids=[i])
    homes.update(doc, doc_ids=[i])
    return jsonify(id=i, query=f"households.update({doc}, doc_ids=[{i}])")

@app.delete('/api/households/<int:i>')
def del_home(i):
    if not homes.contains(doc_id=i): return err('Not found', 404)
    homes.remove(doc_ids=[i])
    return jsonify(ok=True, query=f"households.remove(doc_ids=[{i}])")

# ---------- supplies and distribution ----------
@app.get('/api/supplies')
def list_supplies():
    return jsonify(items=[out(s) for s in stock.all()], query='supplies.all()')

@app.post('/api/supplies')
def add_supply():
    d = request.get_json(force=True)
    item = re.sub(r'\s+', '_', str(d.get('item', '')).strip().lower())
    try: qty = int(d.get('qty', 0))
    except (TypeError, ValueError): return err('Quantity must be a number')
    if not item or qty < 1: return err('Item name and a positive quantity are required')
    if stock.contains(Q.item == item):
        stock.update(add('qty', qty), Q.item == item)
        q = f"supplies.update(add('qty', {qty}), Q.item == '{item}')"
    else:
        stock.insert({'item': item, 'qty': qty}); q = f"supplies.insert({{'item': '{item}', 'qty': {qty}}})"
    return jsonify(ok=True, query=q)

@app.post('/api/distribute')
def distribute():
    d = request.get_json(force=True)
    try: hid, qty = int(d.get('home_id')), int(d.get('qty'))
    except (TypeError, ValueError): return err('Choose a household and enter a quantity')
    item = d.get('item'); h = homes.get(doc_id=hid); s = stock.get(Q.item == item)
    if h is None: return err('Household not found', 404)
    if s is None: return err('Unknown supply item', 404)
    if qty < 1: return err('Quantity must be positive')
    if s['qty'] < qty: return err(f"Only {s['qty']} {item} left in stock", 409)
    stock.update(subtract('qty', qty), Q.item == item)
    log.insert({'home_id': hid, 'item': item, 'qty': qty, 'ts': datetime.now().isoformat(timespec='seconds')})
    return jsonify(ok=True, query=f"supplies.update(subtract('qty', {qty}), Q.item == '{item}'); distributions.insert({{'home_id': {hid}, ...}})")

@app.get('/api/distributions')
def list_log():
    rows = []
    for d in reversed(log.all()):
        h = homes.get(doc_id=d['home_id'])          # manual JOIN: TinyDB has no JOIN
        rows.append(dict(out(d), family=h['family'] if h else '(removed)', zone=h['zone'] if h else '-'))
    return jsonify(items=rows, query='distributions.all() + households.get(doc_id=...)  # manual join')

# ---------- dashboard ----------
@app.get('/api/stats')
def stats():
    allh = homes.all(); ids = {h.doc_id for h in allh}
    served = {d['home_id'] for d in log.all()} & ids
    zones = Counter(h['zone'] for h in allh)
    low = [out(s) for s in stock.all() if s['qty'] < 20]
    pending = sorted([h for h in allh if h.doc_id not in served], key=score, reverse=True)[:5]
    triage = [dict(out(h), priority=score(h)) for h in pending]
    return jsonify(households=len(allh), people=sum(h['members'] for h in allh), served=len(served),
                   distributions=len(log), zones=dict(zones), low_stock=low, triage=triage,
                   query="households.all(); distributions.all(); sorted(pending, key=score)")

# ---------- tools ----------
@app.post('/api/seed')
def seed():
    db.drop_tables()
    homes.insert_multiple([
        {'family': 'Kumar', 'zone': 'A', 'members': 5, 'needs': ['food', 'medicine'], 'vulnerable': {'elderly': 1, 'infants': 0}},
        {'family': 'Fatima', 'zone': 'A', 'members': 3, 'needs': ['food', 'water'], 'vulnerable': {'elderly': 0, 'infants': 0}, 'notes': 'two pets'},
        {'family': 'Joseph', 'zone': 'B', 'members': 6, 'needs': ['food', 'medicine', 'blankets'], 'vulnerable': {'elderly': 0, 'infants': 2}},
        {'family': 'Lakshmi', 'zone': 'B', 'members': 2, 'needs': ['water'], 'vulnerable': {'elderly': 2, 'infants': 0}, 'notes': 'ground floor flooded'},
        {'family': 'Rahman', 'zone': 'C', 'members': 4, 'needs': ['food', 'shelter'], 'vulnerable': {'elderly': 0, 'infants': 1}},
        {'family': 'Devi', 'zone': 'C', 'members': 7, 'needs': ['food', 'medicine', 'water', 'blankets'], 'vulnerable': {'elderly': 1, 'infants': 1}},
    ])
    stock.insert_multiple([{'item': 'rice_kg', 'qty': 200}, {'item': 'medkits', 'qty': 12}, {'item': 'blankets', 'qty': 30}, {'item': 'water_l', 'qty': 500}])
    return jsonify(ok=True, query='db.drop_tables(); households.insert_multiple([...]); supplies.insert_multiple([...])')

@app.post('/api/merge')
def merge():
    path = (request.get_json(force=True) or {}).get('path', '')
    if not path.lower().endswith('.json') or not os.path.isfile(path): return err('Pick a valid TinyDB .json file')
    if os.path.abspath(path) == os.path.abspath(DB_PATH): return err('That is the current database file')
    try:
        src = TinyDB(path); added = skipped = 0
        for d in src.table('households').all():
            if 'family' not in d or 'zone' not in d: skipped += 1; continue
            if homes.contains((Q.family == d['family']) & (Q.zone == d['zone'])): skipped += 1
            else: homes.insert(dict(d)); added += 1
        src.close()
    except Exception as e:
        return err(f'Could not read file: {e}')
    return jsonify(added=added, skipped=skipped, query="for d in other.table('households'): if not households.contains(...): households.insert(dict(d))")

@app.post('/api/backup')
def backup():
    path = (request.get_json(force=True) or {}).get('path', '')
    if not path.lower().endswith('.json'): return err('Choose a .json destination')
    shutil.copyfile(DB_PATH, path)
    return jsonify(ok=True, query=f"shutil.copyfile('{os.path.basename(DB_PATH)}', backup.json)  # the database is one file")

@app.get('/api/raw')
def raw():
    import json
    with open(DB_PATH, encoding='utf-8') as f: return jsonify(data=json.load(f), path=DB_PATH, query='open(relieflog.json)  # human-readable JSON on disk')

@app.get('/api/benchmark')
def benchmark():
    with tempfile.TemporaryDirectory() as tmp:
        t0 = TinyDB(os.path.join(tmp, 'b.json')); t = t0.table('h')
        s = time.perf_counter(); t.insert_multiple([{'id': i, 'zone': 'ABC'[i % 3]} for i in range(10000)]); ins = time.perf_counter() - s
        s = time.perf_counter(); t.search(Q.id == 9999); scan = time.perf_counter() - s
        s = time.perf_counter(); t.get(doc_id=10000); direct = time.perf_counter() - s
        t0.close()
        plain = TinyDB(os.path.join(tmp, 'p.json'))
        s = time.perf_counter()
        for i in range(200): plain.insert({'n': i})
        plain_t = time.perf_counter() - s; plain.close()
        cached = TinyDB(os.path.join(tmp, 'c.json'), storage=CachingMiddleware(JSONStorage))
        s = time.perf_counter()
        for i in range(200): cached.insert({'n': i})
        cached.close(); cache_t = time.perf_counter() - s
    ms = lambda x: round(x * 1000, 2)
    return jsonify(insert_10000_ms=ms(ins), scan_10000_ms=ms(scan), doc_id_lookup_ms=ms(direct),
                   plain_200_inserts_ms=ms(plain_t), cached_200_inserts_ms=ms(cache_t),
                   query="table.search(Q.id == 9999)  vs  table.get(doc_id=10000)")

if __name__ == '__main__':
    # TinyDB is not thread-safe, so serve one request at a time (a real case-study limitation).
    app.run(host='127.0.0.1', port=int(os.environ.get('PORT', 5050)), debug=False, threaded=False)
