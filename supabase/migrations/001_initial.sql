create extension if not exists pgcrypto;

create table public.centers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address_text text not null,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);

create table public.slots (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id),
  code text not null,
  unique (center_id, code),
  unique (id, center_id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin', 'courier')),
  center_id uuid references public.centers(id),
  max_parcels integer not null default 5 check (max_parcels between 1 and 100),
  available boolean not null default false,
  created_at timestamptz not null default now(),
  check (role = 'admin' or center_id is not null)
);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  normalized_text text not null unique,
  display_text text not null,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id),
  courier_id uuid references public.profiles(id),
  status text not null default 'queued' check (status in ('queued','offered','accepted','picked_up','in_transit','delivered')),
  pickup_verified boolean not null default false,
  offered_at timestamptz,
  accepted_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.job_rejections (
  job_id uuid not null references public.jobs(id) on delete cascade,
  courier_id uuid not null references public.profiles(id),
  rejected_at timestamptz not null default now(),
  primary key (job_id, courier_id)
);

create table public.stops (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  address_id uuid not null references public.addresses(id),
  recipient_name text not null,
  recipient_phone text not null,
  sequence_no integer not null,
  arrived_at timestamptz,
  arrival_lat double precision,
  arrival_lng double precision,
  delivered_at timestamptz,
  unique (job_id, address_id, recipient_name, recipient_phone),
  unique (job_id, sequence_no)
);

create table public.parcels (
  id uuid primary key default gen_random_uuid(),
  qr_token uuid not null unique default gen_random_uuid(),
  center_id uuid not null references public.centers(id),
  slot_id uuid not null,
  kind text not null check (kind in ('document','box','package')),
  weight_kg numeric(9,2) check (weight_kg is null or weight_kg > 0),
  description text not null default '',
  sender_name text not null,
  sender_phone text not null default '',
  recipient_name text not null,
  recipient_phone text not null,
  origin_address_id uuid not null references public.addresses(id),
  destination_address_id uuid not null references public.addresses(id),
  job_id uuid references public.jobs(id),
  stop_id uuid references public.stops(id),
  status text not null default 'ready' check (status in ('ready','offered','accepted','picked_up','in_transit','delivered')),
  scanned_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (slot_id, center_id) references public.slots(id, center_id),
  check (kind <> 'box' or weight_kg is not null)
);

create index parcels_dispatch_idx on public.parcels(center_id, status, created_at) where job_id is null;
create index parcels_job_idx on public.parcels(job_id);
create index stops_job_idx on public.stops(job_id, sequence_no);
create index jobs_courier_idx on public.jobs(courier_id, status);

create table public.events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  center_id uuid references public.centers(id),
  job_id uuid references public.jobs(id),
  parcel_id uuid references public.parcels(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_created_idx on public.events(created_at desc);

-- Clients use authenticated HTTP API routes. Tables and transition functions are
-- inaccessible with the public/anon key; the server holds the service key.
alter table public.centers enable row level security;
alter table public.slots enable row level security;
alter table public.profiles enable row level security;
alter table public.addresses enable row level security;
alter table public.jobs enable row level security;
alter table public.job_rejections enable row level security;
alter table public.stops enable row level security;
alter table public.parcels enable row level security;
alter table public.events enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

create or replace function public.dispatch_center(p_center uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_courier record;
  v_job public.jobs%rowtype;
  v_seed record;
  v_group record;
  v_stop uuid;
  v_sequence integer;
  v_count integer;
  v_added integer;
  v_take integer;
begin
  perform 1 from public.centers where id = p_center for update;
  for v_courier in
    select p.* from public.profiles p
    where p.role = 'courier' and p.available and p.center_id = p_center
      and not exists (select 1 from public.jobs j where j.courier_id = p.id and j.status in ('offered','accepted','picked_up','in_transit'))
    order by p.created_at, p.id
  loop
    select j.* into v_job from public.jobs j
    where j.center_id = p_center and j.status = 'queued'
      and (select count(*) from public.parcels where job_id = j.id) <= v_courier.max_parcels
      and not exists (select 1 from public.job_rejections r where r.job_id = j.id and r.courier_id = v_courier.id)
    order by j.created_at limit 1 for update skip locked;

    if found then
      update public.jobs set courier_id = v_courier.id, status = 'offered', offered_at = now() where id = v_job.id;
      update public.parcels set status = 'offered' where job_id = v_job.id;
      insert into public.events(center_id, job_id, event_type, details)
        values (p_center, v_job.id, 'job_offered', jsonb_build_object('courier_id', v_courier.id));
      continue;
    end if;

    select p.id, a.lat, a.lng into v_seed from public.parcels p
      join public.addresses a on a.id = p.destination_address_id
      where p.center_id = p_center and p.job_id is null and p.status = 'ready'
      order by p.created_at, p.id limit 1;
    if not found then continue; end if;

    insert into public.jobs(center_id, courier_id, status, offered_at)
      values (p_center, v_courier.id, 'offered', now()) returning * into v_job;
    v_sequence := 0;
    v_count := 0;
    for v_group in
      select p.destination_address_id, p.recipient_phone, p.recipient_name,
        count(*)::integer as parcel_count,
        min(((a.lat - v_seed.lat)^2 + ((a.lng - v_seed.lng) * cos(radians(v_seed.lat)))^2)) as distance_score,
        min(p.created_at) as first_created
      from public.parcels p join public.addresses a on a.id = p.destination_address_id
      where p.center_id = p_center and p.job_id is null and p.status = 'ready'
      group by p.destination_address_id, p.recipient_phone, p.recipient_name
      order by distance_score, first_created
    loop
      exit when v_count >= v_courier.max_parcels;
      if v_count + v_group.parcel_count > v_courier.max_parcels
        and (v_group.parcel_count <= v_courier.max_parcels or v_count > 0) then continue; end if;
      v_take := least(v_group.parcel_count, v_courier.max_parcels - v_count);
      v_sequence := v_sequence + 1;
      insert into public.stops(job_id, address_id, recipient_name, recipient_phone, sequence_no)
        values (v_job.id, v_group.destination_address_id, v_group.recipient_name, v_group.recipient_phone, v_sequence)
        returning id into v_stop;
      with picked as (
        select id from public.parcels
        where center_id = p_center and job_id is null and status = 'ready'
          and destination_address_id = v_group.destination_address_id
          and recipient_name = v_group.recipient_name
          and recipient_phone = v_group.recipient_phone
        order by created_at, id limit v_take for update skip locked
      )
      update public.parcels p set job_id = v_job.id, stop_id = v_stop, status = 'offered'
        from picked where p.id = picked.id;
      get diagnostics v_added = row_count;
      if v_added = 0 then
        delete from public.stops where id = v_stop;
        v_sequence := v_sequence - 1;
      end if;
      v_count := v_count + v_added;
    end loop;
    if v_count = 0 then
      delete from public.jobs where id = v_job.id;
    else
      insert into public.events(center_id, job_id, event_type, details)
        values (p_center, v_job.id, 'job_offered', jsonb_build_object('count', v_count, 'courier_id', v_courier.id));
    end if;
  end loop;
end;
$$;

create or replace function public.courier_action(
  p_actor uuid, p_action text, p_job uuid, p_stop uuid default null,
  p_qr uuid default null, p_lat double precision default null, p_lng double precision default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles%rowtype;
  v_job public.jobs%rowtype;
  v_stop public.stops%rowtype;
  v_parcel public.parcels%rowtype;
  v_center uuid;
begin
  select * into v_profile from public.profiles where id = p_actor and role = 'courier';
  if not found then raise exception 'Kurye yetkisi gerekli'; end if;
  select center_id into v_center from public.jobs where id = p_job;
  if v_center is null then raise exception 'İş bulunamadı'; end if;
  perform 1 from public.centers where id = v_center for update;
  select * into v_job from public.jobs where id = p_job for update;
  if not found or v_job.courier_id is distinct from p_actor or v_job.center_id <> v_profile.center_id then
    raise exception 'Bu işe erişim yok';
  end if;

  if p_action = 'accept' and v_job.status = 'offered' then
    update public.jobs set status = 'accepted', accepted_at = now() where id = p_job;
    update public.parcels set status = 'accepted' where job_id = p_job;
  elsif p_action = 'reject' and v_job.status = 'offered' then
    insert into public.job_rejections(job_id, courier_id) values (p_job, p_actor) on conflict do nothing;
    update public.jobs set status = 'queued', courier_id = null, offered_at = null where id = p_job;
    update public.parcels set status = 'ready' where job_id = p_job;
  elsif p_action = 'verify_pickup' and v_job.status = 'accepted' then
    if not exists (select 1 from public.parcels where job_id = p_job and qr_token = p_qr) then
      raise exception 'QR bu işe ait değil';
    end if;
    update public.jobs set pickup_verified = true where id = p_job;
  elsif p_action = 'confirm_pickup' and v_job.status = 'accepted' and v_job.pickup_verified then
    update public.jobs set status = 'picked_up', picked_up_at = now() where id = p_job;
    update public.parcels set status = 'picked_up' where job_id = p_job;
  elsif p_action = 'start_route' and v_job.status = 'picked_up' then
    update public.jobs set status = 'in_transit' where id = p_job;
    update public.parcels set status = 'in_transit' where job_id = p_job;
  elsif p_action in ('arrive','scan','deliver_stop') and v_job.status = 'in_transit' then
    select * into v_stop from public.stops where id = p_stop and job_id = p_job for update;
    if not found or v_stop.delivered_at is not null then raise exception 'Geçersiz teslimat noktası'; end if;
    if p_action = 'arrive' then
      update public.stops set arrived_at = coalesce(arrived_at, now()), arrival_lat = p_lat, arrival_lng = p_lng where id = p_stop;
    elsif p_action = 'scan' then
      if v_stop.arrived_at is null then raise exception 'Önce adrese vardığınızı belirtin'; end if;
      select * into v_parcel from public.parcels where stop_id = p_stop and job_id = p_job and qr_token = p_qr for update;
      if not found then raise exception 'QR bu adresteki kargoya ait değil'; end if;
      if v_parcel.scanned_at is null then
        update public.parcels set scanned_at = now() where id = v_parcel.id;
        insert into public.events(actor_id, center_id, job_id, parcel_id, event_type)
          values (p_actor, v_job.center_id, p_job, v_parcel.id, 'parcel_scanned');
      end if;
      return jsonb_build_object('ok', true, 'already_scanned', v_parcel.scanned_at is not null);
    else
      if v_stop.arrived_at is null then raise exception 'Önce adrese vardığınızı belirtin'; end if;
      if exists (select 1 from public.parcels where stop_id = p_stop and scanned_at is null) then
        raise exception 'Bu adresteki tüm QR kodlarını okutun';
      end if;
      update public.stops set delivered_at = now() where id = p_stop;
      update public.parcels set status = 'delivered', delivered_at = now() where stop_id = p_stop;
      if not exists (select 1 from public.stops where job_id = p_job and delivered_at is null) then
        update public.jobs set status = 'delivered', delivered_at = now() where id = p_job;
      end if;
    end if;
  else
    raise exception 'İş durumu bu işlem için uygun değil';
  end if;

  insert into public.events(actor_id, center_id, job_id, event_type, details)
    values (p_actor, v_job.center_id, p_job, p_action, jsonb_build_object('stop_id', p_stop));
  if p_action in ('reject','deliver_stop') then perform public.dispatch_center(v_job.center_id); end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_requeue(p_actor uuid, p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_job public.jobs%rowtype; v_center uuid;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then
    raise exception 'Yönetici yetkisi gerekli';
  end if;
  select center_id into v_center from public.jobs where id = p_job;
  if v_center is null then raise exception 'İş bulunamadı'; end if;
  perform 1 from public.centers where id = v_center for update;
  select * into v_job from public.jobs where id = p_job for update;
  if not found or v_job.status not in ('queued','offered','accepted') then
    raise exception 'Bu iş yeniden atanamaz';
  end if;
  if v_job.status = 'queued' then
    delete from public.job_rejections where job_id = p_job;
  elsif v_job.courier_id is not null then
    insert into public.job_rejections(job_id, courier_id) values (p_job, v_job.courier_id) on conflict do nothing;
  end if;
  update public.jobs set courier_id = null, status = 'queued', offered_at = null,
    accepted_at = null, pickup_verified = false where id = p_job;
  update public.parcels set status = 'ready' where job_id = p_job;
  insert into public.events(actor_id, center_id, job_id, event_type)
    values (p_actor, v_job.center_id, p_job, 'admin_requeue');
  perform public.dispatch_center(v_job.center_id);
end;
$$;

revoke all on function public.dispatch_center(uuid) from public, anon, authenticated;
revoke all on function public.courier_action(uuid,text,uuid,uuid,uuid,double precision,double precision) from public, anon, authenticated;
grant execute on function public.dispatch_center(uuid) to service_role;
grant execute on function public.courier_action(uuid,text,uuid,uuid,uuid,double precision,double precision) to service_role;
revoke all on function public.admin_requeue(uuid,uuid) from public, anon, authenticated;
grant execute on function public.admin_requeue(uuid,uuid) to service_role;
