// Electron main process: starts the Python/TinyDB backend, then opens the window.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = 5050;
let py = null, win = null, pyLog = '';

function ping() {
  return new Promise(resolve => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 800 }, res => { res.resume(); resolve(res.statusCode === 200); });
    r.on('error', () => resolve(false));
    r.on('timeout', () => { r.destroy(); resolve(false); });
  });
}
async function waitReady(tries = 50) {
  for (let i = 0; i < tries; i++) { if (await ping()) return true; await new Promise(r => setTimeout(r, 300)); }
  return false;
}
function launch(cmds) {                       // try python, then py (Windows launcher), etc.
  return new Promise(resolve => {
    const [cmd, ...rest] = cmds;
    if (!cmd) return resolve(null);
    const args = (cmd === 'py' ? ['-3'] : []).concat([path.join(__dirname, 'backend', 'app.py')]);
    const p = spawn(cmd, args, {
      cwd: path.join(__dirname, 'backend'),
      env: { ...process.env, PORT: String(PORT), PYTHONUNBUFFERED: '1', RELIEFLOG_DB: path.join(app.getPath('userData'), 'relieflog.json') }
    });
    let failed = false;
    p.on('error', () => { failed = true; resolve(launch(rest)); });
    const grab = d => { pyLog += d.toString(); console.log('[backend]', d.toString().trim()); };
    p.stdout.on('data', grab); p.stderr.on('data', grab);
    setTimeout(() => { if (!failed) resolve(p); }, 400);
  });
}
function killBackend() {
  if (!py) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(py.pid), '/f', '/t']); else py.kill();
  py = null;
}

async function start() {
  py = await launch(process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']);
  if (!py || !(await waitReady())) {
    dialog.showErrorBox('ReliefLog backend did not start',
      'Install Python 3 and run:\n  pip install -r backend/requirements.txt\n\n' + (pyLog.slice(-600) || 'Python was not found on PATH.'));
    return app.quit();
  }
  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 1000, minHeight: 640, backgroundColor: '#0f1b2d', title: 'ReliefLog',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'frontend', 'index.html'));
}

ipcMain.handle('pick-json', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose another volunteer\'s TinyDB file', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('pick-save', async () => {
  const r = await dialog.showSaveDialog(win, { title: 'Save backup', defaultPath: 'relieflog-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  return r.canceled ? null : r.filePath;
});

app.whenReady().then(start);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', killBackend);
