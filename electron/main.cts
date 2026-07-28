// =============================================================================
// Electron Main Process — NADA v2
// Tray, clipboard monitoring, screen capture, notifications
// =============================================================================

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, clipboard, nativeImage } = require('electron');
const path = require('path');

let mainWindow: any = null;
let tray: any = null;
let clipboardInterval: any = null;
let lastClipboard = '';

const isDev = !app.isPackaged;

/**
 * Absolute path to the raster app icon.
 *
 * Must be a PNG, not the SVG: Windows accepts neither SVG for BrowserWindow nor
 * for Tray, and nativeImage.createFromPath on an SVG returns an empty image,
 * which makes `new Tray(...)` fail outright. Vite copies public/icon.png into
 * dist/, so the packaged app reads it from there.
 */
function iconPath(): string {
  return isDev
    ? path.join(__dirname, '../public/icon.png')
    : path.join(__dirname, '../dist/icon.png');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 760,
    minWidth: 380,
    minHeight: 600,
    frame: true,
    resizable: true,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Set CSP headers for production
  mainWindow.webContents.session.webRequest.onHeadersReceived((details: any, callback: any) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://api.anthropic.com https://api.groq.com https://safebrowsing.googleapis.com https://*.googleapis.com https://*.firebaseio.com https://*.cloudfunctions.net https://cdn.jsdelivr.net https://storage.googleapis.com https://huggingface.co https://*.hf.co wss://*.firebaseio.com; worker-src 'self' blob:; media-src 'self' blob: mediastream:; object-src 'none'; base-uri 'self'; form-action 'self';"
        ],
      },
    });
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Minimize to tray instead of closing — but only when a tray icon actually
  // exists, otherwise hiding the window would leave the user no way to get it
  // back and no way to quit.
  mainWindow.on('close', (e: any) => {
    if (!app.isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const source = nativeImage.createFromPath(iconPath());
  if (source.isEmpty()) {
    // Without a valid image `new Tray()` throws and takes the whole app down.
    console.error('[NADA] Tray icon could not be loaded from', iconPath());
    return;
  }

  const icon = source.resize({ width: 16, height: 16 });
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Mostrar NADA', click: () => mainWindow?.show() },
    { label: 'Ver Alertas', click: () => { mainWindow?.show(); mainWindow?.webContents.send('tray-action', 'view-alerts'); } },
    { type: 'separator' },
    { label: 'Salir', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setToolTip('NADA — Scam Shield v2');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow?.show());
}

function startClipboardMonitor() {
  clipboardInterval = setInterval(() => {
    const text = clipboard.readText();
    if (text && text !== lastClipboard && text.length > 10) {
      lastClipboard = text;
      mainWindow?.webContents.send('clipboard-change', text);
    }
  }, 3000);
}

// =============================================================================
// App Lifecycle
// =============================================================================

app.whenReady().then(() => {
  // Tray first: createMainWindow's close handler checks whether a tray exists
  // before deciding to hide instead of quit.
  createTray();
  createMainWindow();
  startClipboardMonitor();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  } else {
    mainWindow?.show();
  }
});

app.on('before-quit', () => {
  if (clipboardInterval) clearInterval(clipboardInterval);
});

// =============================================================================
// IPC Handlers
// =============================================================================

ipcMain.on('send-notification', (_event: any, title: string, body: string) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: iconPath() }).show();
  }
});

ipcMain.on('toggle-protection', (_event: any, active: boolean) => {
  if (active) {
    if (!clipboardInterval) startClipboardMonitor();
  } else {
    if (clipboardInterval) {
      clearInterval(clipboardInterval);
      clipboardInterval = null;
    }
  }
});

// Screen capture for OCR-based screen shield
ipcMain.on('request-screen-capture', async (_event: any) => {
  try {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
    });

    if (sources.length > 0) {
      const dataUrl = sources[0].thumbnail.toDataURL();
      mainWindow?.webContents.send('screen-capture-result', dataUrl);
    }
  } catch (e: any) {
    console.warn('[NADA] Screen capture failed:', e?.message);
  }
});

