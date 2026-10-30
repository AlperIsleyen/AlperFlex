export default {
  expo: {
    name: 'AlperFlex Kurye', slug: 'alperflex-kurye', scheme: 'alperflex', platforms: ['ios', 'android'],
    ios: { bundleIdentifier: 'com.alperflex.courier', infoPlist: { NSCameraUsageDescription: 'Kargo QR kodlarını okutmak için kamera kullanılır.', NSLocationWhenInUseUsageDescription: 'Teslimat rotası ve varış kaydı için konum kullanılır.' } },
    android: { package: 'com.alperflex.courier', usesCleartextTraffic: process.env.EXPO_PUBLIC_API_URL?.startsWith('http://') || false, permissions: ['CAMERA', 'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'] },
    plugins: [['react-native-maps', { iosGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY, androidGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY }], 'expo-router'],
    extra: { router: { origin: false } }
  }
};
