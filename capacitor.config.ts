import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.edisonabel.redilalabanza',
  appName: 'Redil Alabanza',
  webDir: 'dist',
  server: {
    url: 'https://alabanzaredilestadio.com',
    cleartext: false,
  },
};

export default config;
