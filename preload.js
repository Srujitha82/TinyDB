const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('relief', {
  pickJson: () => ipcRenderer.invoke('pick-json'),
  pickSave: () => ipcRenderer.invoke('pick-save')
});
