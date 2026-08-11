import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.revm2.app',
  appName: 'RevM2',
  webDir: 'www',
  server: {
    // During Tier 1 development we point at the live Supabase-backed site
    // exactly as-is (no bundled backend changes needed). Switch
    // androidScheme/url off once the native shell/nav work is validated
    // and you want a fully offline-bundled www/ build instead.
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0b0b0f',
      androidSplashResourceName: 'splash',
      showSpinner: false
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0b0b0f'
    }
  }
};

export default config;
