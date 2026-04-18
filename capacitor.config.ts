import type { CapacitorConfig } from '@capacitor/cli';

const useLocalBundle = process.env.CAPACITOR_USE_LOCAL_BUNDLE === '1';
const remoteServerUrl = useLocalBundle
  ? ''
  : process.env.CAPACITOR_REMOTE_URL?.trim() || 'https://alabanzaredilestadio.com';

const config: CapacitorConfig = {
  appId: 'com.edisonabel.redilalabanza',
  appName: 'Redil Alabanza',
  webDir: 'dist',
  ...(remoteServerUrl
    ? {
        server: {
          url: remoteServerUrl,
          cleartext: remoteServerUrl.startsWith('http://'),
        },
      }
    : {}),
};

export default config;
