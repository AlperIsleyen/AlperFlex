import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { api, CourierData, decodePolyline, Row, supabase } from '../src/lib';

const green = '#176843';
const kind: Record<string,string> = { document: 'Belge', box: 'Kutu', package: 'Paket' };

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [data, setData] = useState<CourierData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanMode, setScanMode] = useState<'pickup' | 'delivery' | null>(null);
  const scanLock = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [locationMessage, setLocationMessage] = useState('');
  const [route, setRoute] = useState<{ latitude: number; longitude: number }[]>([]);
  const [distance, setDistance] = useState('');

  const token = session?.access_token as string | undefined;
  const job = data?.jobs[0];
  const parcels = useMemo(() => data?.parcels.filter(p => p.job_id === job?.id) || [], [data, job?.id]);
  const stop = data?.stops.find(s => s.job_id === job?.id && !s.delivered_at);
  const stopParcels = parcels.filter(p => p.stop_id === stop?.id);
  const destination = data?.addresses.find(a => a.id === stop?.address_id);
  const center = data?.centers.find(c => c.id === data?.profile.center_id);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);
  async function refresh() {
    if (!token) return;
    try { const result = await api('/api/data', token); setData(result); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { refresh(); const interval = setInterval(refresh, 20000); return () => clearInterval(interval); }, [token]);
  useEffect(() => {
    if (!token || !job || !stop || !destination || !['picked_up','in_transit'].includes(job.status)) { setRoute([]); return; }
    let cancelled = false;
    (async () => {
      let origin = position;
      if (!origin) {
        try {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (permission.status === 'granted') {
            const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            origin = { lat: fix.coords.latitude, lng: fix.coords.longitude };
            if (!cancelled) { setPosition(origin); setLocationMessage(''); }
          } else if (!cancelled) setLocationMessage('Konum izni yok. Adres ve teslimat adımları kullanılabilir.');
        } catch { if (!cancelled) setLocationMessage('Konum alınamadı. Adres yine görüntülenebilir.'); }
      }
      if (!origin) origin = center ? { lat: center.lat, lng: center.lng } : null;
      if (!origin) return;
      try {
        const response = await api('/api/route', token, { job_id: job.id, stop_id: stop.id, origin });
        if (!cancelled && response.route?.polyline?.encodedPolyline) {
          setRoute(decodePolyline(response.route.polyline.encodedPolyline));
          setDistance(`${(response.route.distanceMeters / 1000).toFixed(1)} km`);
        }
      } catch (e) { if (!cancelled) setLocationMessage(`Rota alınamadı: ${(e as Error).message}`); }
    })();
    return () => { cancelled = true; };
  }, [token, job?.id, job?.status, stop?.id]);

  async function command(action: string, values: Row = {}) {
    if (!token) return;
    setBusy(true); setError(''); setNotice('');
    try { await api('/api/command', token, { action, ...values }); await refresh(); setNotice('İşlem tamamlandı.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function jobAction(operation: string, values: Row = {}) {
    if (!job) return;
    await command('job_action', { job_id: job.id, operation, ...values });
  }
  async function scan(qr: string) {
    if (scanLock.current) return;
    scanLock.current = true;
    setScanMode(null);
    const tokenValue = qr.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(tokenValue)) setError('Geçersiz QR kodu');
    else if (scanMode === 'pickup') await jobAction('verify_pickup', { qr: tokenValue });
    else if (stop) await jobAction('scan', { stop_id: stop.id, qr: tokenValue });
    scanLock.current = false;
  }
  async function openScanner(mode: 'pickup' | 'delivery') {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) { setError('QR okutmak için kamera izni verin'); return; }
    }
    scanLock.current = false;
    setScanMode(mode);
  }
  async function arrive() {
    if (!stop) return;
    let coords: { lat: number; lng: number } | null = null;
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.granted) {
        const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        coords = { lat: fix.coords.latitude, lng: fix.coords.longitude };
        setPosition(coords);
      } else setLocationMessage('Konum izni yok; varış kaydı konumsuz tutulacak.');
    } catch { setLocationMessage('Konum alınamadı; varış kaydı konumsuz tutulacak.'); }
    await jobAction('arrive', { stop_id: stop.id, ...(coords || {}) });
  }

  if (!session) return <SafeAreaView style={styles.screen}><View style={styles.login}><Text style={styles.logo}>AF<Text style={{ color: '#d5ec5a' }}>●</Text></Text><Text style={styles.title}>Kurye girişi</Text><Text style={styles.muted}>Atanan işleri ve teslimat rotalarını buradan yönetin.</Text><TextInput style={styles.input} placeholder="E-posta" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} /><TextInput style={styles.input} placeholder="Şifre" secureTextEntry value={password} onChangeText={setPassword} /><Button title="Giriş yap" busy={busy} onPress={async () => { setBusy(true); setError(''); const result = await supabase.auth.signInWithPassword({ email, password }); if (result.error) setError(result.error.message); setBusy(false); }} />{!!error && <Text style={styles.error}>{error}</Text>}</View></SafeAreaView>;
  if (scanMode) return <SafeAreaView style={styles.cameraScreen}><CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => scan(data)} /><View style={styles.scanTop}><Text style={styles.scanTitle}>{scanMode === 'pickup' ? 'Merkezde bir kargo okutun' : 'Bu adresteki kargoyu okutun'}</Text><Pressable onPress={() => setScanMode(null)}><Text style={styles.scanClose}>Kapat ×</Text></Pressable></View><View style={styles.scanFrame} /><Text style={styles.scanHint}>QR kodunu çerçevenin içine getirin</Text></SafeAreaView>;
  if (data?.profile.role === 'admin') return <SafeAreaView style={styles.screen}><View style={styles.wrap}><Text style={styles.title}>Yönetici hesabı</Text><Text>Yönetici işlemleri web panelindedir.</Text><Button title="Çıkış yap" onPress={() => supabase.auth.signOut()} /></View></SafeAreaView>;
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.wrap}><View style={styles.top}><View><Text style={styles.eyebrow}>ALPERFLEX KURYE</Text><Text style={styles.title}>Merhaba, {data?.profile.full_name?.split(' ')[0] || 'Kurye'}</Text><Text style={styles.muted}>{center?.name || 'Merkez yükleniyor'}</Text></View><Pressable onPress={() => supabase.auth.signOut()}><Text style={styles.link}>Çıkış</Text></Pressable></View>{!!error && <Text style={styles.error}>{error}</Text>}{!!notice && <Text style={styles.success}>{notice}</Text>}{!!locationMessage && <Text style={styles.warning}>{locationMessage}</Text>}{!data ? <ActivityIndicator color={green} /> : <>
    <View style={styles.card}><View style={styles.row}><View><Text style={styles.label}>MÜSAİTLİK</Text><Text style={styles.cardTitle}>{data.profile.available ? 'Yeni işe hazırım' : 'Müsait değilim'}</Text></View><Pressable style={[styles.pill, data.profile.available && styles.pillOn]} onPress={() => command('availability', { available: !data.profile.available })}><Text style={[styles.pillText, data.profile.available && styles.pillTextOn]}>{data.profile.available ? 'Açık' : 'Kapalı'}</Text></Pressable></View><Text style={styles.muted}>Azami {data.profile.max_parcels} parça · Yalnızca bu merkezdeki işler</Text></View>
    {!job && <View style={styles.empty}><Text style={{ fontSize: 42 }}>📦</Text><Text style={styles.cardTitle}>Şu anda iş yok</Text><Text style={styles.muted}>Müsait duruma geçtiğinizde uygun kargo grubu otomatik önerilir.</Text><Button title="Yenile" outline onPress={refresh} /></View>}
    {job?.status === 'offered' && <View style={styles.card}><Text style={styles.label}>YENİ İŞ TEKLİFİ</Text><Text style={styles.cardTitle}>{parcels.length} parça · {data.stops.filter(s => s.job_id === job.id).length} adres</Text><Text style={styles.muted}>Merkez: {center?.name}</Text><View style={styles.gap}><Button title="İşi kabul et" busy={busy} onPress={() => jobAction('accept')} /><Button title="Reddet" outline busy={busy} onPress={() => jobAction('reject')} /></View></View>}
    {job?.status === 'accepted' && <View style={styles.card}><Text style={styles.label}>MERKEZDEN ALMA</Text><Text style={styles.cardTitle}>{parcels.length} parçayı alın</Text><Text style={styles.muted}>{center?.name}</Text><View style={styles.chips}>{[...new Set(parcels.map(p => data.slots.find(s => s.id === p.slot_id)?.code || '?'))].map(code => <Text style={styles.chip} key={code}>Raf / göz {code}</Text>)}</View><Text style={styles.muted}>Grubunuzdaki bir kargonun QR kodunu okutun. Ardından gösterilen tüm parçaları aldığınızı onaylayın.</Text>{job.pickup_verified && <Text style={styles.success}>QR doğrulandı. Bu kargolar size ait.</Text>}<View style={styles.gap}><Button title="Bir QR okut" onPress={() => openScanner('pickup')} /><Button title="Tüm parçaları aldım" outline busy={busy} disabled={!job.pickup_verified} onPress={() => jobAction('confirm_pickup')} /></View></View>}
    {job?.status === 'picked_up' && <View style={styles.card}><Text style={styles.label}>ALMA TAMAMLANDI</Text><Text style={styles.cardTitle}>Dağıtıma başlayın</Text><Text style={styles.muted}>Sıradaki adres ve rota uygulamada açılacak.</Text><Button title="Rotayı başlat" busy={busy} onPress={() => jobAction('start_route')} /></View>}
    {job?.status === 'in_transit' && stop && destination && <><View style={styles.card}><Text style={styles.label}>SIRADAKİ TESLİMAT · {stop.sequence_no}</Text><Text style={styles.cardTitle}>{stop.recipient_name}</Text><Text style={styles.address}>{destination.display_text}</Text><Text style={styles.muted}>{stopParcels.length} parça · {stop.recipient_phone} {distance ? `· ${distance}` : ''}</Text><View style={styles.parcels}>{stopParcels.map(p => <View style={styles.parcel} key={p.id}><Text>{kind[p.kind]} · {p.id.slice(0, 8)}</Text><Text style={{ color: p.scanned_at ? green : '#a56f16' }}>{p.scanned_at ? 'Okutuldu ✓' : 'QR bekliyor'}</Text></View>)}</View></View><View style={styles.mapBox}><MapView key={stop.id} provider={PROVIDER_GOOGLE} style={StyleSheet.absoluteFill} initialRegion={{ latitude: destination.lat, longitude: destination.lng, latitudeDelta: 0.055, longitudeDelta: 0.055 }}><Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} title="Teslimat adresi" />{position && <Marker coordinate={{ latitude: position.lat, longitude: position.lng }} title="Konumunuz" pinColor={green} />}{route.length > 1 && <Polyline coordinates={route} strokeColor={green} strokeWidth={5} />}</MapView></View><View style={styles.card}><Text style={styles.label}>TESLİMAT DOĞRULAMA</Text>{!stop.arrived_at ? <><Text style={styles.muted}>Kapıya vardığınızda işaretleyin.</Text><Button title="Adrese vardım" busy={busy} onPress={arrive} /></> : <><Text style={styles.muted}>Bu adresteki {stopParcels.length} parçanın tamamını QR ile okutun.</Text><Text style={styles.progress}>{stopParcels.filter(p => p.scanned_at).length} / {stopParcels.length} okutuldu</Text><View style={styles.gap}><Button title="Kargo QR okut" onPress={() => openScanner('delivery')} /><Button title="Teslim edildi" busy={busy} disabled={stopParcels.some(p => !p.scanned_at)} onPress={() => Alert.alert('Teslimatı tamamla', 'Tüm parçaları alıcıya teslim ettiniz mi?', [{ text: 'Vazgeç' }, { text: 'Teslim edildi', onPress: () => jobAction('deliver_stop', { stop_id: stop.id }) }])} /></View></>}</View></>}
  </>}</ScrollView></SafeAreaView>;
}

function Button({ title, onPress, outline, busy, disabled }: { title: string; onPress: () => void; outline?: boolean; busy?: boolean; disabled?: boolean }) {
  return <Pressable disabled={busy || disabled} onPress={onPress} style={[styles.button, outline && styles.outline, (busy || disabled) && { opacity: .45 }]}><Text style={[styles.buttonText, outline && { color: green }]}>{busy ? 'Lütfen bekleyin…' : title}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:'#f5f8f5'},wrap:{padding:20,paddingBottom:50},login:{flex:1,justifyContent:'center',padding:30,gap:15},logo:{fontSize:43,fontWeight:'900',color:green,letterSpacing:-4},top:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24},eyebrow:{color:green,fontSize:11,fontWeight:'900',letterSpacing:2,marginBottom:6},title:{fontSize:27,fontWeight:'800',color:'#17261c'},muted:{color:'#708074',lineHeight:21,marginTop:5},link:{color:green,fontWeight:'700'},input:{backgroundColor:'white',borderWidth:1,borderColor:'#d6e1d7',borderRadius:10,padding:13,fontSize:16},card:{backgroundColor:'white',padding:19,borderRadius:16,borderWidth:1,borderColor:'#e2eae3',marginBottom:16,gap:10},row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},label:{fontSize:10,color:'#69917a',fontWeight:'900',letterSpacing:1.4},cardTitle:{fontSize:20,fontWeight:'800',color:'#1c2e22'},pill:{backgroundColor:'#e8ede8',paddingHorizontal:15,paddingVertical:9,borderRadius:30},pillOn:{backgroundColor:'#dcf5e2'},pillText:{color:'#67786c',fontWeight:'700'},pillTextOn:{color:green},button:{backgroundColor:green,padding:15,borderRadius:10,alignItems:'center',marginTop:8},outline:{backgroundColor:'white',borderWidth:1,borderColor:green},buttonText:{color:'white',fontWeight:'800'},gap:{gap:4,marginTop:10},empty:{padding:30,alignItems:'center',gap:12,marginTop:40},error:{backgroundColor:'#ffebe8',color:'#9d3028',padding:12,borderRadius:9,marginBottom:14},success:{backgroundColor:'#e2f5e8',color:green,padding:12,borderRadius:9,marginBottom:14},warning:{backgroundColor:'#fff4da',color:'#8a6415',padding:12,borderRadius:9,marginBottom:14},chips:{flexDirection:'row',flexWrap:'wrap',gap:6,marginVertical:8},chip:{backgroundColor:'#e8f3eb',color:green,padding:9,borderRadius:7,fontWeight:'800'},address:{fontSize:16,color:'#273d2d',lineHeight:23},parcels:{marginTop:8},parcel:{flexDirection:'row',justifyContent:'space-between',borderTopWidth:1,borderColor:'#edf1ee',paddingVertical:10},mapBox:{height:270,borderRadius:16,overflow:'hidden',marginBottom:16},progress:{color:green,fontWeight:'800',fontSize:18},cameraScreen:{flex:1,backgroundColor:'black',justifyContent:'space-between'},scanTop:{padding:25,paddingTop:50,backgroundColor:'#0009',flexDirection:'row',justifyContent:'space-between'},scanTitle:{color:'white',fontSize:18,fontWeight:'800',maxWidth:'70%'},scanClose:{color:'white',fontWeight:'800'},scanFrame:{height:230,width:230,alignSelf:'center',borderColor:'#c7f45f',borderWidth:4,borderRadius:20},scanHint:{color:'white',textAlign:'center',padding:35,backgroundColor:'#0009'}
});
