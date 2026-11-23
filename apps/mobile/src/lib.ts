import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVER_KEY = 'alperflex_server_url';
const SERVER_URLS = ['http://192.168.0.143:3000', 'http://100.65.74.43:3000'];
let activeServer: string | null = null;
let activeUntil = 0;

export class ServerConnectionError extends Error {}

export type Row = Record<string, any>;
export type CourierData = { profile: Row; centers: Row[]; slots: Row[]; jobs: Row[]; parcels: Row[]; stops: Row[]; addresses: Row[] };

async function health(server: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(server + '/api/health', { signal: controller.signal });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.ok === true && payload?.name === 'AlperFlex';
  } catch { return false; }
  finally { clearTimeout(timeout); }
}

export async function discoverServerUrl(force = false) {
  if (!force && activeServer && Date.now() < activeUntil) return activeServer;
  const saved = await AsyncStorage.getItem(SERVER_KEY);
  const candidates = [...new Set([saved, ...SERVER_URLS].filter((value): value is string => !!value && SERVER_URLS.includes(value)))];
  for (const server of candidates) {
    if (await health(server)) {
      activeServer = server;
      activeUntil = Date.now() + 30000;
      await AsyncStorage.setItem(SERVER_KEY, server);
      return server;
    }
  }
  activeServer = null;
  activeUntil = 0;
  throw new ServerConnectionError('Bilgisayardaki AlperFlex sunucusuna bağlanılamıyor. Aynı Wi-Fi ağını veya Tailscale bağlantısını kontrol edin.');
}

export async function request(path: string, body?: object, token?: string, server?: string) {
  const base = server || await discoverServerUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let response: Response;
  try {
    response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
  } catch {
    activeUntil = 0;
    throw new ServerConnectionError('Sunucuya erişilemiyor. Wi-Fi veya Tailscale bağlantısını kontrol edip tekrar deneyin.');
  } finally { clearTimeout(timeout); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Sunucu hatası (' + response.status + ')');
  return payload;
}

export const api = (path: string, token: string, body?: object) => request(path, body, token);
