-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  GS MASTERS FIELD APP — Supabase Schema                         ║
-- ║  Same project as GSM Builder (mkibgjnzbgfqjkhowafr)             ║
-- ║  Run in Supabase SQL Editor                                     ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── PROFILES (crew roster — PIN-based auth, no Supabase Auth needed) ─
create table if not exists field_profiles (
  id          text primary key,               -- 'u1', 'u2', etc. or uuid
  name        text not null,
  role        text not null default 'crew' check (role in ('admin','crew')),
  email       text unique not null,
  phone       text,
  pin         text not null,
  active      boolean default true,
  preferred_lang text default 'en' check (preferred_lang in ('en','es')),
  created_at  timestamptz default now()
);

-- ── FIELD JOBS ──────────────────────────────────────────────────────
create table if not exists field_jobs (
  id          text primary key,               -- 'j1', 'j2', etc.
  name        text not null,
  address     text,
  lat         double precision,
  lng         double precision,
  budget      numeric(12,2),
  status      text default 'active' check (status in ('active','closed')),
  closed_at   date,
  -- GSM Builder integration: links to JOB-001 style IDs in app_data
  gsm_job_id  text,                           -- e.g. 'JOB-001' — null until linked
  created_at  timestamptz default now()
);

-- ── FIELD TASKS ─────────────────────────────────────────────────────
create table if not exists field_tasks (
  id          text primary key,
  job_id      text references field_jobs on delete cascade,
  title       text not null,
  title_es    text,
  assigned_to text references field_profiles,
  status      text default 'pending' check (status in ('pending','done')),
  due_date    date,
  notes       text,
  created_at  timestamptz default now(),
  completed_at timestamptz
);

-- ── DAILY LOGS ──────────────────────────────────────────────────────
create table if not exists field_logs (
  id          text primary key,
  task_id     text references field_tasks on delete set null,
  job_id      text references field_jobs on delete cascade,
  crew_id     text references field_profiles,
  text_en     text,
  text_es     text,
  weather     text,
  lat         double precision,
  lng         double precision,
  log_date    date default current_date,
  created_at  timestamptz default now()
);

-- ── PHOTOS ──────────────────────────────────────────────────────────
create table if not exists field_photos (
  id          text primary key,
  task_id     text references field_tasks on delete cascade,
  job_id      text references field_jobs on delete cascade,
  crew_id     text references field_profiles,
  data_url    text,                           -- compressed base64 (temp until Storage)
  storage_path text,                          -- Supabase Storage path (future)
  photo_type  text default 'progress' check (photo_type in ('before','after','progress')),
  size_kb     int,
  created_at  timestamptz default now()
);

-- ── RECEIPTS (with full reimbursement + GSM Builder integration) ─────
create table if not exists field_receipts (
  id          text primary key,
  task_id     text references field_tasks on delete set null,
  job_id      text references field_jobs on delete cascade,
  crew_id     text references field_profiles,
  data_url    text,                           -- receipt photo base64
  store       text,                           -- vendor name
  amount      numeric(10,2),
  note        text,

  -- Who paid at point of purchase
  paid_by     text default 'crew' check (paid_by in ('company','crew')),

  -- Reimbursement tracking (only relevant when paid_by = 'crew')
  reimbursement_status text default 'pending' check (reimbursement_status in ('na','pending','paid')),
  reimbursement_amount numeric(10,2),
  reimbursement_date   date,
  reimbursed_by        text,                  -- name of person who paid back

  -- GSM Builder integration
  bill_status     text default 'pending_review',  -- pending_review → posted
  gsm_bill_id     text,                           -- ID of bill in GSM Builder once posted
  gsm_job_folder  text,                           -- Drive folder path where copy was filed
  integration_sent_at timestamptz,               -- when pushed to GSM Builder

  created_at  timestamptz default now()
);

-- ── MATERIAL REQUESTS ───────────────────────────────────────────────
create table if not exists field_material_requests (
  id          text primary key,
  task_id     text references field_tasks on delete set null,
  job_id      text references field_jobs on delete cascade,
  crew_id     text references field_profiles,
  text_en     text,
  text_es     text,
  fulfilled   boolean default false,
  created_at  timestamptz default now()
);

-- ── SIGN-OFFS ────────────────────────────────────────────────────────
create table if not exists field_signoffs (
  id              text primary key,
  task_id         text references field_tasks on delete cascade,
  job_id          text references field_jobs on delete cascade,
  signed_name     text,
  signature_data  text,                       -- base64 PNG
  created_at      timestamptz default now()
);

-- ── INTEGRATION SETTINGS (read by GSM Builder toggle) ───────────────
-- Stored in GSM Builder STATE.settings.fieldApp — this table is the
-- server-side record so both apps can read it without STATE sync.
create table if not exists field_integration_settings (
  id              int primary key default 1,  -- singleton row
  enabled         boolean default false,
  auto_post_bills boolean default false,      -- auto-create bill when receipt arrives
  auto_file_drive boolean default false,      -- auto-copy to job Drive folder
  auto_calendar   boolean default false,      -- sync tasks to GSM Builder calendar
  updated_at      timestamptz default now()
);
insert into field_integration_settings (id, enabled) values (1, false)
  on conflict (id) do nothing;

-- ── RLS: PUBLIC READ/WRITE (PIN auth, no Supabase Auth) ─────────────
-- Field app uses its own PIN auth, not Supabase Auth.
-- Tables are publicly accessible via anon key — protected by Netlify function
-- layer in production. Enable RLS and allow anon for now.

alter table field_profiles             enable row level security;
alter table field_jobs                 enable row level security;
alter table field_tasks                enable row level security;
alter table field_logs                 enable row level security;
alter table field_photos               enable row level security;
alter table field_receipts             enable row level security;
alter table field_material_requests    enable row level security;
alter table field_signoffs             enable row level security;
alter table field_integration_settings enable row level security;

-- Allow anon full access (PIN auth handled in app layer)
create policy "anon all field_profiles"             on field_profiles             for all to anon using (true) with check (true);
create policy "anon all field_jobs"                 on field_jobs                 for all to anon using (true) with check (true);
create policy "anon all field_tasks"                on field_tasks                for all to anon using (true) with check (true);
create policy "anon all field_logs"                 on field_logs                 for all to anon using (true) with check (true);
create policy "anon all field_photos"               on field_photos               for all to anon using (true) with check (true);
create policy "anon all field_receipts"             on field_receipts             for all to anon using (true) with check (true);
create policy "anon all field_material_requests"    on field_material_requests    for all to anon using (true) with check (true);
create policy "anon all field_signoffs"             on field_signoffs             for all to anon using (true) with check (true);
create policy "anon all field_integration_settings" on field_integration_settings for all to anon using (true) with check (true);

-- ── SEED DEMO DATA ───────────────────────────────────────────────────
insert into field_profiles (id, name, role, email, phone, pin, active) values
  ('u1', 'Gregory Masters', 'admin', 'gsmastersinc@gmail.com', '+12055550001', '1234', true),
  ('u2', 'Alberto Garcia',  'crew',  'alberto@gsm.com',        '+12055550002', '2222', true),
  ('u3', 'Alex Reyes',      'crew',  'alex@gsm.com',           '+12055550003', '3333', true),
  ('u4', 'Scott Masters',   'crew',  'scott@gsm.com',          '+12055550004', '4444', true)
on conflict (id) do nothing;

insert into field_jobs (id, name, address, lat, lng, budget, status) values
  ('j1', 'Mountain Brook Residence', 'Mountain Brook, AL', 33.500, -86.752, 425000, 'active'),
  ('j2', 'Lot 1 – Harvest Creek',    'Chelsea, AL',        33.339, -86.535, 380000, 'active'),
  ('j3', 'Lot 2 – Harvest Creek',    'Chelsea, AL',        33.340, -86.536, 395000, 'active'),
  ('j4', 'Simpson Remodel',          'Hoover, AL',         33.405, -86.811,  85000, 'active')
on conflict (id) do nothing;
