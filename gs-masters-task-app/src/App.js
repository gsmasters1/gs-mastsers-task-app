import { useState, useEffect, useRef, useCallback } from "react";

/* ════════════════════════════════════════════════════════════════════
   GS MASTERS FIELD APP — v2 "SUPERCHARGED"
   Superpowers: Supabase backend · Offline-first sync · GPS check-in
   · Cost roll-ups · Photo compression · Signature capture · Smart reminders
   ════════════════════════════════════════════════════════════════════ */

// ─── SUPABASE CONFIG ───────────────────────────────────────────────────
const SB_URL = "https://mkibgjnzbgfqjkhowafr.supabase.co";
const SB_KEY = "sb_publishable_zh5Soyi6iNGd8CLxPfD9Lg_dVdAwDe7";

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
      ...opts.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}
const sbGet    = (t, q = "")  => sbFetch(`${t}?${q}`, { method: "GET" });
const sbPost   = (t, d)        => sbFetch(t, { method: "POST", body: JSON.stringify(d) });
const sbPatch  = (t, id, d)    => sbFetch(`${t}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(d), prefer: "return=minimal" });
const sbDelete = (t, id)       => sbFetch(`${t}?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });

// ─── SNAKE ↔ CAMEL TRANSFORMS ──────────────────────────────────────────
const fromProfile = r => ({ id: r.id, name: r.name, role: r.role, email: r.email, phone: r.phone || "", pin: r.pin, active: r.active !== false });
const fromJob     = r => ({ id: r.id, name: r.name, address: r.address || "", lat: r.lat, lng: r.lng, budget: r.budget, status: r.status, closedAt: r.closed_at, gsmJobId: r.gsm_job_id, gsmSync: r.gsm_sync || false });
const fromTask    = r => ({ id: r.id, jobId: r.job_id, title: r.title, titleEs: r.title_es || "", assignedTo: Array.isArray(r.assigned_to) ? r.assigned_to : (r.assigned_to ? [r.assigned_to] : []), status: r.status, dueDate: r.due_date || "", createdAt: (r.created_at || "").slice(0, 10) });
const fromLog     = r => ({ id: r.id, taskId: r.task_id, jobId: r.job_id, crewId: r.crew_id, en: r.text_en, es: r.text_es, weather: r.weather, date: r.log_date });
const fromPhoto   = r => ({ id: r.id, taskId: r.task_id, jobId: r.job_id, crewId: r.crew_id, dataUrl: r.data_url, type: r.photo_type, sizeKB: r.size_kb, date: r.created_at });
const fromReceipt = r => ({ id: r.id, taskId: r.task_id, jobId: r.job_id, crewId: r.crew_id, dataUrl: r.data_url, store: r.store, amount: r.amount, note: r.note, paidBy: r.paid_by || "crew", reimbursementStatus: r.reimbursement_status || "pending", billStatus: r.bill_status, createdAt: (r.created_at || "").slice(0, 10) });
const fromMat     = r => ({ id: r.id, taskId: r.task_id, jobId: r.job_id, crewId: r.crew_id, en: r.text_en, es: r.text_es, fulfilled: r.fulfilled });

// ─── OFFLINE QUEUE ──────────────────────────────────────────────────────
const QUEUE_KEY = "gsm_offline_queue";
const getQueue = () => JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
const setQueue = (q) => localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
const enqueue  = (action) => setQueue([...getQueue(), { ...action, ts: Date.now() }]);

async function flushQueue() {
  if (!navigator.onLine) return 0;
  const q = getQueue();
  let done = 0;
  for (const action of q) {
    try {
      await sbPost(action.table, action.payload);
      done++;
    } catch { break; }
  }
  setQueue(q.slice(done));
  return done;
}

// ─── PHOTO COMPRESSION ──────────────────────────────────────────────────
function compressImage(file, maxW = 1280, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          resolve({ blob, dataUrl: canvas.toDataURL("image/jpeg", quality),
                    sizeKB: Math.round(blob.size / 1024) });
        }, "image/jpeg", quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ─── GPS HELPER ─────────────────────────────────────────────────────────
function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 8000 }
    );
  });
}
function distanceMi(a, b) {
  if (!a || !b) return null;
  const R = 3959, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

// ─── GOOGLE TRANSLATE ───────────────────────────────────────────────────
async function translateText(text, target, key) {
  if (!key || !text) return text;
  try {
    const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, target, format: "text" }) });
    const d = await r.json();
    return d?.data?.translations?.[0]?.translatedText || text;
  } catch { return text; }
}

// ─── DEMO DATA ──────────────────────────────────────────────────────────
const DEMO_USERS = [
  { id: "u1", name: "Gregory Masters", role: "admin", email: "gsmastersinc@gmail.com", phone: "+12055550001", pin: "1234", active: true },
  { id: "u2", name: "Alberto Garcia",  role: "crew",  email: "alberto@gsm.com", phone: "+12055550002", pin: "2222", active: true },
  { id: "u3", name: "Alex Reyes",      role: "crew",  email: "alex@gsm.com",    phone: "+12055550003", pin: "3333", active: true },
  { id: "u4", name: "Scott Masters",   role: "crew",  email: "scott@gsm.com",   phone: "+12055550004", pin: "4444", active: true },
];
const DEMO_JOBS = [
  { id: "j1", name: "Mountain Brook Residence", address: "Mountain Brook, AL", lat: 33.500, lng: -86.752, budget: 425000, status: "active" },
  { id: "j2", name: "Lot 1 – Harvest Creek",    address: "Chelsea, AL",        lat: 33.339, lng: -86.535, budget: 380000, status: "active" },
  { id: "j3", name: "Lot 2 – Harvest Creek",    address: "Chelsea, AL",        lat: 33.340, lng: -86.536, budget: 395000, status: "active" },
  { id: "j4", name: "Simpson Remodel",          address: "Hoover, AL",         lat: 33.405, lng: -86.811, budget: 85000,  status: "active" },
];
const DEMO_TASKS = [
  { id: "t1", jobId: "j1", title: "Frame exterior walls", titleEs: "Encuadrar paredes exteriores", assignedTo: "u2", status: "done",    dueDate: "2026-05-27", createdAt: "2026-05-26" },
  { id: "t2", jobId: "j2", title: "Pour concrete foundation", titleEs: "Verter cimientos de concreto", assignedTo: "u3", status: "pending", dueDate: "2026-05-30", createdAt: "2026-05-26" },
  { id: "t3", jobId: "j4", title: "Tile master bathroom", titleEs: "Colocar azulejo en baño principal", assignedTo: "u2", status: "pending", dueDate: "2026-05-28", createdAt: "2026-05-27" },
  { id: "t4", jobId: "j1", title: "Install insulation", titleEs: "Instalar aislamiento", assignedTo: "u4", status: "pending", dueDate: "2026-05-31", createdAt: "2026-05-27" },
];
const DEMO_RECEIPTS = [
  { id: "r1", jobId: "j1", taskId: "t1", crewId: "u2", store: "Home Depot", amount: 342.18, note: "Framing lumber", createdAt: "2026-05-26" },
  { id: "r2", jobId: "j4", taskId: "t3", crewId: "u2", store: "Floor & Decor", amount: 218.50, note: "Tile + thinset", createdAt: "2026-05-27" },
];

const T = {
  en: { tasks:"Tasks", photos:"Photos", receipts:"Receipts", log:"Log Day", login:"Sign In",
        pending:"Pending", done:"Done", overdue:"Overdue", noTasks:"All caught up!",
        checkIn:"Check In", checkedIn:"Checked in", weather:"Weather",
        sunny:"Sunny", cloudy:"Cloudy", rainy:"Rainy", hot:"Hot" },
  es: { tasks:"Tareas", photos:"Fotos", receipts:"Recibos", log:"Registro", login:"Entrar",
        pending:"Pendiente", done:"Hecho", overdue:"Atrasado", noTasks:"¡Todo al día!",
        checkIn:"Registrarse", checkedIn:"Registrado", weather:"Clima",
        sunny:"Soleado", cloudy:"Nublado", rainy:"Lluvioso", hot:"Caluroso" },
};

// ─── ICONS ──────────────────────────────────────────────────────────────
const Icon = ({ n, s = 20, c = "currentColor" }) => {
  const p = {
    home:"M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
    tasks:"M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
    calendar:"M3 4h18v18H3z M16 2v4 M8 2v4 M3 10h18",
    report:"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8",
    settings:"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
    camera:"M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    receipt:"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 18v-6 M9 15h6",
    plus:"M12 5v14 M5 12h14", check:"M20 6L9 17l-5-5",
    logout:"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
    briefcase:"M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",
    users:"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
    photo:"M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21",
    tools:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
    filter:"M22 3H2l8 9.46V19l4 2v-8.54L22 3z", translate:"M5 8l6 6 M4 6h7 M2 12h20 M7 2l5 10 M11 2l-5 10 M22 22l-5-10-5 10 M14.5 17h5",
    print:"M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z",
    pin:"M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    dollar:"M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
    wifi:"M5 13a10 10 0 0 1 14 0 M8.5 16.5a5 5 0 0 1 7 0 M2 8.82a15 15 0 0 1 20 0 M12 20h.01",
    wifiOff:"M1 1l22 22 M16.72 11.06A10.94 10.94 0 0 1 19 12.55 M5 12.55a10.94 10.94 0 0 1 5.17-2.39 M10.71 5.05A16 16 0 0 1 22.58 9 M1.42 9a15.91 15.91 0 0 1 4.7-2.88 M8.53 16.11a6 6 0 0 1 6.95 0 M12 20h.01",
    pen:"M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z M2 2l7.586 7.586 M11 11a2 2 0 1 0-4 0 2 2 0 0 0 4 0z",
    menu:"M3 12h18 M3 6h18 M3 18h18", x:"M18 6L6 18 M6 6l12 12",
    lock:"M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 10 0v4",
    power:"M18.36 6.64a9 9 0 1 1-12.73 0 M12 2v10",
  };
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p[n] && <path d={p[n]} />}</svg>;
};

// ─── STYLES ─────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@300;400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --steel:#0f1923;--steel2:#1a2738;--steel3:#243650;--sky:#3b82f6;--sky2:#60a5fa;--sky-dim:#1d4ed8;
  --slate:#64748b;--silver:#94a3b8;--mist:#cbd5e1;--white:#f8fafc;--accent:#f59e0b;
  --green:#10b981;--red:#ef4444;--orange:#f97316;--card:rgba(26,39,56,.92);--border:rgba(59,130,246,.15);
  --r:12px;--sh:0 4px 24px rgba(0,0,0,.35);
}
body{background:var(--steel);font-family:'Barlow',sans-serif;color:var(--white);min-height:100vh;overflow-x:hidden}
.app{display:flex;flex-direction:column;min-height:100vh}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes spin{to{transform:rotate(360deg)}}
.fade{animation:fadeUp .4s ease both}
.fade-1{animation-delay:.05s}.fade-2{animation-delay:.1s}.fade-3{animation-delay:.15s}

.login{min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 20% 30%,rgba(59,130,246,.12),transparent 55%),
  radial-gradient(ellipse at 85% 70%,rgba(245,158,11,.08),transparent 50%),#0b141d;padding:20px}
.login-card{width:100%;max-width:400px;padding:44px 36px;background:rgba(26,39,56,.85);
  border:1px solid var(--border);border-radius:22px;backdrop-filter:blur(20px);
  box-shadow:0 24px 70px rgba(0,0,0,.55);animation:fadeUp .5s ease both}
.logo-mark{width:72px;height:72px;border-radius:18px;margin:0 auto 16px;display:flex;align-items:center;
  justify-content:center;background:linear-gradient(135deg,var(--sky-dim),var(--sky));
  box-shadow:0 8px 28px rgba(59,130,246,.4)}
.logo-title{font-family:'Barlow Condensed';font-size:30px;font-weight:800;letter-spacing:1px;text-align:center}
.logo-sub{font-size:12px;color:var(--silver);text-align:center;letter-spacing:3px;text-transform:uppercase;margin-top:2px}

.fg{margin-bottom:18px}
.fl{display:block;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--silver);margin-bottom:7px}
.fi{width:100%;padding:13px 15px;border-radius:var(--r);background:rgba(255,255,255,.05);
  border:1px solid var(--border);color:var(--white);font-family:'Barlow';font-size:15px;outline:none;transition:.2s}
.fi:focus{border-color:var(--sky);background:rgba(59,130,246,.08);box-shadow:0 0 0 3px rgba(59,130,246,.12)}
select.fi{appearance:none;cursor:pointer}textarea.fi{resize:vertical;min-height:78px}

.btn{display:inline-flex;align-items:center;gap:7px;padding:11px 18px;border-radius:var(--r);
  font-family:'Barlow Condensed';font-size:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;
  border:none;cursor:pointer;transition:.18s;white-space:nowrap}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-p{background:linear-gradient(135deg,var(--sky-dim),var(--sky));color:#fff;box-shadow:0 4px 14px rgba(59,130,246,.35)}
.btn-p:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 22px rgba(59,130,246,.45)}
.btn-s{background:rgba(255,255,255,.07);color:var(--mist);border:1px solid var(--border)}
.btn-s:hover{background:rgba(255,255,255,.12)}
.btn-a{background:linear-gradient(135deg,#d97706,var(--accent));color:#fff}
.btn-g{background:linear-gradient(135deg,#059669,var(--green));color:#fff}
.btn-sm{padding:8px 13px;font-size:12px}.btn-full{width:100%;justify-content:center;padding:15px;font-size:16px}
.btn-ic{padding:10px;border-radius:10px}

.topbar{display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:62px;
  background:rgba(11,20,29,.96);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);position:sticky;top:0;z-index:100}
.tb-brand{display:flex;align-items:center;gap:11px}
.tb-mark{width:36px;height:36px;border-radius:9px;background:linear-gradient(135deg,var(--sky-dim),var(--sky));display:flex;align-items:center;justify-content:center}
.tb-title{font-family:'Barlow Condensed';font-size:19px;font-weight:800;letter-spacing:1px}
.tb-right{display:flex;align-items:center;gap:10px}
.badge{padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
.badge-admin{background:rgba(245,158,11,.2);color:var(--accent);border:1px solid rgba(245,158,11,.3)}
.badge-crew{background:rgba(59,130,246,.2);color:var(--sky2);border:1px solid rgba(59,130,246,.3)}

.net-dot{display:flex;align-items:center;gap:5px;font-size:11px;padding:3px 9px;border-radius:20px}
.net-on{background:rgba(16,185,129,.12);color:var(--green)}
.net-off{background:rgba(249,115,22,.12);color:var(--orange);animation:pulse 2s infinite}

.layout{display:flex;flex:1;min-height:calc(100vh - 62px)}
.side{width:212px;flex-shrink:0;background:rgba(11,20,29,.8);border-right:1px solid var(--border);padding:18px 11px;display:flex;flex-direction:column;gap:3px}
.nav{display:flex;align-items:center;gap:10px;padding:10px 13px;border-radius:10px;cursor:pointer;transition:.15s;color:var(--silver);font-size:14px;font-weight:500}
.nav:hover{background:rgba(59,130,246,.1);color:var(--white)}
.nav.on{background:rgba(59,130,246,.16);color:var(--sky2);border:1px solid rgba(59,130,246,.22)}
.nav-sec{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--slate);padding:14px 13px 5px}
.content{flex:1;overflow-y:auto;padding:26px}
.h2{font-family:'Barlow Condensed';font-size:27px;font-weight:800;letter-spacing:1px}

.card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:22px;margin-bottom:18px;box-shadow:var(--sh)}
.ct{font-family:'Barlow Condensed';font-size:17px;font-weight:700;letter-spacing:.5px;margin-bottom:14px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:22px}
.stat{background:rgba(11,20,29,.7);border:1px solid var(--border);border-radius:var(--r);padding:18px;text-align:center}
.stat-btn{cursor:pointer;font-family:inherit;color:inherit;width:100%;min-width:0;box-sizing:border-box;display:block;transition:.18s;position:relative}
.stat-btn:hover{transform:translateY(-2px);border-color:var(--sky);background:rgba(59,130,246,.08);box-shadow:0 6px 20px rgba(59,130,246,.18)}
.stat-btn::after{content:"›";position:absolute;top:10px;right:12px;font-size:18px;color:var(--slate);opacity:0;transition:.18s}
.stat-btn:hover::after{opacity:1;color:var(--sky2)}
.job-prog{padding:8px;margin:0 -8px;border-radius:8px;transition:background .15s}
.job-prog:hover{background:rgba(59,130,246,.06)}
.stat-n{font-family:'Barlow Condensed';font-size:38px;font-weight:800;line-height:1;color:var(--sky2)}
.stat-l{font-size:11px;color:var(--silver);margin-top:5px;letter-spacing:1px;text-transform:uppercase}

.jobsec{margin-bottom:24px;animation:fadeUp .4s ease both}
.jobhead{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-radius:12px 12px 0 0;
  background:linear-gradient(135deg,var(--steel3),var(--steel2));border:1px solid rgba(59,130,246,.2);border-bottom:none}
.jobname{font-family:'Barlow Condensed';font-size:17px;font-weight:800;letter-spacing:1px}
.jobaddr{font-size:12px;color:var(--silver);margin-top:1px}
.jobbody{border:1px solid rgba(59,130,246,.2);border-top:none;border-radius:0 0 12px 12px;overflow:hidden}

.trow{display:flex;align-items:flex-start;gap:13px;padding:13px 18px;border-bottom:1px solid rgba(255,255,255,.04);background:rgba(15,25,36,.5);transition:background .15s}
.trow:hover{background:rgba(59,130,246,.05)}.trow:last-child{border:none}
.tchk input{width:18px;height:18px;cursor:pointer;accent-color:var(--sky);margin-top:2px}
.tinfo{flex:1}.ten{font-size:14px;font-weight:600}.tes{font-size:12px;color:var(--silver);font-style:italic;margin-top:2px}
.tmeta{display:flex;gap:8px;margin-top:6px;flex-wrap:wrap}
.tag{font-size:11px;padding:2px 8px;border-radius:6px;font-weight:600}
.tag-done{background:rgba(16,185,129,.15);color:var(--green)}
.tag-pending{background:rgba(59,130,246,.15);color:var(--sky2)}
.tag-overdue{background:rgba(239,68,68,.15);color:var(--red)}
.tag-l{font-size:11px;padding:3px 8px;border-radius:20px;font-weight:600;background:rgba(59,130,246,.15);color:var(--sky2)}
.tact{display:flex;gap:6px;flex-shrink:0}

.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;z-index:200;padding:18px;animation:fadeUp .2s ease both}
.modal{background:var(--steel2);border:1px solid var(--border);border-radius:20px;padding:28px;width:100%;max-width:500px;box-shadow:0 24px 60px rgba(0,0,0,.5);max-height:90vh;overflow-y:auto}
.mt{font-family:'Barlow Condensed';font-size:21px;font-weight:800;margin-bottom:20px}
.macts{display:flex;gap:10px;justify-content:flex-end;margin-top:20px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}

.log{padding:11px;background:rgba(0,0,0,.22);border-radius:10px;margin-bottom:9px}
.log-en{font-size:14px}.log-es{font-size:13px;color:var(--sky2);font-style:italic;margin-top:3px}
.log-m{font-size:11px;color:var(--slate);margin-top:3px}

.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:9px}
.pthumb{aspect-ratio:1;border-radius:10px;overflow:hidden;position:relative;background:rgba(0,0,0,.3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center}
.pthumb img{width:100%;height:100%;object-fit:cover}
.plabel{position:absolute;bottom:0;left:0;right:0;padding:3px 5px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:rgba(0,0,0,.72);text-align:center}

.cnav{position:fixed;bottom:0;left:0;right:0;height:64px;background:rgba(8,15,22,.98);border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-around;z-index:100;backdrop-filter:blur(20px)}
.cnav-i{display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 14px;cursor:pointer;color:var(--slate);transition:color .15s}
.cnav-i.on{color:var(--sky2)}
.cnav-l{font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase}

.bar{height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden}
.bar-f{height:100%;border-radius:4px;transition:width .6s ease}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px}
.empty{text-align:center;padding:40px;color:var(--slate)}
.muted{color:var(--silver);font-size:13px}
.flexb{display:flex;justify-content:space-between;align-items:center}
.spin{width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.cal-h{text-align:center;padding:7px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--silver)}
.cal-d{min-height:76px;padding:5px;border-radius:8px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.03);font-size:12px}
.cal-d.today{border-color:var(--sky);background:rgba(59,130,246,.08)}
.cal-ev{font-size:10px;padding:2px 4px;border-radius:4px;margin-bottom:2px;color:#fff;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.sig-pad{width:100%;height:160px;background:#fff;border-radius:10px;touch-action:none;cursor:crosshair}
table{width:100%;border-collapse:collapse}
th{padding:9px 11px;text-align:left;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--silver);background:rgba(0,0,0,.2);border-bottom:1px solid var(--border)}
td{padding:9px 11px;font-size:13px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:top}
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.hamburger{display:none}
.side-scrim{display:none}

/* ── TABLET (≤1024px): narrower sidebar, tighter padding ── */
@media(max-width:1024px){
  .side{width:180px;padding:14px 8px}
  .content{padding:20px}
  .nav{padding:9px 11px;font-size:13px}
}

/* ── MOBILE (≤760px): sidebar becomes slide-out drawer ── */
@media(max-width:760px){
  .hamburger{display:inline-flex;margin-right:2px}
  .tb-title{font-size:14px;letter-spacing:.5px}
  .tb-name{display:none}
  .net-txt{display:none}
  .badge{display:none}
  .topbar{padding:0 10px;gap:4px}
  .tb-right{gap:5px}
  .tb-brand{gap:6px;min-width:0;overflow:hidden}
  .net-dot{padding:3px 6px}
  .layout{display:block}
  .side{position:fixed;top:62px;left:0;bottom:0;width:250px;z-index:160;
    transform:translateX(-100%);transition:transform .25s ease;overflow-y:auto;
    box-shadow:6px 0 30px rgba(0,0,0,.5)}
  .side-open{transform:translateX(0)}
  .side-scrim{display:block;position:fixed;inset:62px 0 0 0;background:rgba(0,0,0,.5);z-index:150}
  .content{padding:16px}
  .h2{font-size:23px}
  .card{padding:16px}
  .stats{grid-template-columns:repeat(2,1fr);gap:10px}
  .stat{padding:14px}.stat-n{font-size:30px}
  .grid2{grid-template-columns:1fr}
  .jobhead{flex-wrap:wrap;gap:8px}
  .trow{padding:11px 13px}
  .toolbar{gap:7px}
  .toolbar select{flex:1}
  .flexb{flex-wrap:wrap;gap:10px}
  .modal{padding:22px;border-radius:16px}
  .mt{font-size:19px}
  /* stack admin tables into cards on phones */
  .tbl-wrap table,.tbl-wrap thead,.tbl-wrap tbody,.tbl-wrap th,.tbl-wrap td,.tbl-wrap tr{display:block}
  .tbl-wrap thead{display:none}
  .tbl-wrap tr{border:1px solid var(--border);border-radius:10px;margin-bottom:10px;padding:6px 10px;background:rgba(0,0,0,.15)}
  .tbl-wrap td{border:none;padding:5px 0;display:flex;justify-content:space-between;gap:12px}
  .tbl-wrap td::before{content:attr(data-l);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--silver)}
  .cal-d{min-height:54px;font-size:10px;padding:3px}
  .cal-ev{font-size:8px}
}

/* ── SMALL PHONES (≤400px) ── */
@media(max-width:400px){
  .stats{grid-template-columns:1fr 1fr}
  .stat-n{font-size:26px}
  .pgrid{grid-template-columns:repeat(auto-fill,minmax(90px,1fr))}
  .cnav-l{font-size:9px}
}

/* ── LARGE DESKTOP (≥1400px): cap content width, center ── */
@media(min-width:1400px){
  .content{max-width:1280px;margin:0 auto;width:100%}
}

@media print{.topbar,.side,.cnav,.toolbar .btn,.modal-bg,.hamburger,.side-scrim{display:none!important}.content{padding:0}body{background:#fff;color:#000}}

/* ── DROPDOWN OPTIONS FIX (dark mode: white bg / white text) ── */
select.fi option{background:var(--steel2);color:var(--white)}

/* ── LIGHT MODE ── */
.app.light{--steel:#f1f5f9;--steel2:#ffffff;--steel3:#e8edf2;--card:rgba(255,255,255,.97);--border:rgba(15,25,36,.12);--slate:#475569;--silver:#64748b;--mist:#334155;--white:#0f172a;background:#f1f5f9}
.app.light .login{background:radial-gradient(ellipse at 20% 30%,rgba(59,130,246,.08),transparent 55%),radial-gradient(ellipse at 85% 70%,rgba(245,158,11,.06),transparent 50%),#f1f5f9}
.app.light .login-card{background:rgba(255,255,255,.95);border-color:rgba(59,130,246,.2);box-shadow:0 24px 70px rgba(0,0,0,.1)}
.app.light .topbar{background:rgba(255,255,255,.97);border-color:rgba(15,25,36,.1);box-shadow:0 1px 8px rgba(0,0,0,.08)}
.app.light .side{background:rgba(241,245,249,.98);border-color:rgba(15,25,36,.1)}
.app.light .nav{color:#475569}
.app.light .nav:hover{background:rgba(59,130,246,.08);color:#0f172a}
.app.light .nav.on{background:rgba(59,130,246,.12);color:var(--sky-dim);border-color:rgba(59,130,246,.25)}
.app.light .nav-sec{color:#94a3b8}
.app.light .content{background:#f1f5f9}
.app.light .card{background:rgba(255,255,255,.95);box-shadow:0 2px 12px rgba(0,0,0,.06)}
.app.light .fi{background:#fff;border-color:rgba(15,25,36,.18);color:#0f172a}
.app.light .fi:focus{border-color:var(--sky);background:#fff}
.app.light .fi::placeholder{color:#94a3b8}
.app.light select.fi option{background:#fff;color:#0f172a}
.app.light .trow{background:rgba(255,255,255,.5)}
.app.light .trow:hover{background:rgba(59,130,246,.04)}
.app.light .log{background:rgba(0,0,0,.04)}
.app.light .modal{background:#fff;border-color:rgba(15,25,36,.12)}
.app.light .jobhead{background:linear-gradient(135deg,#e8edf5,#f1f5f9)}
.app.light .jobbody{border-color:rgba(15,25,36,.1)}
.app.light .cnav{background:rgba(255,255,255,.98);border-color:rgba(15,25,36,.1)}
.app.light .cnav-i{color:#64748b}
.app.light .cnav-i.on{color:var(--sky-dim)}
.app.light .stat{background:rgba(255,255,255,.8);border-color:rgba(15,25,36,.1)}
.app.light .bar{background:rgba(0,0,0,.08)}
.app.light th{background:rgba(0,0,0,.04);color:#64748b}
.app.light td{border-color:rgba(0,0,0,.05)}
.app.light .badge-admin{background:rgba(245,158,11,.12);color:#b45309;border-color:rgba(245,158,11,.25)}
.app.light .badge-crew{background:rgba(59,130,246,.1);color:var(--sky-dim);border-color:rgba(59,130,246,.2)}
.app.light .net-on{background:rgba(16,185,129,.1)}
.app.light .net-off{background:rgba(249,115,22,.1)}
`;


// ════════════════════════════════════════════════════════════════════════
export default function App() {
  // Restore session on launch — stays logged in across app restarts
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gsm_session") || "null"); } catch { return null; }
  });
  const [lang, setLang] = useState(() => localStorage.getItem("gsm_lang") || "en");
  const [theme, setTheme] = useState(() => localStorage.getItem("gsm_theme") || "dark");
  const [online, setOnline] = useState(navigator.onLine);
  const [tab, setTab] = useState("dash");
  const toggleTheme = () => setTheme(t => { const n = t === "dark" ? "light" : "dark"; localStorage.setItem("gsm_theme", n); return n; });
  const [menuOpen, setMenuOpen] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [mats, setMats] = useState([]);
  const [revoked, setRevoked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState(() => JSON.parse(localStorage.getItem("gsm_set") || "{}"));
  const [users, setUsers] = useState([]);
  const t = T[lang];

  const login = (u) => { localStorage.setItem("gsm_session", JSON.stringify(u)); setUser(u); };
  const logout = () => { localStorage.removeItem("gsm_session"); setUser(null); setRevoked(false); };
  useEffect(() => { localStorage.setItem("gsm_lang", lang); }, [lang]);

  // ── LOAD ALL DATA FROM SUPABASE ───────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      try {
        const [dbUsers, dbJobs, dbTasks, dbLogs, dbPhotos, dbReceipts, dbMats] = await Promise.all([
          sbGet("field_profiles", "order=created_at"),
          sbGet("field_jobs", "order=created_at"),
          sbGet("field_tasks", "order=created_at"),
          sbGet("field_logs", "order=created_at.desc"),
          sbGet("field_photos", "order=created_at.desc"),
          sbGet("field_receipts", "order=created_at.desc"),
          sbGet("field_material_requests", "order=created_at.desc"),
        ]);
        if (dbUsers)    setUsers(dbUsers.map(fromProfile));
        if (dbJobs)     setJobs(dbJobs.map(fromJob));
        if (dbTasks)    setTasks(dbTasks.map(fromTask));
        if (dbLogs)     setLogs(dbLogs.map(fromLog));
        if (dbPhotos)   setPhotos(dbPhotos.map(fromPhoto));
        if (dbReceipts) setReceipts(dbReceipts.map(fromReceipt));
        if (dbMats)     setMats(dbMats.map(fromMat));
      } catch (e) { console.error("Load:", e); }
      setLoading(false);
    };
    load();
  }, [user?.id]);

  // ── CREW MUTATIONS ────────────────────────────────────────────────
  const setActive = async (id, active) => {
    setUsers(u => u.map(x => x.id === id ? { ...x, active } : x));
    try { await sbPatch("field_profiles", id, { active }); } catch {}
  };
  const addUser = async (member) => {
    const id = "u" + Date.now();
    const row = { id, name: member.name, role: "crew", email: member.email, phone: member.phone || "", pin: member.pin, active: true };
    setUsers(u => [...u, { ...row }]);
    try { await sbPost("field_profiles", row); } catch { enqueue({ table: "field_profiles", payload: row }); }
  };
  const updateUser = async (id, patch) => {
    setUsers(u => u.map(x => x.id === id ? { ...x, ...patch } : x));
    const dbPatch = {};
    if (patch.name)  dbPatch.name  = patch.name;
    if (patch.email) dbPatch.email = patch.email;
    if (patch.phone) dbPatch.phone = patch.phone;
    if (patch.pin)   dbPatch.pin   = patch.pin;
    try { await sbPatch("field_profiles", id, dbPatch); } catch {}
  };
  const removeUser = async (id) => {
    setUsers(u => u.filter(x => x.id !== id));
    try { await sbDelete("field_profiles", id); } catch {}
  };

  // ── REVOCATION CHECK ──────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const check = async () => {
      try {
        const rows = await sbGet("field_profiles", `id=eq.${user.id}&select=active`);
        if (rows?.[0]?.active === false) setRevoked(true);
      } catch {}
    };
    check();
    const iv = setInterval(check, 15000);
    window.addEventListener("focus", check);
    return () => { clearInterval(iv); window.removeEventListener("focus", check); };
  }, [user?.id]);

  useEffect(() => {
    const on = () => { setOnline(true); flushQueue(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Deep link: SMS reminder links contain ?log=1 → jump crew to the log screen
  useEffect(() => {
    if (!user || user.role !== "crew") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("log") === "1") setTab("log");
  }, [user]);

  const saveSettings = (s) => { setSettings(s); localStorage.setItem("gsm_set", JSON.stringify(s)); };

  if (!user) return <Login onLogin={login} t={t} lang={lang} setLang={setLang} />;

  if (revoked) return <LockedOut user={user} lang={lang} onAck={logout} />;

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--steel)" }}>
      <style>{CSS}</style>
      <div style={{ textAlign: "center" }}><div className="spin" style={{ width: 36, height: 36, margin: "0 auto 16px" }} />
        <p style={{ color: "var(--silver)", fontSize: 13 }}>Loading...</p></div>
    </div>
  );

  const shared = { user, lang, t, jobs, setJobs, tasks, setTasks, receipts, setReceipts,
                   logs, setLogs, photos, setPhotos, mats, setMats, settings, saveSettings, users,
                   online, setActive, addUser, updateUser, removeUser };

  return (
    <div className={`app${theme === "light" ? " light" : ""}`}>
      <style>{CSS}</style>
      <TopBar user={user} onLogout={logout} t={t} lang={lang} setLang={setLang} online={online}
        theme={theme} toggleTheme={toggleTheme}
        showMenu={user.role === "admin"} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      {user.role === "admin"
        ? <Admin {...shared} tab={tab} setTab={setTab} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
        : <Crew {...shared} tab={tab} setTab={setTab} />}
    </div>
  );
}

// ─── LOCKED OUT ───────────────────────────────────────────────────────
function LockedOut({ user, lang, onAck }) {
  return (
    <div className="login"><style>{CSS}</style>
      <div className="login-card" style={{ textAlign: "center" }}>
        <div className="logo-mark" style={{ background: "linear-gradient(135deg,#b91c1c,#ef4444)", boxShadow: "0 8px 28px rgba(239,68,68,.4)" }}>
          <Icon n="lock" s={32} c="#fff" /></div>
        <div className="logo-title">{lang === "es" ? "ACCESO BLOQUEADO" : "ACCESS LOCKED"}</div>
        <p className="muted" style={{ marginTop: 16, lineHeight: 1.6 }}>
          {lang === "es"
            ? "Tu acceso a la aplicación ha sido desactivado por el administrador. Contacta a Gregory si crees que esto es un error."
            : "Your access to this app has been turned off by the administrator. Contact Gregory if you think this is a mistake."}
        </p>
        <button className="btn btn-s btn-full" style={{ marginTop: 24 }} onClick={onAck}>
          {lang === "es" ? "Entendido" : "OK"}</button>
      </div>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────
function Login({ onLogin, t, lang, setLang }) {
  const [email, setEmail] = useState(""), [pin, setPin] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const go = async () => {
    if (!email || !pin) return setErr(lang === "en" ? "Enter email and PIN." : "Ingresa email y PIN.");
    setBusy(true); setErr("");
    try {
      const rows = await sbGet("field_profiles", `email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=*`);
      const u = rows?.[0];
      if (!u || u.pin !== pin) { setErr(lang === "en" ? "Invalid credentials." : "Credenciales inválidas."); setBusy(false); return; }
      if (u.active === false) { setErr(lang === "en" ? "Account deactivated." : "Cuenta desactivada."); setBusy(false); return; }
      onLogin(fromProfile(u));
    } catch { setErr(lang === "en" ? "Connection error. Try again." : "Error de conexión."); }
    setBusy(false);
  };
  return (
    <div className="login"><style>{CSS}</style>
      <div className="login-card">
        <div className="logo-mark"><Icon n="briefcase" s={32} c="#fff" /></div>
        <div className="logo-title">GS MASTERS</div>
        <div className="logo-sub">Field App</div>
        <div style={{ marginTop: 32 }}>
          <div className="fg"><label className="fl">Email</label>
            <input className="fi" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" /></div>
          <div className="fg"><label className="fl">PIN</label>
            <input className="fi" type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="••••" maxLength={6}
              onKeyDown={e => e.key === "Enter" && go()} /></div>
          {err && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{err}</p>}
          <button className="btn btn-p btn-full" onClick={go} disabled={busy}>{busy ? <span className="spin" /> : t.login}</button>
        </div>
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button className="btn btn-s btn-sm" onClick={() => setLang(lang === "en" ? "es" : "en")}>
            <Icon n="translate" s={14} /> {lang === "en" ? "Español" : "English"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── TOP BAR ──────────────────────────────────────────────────────────
function TopBar({ user, onLogout, t, lang, setLang, online, showMenu, menuOpen, setMenuOpen, theme, toggleTheme }) {
  return (
    <div className="topbar">
      <div className="tb-brand">
        {showMenu && <button className="btn btn-s btn-ic hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
          <Icon n={menuOpen ? "x" : "menu"} s={18} /></button>}
        <div className="tb-mark"><Icon n="briefcase" s={17} c="#fff" /></div>
        <span className="tb-title">GS MASTERS FIELD</span></div>
      <div className="tb-right">
        <span className={`net-dot ${online ? "net-on" : "net-off"}`}>
          <Icon n={online ? "wifi" : "wifiOff"} s={12} /> <span className="net-txt">{online ? "Online" : "Offline"}</span></span>
        <button className="btn btn-s btn-sm btn-ic" onClick={toggleTheme} title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          style={{ fontSize: 15 }}>{theme === "dark" ? "☀️" : "🌙"}</button>
        <button className="btn btn-s btn-sm" onClick={() => setLang(lang === "en" ? "es" : "en")}>
          <Icon n="translate" s={14} /> {lang === "en" ? "ES" : "EN"}</button>
        <span className="muted tb-name" style={{ fontSize: 13 }}>{user.name}</span>
        <span className={`badge badge-${user.role}`}>{user.role}</span>
        <button className="btn btn-s btn-sm btn-ic" onClick={onLogout}><Icon n="logout" s={16} /></button>
      </div>
    </div>
  );
}

// ─── ADMIN ────────────────────────────────────────────────────────────
function Admin(props) {
  const { t, tab, setTab, menuOpen, setMenuOpen } = props;
  const nav = [
    { k: "dash", i: "home", l: "Dashboard" }, { k: "tasks", i: "tasks", l: t.tasks },
    { k: "cal", i: "calendar", l: "Calendar" }, { k: "report", i: "report", l: "Reports" },
    { k: "receipts", i: "receipt", l: t.receipts },
    { k: "photos", i: "photo", l: "Photos" }, { k: "jobs", i: "briefcase", l: "Jobs" },
    { k: "crew", i: "users", l: "Crew" }, { k: "set", i: "settings", l: "Settings" },
  ];
  const pick = k => { setTab(k); setMenuOpen(false); };
  return (
    <div className="layout">
      {menuOpen && <div className="side-scrim" onClick={() => setMenuOpen(false)} />}
      <div className={`side ${menuOpen ? "side-open" : ""}`}><div className="nav-sec">Navigation</div>
        {nav.map(n => <div key={n.k} className={`nav ${tab === n.k ? "on" : ""}`} onClick={() => pick(n.k)}>
          <Icon n={n.i} s={17} /> {n.l}</div>)}</div>
      <div className="content">
        {tab === "dash" && <Dash {...props} />}
        {tab === "tasks" && <AdminTasks {...props} />}
        {tab === "cal" && <Calendar {...props} />}
        {tab === "report" && <Report {...props} />}
        {tab === "receipts" && <AdminReceipts {...props} />}
        {tab === "photos" && <AdminPhotos {...props} />}
        {tab === "jobs" && <Jobs {...props} />}
        {tab === "crew" && <CrewMgmt {...props} />}
        {tab === "set" && <Settings {...props} />}
      </div>
    </div>
  );
}

function Dash({ tasks, jobs, users, receipts, setTab }) {
  const today = new Date().toISOString().split("T")[0];
  const activeJobs = jobs.filter(j => j.status !== "closed");
  const done = tasks.filter(t => t.status === "done").length;
  const pending = tasks.filter(t => t.status === "pending").length;
  const overdue = tasks.filter(t => t.status === "pending" && t.dueDate < today).length;
  return (
    <div>
      <h2 className="h2 fade" style={{ marginBottom: 22 }}>Dashboard</h2>
      <div className="stats">
        {[["Total Tasks", tasks.length, "var(--sky2)", "tasks"], ["Completed", done, "var(--green)", "tasks"],
          ["Pending", pending, "var(--accent)", "tasks"], ["Overdue", overdue, "var(--red)", "tasks"],
          ["Active Jobs", activeJobs.length, "var(--silver)", "jobs"]
        ].map(([l, n, c, dest], i) => <button key={l} className={`stat stat-btn fade fade-${i % 3 + 1}`} onClick={() => setTab(dest)}>
          <div className="stat-n" style={{ color: c }}>{n}</div>
          <div className="stat-l">{l}</div></button>)}
      </div>
      <div className="card fade">
        <div className="ct">Job Progress</div>
        {activeJobs.map(job => {
          const jt = tasks.filter(t => t.jobId === job.id);
          const jd = jt.filter(t => t.status === "done").length;
          const pct = jt.length ? Math.round(jd / jt.length * 100) : 0;
          return <div key={job.id} className="job-prog" onClick={() => setTab("tasks")} style={{ marginBottom: 14, cursor: "pointer" }}>
            <div className="flexb" style={{ marginBottom: 6 }}><span style={{ fontWeight: 600 }}>{job.name}</span>
              <span className="muted">{jd}/{jt.length} · {pct}%</span></div>
            <div className="bar"><div className="bar-f" style={{ width: pct + "%", background: "linear-gradient(90deg,var(--sky-dim),var(--sky))" }} /></div>
          </div>;
        })}
      </div>
    </div>
  );
}

function AdminTasks(props) {
  const { tasks, setTasks, jobs, users, t, settings } = props;
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(false);
  const [nt, setNt] = useState({ title: "", titleEs: "", jobId: "", assignedTo: [], dueDate: "" });
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().split("T")[0];
  const shown = filter === "all" ? jobs : jobs.filter(j => j.id === filter);

  const toggleCrew = (id) => setNt(p => ({ ...p, assignedTo: p.assignedTo.includes(id) ? p.assignedTo.filter(x => x !== id) : [...p.assignedTo, id] }));

  const add = async () => {
    if (!nt.title || !nt.jobId || !nt.assignedTo.length) return;
    setBusy(true);
    let es = nt.titleEs;
    if (!es && settings.gtKey) es = await translateText(nt.title, "es", settings.gtKey);
    const id = "t" + Date.now();
    const task = { id, jobId: nt.jobId, title: nt.title, titleEs: es || nt.title, assignedTo: nt.assignedTo, dueDate: nt.dueDate, status: "pending", createdAt: today };
    setTasks(p => [...p, task]);
    const row = { id, job_id: nt.jobId, title: nt.title, title_es: es || nt.title, assigned_to: nt.assignedTo, due_date: nt.dueDate || null, status: "pending" };
    try { await sbPost("field_tasks", row); } catch { enqueue({ table: "field_tasks", payload: row }); }
    setNt({ title: "", titleEs: "", jobId: "", assignedTo: [], dueDate: "" }); setModal(false); setBusy(false);
  };
  const toggle = async (id) => {
    const task = tasks.find(t => t.id === id);
    const next = task.status === "done" ? "pending" : "done";
    setTasks(p => p.map(t => t.id === id ? { ...t, status: next } : t));
    try { await sbPatch("field_tasks", id, { status: next, completed_at: next === "done" ? new Date().toISOString() : null }); } catch {}
  };
  const deleteTask = async (id) => {
    setTasks(p => p.filter(t => t.id !== id));
    try { await sbDelete("field_tasks", id); } catch {}
  };
  const st = task => task.status === "done" ? "done" : (task.dueDate && task.dueDate < today ? "overdue" : "pending");

  return (
    <div>
      <div className="flexb" style={{ marginBottom: 20 }}><h2 className="h2">{t.tasks}</h2>
        <button className="btn btn-p" onClick={() => setModal(true)}><Icon n="plus" s={16} /> Add Task</button></div>
      <div className="toolbar"><Icon n="filter" s={16} c="var(--silver)" />
        <select className="fi" style={{ width: "auto", padding: "8px 13px" }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All Jobs</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select></div>
      {shown.map(job => {
        const jt = tasks.filter(t => t.jobId === job.id);
        if (!jt.length) return null;
        return <div key={job.id} className="jobsec">
          <div className="jobhead"><div><div className="jobname">{job.name}</div><div className="jobaddr">{job.address}</div></div>
            <span className="tag-l">{jt.length} tasks</span></div>
          <div className="jobbody">{jt.map(task => {
            const s = st(task), crew = (task.assignedTo || []).map(id => users.find(u => u.id === id)).filter(Boolean);
            return <div key={task.id} className="trow">
              <div className="tchk"><input type="checkbox" checked={task.status === "done"} onChange={() => toggle(task.id)} /></div>
              <div className="tinfo">
                <div className="ten" style={{ textDecoration: task.status === "done" ? "line-through" : "none", opacity: task.status === "done" ? .6 : 1 }}>{task.title}</div>
                <div className="tes">{task.titleEs}</div>
                <div className="tmeta"><span className={`tag tag-${s}`}>{t[s]}</span>
                  {task.dueDate && <span className="tag" style={{ background: "rgba(255,255,255,.06)", color: "var(--silver)" }}>Due {task.dueDate}</span>}
                  {crew.map(a => <span key={a.id} className="tag-l" style={{ marginRight: 3 }}>{a.name}</span>)}</div>
              </div>
              <button className="btn btn-s btn-sm btn-ic" style={{ color: "var(--red)", flexShrink: 0 }} title="Delete" onClick={() => deleteTask(task.id)}><Icon n="x" s={14} /></button>
            </div>;
          })}</div>
        </div>;
      })}
      {modal && <div className="modal-bg" onClick={e => e.target === e.currentTarget && setModal(false)}>
        <div className="modal"><div className="mt">Add Task</div>
          <div className="fg"><label className="fl">Job</label>
            <select className="fi" value={nt.jobId} onChange={e => setNt(p => ({ ...p, jobId: e.target.value }))}>
              <option value="">Select Job</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select></div>
          <div className="fg"><label className="fl">Task (English)</label>
            <input className="fi" value={nt.title} onChange={e => setNt(p => ({ ...p, title: e.target.value }))} placeholder="Task..." /></div>
          <div className="fg"><label className="fl">Tarea (Español) — auto-translates if blank</label>
            <input className="fi" value={nt.titleEs} onChange={e => setNt(p => ({ ...p, titleEs: e.target.value }))} placeholder="Opcional..." /></div>
          <div className="fg">
            <label className="fl">Assign To <span style={{ color: "var(--silver)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— select one or more</span></label>
            <div style={{ background: "rgba(0,0,0,.15)", borderRadius: 10, padding: "6px 4px", border: "1px solid var(--border)" }}>
              {users.filter(u => u.role === "crew").map(u => (
                <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 12px", cursor: "pointer", borderRadius: 8,
                  background: nt.assignedTo.includes(u.id) ? "rgba(59,130,246,.12)" : "transparent", transition: ".15s" }}>
                  <input type="checkbox" checked={nt.assignedTo.includes(u.id)} onChange={() => toggleCrew(u.id)}
                    style={{ width: 17, height: 17, accentColor: "var(--sky)", flexShrink: 0 }} />
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: nt.assignedTo.includes(u.id) ? "linear-gradient(135deg,var(--sky-dim),var(--sky))" : "rgba(255,255,255,.1)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{u.name[0]}</div>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{u.name}</span>
                  {nt.assignedTo.includes(u.id) && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--sky2)" }}>✓ assigned</span>}
                </label>
              ))}
              {!users.filter(u => u.role === "crew").length && <p className="muted" style={{ padding: "10px 12px", fontSize: 13 }}>No crew members added yet.</p>}
            </div>
            {!nt.assignedTo.length && <p style={{ fontSize: 11, color: "var(--orange)", marginTop: 6 }}>Select at least one crew member</p>}
          </div>
          <div className="fg"><label className="fl">Due Date</label>
            <input className="fi" type="date" value={nt.dueDate} onChange={e => setNt(p => ({ ...p, dueDate: e.target.value }))} /></div>
          <div className="macts"><button className="btn btn-s" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-p" onClick={add} disabled={busy}>{busy ? <span className="spin" /> : "Add Task"}</button></div>
        </div></div>}
    </div>
  );
}

function Calendar({ tasks, jobs }) {
  const [d, setD] = useState(new Date());
  const [filter, setFilter] = useState("all");
  const y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const today = new Date().toISOString().split("T")[0];
  const ft = filter === "all" ? tasks : tasks.filter(t => t.jobId === filter);
  const colors = { j1: "#3b82f6", j2: "#10b981", j3: "#f59e0b", j4: "#ef4444" };
  const mn = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const forDay = day => { const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`; return ft.filter(t => t.dueDate === ds || t.createdAt === ds); };
  return (
    <div>
      <div className="flexb" style={{ marginBottom: 20 }}><h2 className="h2">Calendar</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="fi" style={{ width: "auto", padding: "8px 13px" }} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All Jobs</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select>
          <button className="btn btn-s btn-sm" onClick={() => setD(new Date(y, m - 1, 1))}>‹</button>
          <span style={{ padding: "8px 14px", fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 17 }}>{mn[m]} {y}</span>
          <button className="btn btn-s btn-sm" onClick={() => setD(new Date(y, m + 1, 1))}>›</button>
          <button className="btn btn-s btn-sm" onClick={() => window.print()}><Icon n="print" s={14} /> Print</button></div></div>
      <div className="card" style={{ padding: 14 }}>
        <div className="cal-grid">{dn.map(x => <div key={x} className="cal-h">{x}</div>)}
          {Array(first).fill(0).map((_, i) => <div key={"e" + i} className="cal-d" style={{ opacity: .3 }} />)}
          {Array(days).fill(0).map((_, i) => {
            const day = i + 1, ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`, dt = forDay(day);
            return <div key={day} className={`cal-d ${ds === today ? "today" : ""}`}>
              <div style={{ fontWeight: 700, color: "var(--silver)", marginBottom: 3 }}>{day}</div>
              {dt.slice(0, 3).map(task => <div key={task.id} className="cal-ev" title={task.title} style={{ background: colors[task.jobId] || "var(--sky-dim)" }}>{task.title.slice(0, 16)}</div>)}
              {dt.length > 3 && <div style={{ fontSize: 10, color: "var(--silver)" }}>+{dt.length - 3}</div>}</div>;
          })}</div></div>
      <div className="card"><div className="ct">Legend</div><div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {jobs.map(j => <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 13, height: 13, borderRadius: 3, background: colors[j.id] || "var(--sky)" }} /><span style={{ fontSize: 13 }}>{j.name}</span></div>)}</div></div>
    </div>
  );
}

function Report({ tasks, jobs, users, logs, t }) {
  const [filter, setFilter] = useState("all");
  const crew = users.filter(u => u.role === "crew");
  const ft = filter === "all" ? tasks : tasks.filter(t => t.jobId === filter);
  const today = new Date().toISOString().split("T")[0];
  return (
    <div>
      <div className="flexb" style={{ marginBottom: 20 }}><h2 className="h2">Weekly Report</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <select className="fi" style={{ width: "auto", padding: "8px 13px" }} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All Jobs</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select>
          <button className="btn btn-s btn-sm" onClick={() => window.print()}><Icon n="print" s={14} /> Print</button></div></div>
      {crew.map(m => {
        const mt = ft.filter(t => (Array.isArray(t.assignedTo) ? t.assignedTo.includes(m.id) : t.assignedTo === m.id));
        if (!mt.length) return null;
        const done = mt.filter(t => t.status === "done").length;
        const jw = [...new Set(mt.map(t => t.jobId))];
        return <div key={m.id} style={{ marginBottom: 26 }}>
          <div style={{ padding: "11px 15px", background: "rgba(59,130,246,.1)", borderRadius: "10px 10px 0 0", border: "1px solid rgba(59,130,246,.2)", borderBottom: "none" }}>
            <div className="flexb"><span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 16 }}>{m.name}</span>
              <span className="muted">{done}/{mt.length} tasks · {jw.length} job{jw.length !== 1 ? "s" : ""}</span></div></div>
          <div className="tbl-wrap" style={{ border: "1px solid rgba(59,130,246,.2)", borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
            <table><thead><tr><th>Date</th><th>Job</th><th>Task (EN)</th><th>Tarea (ES)</th><th>Status</th></tr></thead>
              <tbody>{mt.map(task => { const job = jobs.find(j => j.id === task.jobId);
                const s = task.status === "done" ? "done" : (task.dueDate < today ? "overdue" : "pending");
                return <tr key={task.id}><td data-l="Date" className="muted" style={{ whiteSpace: "nowrap" }}>{task.createdAt}</td>
                  <td data-l="Job"><span className="tag-l" style={{ fontSize: 11 }}>{job?.name}</span></td><td data-l="Task">{task.title}</td>
                  <td data-l="Tarea" style={{ color: "var(--sky2)", fontStyle: "italic" }}>{task.titleEs}</td>
                  <td data-l="Status"><span className={`tag tag-${s}`}>{t[s]}</span></td></tr>; })}</tbody></table></div></div>;
      })}
    </div>
  );
}

function AdminReceipts({ receipts, setReceipts, jobs, users }) {
  // Receipts here double as the queue that feeds the GSM Builder accounting
  // app. "Export for Bills" produces the JSON payload AI will read & post.
  const total = receipts.reduce((s, r) => s + (+r.amount || 0), 0);
  const exportBills = () => {
    const payload = receipts.map(r => ({
      receipt_id: r.id,
      vendor: r.store || "",
      amount: +r.amount || 0,
      job_id: r.jobId,
      job_name: jobs.find(j => j.id === r.jobId)?.name || "",
      memo: r.note || "",
      receipt_date: r.createdAt,
      submitted_by: users.find(u => u.id === r.crewId)?.name || "",
      image: r.dataUrl ? "[base64 attached]" : null,
      status: "pending_review",   // GSM Builder AI sets to 'posted' once read
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `gsm-bills-export-${new Date().toISOString().split("T")[0]}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      <div className="flexb" style={{ marginBottom: 8 }}><h2 className="h2">Receipts</h2>
        {receipts.length > 0 && <button className="btn btn-p btn-sm" onClick={exportBills}>
          <Icon n="receipt" s={14} /> Export for Bills</button>}</div>
      <p className="muted" style={{ marginBottom: 18, fontSize: 13 }}>
        Field receipts captured by crew. These are ready to feed the GSM Builder accounting app, where AI reads each one and posts it as a bill against the job.
      </p>
      {receipts.length === 0 ? <div className="empty"><Icon n="receipt" s={48} c="var(--slate)" /><p>No receipts yet.</p></div>
        : <div className="card">
          <div className="flexb" style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
            <span className="muted">{receipts.length} receipt{receipts.length !== 1 ? "s" : ""} captured</span>
            <span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 20, color: "var(--accent)" }}>${total.toFixed(2)}</span></div>
          <div className="tbl-wrap"><table><thead><tr><th>Date</th><th>Crew</th><th>Job</th><th>Vendor</th><th>Memo</th><th>Paid By</th><th>Reimburse</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
          <tbody>{receipts.map(r => { const j = jobs.find(x => x.id === r.jobId), c = users.find(u => u.id === r.crewId);
            const needsReimb = r.paidBy === "crew" && r.reimbursementStatus !== "paid";
            return <tr key={r.id}>
              <td data-l="Date" className="muted">{r.createdAt}</td>
              <td data-l="Crew">{c?.name}</td>
              <td data-l="Job"><span className="tag-l" style={{ fontSize: 11 }}>{j?.name}</span></td>
              <td data-l="Vendor">{r.store}</td>
              <td data-l="Memo" className="muted">{r.note}</td>
              <td data-l="Paid By"><span className={`tag ${r.paidBy === "crew" ? "tag-overdue" : "tag-done"}`}>{r.paidBy === "crew" ? "Crew" : "Company"}</span></td>
              <td data-l="Reimburse">{r.paidBy === "crew" ? <span className={`tag ${needsReimb ? "tag-pending" : "tag-done"}`}>{needsReimb ? "Pending" : "Paid"}</span> : <span className="muted">—</span>}</td>
              <td data-l="Amount" style={{ textAlign: "right", fontWeight: 600, color: needsReimb ? "var(--orange)" : "var(--accent)" }}>${(+r.amount).toFixed(2)}</td>
            </tr>; })}</tbody></table></div></div>}
      {receipts.filter(r => r.paidBy === "crew" && r.reimbursementStatus !== "paid").length > 0 && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(249,115,22,.1)", border: "1px solid rgba(249,115,22,.3)", borderRadius: 10, color: "var(--orange)", fontSize: 13 }}>
          ⚠ {receipts.filter(r => r.paidBy === "crew" && r.reimbursementStatus !== "paid").length} receipt{receipts.filter(r => r.paidBy === "crew" && r.reimbursementStatus !== "paid").length !== 1 ? "s" : ""} need reimbursement — total ${receipts.filter(r => r.paidBy === "crew" && r.reimbursementStatus !== "paid").reduce((s, r) => s + (+r.amount || 0), 0).toFixed(2)}
        </div>
      )}
    </div>
  );
}

function AdminPhotos({ photos, tasks, jobs }) {
  return (
    <div><h2 className="h2" style={{ marginBottom: 20 }}>Photo Gallery</h2>
      {photos.length === 0 ? <div className="empty"><Icon n="photo" s={48} c="var(--slate)" /><p>No photos yet. Crew photos appear here.</p></div>
        : <div className="card"><div className="pgrid">{photos.map((p, i) => {
          const job = jobs.find(j => j.id === p.jobId);
          return <div key={i} className="pthumb">{p.dataUrl ? <img src={p.dataUrl} alt={p.type} /> : <Icon n="camera" s={28} c="var(--slate)" />}
            <div className="plabel" style={{ color: p.type === "before" ? "var(--orange)" : p.type === "after" ? "var(--green)" : "var(--sky2)" }}>{p.type}</div></div>;
        })}</div></div>}
    </div>
  );
}

function Jobs({ jobs, setJobs, tasks }) {
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [syncConfirm, setSyncConfirm] = useState(null);
  const [nj, setNj] = useState({ name: "", address: "", gsmSync: false });
  const [showClosed, setShowClosed] = useState(false);

  const add = async () => {
    if (!nj.name) return;
    const id = "j" + Date.now();
    const job = { id, name: nj.name, address: nj.address, status: "active", gsmSync: nj.gsmSync, gsmJobId: null };
    setJobs(p => [...p, job]); setNj({ name: "", address: "", gsmSync: false }); setModal(false);
    try { await sbPost("field_jobs", { id, name: nj.name, address: nj.address, status: "active", gsm_sync: nj.gsmSync }); }
    catch { enqueue({ table: "field_jobs", payload: { id, name: nj.name, address: nj.address, status: "active", gsm_sync: nj.gsmSync } }); }
  };

  const setStatus = async (id, status) => {
    const closedAt = status === "closed" ? new Date().toISOString().split("T")[0] : null;
    setJobs(p => p.map(j => j.id === id ? { ...j, status, closedAt } : j)); setConfirm(null);
    try { await sbPatch("field_jobs", id, { status, closed_at: closedAt }); } catch {}
  };

  const toggleSync = async (job) => {
    if (!job.gsmSync) { setSyncConfirm(job); return; }
    const next = false;
    setJobs(p => p.map(j => j.id === job.id ? { ...j, gsmSync: next } : j));
    try { await sbPatch("field_jobs", job.id, { gsm_sync: next }); } catch {}
  };

  const confirmSync = async (job) => {
    setJobs(p => p.map(j => j.id === job.id ? { ...j, gsmSync: true } : j));
    try { await sbPatch("field_jobs", job.id, { gsm_sync: true }); } catch {}
    setSyncConfirm(null);
  };

  const active = jobs.filter(j => j.status !== "closed");
  const closed = jobs.filter(j => j.status === "closed");
  const jobStats = job => { const jt = tasks.filter(t => t.jobId === job.id); return { total: jt.length, done: jt.filter(t => t.status === "done").length }; };

  const SyncBadge = ({ job }) => (
    <button onClick={() => toggleSync(job)} title={job.gsmSync ? "Syncing to GSM Builder — click to disable" : "Click to sync tasks & receipts to GSM Builder"}
      style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
        background: job.gsmSync ? "rgba(16,185,129,.15)" : "rgba(100,116,139,.12)",
        color: job.gsmSync ? "var(--green)" : "var(--slate)" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: job.gsmSync ? "var(--green)" : "var(--slate)", display: "inline-block" }} />
      {job.gsmSync ? "GSM Builder ON" : "GSM Builder OFF"}
    </button>
  );

  return (
    <div>
      <div className="flexb" style={{ marginBottom: 8 }}><h2 className="h2">Jobs</h2>
        <button className="btn btn-p" onClick={() => setModal(true)}><Icon n="plus" s={16} /> Add Job</button></div>
      <p className="muted" style={{ marginBottom: 18, fontSize: 13 }}>
        Toggle <strong style={{ color: "var(--green)" }}>GSM Builder</strong> per job to push tasks, receipts, and billing into the accounting system. Jobs staying in QuickBooks leave it OFF.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 14 }}>
        {active.map(job => { const s = jobStats(job); const allDone = s.total > 0 && s.done === s.total;
          return <div key={job.id} className="card" style={{ borderLeft: `4px solid ${job.gsmSync ? "var(--green)" : "var(--sky)"}` }}>
            <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 19, fontWeight: 800, marginBottom: 4 }}>{job.name}</div>
            <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>{job.address}</div>
            <div className="flexb" style={{ marginBottom: 12 }}>
              <SyncBadge job={job} />
              <span className="muted" style={{ fontSize: 12 }}>{s.done}/{s.total} tasks</span>
            </div>
            {allDone && <div style={{ fontSize: 12, color: "var(--green)", marginBottom: 10 }}>✓ All tasks complete — ready to close</div>}
            <button className="btn btn-s btn-sm btn-full" onClick={() => setConfirm(job)}>
              <Icon n="check" s={13} /> Close Job</button></div>; })}
      </div>

      {closed.length > 0 && <div style={{ marginTop: 28 }}>
        <button className="btn btn-s btn-sm" onClick={() => setShowClosed(!showClosed)}>
          <Icon n={showClosed ? "x" : "briefcase"} s={14} /> {showClosed ? "Hide" : "Show"} Closed Jobs ({closed.length})</button>
        {showClosed && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 14, marginTop: 16 }}>
          {closed.map(job => { const s = jobStats(job);
            return <div key={job.id} className="card" style={{ borderLeft: "4px solid var(--slate)", opacity: .75 }}>
              <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 19, fontWeight: 800, marginBottom: 4 }}>{job.name}</div>
              <div className="muted" style={{ marginBottom: 10 }}>{job.address}</div>
              <div className="flexb" style={{ marginBottom: 12 }}>
                <span className="tag" style={{ background: "rgba(100,116,139,.2)", color: "var(--silver)" }}>closed</span>
                <span className="muted" style={{ fontSize: 12 }}>{job.closedAt}</span></div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>{s.done}/{s.total} tasks · {job.gsmSync ? "was synced to GSM Builder" : "QuickBooks job"}</div>
              <button className="btn btn-s btn-sm btn-full" onClick={() => setStatus(job.id, "active")}>
                <Icon n="power" s={13} /> Reopen Job</button></div>; })}</div>}
      </div>}

      {modal && <div className="modal-bg" onClick={e => e.target === e.currentTarget && setModal(false)}>
        <div className="modal"><div className="mt">Add Job</div>
          <div className="fg"><label className="fl">Job Name</label>
            <input className="fi" value={nj.name} onChange={e => setNj(p => ({ ...p, name: e.target.value }))} placeholder="Lot 5 – Harvest Creek" /></div>
          <div className="fg"><label className="fl">Address</label>
            <input className="fi" value={nj.address} onChange={e => setNj(p => ({ ...p, address: e.target.value }))} placeholder="Chelsea, AL" /></div>
          <div style={{ padding: "14px 16px", background: "rgba(0,0,0,.2)", borderRadius: 10, marginBottom: 18 }}>
            <div className="flexb">
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Sync to GSM Builder Accounting?</div>
                <div style={{ fontSize: 12, color: "var(--silver)", lineHeight: 1.5 }}>ON = tasks, receipts & billing push to GSM Builder.<br />OFF = stays in field app only (QuickBooks job).</div>
              </div>
              <button onClick={() => setNj(p => ({ ...p, gsmSync: !p.gsmSync }))}
                style={{ width: 48, height: 26, borderRadius: 13, border: "none", cursor: "pointer", position: "relative", flexShrink: 0,
                  background: nj.gsmSync ? "var(--green)" : "rgba(255,255,255,.15)", transition: ".2s" }}>
                <span style={{ position: "absolute", top: 3, left: nj.gsmSync ? 25 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: ".2s" }} />
              </button>
            </div>
            {nj.gsmSync && <p style={{ fontSize: 11, color: "var(--green)", marginTop: 8 }}>✓ This job will sync tasks & receipts to GSM Builder</p>}
          </div>
          <div className="macts"><button className="btn btn-s" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-p" onClick={add}>Add Job</button></div></div></div>}

      {confirm && <div className="modal-bg" onClick={e => e.target === e.currentTarget && setConfirm(null)}>
        <div className="modal"><div className="mt">Close "{confirm.name}"?</div>
          <p className="muted" style={{ lineHeight: 1.6 }}>This moves the job to Closed Jobs. Crew will stop seeing it and its tasks. All photos, receipts, and history stay saved and you can reopen it anytime.</p>
          <div className="macts"><button className="btn btn-s" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn btn-g" onClick={() => setStatus(confirm.id, "closed")}><Icon n="check" s={14} /> Close Job</button></div></div></div>}

      {syncConfirm && <div className="modal-bg" onClick={e => e.target === e.currentTarget && setSyncConfirm(null)}>
        <div className="modal"><div className="mt">Enable GSM Builder Sync?</div>
          <p className="muted" style={{ lineHeight: 1.6, marginBottom: 12 }}>
            Turning ON sync for <strong style={{ color: "var(--white)" }}>{syncConfirm.name}</strong> means:
          </p>
          <ul style={{ color: "var(--silver)", fontSize: 13, lineHeight: 1.8, paddingLeft: 18, marginBottom: 16 }}>
            <li>Tasks will appear in the GSM Builder calendar</li>
            <li>Receipts will auto-create bills in GSM Builder accounting</li>
            <li>AI will scan, file, and post each receipt to the job folder</li>
          </ul>
          <p className="muted" style={{ fontSize: 12 }}>You can turn this OFF again anytime from the job card.</p>
          <div className="macts"><button className="btn btn-s" onClick={() => setSyncConfirm(null)}>Cancel</button>
            <button className="btn btn-g" onClick={() => confirmSync(syncConfirm)}><Icon n="check" s={14} /> Enable Sync</button></div></div></div>}
    </div>
  );
}

function CrewMgmt({ users, tasks, setActive, addUser, updateUser, removeUser, settings }) {
  const [modal, setModal] = useState(null); // 'add' | user object (edit)
  const [invite, setInvite] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", pin: "" });
  const isActive = m => m.active !== false;
  const appUrl = settings?.appUrl || (typeof window !== "undefined" ? window.location.origin : "https://your-app.netlify.app");

  const openAdd = () => { setForm({ name: "", email: "", phone: "", pin: String(Math.floor(1000 + Math.random() * 9000)) }); setModal("add"); };
  const openEdit = m => { setForm({ name: m.name, email: m.email, phone: m.phone || "", pin: m.pin }); setModal(m); };
  const save = () => {
    if (!form.name || !form.email || !form.pin) return;
    if (modal === "add") { addUser(form); setInvite({ ...form }); }
    else updateUser(modal.id, form);
    setModal(null);
  };
  const inviteText = (m) =>
    `Hi ${m.name.split(" ")[0]}! Here's the G.S. Masters crew app.\n\n1. Open: ${appUrl}\n2. Tap "Add to Home Screen"\n3. Log in:\n   Email: ${m.email}\n   PIN: ${m.pin}\n\nText me if you have trouble. — Gregory`;

  return (
    <div>
      <div className="flexb" style={{ marginBottom: 8 }}><h2 className="h2">Crew</h2>
        <button className="btn btn-p" onClick={openAdd}><Icon n="plus" s={16} /> Add Crew</button></div>
      <p className="muted" style={{ marginBottom: 18, fontSize: 13 }}>Add a member to generate their login + a text-ready invite. Deactivating locks their app on every device within seconds and blocks new logins.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 14 }}>
        {users.filter(u => u.role === "crew").map(m => { const mt = tasks.filter(t => (Array.isArray(t.assignedTo) ? t.assignedTo.includes(m.id) : t.assignedTo === m.id)), done = mt.filter(t => t.status === "done").length;
          const active = isActive(m);
          return <div key={m.id} className="card" style={{ borderTop: `4px solid ${active ? "var(--sky)" : "var(--red)"}`, opacity: active ? 1 : .75 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div style={{ width: 46, height: 46, borderRadius: "50%", background: active ? "linear-gradient(135deg,var(--sky-dim),var(--sky))" : "linear-gradient(135deg,#7f1d1d,var(--red))", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 19 }}>{m.name[0]}</div>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 16 }}>{m.name}</div><div className="muted" style={{ fontSize: 12 }}>{m.email}</div></div></div>
            <div className="grid2" style={{ marginBottom: 12 }}><div style={{ textAlign: "center", padding: 10, background: "rgba(0,0,0,.2)", borderRadius: 8 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--sky2)" }}>{mt.length}</div><div className="muted" style={{ fontSize: 11 }}>Tasks</div></div>
              <div style={{ textAlign: "center", padding: 10, background: "rgba(0,0,0,.2)", borderRadius: 8 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--green)" }}>{done}</div><div className="muted" style={{ fontSize: 11 }}>Done</div></div></div>
            <div className="flexb" style={{ marginBottom: 10 }}>
              <span className={`tag tag-${active ? "done" : "overdue"}`}>{active ? "● Active" : "● Locked"}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-s btn-sm btn-ic" title="Invite" onClick={() => setInvite(m)}><Icon n="translate" s={13} /></button>
                <button className="btn btn-s btn-sm btn-ic" title="Edit" onClick={() => openEdit(m)}><Icon n="pen" s={13} /></button></div></div>
            <button className={`btn btn-sm btn-full ${active ? "btn-s" : "btn-g"}`} onClick={() => setActive(m.id, !active)}>
              <Icon n={active ? "lock" : "power"} s={13} /> {active ? "Deactivate" : "Reactivate"}</button>
          </div>; })}</div>

      {modal && <div className="modal-bg" onClick={e => e.target === e.currentTarget && setModal(null)}>
        <div className="modal"><div className="mt">{modal === "add" ? "Add Crew Member" : "Edit Crew Member"}</div>
          <div className="fg"><label className="fl">Full Name</label><input className="fi" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Juan Martinez" /></div>
          <div className="fg"><label className="fl">Email (their login)</label><input className="fi" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="juan@gsm.com" /></div>
          <div className="grid2">
            <div className="fg"><label className="fl">Phone</label><input className="fi" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+1205..." /></div>
            <div className="fg"><label className="fl">PIN</label><input className="fi" value={form.pin} onChange={e => setForm(p => ({ ...p, pin: e.target.value.replace(/\D/g, "").slice(0, 6) }))} placeholder="4-digit" /></div></div>
          <div className="macts">
            {modal !== "add" && <button className="btn btn-s" style={{ marginRight: "auto", color: "var(--red)" }} onClick={() => { setConfirm(modal); setModal(null); }}>Remove</button>}
            <button className="btn btn-s" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-p" onClick={save}>{modal === "add" ? "Add & Get Invite" : "Save"}</button></div></div></div>}

      {invite && <div className="modal-bg" onClick={e => e.target === e.currentTarget && setInvite(null)}>
        <div className="modal"><div className="mt">Invite for {invite.name}</div>
          <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>Copy this and text it to them. It has the app link and their login.</p>
          <textarea className="fi" readOnly value={inviteText(invite)} style={{ minHeight: 180, fontFamily: "monospace", fontSize: 12 }} onFocus={e => e.target.select()} />
          <div className="macts">
            <button className="btn btn-s" onClick={() => setInvite(null)}>Close</button>
            <button className="btn btn-p" onClick={() => { navigator.clipboard?.writeText(inviteText(invite)); }}><Icon n="check" s={14} /> Copy</button>
            <a className="btn btn-g" href={`sms:${invite.phone}?body=${encodeURIComponent(inviteText(invite))}`} style={{ textDecoration: "none" }}><Icon n="translate" s={14} /> Text It</a></div></div></div>}

      {confirm && <div className="modal-bg" onClick={e => e.target === e.currentTarget && setConfirm(null)}>
        <div className="modal"><div className="mt">Remove {confirm.name}?</div>
          <p className="muted" style={{ lineHeight: 1.6 }}>This permanently removes them from the crew list. To just block access instead, use Deactivate — that keeps their record and history.</p>
          <div className="macts"><button className="btn btn-s" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn btn-danger" style={{ background: "linear-gradient(135deg,#dc2626,var(--red))", color: "#fff" }} onClick={() => { removeUser(confirm.id); setConfirm(null); }}>Remove</button></div></div></div>}
    </div>
  );
}

function TestReminder({ f }) {
  const [phone, setPhone] = useState(f.twPhone ? "" : "");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!phone) { setStatus("Enter a phone number to test."); return; }
    setBusy(true); setStatus("");
    try {
      const link = (f.appUrl || window.location.origin) + "/?log=1";
      const res = await fetch("/.netlify/functions/send-sms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone, body: `Test from GS Masters Field: don't forget to log today's work. Tap here: ${link}` }),
      });
      const data = await res.json();
      setStatus(res.ok ? "✓ Sent! Check the phone." : `Failed: ${data.error || "check Twilio env vars"}`);
    } catch (e) { setStatus("Failed — function only works once deployed to Netlify with env vars set."); }
    setBusy(false);
  };
  return (
    <div style={{ padding: 12, background: "rgba(0,0,0,.2)", borderRadius: 10 }}>
      <label className="fl">Send a test reminder</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="fi" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+12055551234" style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={send} disabled={busy}>{busy ? <span className="spin" /> : "Send Test"}</button></div>
      {status && <p className="muted" style={{ fontSize: 12, marginTop: 8, color: status.startsWith("✓") ? "var(--green)" : "var(--orange)" }}>{status}</p>}
    </div>
  );
}

function Settings({ settings, saveSettings }) {
  const [f, setF] = useState({ sbUrl: settings.sbUrl || "", sbKey: settings.sbKey || "", driveFolder: settings.driveFolder || "",
    twSid: settings.twSid || "", twToken: settings.twToken || "", twPhone: settings.twPhone || "", gtKey: settings.gtKey || "", reminder: settings.reminder || "17:00", appUrl: settings.appUrl || "" });
  const [saved, setSaved] = useState(false);
  const save = () => { saveSettings(f); if (f.sbUrl) localStorage.setItem("sb_url", f.sbUrl); if (f.sbKey) localStorage.setItem("sb_key", f.sbKey); setSaved(true); setTimeout(() => setSaved(false), 2000); };
  const F = ({ l, k, type = "text", ph = "" }) => <div className="fg"><label className="fl">{l}</label>
    <input className="fi" type={type} value={f[k]} placeholder={ph} onChange={e => setF(p => ({ ...p, [k]: e.target.value }))} /></div>;
  const Sec = ({ title, children }) => <div style={{ marginBottom: 24 }}>
    <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 16, fontWeight: 700, color: "var(--sky2)", letterSpacing: 1, marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>{title}</div>{children}</div>;
  return (
    <div><h2 className="h2" style={{ marginBottom: 20 }}>Settings</h2>
      <div className="card">
        <Sec title="🔗 App Link"><F l="Your App URL (for crew invites)" k="appUrl" ph="https://gsmfield.netlify.app" /></Sec>
        <Sec title="⚡ Supabase Backend"><F l="Supabase URL" k="sbUrl" ph="https://xxxx.supabase.co" /><F l="Supabase Anon Key" k="sbKey" type="password" ph="eyJ..." /></Sec>
        <Sec title="📁 Google Drive"><F l="Drive Folder ID (GS Masters Inc)" k="driveFolder" ph="1ABC...xyz" /></Sec>
        <Sec title="📱 Twilio SMS"><F l="Account SID" k="twSid" ph="ACxxxx" /><F l="Auth Token" k="twToken" type="password" /><F l="From Number" k="twPhone" ph="+12055550100" /></Sec>
        <Sec title="🌐 Google Translate"><F l="Translate API Key" k="gtKey" type="password" ph="AIzaSy..." /></Sec>
        <Sec title="⏰ Reminders"><div className="fg"><label className="fl">Daily Log Reminder</label>
          <input className="fi" type="time" value={f.reminder} onChange={e => setF(p => ({ ...p, reminder: e.target.value }))} /></div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>Crew gets an SMS with a one-tap link to their log screen if they haven't logged by this time. The schedule runs on the server (Netlify) so it fires even when no one has the app open.</p>
          <TestReminder f={f} /></Sec>
        <button className="btn btn-p" onClick={save} style={{ minWidth: 140 }}>{saved ? <><Icon n="check" s={16} /> Saved!</> : "Save Settings"}</button>
      </div>
    </div>
  );
}

// ─── CREW ─────────────────────────────────────────────────────────────
function Crew(props) {
  const { t, tab, setTab } = props;
  const ctab = (tab === "dash" || !tab) ? "tasks" : tab;
  const nav = [{ k: "tasks", i: "tasks", l: t.tasks }, { k: "cam", i: "camera", l: t.photos },
    { k: "rec", i: "receipt", l: t.receipts }, { k: "log", i: "report", l: t.log }];
  return (
    <div style={{ minHeight: "calc(100vh - 62px)", background: "var(--steel)" }}>
      <div style={{ padding: 18, paddingBottom: 80 }}>
        {ctab === "tasks" && <CrewTasks {...props} />}
        {ctab === "cam" && <CrewPhotos {...props} />}
        {ctab === "rec" && <CrewReceipts {...props} />}
        {ctab === "log" && <CrewLog {...props} />}
      </div>
      <div className="cnav">{nav.map(n => <div key={n.k} className={`cnav-i ${ctab === n.k ? "on" : ""}`} onClick={() => setTab(n.k)}>
        <Icon n={n.i} s={22} /><span className="cnav-l">{n.l}</span></div>)}</div>
    </div>
  );
}

function CrewTasks(props) {
  const { user, tasks, setTasks, jobs, lang, t, settings } = props;
  const closedJobIds = new Set(jobs.filter(j => j.status === "closed").map(j => j.id));
  const my = tasks.filter(t => (Array.isArray(t.assignedTo) ? t.assignedTo.includes(user.id) : t.assignedTo === user.id) && !closedJobIds.has(t.jobId));
  const today = new Date().toISOString().split("T")[0];
  const [checkedJob, setCheckedJob] = useState(null);
  const [gps, setGps] = useState(null);
  const [matModal, setMatModal] = useState(null);
  const [mat, setMat] = useState("");
  const [signModal, setSignModal] = useState(null);
  const toggle = async (id) => {
    const task = tasks.find(t => t.id === id);
    const next = task.status === "done" ? "pending" : "done";
    setTasks(p => p.map(t => t.id === id ? { ...t, status: next } : t));
    try { await sbPatch("field_tasks", id, { status: next, completed_at: next === "done" ? new Date().toISOString() : null }); } catch {}
  };
  const submitMat = async (taskId) => {
    if (!mat.trim()) return;
    const tk = tasks.find(t => t.id === taskId);
    const id = "m" + Date.now();
    const row = { id, task_id: taskId, job_id: tk?.jobId || null, crew_id: user.id, text_en: mat, text_es: null, fulfilled: false };
    try { await sbPost("field_material_requests", row); } catch { enqueue({ table: "field_material_requests", payload: row }); }
    setMat(""); setMatModal(null);
  };
  const st = task => task.status === "done" ? "done" : (task.dueDate && task.dueDate < today ? "overdue" : "pending");

  const checkIn = async (job) => {
    const loc = await getLocation();
    setGps(loc);
    if (loc && job.lat) {
      const dist = distanceMi(loc, { lat: job.lat, lng: job.lng });
      setCheckedJob({ id: job.id, dist });
    } else setCheckedJob({ id: job.id, dist: null });
  };

  const groups = [...new Set(my.map(t => t.jobId))];
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 className="h2">{lang === "es" ? `Hola, ${user.name.split(" ")[0]}` : `Hey, ${user.name.split(" ")[0]}`}</h2>
        <p className="muted">{lang === "es" ? "Tus tareas de hoy" : "Your tasks today"}</p></div>
      {my.length === 0 ? <div className="empty"><Icon n="check" s={48} c="var(--green)" /><p style={{ marginTop: 12 }}>{t.noTasks}</p></div>
        : groups.map(jid => { const job = jobs.find(j => j.id === jid), jt = my.filter(t => t.jobId === jid);
          const ci = checkedJob?.id === jid;
          return <div key={jid} className="jobsec">
            <div className="jobhead"><div><div className="jobname">{job?.name}</div><div className="jobaddr">{job?.address}</div></div>
              <button className={`btn btn-sm ${ci ? "btn-g" : "btn-s"}`} onClick={() => checkIn(job)}>
                <Icon n="pin" s={13} /> {ci ? t.checkedIn : t.checkIn}</button></div>
            {ci && checkedJob.dist != null && <div style={{ padding: "6px 18px", fontSize: 12, color: checkedJob.dist < 0.5 ? "var(--green)" : "var(--orange)", background: "rgba(0,0,0,.2)" }}>
              📍 {checkedJob.dist < 0.5 ? (lang === "es" ? "En el sitio" : "On site") : `${checkedJob.dist.toFixed(1)} mi ${lang === "es" ? "del sitio" : "from site"}`}</div>}
            <div className="jobbody">{jt.map(task => { const s = st(task);
              return <div key={task.id} className="trow">
                <div className="tchk"><input type="checkbox" checked={task.status === "done"} onChange={() => toggle(task.id)} /></div>
                <div className="tinfo">
                  <div className="ten" style={{ textDecoration: task.status === "done" ? "line-through" : "none", opacity: task.status === "done" ? .6 : 1 }}>{task.title}</div>
                  <div className="tes">{task.titleEs}</div>
                  <div className="tmeta"><span className={`tag tag-${s}`}>{t[s]}</span>
                    {task.dueDate && <span className="tag" style={{ background: "rgba(255,255,255,.06)", color: "var(--silver)" }}>{task.dueDate}</span>}</div></div>
                <div className="tact">
                  <button className="btn btn-s btn-sm btn-ic" title="Materials" onClick={() => setMatModal(task.id)}><Icon n="tools" s={14} /></button>
                  {task.status === "done" && <button className="btn btn-s btn-sm btn-ic" title="Sign-off" onClick={() => setSignModal(task)}><Icon n="pen" s={14} /></button>}</div>
              </div>; })}</div></div>; })}
      {matModal && <div className="modal-bg" onClick={e => e.target === e.currentTarget && setMatModal(null)}>
        <div className="modal"><div className="mt">{lang === "es" ? "Solicitar Materiales" : "Request Materials"}</div>
          <div className="fg"><label className="fl">{lang === "es" ? "¿Qué necesitas?" : "What do you need?"}</label>
            <textarea className="fi" value={mat} onChange={e => setMat(e.target.value)} placeholder={lang === "es" ? "ej. madera 2x4..." : "e.g. 2x4 lumber..."} /></div>
          <div className="macts"><button className="btn btn-s" onClick={() => setMatModal(null)}>Cancel</button>
            <button className="btn btn-a" onClick={() => submitMat(matModal)}><Icon n="tools" s={14} /> {lang === "es" ? "Enviar" : "Submit"}</button></div></div></div>}
      {signModal && <SignModal task={signModal} lang={lang} onClose={() => setSignModal(null)} />}
    </div>
  );
}

function SignModal({ task, lang, onClose }) {
  const cv = useRef(); const [drawing, setDrawing] = useState(false); const [name, setName] = useState(""); const [busy, setBusy] = useState(false);
  const pos = e => { const r = cv.current.getBoundingClientRect(); const t = e.touches?.[0] || e; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
  const start = e => { setDrawing(true); const c = cv.current.getContext("2d"); const p = pos(e); c.beginPath(); c.moveTo(p.x, p.y); };
  const move = e => { if (!drawing) return; e.preventDefault(); const c = cv.current.getContext("2d"); const p = pos(e); c.lineWidth = 2.5; c.lineCap = "round"; c.strokeStyle = "#0f1923"; c.lineTo(p.x, p.y); c.stroke(); };
  const clear = () => cv.current.getContext("2d").clearRect(0, 0, cv.current.width, cv.current.height);
  const save = async () => {
    if (!name) return;
    setBusy(true);
    const sigData = cv.current.toDataURL("image/png");
    const id = "sig" + Date.now();
    const row = { id, task_id: task.id, job_id: task.jobId, signed_name: name, signature_data: sigData };
    try { await sbPost("field_signoffs", row); } catch { enqueue({ table: "field_signoffs", payload: row }); }
    setBusy(false); onClose();
  };
  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal"><div className="mt">{lang === "es" ? "Firma de Aprobación" : "Client Sign-Off"}</div>
        <p className="muted" style={{ marginBottom: 14 }}>{task.title}</p>
        <div className="fg"><label className="fl">{lang === "es" ? "Nombre" : "Name"}</label>
          <input className="fi" value={name} onChange={e => setName(e.target.value)} placeholder={lang === "es" ? "Nombre del cliente" : "Client name"} /></div>
        <label className="fl">{lang === "es" ? "Firma aquí" : "Sign here"}</label>
        <canvas ref={cv} className="sig-pad" width={440} height={160}
          onMouseDown={start} onMouseMove={move} onMouseUp={() => setDrawing(false)} onMouseLeave={() => setDrawing(false)}
          onTouchStart={start} onTouchMove={move} onTouchEnd={() => setDrawing(false)} />
        <div className="macts"><button className="btn btn-s" onClick={clear}>{lang === "es" ? "Borrar" : "Clear"}</button>
          <button className="btn btn-g" onClick={save} disabled={busy}>{busy ? <span className="spin" /> : <><Icon n="check" s={14} /> {lang === "es" ? "Guardar" : "Save"}</>}</button></div></div>
    </div>
  );
}

function CrewPhotos(props) {
  const { user, tasks, jobs, photos, setPhotos, t } = props;
  const my = tasks.filter(t => Array.isArray(t.assignedTo) ? t.assignedTo.includes(user.id) : t.assignedTo === user.id);
  const [task, setTask] = useState(""); const [type, setType] = useState("before"); const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const upload = async e => {
    const file = e.target.files[0]; if (!file || !task) return;
    setBusy(true);
    const { dataUrl, sizeKB } = await compressImage(file);
    const tk = tasks.find(t => t.id === task);
    const id = "p" + Date.now();
    const photo = { id, dataUrl, type, taskId: task, jobId: tk?.jobId, crewId: user.id, sizeKB, date: new Date().toISOString() };
    setPhotos(p => [...p, photo]);
    const row = { id, data_url: dataUrl, photo_type: type, task_id: task, job_id: tk?.jobId, crew_id: user.id, size_kb: sizeKB };
    try { await sbPost("field_photos", row); } catch { enqueue({ table: "field_photos", payload: row }); }
    setBusy(false);
  };
  return (
    <div><h2 className="h2" style={{ marginBottom: 18 }}>{t.photos}</h2>
      <div className="card">
        <div className="fg"><label className="fl">Task</label>
          <select className="fi" value={task} onChange={e => setTask(e.target.value)}><option value="">Choose...</option>
            {my.map(tk => { const j = jobs.find(j => j.id === tk.jobId); return <option key={tk.id} value={tk.id}>{j?.name} — {tk.title}</option>; })}</select></div>
        <div className="fg"><label className="fl">Type</label>
          <div style={{ display: "flex", gap: 8 }}>{["before", "after", "progress"].map(x => <button key={x} className={`btn btn-sm ${type === x ? "btn-p" : "btn-s"}`} onClick={() => setType(x)}>{x}</button>)}</div></div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={upload} />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-p" disabled={!task || busy} onClick={() => fileRef.current?.click()}>{busy ? <span className="spin" /> : <><Icon n="camera" s={16} /> Take Photo</>}</button>
          <button className="btn btn-s" disabled={!task || busy} onClick={() => { fileRef.current?.removeAttribute("capture"); fileRef.current?.click(); }}><Icon n="photo" s={16} /> Library</button></div>
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>Photos auto-compressed before upload to save data & storage.</p>
      </div>
      {[...new Set(photos.filter(p => p.crewId === user.id).map(p => p.taskId))].map(tid => {
        const tk = tasks.find(t => t.id === tid), j = jobs.find(j => j.id === tk?.jobId), tp = photos.filter(p => p.taskId === tid);
        return <div key={tid} className="card"><div className="ct" style={{ fontSize: 15 }}>{j?.name} — {tk?.title}</div>
          <div className="pgrid">{tp.map((p, i) => <div key={i} className="pthumb"><img src={p.dataUrl} alt={p.type} />
            <div className="plabel" style={{ color: p.type === "before" ? "var(--orange)" : p.type === "after" ? "var(--green)" : "var(--sky2)" }}>{p.type} · {p.sizeKB}kb</div></div>)}</div></div>;
      })}
    </div>
  );
}

function CrewReceipts(props) {
  const { user, tasks, jobs, receipts, setReceipts, t, lang } = props;
  const my = tasks.filter(t => Array.isArray(t.assignedTo) ? t.assignedTo.includes(user.id) : t.assignedTo === user.id);
  const [task, setTask] = useState(""); const [store, setStore] = useState(""); const [amount, setAmount] = useState(""); const [note, setNote] = useState(""); const [paidBy, setPaidBy] = useState("crew"); const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const upload = async e => {
    const file = e.target.files[0]; if (!file || !task) return; setBusy(true);
    const { dataUrl } = await compressImage(file, 1000, 0.6);
    const tk = tasks.find(t => t.id === task);
    const id = "r" + Date.now();
    const today = new Date().toISOString().split("T")[0];
    const receipt = { id, dataUrl, taskId: task, jobId: tk?.jobId, crewId: user.id, store, amount, note, paidBy, reimbursementStatus: paidBy === "crew" ? "pending" : "na", createdAt: today };
    setReceipts(p => [...p, receipt]);
    const row = { id, data_url: dataUrl, task_id: task, job_id: tk?.jobId, crew_id: user.id, store, amount: parseFloat(amount) || 0, note, paid_by: paidBy, reimbursement_status: paidBy === "crew" ? "pending" : "na" };
    try { await sbPost("field_receipts", row); } catch { enqueue({ table: "field_receipts", payload: row }); }
    setStore(""); setAmount(""); setNote(""); setPaidBy("crew"); setBusy(false);
  };
  return (
    <div><h2 className="h2" style={{ marginBottom: 18 }}>{t.receipts}</h2>
      <div className="card">
        <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>{lang === "es" ? "Toma foto de tu recibo." : "Snap your receipt and log it."}</p>
        <div className="fg"><label className="fl">{lang === "es" ? "Tarea" : "Task"}</label>
          <select className="fi" value={task} onChange={e => setTask(e.target.value)}><option value="">Choose...</option>
            {my.map(tk => { const j = jobs.find(j => j.id === tk.jobId); return <option key={tk.id} value={tk.id}>{j?.name} — {tk.title}</option>; })}</select></div>
        <div className="grid2"><div className="fg"><label className="fl">{lang === "es" ? "Tienda" : "Store"}</label>
          <input className="fi" value={store} onChange={e => setStore(e.target.value)} placeholder="Home Depot" /></div>
          <div className="fg"><label className="fl">{lang === "es" ? "Monto" : "Amount"} ($)</label>
            <input className="fi" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></div></div>
        <div className="fg"><label className="fl">{lang === "es" ? "Notas" : "Notes"}</label>
          <input className="fi" value={note} onChange={e => setNote(e.target.value)} placeholder={lang === "es" ? "Qué compraste" : "What was bought"} /></div>
        <div className="fg"><label className="fl">{lang === "es" ? "¿Quién pagó?" : "Who paid?"}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className={`btn btn-sm ${paidBy === "crew" ? "btn-a" : "btn-s"}`} onClick={() => setPaidBy("crew")}>{lang === "es" ? "Yo pagué (necesito reembolso)" : "I paid (need reimbursement)"}</button>
            <button className={`btn btn-sm ${paidBy === "company" ? "btn-p" : "btn-s"}`} onClick={() => setPaidBy("company")}>{lang === "es" ? "Empresa pagó" : "Company paid"}</button>
          </div>
          {paidBy === "crew" && <p style={{ fontSize: 11, color: "var(--orange)", marginTop: 6 }}>{lang === "es" ? "Se registrará para reembolso" : "Will be flagged for reimbursement"}</p>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={upload} />
        <button className="btn btn-a" disabled={!task || busy} onClick={() => fileRef.current?.click()}>{busy ? <span className="spin" /> : <><Icon n="camera" s={16} /> {lang === "es" ? "Foto Recibo" : "Photo Receipt"}</>}</button>
      </div>
      {receipts.filter(r => r.crewId === user.id).map(r => { const j = jobs.find(x => x.id === r.jobId);
        return <div key={r.id} className="card" style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {r.dataUrl && <img src={r.dataUrl} alt="receipt" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover" }} />}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{r.store}</div>
            <div className="muted">{j?.name} · {r.note}</div>
            {r.paidBy === "crew" && <span className={`tag ${r.reimbursementStatus === "paid" ? "tag-done" : "tag-overdue"}`} style={{ marginTop: 4, display: "inline-block" }}>{r.reimbursementStatus === "paid" ? (lang === "es" ? "Reembolsado" : "Reimbursed") : (lang === "es" ? "Pendiente reembolso" : "Awaiting reimbursement")}</span>}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--accent)" }}>${(+r.amount).toFixed(2)}</div></div>; })}
    </div>
  );
}

function CrewLog(props) {
  const { user, tasks, jobs, logs, setLogs, lang, t, settings } = props;
  const my = tasks.filter(t => Array.isArray(t.assignedTo) ? t.assignedTo.includes(user.id) : t.assignedTo === user.id);
  const [task, setTask] = useState(""); const [en, setEn] = useState(""); const [es, setEs] = useState(""); const [weather, setWeather] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const today = new Date().toISOString().split("T")[0];
  const loggedToday = logs.some(l => l.crewId === user.id && l.date === today);
  const submit = async () => {
    if (!en && !es) return; setBusy(true);
    let e = en, s = es;
    if (e && !s && settings.gtKey) s = await translateText(e, "es", settings.gtKey);
    if (s && !e && settings.gtKey) e = await translateText(s, "en", settings.gtKey);
    const tk = tasks.find(t => t.id === task);
    const id = "l" + Date.now();
    const log = { id, en: e, es: s, weather, taskId: task, jobId: tk?.jobId, crewId: user.id, date: today };
    setLogs(p => [...p, log]);
    const row = { id, text_en: e, text_es: s, weather, task_id: task || null, job_id: tk?.jobId || null, crew_id: user.id, log_date: today };
    try { await sbPost("field_logs", row); } catch { enqueue({ table: "field_logs", payload: row }); }
    setEn(""); setEs(""); setWeather(""); setBusy(false); setDone(true); setTimeout(() => setDone(false), 3000);
  };
  return (
    <div><h2 className="h2">{lang === "es" ? "Registro del Día" : "Log Your Day"}</h2>
      <p className="muted" style={{ marginBottom: 16 }}>{lang === "es" ? "Cuéntanos qué hiciste hoy." : "Tell us what you did today."}</p>
      {!loggedToday && <div style={{ padding: "10px 14px", background: "rgba(249,115,22,.12)", border: "1px solid rgba(249,115,22,.3)", borderRadius: 10, marginBottom: 16, color: "var(--orange)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
        <Icon n="report" s={16} /> {lang === "es" ? "Aún no has registrado hoy" : "You haven't logged today yet"}</div>}
      {done && <div style={{ padding: "10px 14px", background: "rgba(16,185,129,.15)", border: "1px solid rgba(16,185,129,.3)", borderRadius: 10, marginBottom: 16, color: "var(--green)", fontWeight: 600 }}>✓ {lang === "es" ? "¡Registro enviado!" : "Log submitted!"}</div>}
      <div className="card">
        <div className="fg"><label className="fl">{lang === "es" ? "Tarea" : "Task"}</label>
          <select className="fi" value={task} onChange={e => setTask(e.target.value)}><option value="">{lang === "es" ? "General" : "General log"}</option>
            {my.map(tk => { const j = jobs.find(j => j.id === tk.jobId); return <option key={tk.id} value={tk.id}>{j?.name} — {tk.title}</option>; })}</select></div>
        <div className="fg"><label className="fl">{lang === "es" ? "¿Qué hiciste? (Inglés)" : "What did you do? (English)"}</label>
          <textarea className="fi" value={en} onChange={e => setEn(e.target.value)} placeholder="Describe your work..." /></div>
        <div className="fg"><label className="fl">{lang === "es" ? "¿Qué hiciste? (Español)" : "What did you do? (Spanish)"}</label>
          <textarea className="fi" value={es} onChange={e => setEs(e.target.value)} placeholder="Describe tu trabajo..." /></div>
        <div className="fg"><label className="fl">{t.weather}</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{[["sunny", "☀️"], ["cloudy", "☁️"], ["rainy", "🌧️"], ["hot", "🔥"]].map(([k, ic]) =>
            <button key={k} className={`btn btn-sm ${weather === k ? "btn-p" : "btn-s"}`} onClick={() => setWeather(weather === k ? "" : k)}>{ic} {t[k]}</button>)}</div></div>
        <button className="btn btn-p btn-full" disabled={busy} onClick={submit}>{busy ? <span className="spin" /> : <><Icon n="check" s={16} /> {t.log}</>}</button>
      </div>
      {logs.filter(l => l.crewId === user.id).map(l => { const j = jobs.find(j => j.id === l.jobId);
        return <div key={l.id} className="card"><div className="log"><div className="log-en">{l.en}</div><div className="log-es">{l.es}</div>
          <div className="log-m">{j?.name && `${j.name} · `}{l.weather && `${l.weather} · `}{l.date}</div></div></div>; })}
    </div>
  );
}
