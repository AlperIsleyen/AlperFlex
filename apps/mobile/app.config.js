export default {
  expo: {
    name: 'AlperFlex Kurye', slug: 'alperflex-kurye', scheme: 'alperflex', platforms: ['ios', 'android'],
    version: '1.1.0', icon: './assets/icon.png',
    ios: { bundleIdentifier: 'com.alperflex.courier', infoPlist: { NSCameraUsageDescription: 'Kargo QR kodlarını okutmak için kamera kullanılır.' } },
    android: {
      package: 'com.alperflex.courier', versionCode: Number(process.env.ALPERFLEX_VERSION_CODE || 2),
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        monochromeImage: './assets/monochrome-icon.png',
        backgroundColor: '#176843'
      },
      softwareKeyboardLayoutMode: 'resize', permissions: ['CAMERA'],
      blockedPermissions: [
        'android.permission.RECORD_AUDIO', 'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.VIBRATE'
      ]
    },
    plugins: ['expo-router', 'expo-secure-store', ['expo-build-properties', { android: { usesCleartextTraffic: true } }]],
    extra: { router: { origin: false } }
  }
};
