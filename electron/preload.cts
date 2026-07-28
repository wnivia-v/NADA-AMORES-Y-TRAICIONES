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
});
