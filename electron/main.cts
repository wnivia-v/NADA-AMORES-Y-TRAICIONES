// =============================================================================
// Electron Main Process — NADA v2
// Tray, clipboard monitoring, screen capture, notifications
// =============================================================================

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, clipboard, nativeImage } = require('electron');
const path = require('path');

let mainWindow: any = null;
let tray: any = null;
let overlayWindow: any = null;
let clipboardInterval: any = null;
let lastClipboard = '';
// Cached so a freshly-created overlay window (or one that reloads) shows the
// real current state instead of its hardcoded default until the next push.
let lastOverlayStatus: any = { active: false, scanning: false, verdict: null };

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

/**
 * Construye la CSP del renderer.
 *
 * api.anthropic.com y api.groq.com salieron de connect-src: esas llamadas las
 * hace ahora el servidor de NADA, no el navegador. Si alguien reintroduce una
 * llamada directa desde el cliente, la CSP la bloquea y se ve — en vez de
 * volver a enviar una clave de API desde el equipo del usuario.
 *
 * El origen del backend se declara en NADA_API_ORIGIN. Vacio por defecto: sin
 * backend configurado la app funciona igual, con el clasificador local.
 */
function buildCsp(): string {
  const apiOrigin = (process.env.NADA_API_ORIGIN ?? '').trim();
  const connect = [
    "'self'",
    apiOrigin,
    'https://safebrowsing.googleapis.com',
    'https://*.googleapis.com',
    'https://*.firebaseio.com',
    'https://*.cloudfunctions.net',
    'https://cdn.jsdelivr.net',
    'https://storage.googleapis.com',
    'https://huggingface.co',
    'https://*.hf.co',
    'wss://*.firebaseio.com',
  ]
    .filter(Boolean)
    .join(' ');

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob: mediastream:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ') + ';';
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

  // ── Permission Handlers ─────────────────────────────────────────────────────
  // Without these, Electron silently denies every Web API permission request
  // (clipboard-read, microphone, screen capture, notifications) before it ever
  // reaches the OS — so the user sees a dialog they cannot accept because the
  // app already said "no" underneath. Grant the permissions NADA genuinely
  // needs and deny everything else.
  const ALLOWED_PERMISSIONS = new Set([
    'clipboard-read',
    'clipboard-sanitized-write',
    'media',            // microphone / camera
    'mediaKeySystem',
    'notifications',
    'fullscreen',
    'pointerLock',
    'openExternal',
    'display-capture',  // screen sharing via getDisplayMedia
  ]);

  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents: any, permission: string, callback: (granted: boolean) => void) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    }
  );

  // setPermissionCheckHandler runs synchronously before a permission request is
  // even shown. Return true so clipboard / media checks don't get pre-rejected.
  mainWindow.webContents.session.setPermissionCheckHandler(
    (_webContents: any, permission: string) => {
      return ALLOWED_PERMISSIONS.has(permission);
    }
  );

  // Set CSP headers for production
  mainWindow.webContents.session.webRequest.onHeadersReceived((details: any, callback: any) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp()],
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

/**
 * Small always-on-top widget shown while protection is active, positioned in
 * the corner of the primary display. This is the desktop answer to "the
 * shield icon must stay visible over everything, even other apps, until the
 * user explicitly turns it off" — a browser tab can never draw over other
 * native applications (no web API grants that, by design), so this only
 * exists in the Electron build.
 */
function createOverlayWindow() {
  if (overlayWindow) return;

  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const SIZE = 64;
  const MARGIN = 16;

  overlayWindow = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    x: display.workArea.x + display.workArea.width - SIZE - MARGIN,
    y: display.workArea.y + display.workArea.height - SIZE - MARGIN,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' level keeps it above fullscreen apps on macOS; combined
  // with setVisibleOnAllWorkspaces this is the strongest "always on top" the
  // OS allows a normal (non-kiosk) app to request.
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (isDev) {
    overlayWindow.loadURL('http://127.0.0.1:5173/?overlay=1');
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../dist/index.html'), { search: 'overlay=1' });
  }

  overlayWindow.webContents.once('did-finish-load', () => {
    overlayWindow?.webContents.send('overlay-status-update', lastOverlayStatus);
  });

  overlayWindow.on('closed', () => { overlayWindow = null; });
}

function destroyOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
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
  destroyOverlayWindow();
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

// Always-on-top overlay: created/destroyed as the renderer's protection
// toggle changes, kept in sync via pushed status updates.
ipcMain.on('set-overlay-visible', (_event: any, visible: boolean) => {
  if (visible) createOverlayWindow();
  else destroyOverlayWindow();
});

ipcMain.on('update-overlay-status', (_event: any, status: any) => {
  lastOverlayStatus = status;
  overlayWindow?.webContents.send('overlay-status-update', status);
});

ipcMain.on('focus-main-window', () => {
  mainWindow?.show();
  mainWindow?.focus();
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

