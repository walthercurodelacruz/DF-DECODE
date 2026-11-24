const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let fileToOpenOnLaunch = null;

// Enfoque Single Instance Lock (evita abrir múltiples instancias si el usuario abre varios archivos)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      // En Windows el archivo viene en commandLine
      const filePath = findFilePathInArgs(commandLine);
      if (filePath) {
        sendFileToRenderer(filePath);
      }
    }
  });
}

function findFilePathInArgs(args) {
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg && !arg.startsWith('--') && !arg.startsWith('-')) {
      const ext = path.extname(arg).toLowerCase();
      if (['.dfx', '.dfd', '.dfdx'].includes(ext) && fs.existsSync(arg)) {
        return path.resolve(arg);
      }
    }
  }
  return null;
}

function sendFileToRenderer(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('file:opened-from-os', {
        fileName,
        filePath,
        bytes: new Uint8Array(buffer),
        content: buffer.toString('utf-8')
      });
    }
  } catch (err) {
    console.error('Error al leer archivo pasado por argumento:', err);
  }
}

function createWindow() {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, '../assets/icon.ico')
    : path.join(__dirname, '../assets/icon-512.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'df-decode v1.0 — Diagramas de Flujo',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#111827',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: !app.isPackaged
    }
  });

  // Ocultar barra de menú por defecto de Electron (df-decode tiene su propia barra completa)
  mainWindow.setMenuBarVisibility(false);

  // Garantizar que el botón Cerrar (X) de la ventana siempre cierre la aplicación
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
  });

  mainWindow.loadFile(path.join(__dirname, '../index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (fileToOpenOnLaunch) {
      setTimeout(() => sendFileToRenderer(fileToOpenOnLaunch), 400);
      fileToOpenOnLaunch = null;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Capturar archivo abierto desde argumentos de inicio (CLI o doble clic en Windows/Linux)
fileToOpenOnLaunch = findFilePathInArgs(process.argv);

// En macOS / Linux via evento open-file
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    sendFileToRenderer(filePath);
  } else {
    fileToOpenOnLaunch = filePath;
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// =========================================================================
// IPC HANDLERS (Diálogos nativos del Sistema Operativo)
// =========================================================================

// Diálogo nativo para Abrir Archivo
ipcMain.handle('dialog:openFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir Diagrama DFD',
    buttonLabel: 'Abrir Diagrama',
    filters: [
      { name: 'Diagramas df-decode y DFD', extensions: ['dfx', 'dfd', 'dfdx'] },
      { name: 'Diagramas df-decode (*.dfx)', extensions: ['dfx'] },
      { name: 'Diagramas DFD Clásicos (*.dfd)', extensions: ['dfd'] },
      { name: 'Todos los archivos (*.*)', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || !result.filePaths.length) return null;

  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  return {
    fileName: path.basename(filePath),
    filePath: filePath,
    bytes: new Uint8Array(buffer),
    content: buffer.toString('utf-8'),
    isBinary: buffer.includes(0x00) // Detección simple de formato binario si fuera el caso
  };
});

// Diálogo nativo para Guardar Archivo
ipcMain.handle('dialog:saveFile', async (event, { defaultFileName, content, bytes, filters }) => {
  if (!mainWindow) return { success: false };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar Diagrama DFD',
    defaultPath: defaultFileName || 'diagrama.dfx',
    buttonLabel: 'Guardar',
    filters: filters || [
      { name: 'Diagrama df-decode (*.dfx)', extensions: ['dfx'] },
      { name: 'Diagrama DFD (*.dfd)', extensions: ['dfd'] },
      { name: 'Todos los archivos (*.*)', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) return { success: false, canceled: true };

  if (bytes && bytes.length !== undefined) {
    fs.writeFileSync(result.filePath, Buffer.from(bytes));
  } else {
    fs.writeFileSync(result.filePath, content, 'utf-8');
  }
  return {
    success: true,
    filePath: result.filePath,
    fileName: path.basename(result.filePath)
  };
});

// Obtener versión de la app
ipcMain.handle('app:getInfo', () => {
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    isDesktop: true
  };
});

// Cerrar aplicación de forma limpia
ipcMain.handle('app:exit', () => {
  if (mainWindow) {
    mainWindow.destroy();
  } else {
    app.quit();
  }
});
