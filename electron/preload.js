const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  exitApp: () => ipcRenderer.invoke('app:exit'),
  onFileOpenedFromOS: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('file:opened-from-os', handler);
    return () => ipcRenderer.removeListener('file:opened-from-os', handler);
  }
});
