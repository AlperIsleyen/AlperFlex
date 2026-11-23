import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, CourierData, discoverServerUrl, request, Row, ServerConnectionError } from '../src/lib';

const green = '#176843';
const kind: Record<string,string> = { document: 'Belge', box: 'Kutu', package: 'Paket' };

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [connected, setConnected] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registrationName, setRegistrationName] = useState('');
  const [registrationCenter, setRegistrationCenter] = useState('');
  const [publicCenters, setPublicCenters] = useState<Row[]>([]);
  const [returnCode, setReturnCode] = useState('');
  const [data, setData] = useState<CourierData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanMode, setScanMode] = useState<'pickup' | 'delivery' | null>(null);
  const [scanError, setScanError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const scanLock = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const token = session?.token as string | undefined;
  const job = data?.jobs[0];
  const parcels = useMemo(() => data?.parcels.filter(p => p.job_id === job?.id) || [], [data, job?.id]);
  const stop = data?.stops.find(s => s.job_id === job?.id && !s.delivered_at);
  const stopParcels = parcels.filter(p => p.stop_id === stop?.id);
  const destination = data?.addresses.find(a => a.id === stop?.address_id);
  const center = data?.centers.find(c => c.id === data?.profile.center_id);

  useEffect(() => {
    (async () => {
      const storedToken = await SecureStore.getItemAsync('alperflex_token');
      if (storedToken) setSession({ token: storedToken });
      setLoadingSession(false);
    })().catch(e => { setError((e as Error).message); setLoadingSession(false); });
  }, []);
  useEffect(() => {
    let active = true;
    let probing = false;
    async function probe() {
      if (probing) return;
      probing = true;
      try {
        const url = await discoverServerUrl(true);
        if (active) { setServerUrl(url); setConnected(true); }
      } catch (e) {
        if (active) markOffline(e as Error);
      } finally { probing = false; }
    }
    probe();
    const interval = setInterval(probe, 10000);
    return () => { active = false; clearInterval(interval); };
  }, []);
  useEffect(() => {
    if (!serverUrl) return;
    request('/api/public/centers', undefined, undefined, serverUrl)
      .then(result => setPublicCenters(result.centers || []))
      .catch(() => setPublicCenters([]));
  }, [serverUrl]);
  function markOffline(reason: Error) {
    setConnected(false); setServerUrl(''); setData(null); setScanMode(null);
    setError(reason.message);
  }
  async function refresh() {
    if (!token || !connected) return false;
    try { const result = await api('/api/data', token); setData(result); setError(''); return true; }
    catch (e) { if (e instanceof ServerConnectionError) markOffline(e); else setError((e as Error).message); return false; }
  }
  useEffect(() => { if (!connected || !token) return; refresh(); const interval = setInterval(refresh, 20000); return () => clearInterval(interval); }, [token, connected]);
  async function signOut() {
    if (token) await api('/api/auth/logout', token, {}).catch(() => {});
    await SecureStore.deleteItemAsync('alperflex_token');
    setSession(null); setData(null);
  }
  async function reconnect() {
    setBusy(true); setError('');
    try { setServerUrl(await discoverServerUrl(true)); setConnected(true); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function register() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request('/api/auth/register', { full_name: registrationName, email, password, center_id: registrationCenter });
      setRegistering(false); setPassword(''); setNotice(result.message);
    } catch (e) { if (e instanceof ServerConnectionError) markOffline(e); else setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function command(action: string, values: Row = {}) {
    if (!token) return false;
    setBusy(true); setError(''); setNotice('');
    try { await api('/api/command', token, { action, ...values }); if (!await refresh()) return false; setNotice('İşlem tamamlandı.'); return true; }
    catch (e) { if (e instanceof ServerConnectionError) markOffline(e); else setError((e as Error).message); return false; } finally { setBusy(false); }
  }
  async function jobAction(operation: string, values: Row = {}) {
    if (!job) return false;
    return command('job_action', { job_id: job.id, operation, ...values });
  }
  async function scan(qr: string) {
    if (scanLock.current) return;
    scanLock.current = true;
    const tokenValue = qr.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tokenValue)) {
      setScanError('Bu QR kodu bir AlperFlex kargo etiketi değil. Tekrar deneyin.');
      scanLock.current = false;
      return;
    }
    let success = false;
    if (scanMode === 'pickup') success = await jobAction('verify_pickup', { qr: tokenValue });
    else if (stop) success = await jobAction('scan', { stop_id: stop.id, qr: tokenValue });
    if (success) { setScanMode(null); setScanError(''); }
    else { setScanError('Kod bu işe veya adrese ait değil. Doğru etiketi okutun.'); scanLock.current = false; }
  }
  async function openScanner(mode: 'pickup' | 'delivery') {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) { setError('QR okutmak için kamera izni verin'); return; }
    }
    scanLock.current = false;
    setScanError(''); setCameraReady(false); setTorch(false);
    setScanMode(mode);
  }
  async function scanPhoto() {
    if (!cameraRef.current || photoBusy) return;
    setPhotoBusy(true); setScanError('Fotoğraf kontrol ediliyor…');
    try {
      const picture = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!picture?.uri) throw new Error('Fotoğraf alınamadı. Tekrar deneyin.');
      const codes = await scanFromURLAsync(picture.uri, ['qr']);
      if (codes.length) await scan(codes[0].data);
      else setScanError('Fotoğrafta QR bulunamadı. Kodu yaklaştırıp yeniden deneyin.');
    } catch (e) { setScanError((e as Error).message || 'Fotoğraf taranamadı.'); }
    finally { setPhotoBusy(false); }
  }
  async function arrive() {
    if (!stop) return;
    await jobAction('arrive', { stop_id: stop.id });
  }
  function cancelJob() {
    if (!job) return;
    const afterPickup = ['picked_up', 'in_transit'].includes(job.status);
    Alert.alert('İşi iptal et', afterPickup ? 'Paketleri merkeze geri götürmeniz ve merkezden iade kodu almanız gerekir.' : 'İş yeniden atama bekleyen işler arasına alınacak.', [
      { text: 'Vazgeç' },
      { text: 'İşi iptal et', style: 'destructive', onPress: () => jobAction('cancel') }
    ]);
  }

  if (loadingSession) return <SafeAreaView style={styles.screen}><ActivityIndicator color={green} /></SafeAreaView>;
  if (!connected) return <EntryScreen><Text style={styles.logo}>AF<Text style={{ color: '#d5ec5a' }}>●</Text></Text><Text style={styles.title}>Sunucu bağlantısı yok</Text><Text style={styles.muted}>AlperFlex sunucusuna ulaşılana kadar kurye işlemleri kapalıdır. Bilgisayarın açık, telefonun aynı Wi-Fi ağında veya Tailscale'e bağlı olduğunu kontrol edin. Bağlantı otomatik olarak yeniden denenir.</Text><Button title="Şimdi tekrar dene" busy={busy} onPress={reconnect} />{!!error && <Text style={styles.error}>{error}</Text>}</EntryScreen>;
  if (!session) return <EntryScreen>
    <Text style={styles.logo}>AF<Text style={{ color: '#d5ec5a' }}>●</Text></Text>
    <Text style={styles.title}>{registering ? 'Kurye hesabı oluştur' : 'Kurye girişi'}</Text>
    <Text style={styles.muted}>AlperFlex'e bağlı · {serverUrl.includes('100.65.') ? 'Dış bağlantı' : 'Aynı Wi-Fi'}</Text>
    {registering && <><Text style={styles.fieldLabel}>Ad soyad</Text><TextInput style={styles.input} placeholder="Ad soyad" placeholderTextColor="#68776c" autoCapitalize="words" value={registrationName} onChangeText={setRegistrationName} /><Text style={styles.fieldLabel}>Merkez seçin</Text>{publicCenters.map(item => <Pressable key={item.id} onPress={() => setRegistrationCenter(item.id)} style={[styles.centerOption, registrationCenter === item.id && styles.centerOptionSelected]}><Text style={styles.centerOptionText}>{item.name}</Text><Text style={styles.muted}>{item.address_text}</Text></Pressable>)}{!publicCenters.length && <Text style={styles.warning}>Merkez listesi alınamadı. Sunucu bağlantısını kontrol edin.</Text>}</>}
    <Text style={styles.fieldLabel}>E-posta</Text><TextInput style={styles.input} placeholder="E-posta" placeholderTextColor="#68776c" selectionColor={green} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
    <Text style={styles.fieldLabel}>Şifre</Text><TextInput style={styles.input} placeholder={registering ? 'En az 12 karakter' : 'Şifre'} placeholderTextColor="#68776c" selectionColor={green} secureTextEntry value={password} onChangeText={setPassword} />
    {registering ? <><Button title="Hesap oluştur" busy={busy} disabled={!registrationCenter || !registrationName.trim()} onPress={register} /><Button title="Giriş ekranına dön" outline onPress={() => setRegistering(false)} /></> : <><Button title="Giriş yap" busy={busy} onPress={async () => { setBusy(true); setError(''); try { const result = await request('/api/auth/login', { email, password, client: 'mobile' }); await SecureStore.setItemAsync('alperflex_token', result.token); setSession({ token: result.token }); } catch (e) { if (e instanceof ServerConnectionError) markOffline(e); else setError((e as Error).message); } finally { setBusy(false); } }} /><Button title="Kurye hesabı oluştur" outline onPress={() => { setRegistering(true); setError(''); setNotice(''); }} /></>}
    {!!notice && <Text style={styles.success}>{notice}</Text>}{!!error && <Text style={styles.error}>{error}</Text>}
  </EntryScreen>;
  if (scanMode) return <SafeAreaView style={styles.cameraScreen}>
    <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => scan(data)} onCameraReady={() => setCameraReady(true)} onMountError={({ message }) => setScanError(`Kamera açılamadı: ${message}`)} />
    <View style={styles.scanTop}><Text style={styles.scanTitle}>{scanMode === 'pickup' ? 'Merkezde bir kargo okutun' : 'Bu adresteki kargoyu okutun'}</Text><Pressable onPress={() => setScanMode(null)}><Text style={styles.scanClose}>Kapat ×</Text></Pressable></View>
    <View style={styles.scanFrame} pointerEvents="none" />
    <View style={styles.scanBottom}><Text style={styles.scanHint}>{scanError || (cameraReady ? 'Etiketin QR kodunu çerçeveyi dolduracak kadar yaklaştırın' : 'Kamera açılıyor…')}</Text><Pressable disabled={!cameraReady || photoBusy} onPress={scanPhoto} style={styles.torchButton}><Text style={styles.scanClose}>{photoBusy ? 'Fotoğraf taranıyor…' : 'Fotoğraf çekip tara'}</Text></Pressable><Pressable onPress={() => setTorch(value => !value)} style={styles.torchButton}><Text style={styles.scanClose}>{torch ? 'Işığı kapat' : 'Işığı aç'}</Text></Pressable></View>
  </SafeAreaView>;
  if (data?.profile.role === 'admin') return <SafeAreaView style={styles.screen}><View style={styles.wrap}><Text style={styles.title}>Yönetici hesabı</Text><Text>Yönetici işlemleri web panelindedir.</Text><Button title="Çıkış yap" onPress={signOut} /></View></SafeAreaView>;
  if (data && job && ['accepted', 'picked_up', 'in_transit', 'return_pending'].includes(job.status)) return <SafeAreaView style={styles.screen}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.wrap}>
    <View style={styles.sessionHeader}><Text style={styles.eyebrow}>{center?.name?.toUpperCase() || 'MERKEZ'} · AKTİF İŞ</Text><Text style={styles.title}>{job.status === 'accepted' ? 'Paketleri merkezden alın' : job.status === 'picked_up' ? 'Dağıtıma hazırsınız' : job.status === 'return_pending' ? 'Paketleri merkeze iade edin' : 'Teslimat yapılıyor'}</Text><Text style={styles.muted}>{parcels.length} paket · {data.stops.filter(s => s.job_id === job.id).length} teslimat noktası</Text></View>
    {job.status === 'accepted' && <View style={styles.card}><Text style={styles.label}>1 / 3 · MERKEZDEN ALMA</Text><Text style={styles.cardTitle}>Paketlerinizi raflardan alın</Text><Text style={styles.muted}>Aşağıdaki raf kodlarını kontrol edin. Aldığınız paketlerden birinin QR kodunu okutun.</Text><View style={styles.chips}>{[...new Set(parcels.map(p => data.slots.find(s => s.id === p.slot_id)?.code || '?'))].map(code => <Text style={styles.chip} key={code}>Raf {code}</Text>)}</View>{job.pickup_verified && <Text style={styles.success}>QR doğrulandı. Paketleri aldığınızı onaylayabilirsiniz.</Text>}<Button title="Paket QR'ını okut" onPress={() => openScanner('pickup')} /><Button title="Tüm paketleri aldım" busy={busy} disabled={!job.pickup_verified} onPress={() => jobAction('confirm_pickup')} /></View>}
    {job.status === 'picked_up' && <View style={styles.card}><Text style={styles.label}>2 / 3 · DAĞITIMA HAZIRLIK</Text><Text style={styles.cardTitle}>Adresleri kontrol edin</Text><Text style={styles.muted}>Aşağıdaki paketlerin alıcılarını ve teslimat adreslerini inceleyin.</Text><Button title="Dağıtıma başla" busy={busy} onPress={() => jobAction('start_route')} /></View>}
    {job.status === 'in_transit' && stop && destination && <><View style={styles.card}><Text style={styles.label}>3 / 3 · SIRADAKİ TESLİMAT · {stop.sequence_no}</Text><Text style={styles.cardTitle}>{stop.recipient_name}</Text><Text style={styles.address}>{destination.display_text}</Text><Text style={styles.muted}>{stop.recipient_phone} · {stopParcels.length} paket</Text>{!stop.arrived_at ? <Button title="Adrese vardım" busy={busy} onPress={arrive} /> : <><Text style={styles.progress}>{stopParcels.filter(p => p.scanned_at).length} / {stopParcels.length} QR okutuldu</Text><Button title="Bu adresteki QR'ları okut" onPress={() => openScanner('delivery')} /><Button title="Teslimatı tamamla" busy={busy} disabled={stopParcels.some(p => !p.scanned_at)} onPress={() => Alert.alert('Teslimatı tamamla', 'Tüm paketleri alıcıya teslim ettiniz mi?', [{ text: 'Vazgeç' }, { text: 'Evet', onPress: () => jobAction('deliver_stop', { stop_id: stop.id }) }])} /></>}</View></>}
    {job.status === 'return_pending' && <View style={styles.card}><Text style={styles.label}>İADE GEREKLİ</Text><Text style={styles.cardTitle}>Paketleri {center?.name || 'merkeze'} geri götürün</Text><Text style={styles.address}>{center?.address_text}</Text><Text style={styles.muted}>Merkez yetkilisi paketleri teslim aldıktan sonra size 6 haneli iade kodu verecek. Kodu almadan iş yeniden atanmaz.</Text><TextInput style={styles.input} placeholder="6 haneli iade kodu" placeholderTextColor="#68776c" keyboardType="number-pad" maxLength={6} value={returnCode} onChangeText={setReturnCode} /><Button title="İadeyi tamamla" busy={busy} disabled={!/^\d{6}$/.test(returnCode)} onPress={async () => { if (await jobAction('confirm_return', { code: returnCode })) setReturnCode(''); }} /></View>}
    {!!error && <Text style={styles.error}>{error}</Text>}{!!notice && <Text style={styles.success}>{notice}</Text>}
    <Text style={styles.sectionTitle}>Bu işteki tüm paketler</Text><ParcelList parcels={parcels} data={data} />
    {job.status !== 'return_pending' && <Button title="İşi iptal et" outline busy={busy} onPress={cancelJob} />}
  </ScrollView></SafeAreaView>;
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.wrap}><View style={styles.top}><View><Text style={styles.eyebrow}>ALPERFLEX KURYE</Text><Text style={styles.title}>Merhaba, {data?.profile.full_name?.split(' ')[0] || 'Kurye'}</Text><Text style={styles.muted}>{center?.name || 'Merkez yükleniyor'}</Text></View><Pressable onPress={signOut}><Text style={styles.link}>Çıkış</Text></Pressable></View>{!!error && <Text style={styles.error}>{error}</Text>}{!!notice && <Text style={styles.success}>{notice}</Text>}{!data ? <ActivityIndicator color={green} /> : <>
    <View style={styles.card}><View style={styles.row}><View><Text style={styles.label}>MÜSAİTLİK</Text><Text style={styles.cardTitle}>{data.profile.available ? 'Yeni işe hazırım' : 'Müsait değilim'}</Text></View><Pressable style={[styles.pill, data.profile.available && styles.pillOn]} onPress={() => command('availability', { available: !data.profile.available })}><Text style={[styles.pillText, data.profile.available && styles.pillTextOn]}>{data.profile.available ? 'Açık' : 'Kapalı'}</Text></Pressable></View><Text style={styles.muted}>Azami {data.profile.max_parcels} parça · Yalnızca bu merkezdeki işler</Text></View>
    {!job && <View style={styles.empty}><Text style={{ fontSize: 42 }}>📦</Text><Text style={styles.cardTitle}>Şu anda iş yok</Text><Text style={styles.muted}>Müsait duruma geçtiğinizde uygun kargo grubu otomatik önerilir.</Text><Button title="Yenile" outline onPress={refresh} /></View>}
    {job?.status === 'offered' && <View style={styles.card}><Text style={styles.label}>YENİ İŞ TEKLİFİ</Text><Text style={styles.cardTitle}>{parcels.length} parça · {data.stops.filter(s => s.job_id === job.id).length} adres</Text><Text style={styles.muted}>Merkez: {center?.name}</Text><Text style={styles.sectionTitle}>Paketler ve adresler</Text><ParcelList parcels={parcels} data={data} /><View style={styles.gap}><Button title="İşi kabul et" busy={busy} onPress={() => jobAction('accept')} /><Button title="Reddet" outline busy={busy} onPress={() => jobAction('reject')} /></View></View>}
  </>}</ScrollView></SafeAreaView>;
}

function EntryScreen({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={styles.screen}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.loginScroll}><View style={styles.login}>{children}</View></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

function ParcelList({ parcels, data }: { parcels: Row[]; data: CourierData }) {
  return <View>{parcels.map(parcel => {
    const slot = data.slots.find(item => item.id === parcel.slot_id);
    const destination = data.addresses.find(item => item.id === parcel.destination_address_id);
    return <View style={styles.card} key={parcel.id}>
      <Text style={styles.label}>{kind[parcel.kind] || 'Paket'} · {parcel.id.slice(0, 8).toUpperCase()}</Text>
      <Text style={styles.cardTitle}>{parcel.recipient_name}</Text>
      <Text style={styles.address}>{destination?.display_text || 'Adres yükleniyor'}</Text>
      <Text style={styles.muted}>Raf {slot?.code || '?'} · {parcel.weight_kg ? `${parcel.weight_kg} kg` : 'Ağırlık belirtilmedi'}</Text>
      {!!parcel.description && <Text style={styles.muted}>Açıklama: {parcel.description}</Text>}
      {!!parcel.sender_name && <Text style={styles.muted}>Gönderici: {parcel.sender_name}</Text>}
    </View>;
  })}</View>;
}

function Button({ title, onPress, outline, busy, disabled }: { title: string; onPress: () => void; outline?: boolean; busy?: boolean; disabled?: boolean }) {
  return <Pressable disabled={busy || disabled} onPress={onPress} style={[styles.button, outline && styles.outline, (busy || disabled) && { opacity: .45 }]}><Text style={[styles.buttonText, outline && { color: green }]}>{busy ? 'Lütfen bekleyin…' : title}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:'#f5f8f5'},wrap:{padding:20,paddingBottom:50},sessionHeader:{marginBottom:24,gap:4},sectionTitle:{fontSize:18,fontWeight:'800',color:'#17261c',marginBottom:12},loginScroll:{flexGrow:1,paddingTop:48,paddingBottom:24},login:{paddingHorizontal:30,gap:15},fieldLabel:{color:'#273d2d',fontWeight:'700',marginBottom:-8},centerOption:{borderWidth:1,borderColor:'#9caf9f',borderRadius:10,padding:12,backgroundColor:'white'},centerOptionSelected:{borderColor:green,borderWidth:2,backgroundColor:'#e2f5e8'},centerOptionText:{color:'#17261c',fontWeight:'700'},logo:{fontSize:43,fontWeight:'900',color:green,letterSpacing:-4},top:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24},eyebrow:{color:green,fontSize:11,fontWeight:'900',letterSpacing:2,marginBottom:6},title:{fontSize:27,fontWeight:'800',color:'#17261c'},muted:{color:'#708074',lineHeight:21,marginTop:5},link:{color:green,fontWeight:'700'},input:{backgroundColor:'white',color:'#17261c',borderWidth:1,borderColor:'#9caf9f',borderRadius:10,padding:13,fontSize:16},card:{backgroundColor:'white',padding:19,borderRadius:16,borderWidth:1,borderColor:'#e2eae3',marginBottom:16,gap:10},row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},label:{fontSize:10,color:'#69917a',fontWeight:'900',letterSpacing:1.4},cardTitle:{fontSize:20,fontWeight:'800',color:'#1c2e22'},pill:{backgroundColor:'#e8ede8',paddingHorizontal:15,paddingVertical:9,borderRadius:30},pillOn:{backgroundColor:'#dcf5e2'},pillText:{color:'#67786c',fontWeight:'700'},pillTextOn:{color:green},button:{backgroundColor:green,padding:15,borderRadius:10,alignItems:'center',marginTop:8},outline:{backgroundColor:'white',borderWidth:1,borderColor:green},buttonText:{color:'white',fontWeight:'800'},gap:{gap:4,marginTop:10},empty:{padding:30,alignItems:'center',gap:12,marginTop:40},error:{backgroundColor:'#ffebe8',color:'#9d3028',padding:12,borderRadius:9,marginBottom:14},success:{backgroundColor:'#e2f5e8',color:green,padding:12,borderRadius:9,marginBottom:14},warning:{backgroundColor:'#fff4da',color:'#8a6415',padding:12,borderRadius:9,marginBottom:14},chips:{flexDirection:'row',flexWrap:'wrap',gap:6,marginVertical:8},chip:{backgroundColor:'#e8f3eb',color:green,padding:9,borderRadius:7,fontWeight:'800'},address:{fontSize:16,color:'#273d2d',lineHeight:23},parcels:{marginTop:8},parcel:{flexDirection:'row',justifyContent:'space-between',borderTopWidth:1,borderColor:'#edf1ee',paddingVertical:10},progress:{color:green,fontWeight:'800',fontSize:18},cameraScreen:{flex:1,backgroundColor:'black',justifyContent:'space-between'},scanTop:{padding:25,paddingTop:50,backgroundColor:'#0009',flexDirection:'row',justifyContent:'space-between'},scanTitle:{color:'white',fontSize:18,fontWeight:'800',maxWidth:'70%'},scanClose:{color:'white',fontWeight:'800'},scanFrame:{height:230,width:230,alignSelf:'center',borderColor:'#c7f45f',borderWidth:4,borderRadius:20},scanBottom:{backgroundColor:'#0009',padding:24,gap:12},torchButton:{alignSelf:'center',padding:12},scanHint:{color:'white',textAlign:'center',fontSize:15}
});
