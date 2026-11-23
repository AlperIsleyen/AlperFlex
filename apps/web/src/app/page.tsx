'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type Row = Record<string, any>;
type Data = { profile: Row; centers: Row[]; slots: Row[]; profiles: Row[]; parcels: Row[]; addresses: Row[]; jobs: Row[]; stops: Row[]; events: Row[] };
const kinds: Record<string, string> = { document: 'Belge', box: 'Kutu', package: 'Paket' };
const statuses: Record<string, string> = { ready: 'Bekliyor', queued: 'Atama bekliyor', offered: 'Önerildi', accepted: 'Kabul edildi', picked_up: 'Merkezden alındı', in_transit: 'Yolda', return_pending: 'İade bekliyor', returned_partial: 'Kısmi iade', delivered: 'Teslim edildi' };

export default function Page() {
  const [session, setSession] = useState<Row | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [parcelKind, setParcelKind] = useState('document');
  const [returnCode, setReturnCode] = useState<{ jobId: string; code: string } | null>(null);

  const call = useCallback(async (url: string, method = 'GET', body?: unknown) => {
    const response = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'İşlem başarısız');
    return payload;
  }, []);
  const refresh = useCallback(async () => {
    if (!session) return;
    try { setData(await call('/api/data')); setError(''); } catch (e) { setError((e as Error).message); }
  }, [call, session]);
  useEffect(() => {
    fetch('/api/auth/session').then(r => r.ok ? r.json() : null).then(result => setSession(result?.profile || null)).catch(() => setSession(null));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>, action: string, transform?: (values: Row) => Row) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await call('/api/command', 'POST', { action, ...(transform ? transform(values) : values) });
      form.reset(); setMessage('Kaydedildi.'); await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function command(action: string, values: Row = {}) {
    setBusy(true); setError(''); setMessage('');
    try { const result = await call('/api/command', 'POST', { action, ...values }); setMessage('İşlem tamamlandı.'); await refresh(); return result.data; }
    catch (e) { setError((e as Error).message); return null; } finally { setBusy(false); }
  }
  async function printLabel(parcelId: string) {
    try {
      const label = await call('/api/label?id=' + encodeURIComponent(parcelId));
      const win = window.open('', '_blank', 'width=420,height=560');
      if (!win) throw new Error('Etiket penceresi engellendi');
      const doc = win.document;
      doc.title = 'Kargo etiketi ' + label.id.slice(0, 8);
      const style = doc.createElement('style');
      style.textContent = 'body{font:16px Arial;text-align:center;padding:20px}img{width:300px}strong{display:block;margin:8px}';
      doc.head.appendChild(style);
      const heading = doc.createElement('h2'); heading.textContent = 'AlperFlex'; doc.body.appendChild(heading);
      const image = doc.createElement('img'); image.src = label.qr; image.onload = () => win.print(); doc.body.appendChild(image);
      for (const value of [label.id, kinds[label.kind] + ' · ' + label.slot, label.recipient, label.address]) {
        const line = doc.createElement('strong'); line.textContent = value; doc.body.appendChild(line);
      }
    } catch (e) { setError((e as Error).message); }
  }
  async function issueCode(jobId: string) {
    const result = await command('issue_return_code', { job_id: jobId });
    if (result?.code) setReturnCode({ jobId, code: result.code });
  }
  async function signOut() {
    await call('/api/auth/logout', 'POST').catch(() => {});
    setSession(null); setData(null); setReturnCode(null);
  }

  const owner = !!data && data.profile.role === 'admin' && !data.profile.center_id;
  const activeCenterId = data?.profile.center_id as string | undefined;
  const currentTab = owner ? 'centers' : tab;
  const centers = data?.centers || [], slots = data?.slots || [], profiles = data?.profiles || [];
  const parcels = data?.parcels || [], jobs = data?.jobs || [], stops = data?.stops || [];
  const addresses = data?.addresses || [], events = data?.events || [];
  const parcelCount = useMemo(() => parcels.reduce((acc: Row, parcel) => (acc[parcel.status] = (acc[parcel.status] || 0) + 1, acc), {}), [parcels]);
  const nameOf = (items: Row[], id: string, key = 'name') => items.find(item => item.id === id)?.[key] || '—';
  const nav = owner ? [['centers', 'Merkezler']] : [['overview', 'Genel bakış'], ['centers', 'Raflar'], ['users', 'Kuryeler'], ['parcels', 'Kargolar'], ['jobs', 'Dağıtım işleri'], ['events', 'İşlem geçmişi']];
  const title: Record<string, string> = { overview: 'Genel bakış', centers: owner ? 'Merkezler' : 'Raflar', users: 'Kuryeler', parcels: 'Kargolar', jobs: 'Dağıtım işleri', events: 'İşlem geçmişi' };

  if (!session) return <main className="login"><div className="login-card">
    <div className="brand">AF<span>●</span></div><h1>AlperFlex girişi</h1><p>Yönetici veya merkez hesabınızla giriş yapın.</p>
    <form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { const result = await call('/api/auth/login', 'POST', { email, password, client: 'web' }); setSession(result.profile); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
      <label>E-posta<input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>
      <label>Şifre<input type="password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
      <button disabled={busy}>Giriş yap</button>
    </form>{error && <div className="alert error">{error}</div>}
  </div></main>;
  if (data?.profile.role === 'courier') return <main className="login"><div className="login-card"><h1>Kurye hesabı</h1><p>Bu hesap Android kurye uygulamasında kullanılır.</p><button onClick={signOut}>Çıkış yap</button></div></main>;
  return <div className="shell"><aside>
    <div className="brand">AF<span>●</span></div>
    <div className="sidebar-title">AlperFlex<br/><small>{owner ? 'Ana yönetim' : centers[0]?.name || 'Merkez paneli'}</small></div>
    <nav>{nav.map(([key, label]) => <button key={key} className={currentTab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>
    <div className="sidebar-bottom"><span>{data?.profile.full_name || 'Hesap'}</span><button onClick={signOut}>Çıkış</button></div>
  </aside><main className="content"><header><div><span className="eyebrow">{owner ? 'ANA YÖNETİM' : (centers[0]?.name || 'MERKEZ').toUpperCase()}</span><h1>{title[currentTab]}</h1></div><button className="secondary" onClick={refresh}>Yenile</button></header>
    {message && <div className="alert success">{message}</div>}{error && <div className="alert error">{error}</div>}
    {!data ? <p>Yükleniyor…</p> : <>
      {owner && <div className="grid-two"><section className="card"><h2>Yeni merkez ve hesabı</h2>
        <form onSubmit={event => submit(event, 'create_center')}>
          <label>Merkez adı<input name="name" required placeholder="İstanbul Avrupa Merkez" /></label>
          <label>Merkez adresi<input name="address" required placeholder="Tam açık adres" /></label>
          <label>Merkez yetkilisi<input name="manager_full_name" required /></label>
          <label>Merkez hesabı e-postası<input name="manager_email" type="email" required /></label>
          <label>Şifre (en az 12 karakter)<input name="manager_password" type="password" minLength={12} required /></label>
          <button disabled={busy}>Merkez aç</button>
        </form></section><section className="card"><h2>Merkezler</h2>
          {centers.map(center => <div className="item" key={center.id}><strong>{center.name}</strong><small>{center.address_text}</small>
            {profiles.some(profile => profile.center_id === center.id) ? <small>Merkez hesabı hazır</small> : <form onSubmit={event => submit(event, 'create_center_account', values => ({ ...values, center_id: center.id }))}>
              <p>Bu merkez için hesap oluşturun.</p><label>Yetkili adı<input name="full_name" required /></label><label>E-posta<input name="email" type="email" required /></label><label>Şifre<input name="password" type="password" minLength={12} required /></label><button disabled={busy}>Merkez hesabı aç</button>
            </form>}
          </div>)}
        </section></div>}
      {!owner && currentTab === 'overview' && <><div className="stats">
        <div><span>Kurye</span><strong>{profiles.filter(profile => profile.role === 'courier' && profile.approved).length}</strong></div>
        <div><span>Onay bekleyen</span><strong>{profiles.filter(profile => profile.role === 'courier' && !profile.approved).length}</strong></div>
        <div><span>Bekleyen kargo</span><strong>{parcelCount.ready || 0}</strong></div>
        <div><span>Aktif iş</span><strong>{jobs.filter(job => ['offered','accepted','picked_up','in_transit','return_pending'].includes(job.status)).length}</strong></div>
      </div><section className="card"><h2>Son işler</h2><JobTable jobs={jobs.slice(0, 8)} profiles={profiles} parcels={parcels} onRequeue={id => command('requeue', { job_id: id })} onIssueCode={issueCode} busy={busy} /></section></>}
      {!owner && currentTab === 'centers' && <div className="grid-two"><section className="card"><h2>Raf / göz ekle</h2>
        <form onSubmit={event => submit(event, 'create_slot', values => ({ ...values, center_id: activeCenterId }))}>
          <label>Konum kodu<input name="code" required placeholder="A1" /></label><button disabled={busy}>Raf ekle</button>
        </form></section><section className="card"><h2>Merkez rafları</h2>{slots.map(slot => <div className="item" key={slot.id}><strong>{slot.code}</strong></div>)}</section></div>}
      {!owner && currentTab === 'users' && <div className="grid-two"><section className="card"><h2>Yeni kurye</h2>
        <form onSubmit={event => submit(event, 'create_user', values => ({ ...values, role: 'courier', center_id: activeCenterId }))}>
          <label>Ad soyad<input name="full_name" required /></label><label>E-posta<input name="email" type="email" required /></label>
          <label>Şifre (en az 12 karakter)<input name="password" type="password" minLength={12} required /></label>
          <label>Azami parça<input name="max_parcels" type="number" min="1" max="100" defaultValue="5" /></label>
          <button disabled={busy}>Kurye oluştur</button>
        </form></section><section className="card"><h2>Kuryeler</h2>{profiles.filter(profile => profile.role === 'courier').map(profile => <div className="item" key={profile.id}>
          <strong>{profile.full_name} <span className="badge">{profile.approved ? 'Onaylı' : 'Onay bekliyor'}</span></strong><small>{profile.max_parcels} parça · {profile.available ? 'Müsait' : 'Müsait değil'}</small>
          {!profile.approved && <button className="text-button" disabled={busy} onClick={() => command('approve_courier', { courier_id: profile.id })}>Kuryeyi onayla</button>}
        </div>)}</section></div>}
      {!owner && currentTab === 'parcels' && <><section className="card"><h2>Yeni kargo</h2>
        <form className="form-grid" onSubmit={event => submit(event, 'create_parcel', values => ({ ...values, center_id: activeCenterId, weight_kg: values.weight_kg || undefined }))}>
          <label>Raf / göz<select name="slot_id" required><option value="">Seçin</option>{slots.map(slot => <option key={slot.id} value={slot.id}>{slot.code}</option>)}</select></label>
          <label>Tür<select name="kind" value={parcelKind} onChange={event => setParcelKind(event.target.value)}><option value="document">Belge</option><option value="box">Kutu</option><option value="package">Paket</option></select></label>
          <label>Ağırlık (kg){parcelKind === 'box' ? ' *' : ''}<input name="weight_kg" type="number" step="0.01" min="0.01" required={parcelKind === 'box'} /></label>
          <label>Gönderici<input name="sender_name" required /></label><label>Gönderici telefonu<input name="sender_phone" /></label>
          <label>Çıkış adresi<input name="origin_address" required /></label><label>Alıcı<input name="recipient_name" required /></label>
          <label>Alıcı telefonu<input name="recipient_phone" required /></label><label>Teslimat adresi<input name="destination_address" required /></label>
          <label className="full">Açıklama<textarea name="description" rows={2} /></label><button disabled={busy}>Kargo oluştur</button>
        </form></section><section className="card"><h2>Kargolar</h2><div className="table-wrap"><table><thead><tr><th>Kargo</th><th>Raf</th><th>Alıcı ve adres</th><th>Durum</th><th>Etiket</th></tr></thead><tbody>
          {parcels.map(parcel => <tr key={parcel.id}><td><strong>{kinds[parcel.kind]}</strong><small>{parcel.id.slice(0, 8)} · {parcel.weight_kg ? parcel.weight_kg + ' kg' : 'Ağırlık yok'}</small></td><td>{nameOf(slots, parcel.slot_id, 'code')}</td><td>{parcel.recipient_name}<small>{nameOf(addresses, parcel.destination_address_id, 'display_text')}</small></td><td><span className={'status ' + parcel.status}>{statuses[parcel.status]}</span></td><td><button className="text-button" onClick={() => printLabel(parcel.id)}>QR yazdır</button></td></tr>)}
        </tbody></table></div></section></>}
      {!owner && currentTab === 'jobs' && <section className="card"><div className="section-head"><h2>Dağıtım işleri</h2><button className="secondary" onClick={() => command('dispatch', { center_id: activeCenterId })}>Atama çalıştır</button></div>
        {returnCode && <div className="alert success">İade kodu: <strong>{returnCode.code}</strong> · Paketleri teslim aldıktan sonra kuryeye söyleyin. Kod 30 dakika geçerlidir.</div>}
        <JobTable jobs={jobs} profiles={profiles} parcels={parcels} onRequeue={id => command('requeue', { job_id: id })} onIssueCode={issueCode} busy={busy} />
        {jobs.map(job => <div className="job-detail" key={job.id}><strong>{job.id.slice(0, 8)} · {statuses[job.status]}</strong><span>{stops.filter(stop => stop.job_id === job.id).map(stop => String(stop.sequence_no) + '. ' + stop.recipient_name + ': ' + nameOf(addresses, stop.address_id, 'display_text')).join(' → ')}</span></div>)}
      </section>}
      {!owner && currentTab === 'events' && <section className="card"><h2>Son işlemler</h2><div className="table-wrap"><table><thead><tr><th>Zaman</th><th>İşlem</th><th>Kişi</th><th>İş / kargo</th></tr></thead><tbody>{events.map(event => <tr key={event.id}><td>{new Date(event.created_at).toLocaleString('tr-TR')}</td><td>{event.event_type}</td><td>{nameOf(profiles, event.actor_id, 'full_name')}</td><td>{event.job_id?.slice(0, 8) || event.parcel_id?.slice(0, 8) || '—'}</td></tr>)}</tbody></table></div></section>}
    </>}
  </main></div>;
}

function JobTable({ jobs, profiles, parcels, onRequeue, onIssueCode, busy }: { jobs: Row[]; profiles: Row[]; parcels: Row[]; onRequeue: (id: string) => void; onIssueCode: (id: string) => void; busy: boolean }) {
  return <div className="table-wrap"><table><thead><tr><th>İş</th><th>Kurye</th><th>Parça</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>
    {jobs.map(job => <tr key={job.id}><td><strong>{job.id.slice(0, 8)}</strong><small>{new Date(job.created_at).toLocaleString('tr-TR')}</small></td><td>{profiles.find(profile => profile.id === job.courier_id)?.full_name || 'Atama bekliyor'}</td><td>{parcels.filter(parcel => parcel.job_id === job.id).length}</td><td><span className={'status ' + job.status}>{statuses[job.status] || job.status}</span></td><td>{job.status === 'return_pending' ? <button className="text-button" disabled={busy} onClick={() => onIssueCode(job.id)}>İade kodu oluştur</button> : ['queued','offered','accepted'].includes(job.status) ? <button className="text-button" disabled={busy} onClick={() => onRequeue(job.id)}>Yeniden ata</button> : null}</td></tr>)}
  </tbody></table></div>;
}
