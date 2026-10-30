'use client';

import { createClient } from '@supabase/supabase-js';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://invalid.local', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'missing');
type Row = Record<string, any>;
type Data = { profile: Row; centers: Row[]; slots: Row[]; profiles: Row[]; parcels: Row[]; addresses: Row[]; jobs: Row[]; stops: Row[]; events: Row[] };
const kinds: Record<string, string> = { document: 'Belge', box: 'Kutu', package: 'Paket' };
const statuses: Record<string, string> = { ready: 'Bekliyor', queued: 'Sırada', offered: 'Önerildi', accepted: 'Kabul edildi', picked_up: 'Merkezden alındı', in_transit: 'Yolda', delivered: 'Teslim edildi' };

export default function Page() {
  const [session, setSession] = useState<any>(null);
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [center, setCenter] = useState('');
  const [slotCenter, setSlotCenter] = useState('');
  const [parcelCenter, setParcelCenter] = useState('');
  const [userRole, setUserRole] = useState('courier');
  const [parcelKind, setParcelKind] = useState('document');

  const token = session?.access_token as string | undefined;
  const call = useCallback(async (url: string, method = 'GET', body?: unknown) => {
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'İşlem başarısız');
    return payload;
  }, [token]);
  const refresh = useCallback(async () => {
    if (!token) return;
    try { setData(await call('/api/data')); setError(''); } catch (e) { setError((e as Error).message); }
  }, [call, token]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>, action: string, transform?: (v: Row) => Row) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await call('/api/command', 'POST', { action, ...(transform ? transform(values) : values) });
      form.reset(); setMessage('Kaydedildi.'); await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function command(action: string, values: Row) {
    setBusy(true); setError(''); setMessage('');
    try { await call('/api/command', 'POST', { action, ...values }); setMessage('İşlem tamamlandı.'); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function printLabel(id: string) {
    try {
      const label = await call(`/api/label?id=${id}`);
      const win = window.open('', '_blank', 'width=420,height=520');
      if (!win) throw new Error('Etiket penceresi engellendi');
      const doc = win.document;
      doc.title = `Kargo etiketi ${label.id.slice(0, 8)}`;
      const style = doc.createElement('style'); style.textContent = 'body{font:16px Arial;text-align:center;padding:20px}img{width:260px}strong{display:block;margin:8px}'; doc.head.appendChild(style);
      const heading = doc.createElement('h2'); heading.textContent = 'AlperFlex'; doc.body.appendChild(heading);
      const image = doc.createElement('img'); image.src = label.qr; image.onload = () => win.print(); doc.body.appendChild(image);
      for (const text of [label.id, `${kinds[label.kind]} · ${label.slot}`, label.recipient, label.address]) { const line = doc.createElement('strong'); line.textContent = text; doc.body.appendChild(line); }
    } catch (e) { setError((e as Error).message); }
  }

  const nameOf = (items: Row[], id: string, key = 'name') => items.find(x => x.id === id)?.[key] || '—';
  const parcelCount = useMemo(() => data?.parcels.reduce((acc: Row, p) => (acc[p.status] = (acc[p.status] || 0) + 1, acc), {}) || {}, [data]);

  if (!session) return <main className="login"><div className="login-card"><div className="brand">AF<span>●</span></div><h1>Yönetim paneli</h1><p>Merkezlerinizi, kargoları ve kurye işlerini tek yerden yönetin.</p><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); const result = await supabase.auth.signInWithPassword({ email, password }); if (result.error) setError(result.error.message); setBusy(false); }}><label>E-posta<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Şifre<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label><button disabled={busy}>Giriş yap</button></form>{error && <div className="alert error">{error}</div>}</div></main>;
  if (data?.profile.role === 'courier') return <main className="login"><div className="login-card"><h1>Kurye hesabı</h1><p>Bu hesapla Android/iOS kurye uygulamasından giriş yapın.</p><button onClick={() => supabase.auth.signOut()}>Çıkış yap</button></div></main>;
  const centers = data?.centers || [], slots = data?.slots || [], profiles = data?.profiles || [], parcels = data?.parcels || [], jobs = data?.jobs || [], stops = data?.stops || [], addresses = data?.addresses || [], events = data?.events || [];
  return <div className="shell"><aside><div className="brand">AF<span>●</span></div><div className="sidebar-title">AlperFlex<br/><small>Operasyon paneli</small></div><nav>{[['overview','Genel bakış'],['centers','Merkezler'],['users','Hesaplar'],['parcels','Kargolar'],['jobs','Dağıtım işleri'],['events','İşlem geçmişi']].map(([key,label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav><div className="sidebar-bottom"><span>{data?.profile.full_name || 'Yönetici'}</span><button onClick={() => supabase.auth.signOut()}>Çıkış</button></div></aside><main className="content"><header><div><span className="eyebrow">OPERASYON MERKEZİ</span><h1>{({overview:'Genel bakış',centers:'Merkezler',users:'Hesaplar',parcels:'Kargolar',jobs:'Dağıtım işleri',events:'İşlem geçmişi'} as Row)[tab]}</h1></div><button className="secondary" onClick={refresh}>Yenile</button></header>{message && <div className="alert success">{message}</div>}{error && <div className="alert error">{error}</div>}{!data ? <p>Yükleniyor…</p> : <>
    {tab === 'overview' && <><div className="stats"><div><span>Merkez</span><strong>{centers.length}</strong></div><div><span>Kayıtlı kurye</span><strong>{profiles.filter(p => p.role === 'courier').length}</strong></div><div><span>Bekleyen kargo</span><strong>{parcelCount.ready || 0}</strong></div><div><span>Yoldaki iş</span><strong>{jobs.filter(j => ['picked_up','in_transit'].includes(j.status)).length}</strong></div></div><section className="card"><h2>Son işler</h2><JobTable jobs={jobs.slice(0, 8)} profiles={profiles} centers={centers} parcels={parcels} onRequeue={id => command('requeue', { job_id: id })} busy={busy} /></section></>}
    {tab === 'centers' && <div className="grid-two"><section className="card"><h2>Yeni merkez</h2><form onSubmit={e => submit(e, 'create_center')}><label>Merkez adı<input name="name" required placeholder="İstanbul Avrupa Merkez" /></label><label>Merkez adresi<input name="address" required placeholder="Tam açık adres" /></label><button disabled={busy}>Merkez ekle</button></form><h2>Raf / göz ekle</h2><form onSubmit={e => submit(e, 'create_slot', v => ({...v, center_id: slotCenter}))}><label>Merkez<select value={slotCenter} onChange={e => setSlotCenter(e.target.value)} required><option value="">Seçin</option>{centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Konum kodu<input name="code" required placeholder="B11" /></label><button disabled={busy}>Konum ekle</button></form></section><section className="card"><h2>Merkezler ve konumlar</h2>{centers.map(c => <div className="item" key={c.id}><strong>{c.name}</strong><small>{c.address_text}</small><div className="chips">{slots.filter(s => s.center_id === c.id).map(s => <span key={s.id}>{s.code}</span>)}</div></div>)}</section></div>}
    {tab === 'users' && <div className="grid-two"><section className="card"><h2>Yeni hesap</h2><form onSubmit={e => submit(e, 'create_user', v => ({ ...v, role: userRole, center_id: center || undefined, max_parcels: v.max_parcels || 5 }))}><label>Ad soyad<input name="full_name" required /></label><label>E-posta<input name="email" type="email" required /></label><label>Geçici şifre (en az 12 karakter)<input name="password" type="password" minLength={12} required /></label><label>Rol<select value={userRole} onChange={e => setUserRole(e.target.value)}><option value="courier">Kurye</option><option value="admin">Yönetici</option></select></label>{userRole === 'courier' && <><label>Merkez<select value={center} onChange={e => setCenter(e.target.value)} required><option value="">Seçin</option>{centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Azami parça<input name="max_parcels" type="number" min="1" max="100" defaultValue="5" /></label></>}<button disabled={busy}>Hesap oluştur</button></form></section><section className="card"><h2>Hesaplar</h2>{profiles.map(p => <div className="item" key={p.id}><strong>{p.full_name} <span className="badge">{p.role === 'admin' ? 'Yönetici' : 'Kurye'}</span></strong><small>{p.role === 'courier' ? `${nameOf(centers, p.center_id)} · ${p.max_parcels} parça · ${p.available ? 'Müsait' : 'Müsait değil'}` : 'Tüm merkezler'}</small></div>)}</section></div>}
    {tab === 'parcels' && <><section className="card"><h2>Elle kargo ekle</h2><form className="form-grid" onSubmit={e => submit(e, 'create_parcel', v => ({ ...v, center_id: parcelCenter, weight_kg: v.weight_kg || undefined }))}><label>Merkez<select value={parcelCenter} onChange={e => setParcelCenter(e.target.value)} required><option value="">Seçin</option>{centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Raf / göz<select name="slot_id" required><option value="">Seçin</option>{slots.filter(s => s.center_id === parcelCenter).map(s => <option key={s.id} value={s.id}>{s.code}</option>)}</select></label><label>Tür<select name="kind" value={parcelKind} onChange={e => setParcelKind(e.target.value)}><option value="document">Belge</option><option value="box">Kutu</option><option value="package">Paket</option></select></label><label>Ağırlık (kg){parcelKind === 'box' ? ' *' : ''}<input name="weight_kg" type="number" step="0.01" min="0.01" required={parcelKind === 'box'} /></label><label>Gönderici<input name="sender_name" required /></label><label>Gönderici telefonu<input name="sender_phone" /></label><label>Çıkış adresi<input name="origin_address" required /></label><label>Alıcı<input name="recipient_name" required /></label><label>Alıcı telefonu<input name="recipient_phone" required /></label><label>Teslimat adresi<input name="destination_address" required /></label><label className="full">Açıklama<textarea name="description" rows={2} /></label><button disabled={busy}>Kargo oluştur</button></form></section><section className="card"><h2>Kargolar <small>Son 500 kayıt</small></h2><div className="table-wrap"><table><thead><tr><th>Kargo</th><th>Merkez / göz</th><th>Alıcı ve adres</th><th>Durum</th><th>Etiket</th></tr></thead><tbody>{parcels.map(p => <tr key={p.id}><td><strong>{kinds[p.kind]}</strong><small>{p.id.slice(0, 8)} · {p.weight_kg ? `${p.weight_kg} kg` : 'Ağırlık belirtilmedi'}</small></td><td>{nameOf(centers, p.center_id)}<small>{nameOf(slots, p.slot_id, 'code')}</small></td><td>{p.recipient_name}<small>{nameOf(addresses, p.destination_address_id, 'display_text')}</small></td><td><span className={`status ${p.status}`}>{statuses[p.status]}</span></td><td><button className="text-button" onClick={() => printLabel(p.id)}>QR yazdır</button></td></tr>)}</tbody></table></div></section></>}
    {tab === 'jobs' && <section className="card"><div className="section-head"><h2>Dağıtım işleri</h2><select onChange={e => e.target.value && command('dispatch', { center_id: e.target.value })} value=""><option value="">Merkez için atama çalıştır…</option>{centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div><JobTable jobs={jobs} profiles={profiles} centers={centers} parcels={parcels} onRequeue={id => command('requeue', { job_id: id })} busy={busy} />{jobs.map(j => <div className="job-detail" key={j.id}><strong>{j.id.slice(0, 8)} · {statuses[j.status]}</strong><span>{stops.filter(s => s.job_id === j.id).map(s => `${s.sequence_no}. ${s.recipient_name}: ${nameOf(addresses, s.address_id, 'display_text')}`).join(' → ')}</span></div>)}</section>}
    {tab === 'events' && <section className="card"><h2>Son 200 işlem</h2><div className="table-wrap"><table><thead><tr><th>Zaman</th><th>İşlem</th><th>Kişi</th><th>İş / kargo</th></tr></thead><tbody>{events.map(e => <tr key={e.id}><td>{new Date(e.created_at).toLocaleString('tr-TR')}</td><td>{e.event_type}</td><td>{nameOf(profiles, e.actor_id, 'full_name')}</td><td>{e.job_id?.slice(0, 8) || e.parcel_id?.slice(0, 8) || '—'}</td></tr>)}</tbody></table></div></section>}
  </>}</main></div>;
}

function JobTable({ jobs, profiles, centers, parcels, onRequeue, busy }: { jobs: Row[]; profiles: Row[]; centers: Row[]; parcels: Row[]; onRequeue: (id: string) => void; busy: boolean }) {
  return <div className="table-wrap"><table><thead><tr><th>İş</th><th>Merkez</th><th>Kurye</th><th>Parça</th><th>Durum</th><th></th></tr></thead><tbody>{jobs.map(j => <tr key={j.id}><td><strong>{j.id.slice(0, 8)}</strong><small>{new Date(j.created_at).toLocaleString('tr-TR')}</small></td><td>{centers.find(x => x.id === j.center_id)?.name || '—'}</td><td>{profiles.find(x => x.id === j.courier_id)?.full_name || 'Atama bekliyor'}</td><td>{parcels.filter(p => p.job_id === j.id).length}</td><td><span className={`status ${j.status}`}>{statuses[j.status]}</span></td><td>{['queued','offered','accepted'].includes(j.status) && <button className="text-button" disabled={busy} onClick={() => onRequeue(j.id)}>Yeniden ata</button>}</td></tr>)}</tbody></table></div>;
}
