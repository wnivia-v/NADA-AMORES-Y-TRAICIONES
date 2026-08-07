// =============================================================================
// Electron Preload — Context Bridge (Secure IPC)
// =============================================================================

const { contextBridge, ipcRenderer, desktopCapturer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Send system notification
  sendNotification: (title: string, body: string) => {
    ipcRenderer.send('send-notification', title, body);
  },

  // Toggle background protection
  toggleProtection: (active: boolean) => {
    ipcRenderer.send('toggle-protection', active);
  },

  // Listen for clipboard changes from main process
  onClipboardChange: (callback: (text: string) => void) => {
    ipcRenderer.on('clipboard-change', (_event: any, text: string) => callback(text));
  },

  // Listen for tray actions
  onTrayAction: (callback: (action: string) => void) => {
    ipcRenderer.on('tray-action', (_event: any, action: string) => callback(action));
  },

  // Auto-start protection signal
  onProtectionAutoStarted: (callback: () => void) => {
    ipcRenderer.on('protection-auto-started', () => callback());
  },

  // Screen capture for OCR analysis
  captureScreen: async (): Promise<string | null> => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1280, height: 720 },
      });

      if (sources.length > 0) {
        // Return the primary screen as a data URL
        const thumbnail = sources[0].thumbnail;
        return thumbnail.toDataURL();
      }
      return null;
    } catch {
      return null;
    }
  },

  // Listen for screen capture results from main process
  onScreenCapture: (callback: (dataUrl: string) => void) => {
    ipcRenderer.on('screen-capture-result', (_event: any, dataUrl: string) => callback(dataUrl));
  },

  // Request screen capture from main process
  requestScreenCapture: () => {
    ipcRenderer.send('request-screen-capture');
  },

  // Always-on-top overlay window — called by the main app window
  setOverlayVisible: (visible: boolean) => {
    ipcRenderer.send('set-overlay-visible', visible);
  },
  updateOverlayStatus: (status: { active: boolean; scanning: boolean; verdict: string | null }) => {
    ipcRenderer.send('update-overlay-status', status);
  },

  // Always-on-top overlay window — called by the overlay window itself
  onOverlayStatus: (callback: (status: { active: boolean; scanning: boolean; verdict: string | null }) => void) => {
    ipcRenderer.on('overlay-status-update', (_event: any, status: any) => callback(status));
  },
  focusMainWindow: () => {
    ipcRenderer.send('focus-main-window');
  },
});
