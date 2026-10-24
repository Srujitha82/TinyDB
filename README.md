# ReliefLog: offline-first disaster-relief tracker

Case study project for **TinyDB**. Frontend: Electron (HTML/CSS/JS). Backend: Python Flask REST API using TinyDB.

```
Electron window (frontend/)  --HTTP/JSON-->  Flask API (backend/app.py)  -->  TinyDB  -->  relieflog.json
        main.js starts and stops the Python backend automatically
```

## Try it online (GitHub Pages demo)
The `frontend/` folder is a static site. On GitHub Pages it runs in **demo mode**: no backend is found, so the app keeps its data in your browser and shows the equivalent TinyDB call for every action. Merge and Benchmark need the real backend, so they are disabled online. The real TinyDB only runs in the desktop app below.

Publish it: push this repo to GitHub, then **Settings > Pages > Deploy from a branch > main / (root)**. Your link will be `https://<your-username>.github.io/<repo-name>/`.

## Run on Windows (real TinyDB backend)
1. Install **Node.js LTS** (nodejs.org) and **Python 3** (tick "Add Python to PATH").
2. Open Command Prompt in this folder:
   ```
   pip install -r backend/requirements.txt
   npm install
   npm start
   ```
3. The app opens. Go to **Tools > Load sample data** to fill it with demo records.

The database file lives in Electron's user-data folder (`%APPDATA%\relieflog\relieflog.json`). To use the backend alone, run `python backend/app.py` (API on http://127.0.0.1:5050).

## Demo script (5 minutes, maps to the rubric)
| Step | What to do | What it shows |
|---|---|---|
| 1 | Tools > Load sample data | `insert_multiple`, tables created on first insert |
| 2 | Dashboard | `all()`, triage scoring, low-stock query |
| 3 | Households: filter by need = medicine, zone, min members | `search` with `&`, `any()`, regex `search()` |
| 4 | Add a household with a Notes value; add another without | schema-less documents |
| 5 | Edit a household, then delete one | `update`, `remove` by `doc_id` |
| 6 | Supplies: add stock, then distribute until stock runs out | `add`/`subtract` operations, error handling |
| 7 | Distribution Log | manual JOIN (TinyDB has no JOIN) |
| 8 | Tools > Merge another volunteer's file | offline sync by pen drive |
| 9 | Tools > Run benchmark | scan vs doc_id lookup, `CachingMiddleware` |
| 10 | Tools > Show raw JSON | the whole database is one readable file |

The bar at the bottom of the window always shows the exact TinyDB call behind the last action. Point to it during the demo.

## Honest limitations (use on your slides)
- No indexes: every query scans the table.
- No ACID and not thread-safe, so the backend serves one request at a time.
- No JOIN: the log is joined to households in Python.
- No authentication: anyone with the file can read it.

## Files
`main.js` Electron main process · `preload.js` safe file dialogs · `frontend/` UI · `backend/app.py` API and TinyDB logic
