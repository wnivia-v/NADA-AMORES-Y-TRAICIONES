/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    sendNotification: (title: string, body: string) => void;
    toggleProtection: (active: boolean) => void;
    onProtectionAutoStarted: (cb: () => void) => void;
    onTrayAction: (cb: (action: string) => void) => void;
  };
}
