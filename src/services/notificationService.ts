// =============================================================================
// Notification Service — PWA Push + Native notifications
// Handles permission request, registration, and sending notifications
// =============================================================================

class NotificationService {
  private permissionGranted = false;

  async init(): Promise<boolean> {
    if (!('Notification' in window)) {
      return false;
    }

    if (Notification.permission === 'granted') {
      this.permissionGranted = true;
      return true;
    }

    if (Notification.permission === 'denied') {
      return false;
    }

    // Request permission
    try {
      const result = await Notification.requestPermission();
      this.permissionGranted = result === 'granted';
      return this.permissionGranted;
    } catch {
      return false;
    }
  }

  isSupported(): boolean {
    return 'Notification' in window;
  }

  isGranted(): boolean {
    return this.permissionGranted || Notification.permission === 'granted';
  }

  // Send a notification (works in both web and Electron)
  send(title: string, body: string, options?: { tag?: string; requireInteraction?: boolean }) {
    // Try Electron native notification first
    if (this.isElectron()) {
      try {
        const electronAPI = (window as any).electronAPI;
        electronAPI?.sendNotification(title, body);
        return;
      } catch { /* fallback to web */ }
    }

    // Web notification
    if (!this.isGranted()) return;

    try {
      const notification = new Notification(title, {
        body,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: options?.tag ?? 'nada-alert',
        requireInteraction: options?.requireInteraction ?? false,
        silent: false,
      });

      // Auto-close after 8 seconds
      setTimeout(() => notification.close(), 8000);
    } catch {
      // Notification failed (maybe SW context)
      this.sendViaSW(title, body);
    }
  }

  // Send threat alert notification
  sendThreatAlert(verdict: string, riskScore: number, tactic?: string) {
    const title = `NADA: ${verdict}`;
    const body = tactic
      ? `Riesgo ${riskScore}/100 — ${tactic}`
      : `Riesgo ${riskScore}/100 detectado`;

    this.send(title, body, {
      tag: `nada-threat-${Date.now()}`,
      requireInteraction: verdict === 'PELIGROSO',
    });
  }

  // Try to send via Service Worker (for PWA)
  private async sendViaSW(title: string, body: string) {
    if (!('serviceWorker' in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: 'nada-alert',
      });
    } catch {
      // SW notification also failed
    }
  }

  private isElectron(): boolean {
    return typeof (window as any).electronAPI !== 'undefined';
  }
}

export const notificationService = new NotificationService();
