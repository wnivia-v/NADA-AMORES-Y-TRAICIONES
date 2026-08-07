import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.antigravity.nada',
  appName: 'NADA Shield',
  webDir: 'dist',
  android: {
    // Chrome's WebView already blocks mixed content by default; explicit
    // here so a future change to the default doesn't silently loosen it.
    allowMixedContent: false,
  },
};

export default config;
