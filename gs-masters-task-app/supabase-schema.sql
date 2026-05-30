-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  GS MASTERS FIELD APP — Supabase Schema                            ║
-- ║  Run this in your Supabase SQL Editor                             ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── PROFILES (extends Supabase auth.users) ──────────────────────────
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null,
  role text not null default 'crew' check (role in ('admin','crew')),
  phone text,
  active boolean default true,          -- admin kill switch: false = app locks on all devices
  preferred_lang text default 'en' check (preferred_lang in ('en','es')),
  created_at timestamptz default now()
);

-- ── JOBS ────────────────────────────────────────────────────────────
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  lat double precision,
  lng double precision,
  status text default 'active' check (status in ('active','closed')),
  closed_at date,
  created_at timestamptz default now()
);

-- ── TASKS ───────────────────────────────────────────────────────────
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs on delete cascade,
  title text not null,
  title_es text,
  assigned_to uuid references profiles,
  status text default 'pending' check (status in ('pending','done')),
  due_date date,
  notes text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

-- ── DAILY LOGS (bilingual, weather, GPS) ────────────────────────────
create table if not exists daily_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks on delete set null,
  job_id uuid references jobs on delete cascade,
  crew_id uuid references profiles,
  text_en text,
  text_es text,
  weather text,
  lat double precision,
  lng double precision,
  log_date date default current_date,
  created_at timestamptz default now()
);

-- ── PHOTOS (before/after/progress) ──────────────────────────────────
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks on delete cascade,
  job_id uuid references jobs on delete cascade,
  crew_id uuid references profiles,
  storage_path text not null,
  photo_type text default 'progress' check (photo_type in ('before','after','progress')),
  created_at timestamptz default now()
);

-- ── RECEIPTS (cost tracking) ────────────────────────────────────────
create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks on delete set null,
  job_id uuid references jobs on delete cascade,
  crew_id uuid references profiles,
  storage_path text,
  store text,                              -- vendor name
  amount numeric(10,2),
  note text,                               -- memo
  bill_status text default 'pending_review', -- GSM Builder AI: pending_review -> posted
  posted_bill_id uuid,                     -- links to GSM Builder bill once posted
  created_at timestamptz default now()
);

-- ── MATERIAL REQUESTS ───────────────────────────────────────────────
create table if not exists material_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks on delete set null,
  job_id uuid references jobs on delete cascade,
  crew_id uuid references profiles,
  text_en text,
  text_es text,
  fulfilled boolean default false,
  created_at timestamptz default now()
);

-- ── SIGN-OFFS (client signatures) ───────────────────────────────────
create table if not exists signoffs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks on delete cascade,
  job_id uuid references jobs on delete cascade,
  signed_name text,
  signature_data text,           -- base64 PNG of signature
  created_at timestamptz default now()
);

-- ── STORAGE BUCKET ──────────────────────────────────────────────────
-- Create a bucket named 'field-photos' in Supabase Storage (public read).

-- ── ROW LEVEL SECURITY ──────────────────────────────────────────────
alter table profiles enable row level security;
alter table jobs enable row level security;
alter table tasks enable row level security;
alter table daily_logs enable row level security;
alter table photos enable row level security;
alter table receipts enable row level security;
alter table material_requests enable row level security;
alter table signoffs enable row level security;

-- Helper: is the current user an admin?
create or replace function is_admin() returns boolean as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin');
$$ language sql security definer;

-- Profiles: everyone reads, you edit your own, admin edits all
create policy "read profiles"   on profiles for select using (true);
create policy "update own"      on profiles for update using (id = auth.uid() or is_admin());

-- Jobs: all authenticated read, admin writes
create policy "read jobs"   on jobs for select using (auth.role() = 'authenticated');
create policy "admin jobs"  on jobs for all using (is_admin());

-- Tasks: crew sees their own + admin sees all; admin writes, crew updates own status
create policy "read tasks"   on tasks for select using (is_admin() or assigned_to = auth.uid());
create policy "admin tasks"  on tasks for all using (is_admin());
create policy "crew update task" on tasks for update using (assigned_to = auth.uid());

-- Logs / photos / receipts / materials: crew writes own, admin reads all
create policy "rw logs"     on daily_logs        for all using (is_admin() or crew_id = auth.uid());
create policy "rw photos"   on photos            for all using (is_admin() or crew_id = auth.uid());
create policy "rw receipts" on receipts          for all using (is_admin() or crew_id = auth.uid());
create policy "rw mats"     on material_requests for all using (is_admin() or crew_id = auth.uid());
create policy "rw signoffs" on signoffs          for all using (auth.role() = 'authenticated');

