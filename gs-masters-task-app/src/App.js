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
const fromProfile = r => ({ id: r.id, name: r.name, role: r.role, email: r.email, phone: r.phone || "", pin: r.pin, active: r.active !== false, archived: r.archived === true });
const fromJob     = r => ({ id: r.id, name: r.name, address: r.address || "", lat: r.lat, lng: r.lng, budget: r.budget, status: r.status, closedAt: r.closed_at, gsmJobId: r.gsm_job_id, gsmSync: r.gsm_sync || false });
const fromTask    = r => ({ id: r.id, jobId: r.job_id, title: r.title, titleEs: r.title_es || "", assignedTo: Array.isArray(r.assigned_to) ? r.assigned_to : (r.assigned_to ? [r.assigned_to] : []), status: r.status, dueDate: r.due_date || "", createdAt: (r.created_at || "").slice(0, 10) });
const fromLog     = r => ({ id: r.id, taskId: r.task_id, jobId: r.job_id, crewId: r.crew_id, en: r.text_en, es: r.text_es, weather: r.weather, date: r.log_date });
const fromPhoto   = r => ({ id: r.id, taskId: r.task_id, jobId: r.job_id, crewId: r.crew_id, dataUrl: r.data_url, type: r.photo_type, sizeKB: r.size_kb, date: r.created_at });
const fromReceipt = r => ({ id: r.id, taskId: r.task_id, jobId: r.job_id, crewId: r.crew_id, dataUrl: r.data_url, store: r.store, amount: r.amount, note: r.note, paidBy: r.paid_by || "crew", reimbursementStatus: r.reimbursement_status || "pending", billStatus: r.bill_status, createdAt: (r.created_at || "").slice(0, 10) });
const fromMat     = r => ({ id: r.id, taskId: r.task_id, jobId: r.job_id, crewId: r.crew_id, en: r.text_en, es: r.text_es, fulfilled: r.fulfilled });
const fromCheckin = r => ({ id: r.id, crewId: r.crew_id, jobId: r.job_id, checkIn: r.check_in, checkOut: r.check_out, hours: r.hours, date: r.work_date, latIn: r.lat_in, lngIn: r.lng_in });

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

// ─── TAP-TO-NAVIGATE ADDRESS ─────────────────────────────────────────────
const MapAddr = ({ addr, cls = "jobaddr" }) => {
  if (!addr) return null;
  const url = "https://maps.google.com/?q=" + encodeURIComponent(addr);
  return (
    <a href={url} target="_blank" rel="noreferrer" className={cls}
      style={{ display:"inline-flex", alignItems:"center", gap:4, textDecoration:"none", color:"inherit" }}
      onClick={e => e.stopPropagation()}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--sky2)" strokeWidth="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>
      {addr}
    </a>
  );
};

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
  // Use es-419 (Latin American Spanish) for Mexican crew — NOT generic "es"
  const lang = target === "es" ? "es-419" : target;
  try {
    const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, target: lang, format: "text" }) });
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
  en: {
    // nav
    tasks:"Tasks", photos:"Photos", receipts:"Receipts", log:"Log Day", login:"Sign In",
    // status
    pending:"Pending", done:"Done", overdue:"Overdue", noTasks:"All caught up!",
    // check-in
    checkIn:"Check In", checkedIn:"Checked in",
    // weather
    weather:"Weather", sunny:"Sunny", cloudy:"Cloudy", rainy:"Rainy", hot:"Hot",
    // shared
    task:"Task", job:"Job", choose:"Choose...", cancel:"Cancel", submit:"Submit",
    // photos
    photoType:"Photo Type", before:"Before", after:"After", concern:"Concern",
    takePhoto:"Take Photo", library:"From Library",
    photoNote:"Photos compressed before upload to save data.",
    photoSaved:"Photo saved", retake:"Retake", photo:"Photo",
    // receipts
    store:"Store", amount:"Amount", notes:"Notes", whatBought:"What was bought",
    whoPaid:"Who paid?", iPaid:"I paid — need reimbursement", companyPaid:"Company paid",
    submitReceipt:"Submit Receipt", receiptSubmitted:"Receipt submitted!",
    photoReady:"Photo ready", receiptPhoto:"Receipt photo (optional)",
    reimbursed:"Reimbursed", awaitingReimb:"Awaiting reimbursement",
    flaggedReimb:"Will be flagged for reimbursement",
    requireFields:"Task, store, and amount required to submit",
    snapReceipt:"Fill out the form and submit your receipt.",
    // log
    logYourDay:"Log Your Day", tellUs:"Tell us what you did today.",
    whatEn:"What did you do? (English)", whatEs:"What did you do? (Spanish)",
    logSubmitted:"Log submitted!", notLogged:"You haven't logged today yet",
    generalLog:"General log", descWork:"Describe your work...", descWorkEs:"Describe tu trabajo...",
    // auto-log
    completedTask:"Completed",
    // GPS
    onSite:"On site", fromSite:"from site",
    // net / greeting
    online:"Online", offline:"Offline",
    yourTasks:"Your tasks today",
  },
  es: {
    // nav
    tasks:"Tareas", photos:"Fotos", receipts:"Recibos", log:"Registro del Día", login:"Entrar",
    // status
    pending:"Pendiente", done:"Listo", overdue:"Atrasado", noTasks:"¡Todo al día!",
    // check-in
    checkIn:"Registrarse", checkedIn:"Registrado",
    // weather
    weather:"Clima", sunny:"Soleado", cloudy:"Nublado", rainy:"Lluvioso", hot:"Caluroso",
    // shared
    task:"Tarea", job:"Trabajo", choose:"Elegir...", cancel:"Cancelar", submit:"Enviar",
    // photos
    photoType:"Tipo de Foto", before:"Antes", after:"Después", concern:"Problema",
    takePhoto:"Tomar Foto", library:"De Galería",
    photoNote:"Fotos comprimidas antes de subir para ahorrar datos.",
    photoSaved:"Foto guardada", retake:"Cambiar foto", photo:"Foto",
    // receipts
    store:"Tienda", amount:"Monto", notes:"Notas", whatBought:"¿Qué compraste?",
    whoPaid:"¿Quién pagó?", iPaid:"Yo pagué — necesito reembolso", companyPaid:"La empresa pagó",
    submitReceipt:"Enviar Recibo", receiptSubmitted:"¡Recibo enviado!",
    photoReady:"Foto lista", receiptPhoto:"Foto del recibo (opcional)",
    reimbursed:"Reembolsado", awaitingReimb:"Esperando reembolso",
    flaggedReimb:"Se marcará para reembolso",
    requireFields:"Tarea, tienda y monto son requeridos",
    snapReceipt:"Llena el formulario y envía tu recibo.",
    // log
    logYourDay:"Registro del Día", tellUs:"Cuéntanos qué hiciste hoy.",
    whatEn:"¿Qué hiciste? (Inglés)", whatEs:"¿Qué hiciste? (Español)",
    logSubmitted:"¡Registro enviado!", notLogged:"Aún no has registrado hoy",
    generalLog:"Registro general", descWork:"Describe tu trabajo...", descWorkEs:"Describe tu trabajo...",
    // auto-log
    completedTask:"Completada",
    // GPS
    onSite:"En el sitio", fromSite:"del sitio",
    // net / greeting
    online:"En línea", offline:"Sin conexión",
    yourTasks:"Tus tareas de hoy",
  },
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
.app.light{
  --steel:#f1f5f9;--steel2:#ffffff;--steel3:#e8edf2;
  --card:rgba(255,255,255,.97);--border:rgba(15,25,36,.12);
  --slate:#475569;--silver:#64748b;--mist:#334155;--white:#0f172a;
  background:#f1f5f9;
  color:#0f172a;  /* cascade dark text to ALL children */
}
.app.light .login{background:radial-gradient(ellipse at 20% 30%,rgba(59,130,246,.08),transparent 55%),radial-gradient(ellipse at 85% 70%,rgba(245,158,11,.06),transparent 50%),#f1f5f9;color:#0f172a}
.app.light .login-card{background:rgba(255,255,255,.95);border-color:rgba(59,130,246,.2);box-shadow:0 24px 70px rgba(0,0,0,.1);color:#0f172a}
.app.light .logo-title,.app.light .logo-sub,.app.light .fl{color:#0f172a}
.app.light .topbar{background:rgba(255,255,255,.97);border-color:rgba(15,25,36,.1);box-shadow:0 1px 8px rgba(0,0,0,.08);color:#0f172a}
.app.light .tb-title,.app.light .tb-name{color:#0f172a}
.app.light .side{background:rgba(241,245,249,.98);border-color:rgba(15,25,36,.1);color:#0f172a}
.app.light .nav{color:#475569}
.app.light .nav:hover{background:rgba(59,130,246,.08);color:#0f172a}
.app.light .nav.on{background:rgba(59,130,246,.12);color:var(--sky-dim);border-color:rgba(59,130,246,.25)}
.app.light .nav-sec{color:#94a3b8}
.app.light .content{background:#f1f5f9;color:#0f172a}
.app.light .h2{color:#0f172a}
.app.light .card{background:rgba(255,255,255,.95);box-shadow:0 2px 12px rgba(0,0,0,.06);color:#0f172a}
.app.light .ct{color:#1e293b}
.app.light .muted{color:#475569}
.app.light .fi{background:#fff;border-color:rgba(15,25,36,.18);color:#0f172a}
.app.light .fi:focus{border-color:var(--sky);background:#fff}
.app.light .fi::placeholder{color:#94a3b8}
.app.light select.fi option{background:#fff;color:#0f172a}
.app.light .btn-s{background:rgba(0,0,0,.06);color:#334155;border-color:rgba(15,25,36,.15)}
.app.light .btn-s:hover{background:rgba(0,0,0,.1);color:#0f172a}
.app.light .trow{background:rgba(255,255,255,.5)}
.app.light .trow:hover{background:rgba(59,130,246,.04)}
.app.light .ten{color:#0f172a}
.app.light .tes{color:#475569}
.app.light .log{background:rgba(0,0,0,.04);color:#0f172a}
.app.light .log-en{color:#0f172a}
.app.light .log-es{color:var(--sky-dim)}
.app.light .log-m{color:#64748b}
.app.light .modal{background:#fff;border-color:rgba(15,25,36,.12);color:#0f172a}
.app.light .mt{color:#0f172a}
.app.light .jobhead{background:linear-gradient(135deg,#e8edf5,#f1f5f9);color:#0f172a}
.app.light .jobname,.app.light .jobaddr{color:#0f172a}
.app.light .jobaddr{color:#475569}
.app.light .jobbody{border-color:rgba(15,25,36,.1)}
.app.light .cnav{background:rgba(255,255,255,.98);border-color:rgba(15,25,36,.1);color:#0f172a}
.app.light .cnav-i{color:#64748b}
.app.light .cnav-i.on{color:var(--sky-dim)}
.app.light .cnav-l{color:inherit}
.app.light .stat{background:rgba(255,255,255,.8);border-color:rgba(15,25,36,.1);color:#0f172a}
.app.light .stat-l{color:#475569}
.app.light .bar{background:rgba(0,0,0,.08)}
.app.light th{background:rgba(0,0,0,.04);color:#64748b}
.app.light td{border-color:rgba(0,0,0,.05);color:#0f172a}
.app.light .badge-admin{background:rgba(245,158,11,.12);color:#b45309;border-color:rgba(245,158,11,.25)}
.app.light .badge-crew{background:rgba(59,130,246,.1);color:var(--sky-dim);border-color:rgba(59,130,246,.2)}
.app.light .net-on{background:rgba(16,185,129,.1);color:#059669}
.app.light .net-off{background:rgba(249,115,22,.1);color:#c2410c}
.app.light .empty{color:#64748b}
.app.light .fl{color:#334155}
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

  // ── LIVE SYNC — 30s polling both directions ────────────────────────
  useEffect(() => {
    if (!user) return;
    const sync = async () => {
      if (!navigator.onLine) return;
      try {
        const [dbTasks, dbLogs, dbPhotos, dbReceipts, dbMats] = await Promise.all([
          sbGet("field_tasks",            "order=created_at"),
          sbGet("field_logs",             "order=created_at.desc"),
          sbGet("field_photos",           "order=created_at.desc"),
          sbGet("field_receipts",         "order=created_at.desc"),
          sbGet("field_material_requests","order=created_at.desc"),
        ]);
        if (dbTasks)    setTasks(dbTasks.map(fromTask));
        if (dbLogs)     setLogs(dbLogs.map(fromLog));
        if (dbPhotos)   setPhotos(dbPhotos.map(fromPhoto));
        if (dbReceipts) setReceipts(dbReceipts.map(fromReceipt));
        if (dbMats)     setMats(dbMats.map(fromMat));
      } catch {}
    };
    const iv = setInterval(sync, 30000);
    window.addEventListener("focus", sync);
    return () => { clearInterval(iv); window.removeEventListener("focus", sync); };
  }, [user?.id]);

  // ── CREW MUTATIONS ────────────────────────────────────────────────
  const setActive = async (id, active) => {
    setUsers(u => u.map(x => x.id === id ? { ...x, active } : x));
    try { await sbPatch("field_profiles", id, { active }); } catch {}
  };
  const archiveCrew = async (id) => {
    setUsers(u => u.map(x => x.id === id ? { ...x, active: false, archived: true } : x));
    try { await sbPatch("field_profiles", id, { active: false, archived: true }); } catch {}
  };
  const unarchiveCrew = async (id) => {
    setUsers(u => u.map(x => x.id === id ? { ...x, active: true, archived: false } : x));
    try { await sbPatch("field_profiles", id, { active: true, archived: false }); } catch {}
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

  if (!user) return <Login onLogin={login} t={t} lang={lang} setLang={setLang} theme={theme} toggleTheme={toggleTheme} />;

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
                   online, setActive, addUser, updateUser, removeUser, archiveCrew, unarchiveCrew };

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
function Login({ onLogin, t, lang, setLang, theme, toggleTheme }) {
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
    <div className={`app${theme === "light" ? " light" : ""}`}><div className="login"><style>{CSS}</style>
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
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
          <button className="btn btn-s btn-sm" onClick={() => setLang(lang === "en" ? "es" : "en")}>
            <Icon n="translate" s={14} /> {lang === "en" ? "Español" : "English"}</button>
          <button className="btn btn-s btn-sm" onClick={toggleTheme}>
            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>
      </div>
    </div></div>
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
          <Icon n={online ? "wifi" : "wifiOff"} s={12} /> <span className="net-txt">{online ? t.online : t.offline}</span></span>
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
  const [statusFilter, setStatusFilter] = useState("all");
  const nav = [
    { k: "dash", i: "home", l: "Dashboard" }, { k: "activity", i: "report", l: "Live Activity" },
    { k: "tasks", i: "tasks", l: t.tasks }, { k: "cal", i: "calendar", l: "Calendar" },
    { k: "report", i: "report", l: "Reports" }, { k: "receipts", i: "receipt", l: t.receipts },
    { k: "photos", i: "photo", l: "Photos" }, { k: "jobs", i: "briefcase", l: "Jobs" },
    { k: "crew", i: "users", l: "Crew" }, { k: "hours", i: "calendar", l: "Hours" },
    { k: "set", i: "settings", l: "Settings" },
  ];
  const pick = k => { setTab(k); setStatusFilter("all"); setMenuOpen(false); };
  const navTo = (destTab, filter) => { setTab(destTab); setStatusFilter(filter); setMenuOpen(false); };
  return (
    <div className="layout">
      {menuOpen && <div className="side-scrim" onClick={() => setMenuOpen(false)} />}
      <div className={`side ${menuOpen ? "side-open" : ""}`}><div className="nav-sec">Navigation</div>
        {nav.map(n => <div key={n.k} className={`nav ${tab === n.k ? "on" : ""}`} onClick={() => pick(n.k)}>
          <Icon n={n.i} s={17} /> {n.l}</div>)}</div>
      <div className="content">
        {tab === "dash" && <Dash {...props} navTo={navTo} />}
        {tab === "activity" && <AdminActivity {...props} />}
        {tab === "tasks" && <AdminTasks {...props} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />}
        {tab === "cal" && <Calendar {...props} />}
        {tab === "report" && <Report {...props} />}
        {tab === "receipts" && <AdminReceipts {...props} />}
        {tab === "photos" && <AdminPhotos {...props} />}
        {tab === "jobs" && <Jobs {...props} />}
        {tab === "crew" && <CrewMgmt {...props} />}
        {tab === "hours" && <AdminHours {...props} />}
        {tab === "set" && <Settings {...props} />}
      </div>
    </div>
  );
}

function Dash({ tasks, jobs, users, receipts, setTab, navTo }) {
  const today = new Date().toISOString().split("T")[0];
  const activeJobs = jobs.filter(j => j.status !== "closed");
  const done  = tasks.filter(t => t.status === "done").length;
  const overdue = tasks.filter(t => t.status === "pending" && t.dueDate && t.dueDate < today).length;
  const pending = tasks.filter(t => t.status === "pending" && (!t.dueDate || t.dueDate >= today)).length;
  return (
    <div>
      <h2 className="h2 fade" style={{ marginBottom: 22 }}>Dashboard</h2>
      <div className="stats">
        {[
          ["Total Tasks",  tasks.length,    "var(--sky2)",    "tasks", "all"],
          ["Completed",    done,            "var(--green)",   "tasks", "done"],
          ["Pending",      pending,         "var(--accent)",  "tasks", "pending"],
          ["Overdue",      overdue,         "var(--red)",     "tasks", "overdue"],
          ["Active Jobs",  activeJobs.length,"var(--silver)", "jobs",  "all"],
        ].map(([l, n, c, dest, filter], i) => (
          <button key={l} className={`stat stat-btn fade fade-${i % 3 + 1}`} onClick={() => navTo ? navTo(dest, filter) : setTab(dest)}>
            <div className="stat-n" style={{ color: c }}>{n}</div>
            <div className="stat-l">{l}</div>
          </button>
        ))}
      </div>
      <div className="card fade">
        <div className="ct">Job Progress</div>
        {activeJobs.filter(job => tasks.some(t => t.jobId === job.id)).length === 0
          ? <div className="empty" style={{ padding: "20px 0" }}><p style={{ fontSize: 13 }}>No tasks assigned yet — add tasks to jobs to see progress.</p></div>
          : activeJobs.map(job => {
              const jt = tasks.filter(t => t.jobId === job.id);
              if (!jt.length) return null;
              const jd = jt.filter(t => t.status === "done").length;
              const pct = Math.round(jd / jt.length * 100);
              const allDone = jd === jt.length;
              return <div key={job.id} className="job-prog" onClick={() => setTab("tasks")} style={{ marginBottom: 14, cursor: "pointer" }}>
                <div className="flexb" style={{ marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>{job.name}</span>
                  <span className="muted">{jd}/{jt.length} · {pct}%{allDone ? " ✓" : ""}</span>
                </div>
                <div className="bar"><div className="bar-f" style={{ width: pct + "%", background: allDone ? "linear-gradient(90deg,#059669,var(--green))" : "linear-gradient(90deg,var(--sky-dim),var(--sky))" }} /></div>
              </div>;
            })
        }
      </div>
    </div>
  );
}

function AdminTasks(props) {
  const { tasks, setTasks, jobs, users, t, settings, statusFilter = "all", setStatusFilter } = props;
  const [jobFilter, setJobFilter] = useState("all");
  const [modal, setModal] = useState(false);
  const [nt, setNt] = useState({ title: "", titleEs: "", jobId: "", assignedTo: [], dueDate: "" });
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().split("T")[0];

  // Apply status filter first, then job filter
  const statusFiltered = tasks.filter(task => {
    if (statusFilter === "done")    return task.status === "done";
    if (statusFilter === "overdue") return task.status === "pending" && task.dueDate && task.dueDate < today;
    if (statusFilter === "pending") return task.status === "pending" && (!task.dueDate || task.dueDate >= today);
    return true;
  });
  const jobsWithTasks = jobs.filter(j => statusFiltered.some(t => t.jobId === j.id));
  const shown = jobFilter === "all" ? jobsWithTasks : jobsWithTasks.filter(j => j.id === jobFilter);

  const filterLabel = { all: "All Tasks", done: "Completed Only", pending: "Pending Only", overdue: "Overdue Only" };

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
    // Twilio SMS to each assigned crew member
    const jobName = jobs.find(j => j.id === nt.jobId)?.name || "";
    const appUrl = settings?.appUrl || window.location.origin;
    for (const crewId of nt.assignedTo) {
      const member = users.find(u => u.id === crewId);
      if (member?.phone) {
        const msg = `New task: "${nt.title}"\nJob: ${jobName}${nt.dueDate ? `\nDue: ${nt.dueDate}` : ""}\nOpen app: ${appUrl}`;
        fetch("/.netlify/functions/send-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: member.phone, body: msg }) }).catch(() => {});
      }
    }
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

      <div className="toolbar">
        <Icon n="filter" s={16} c="var(--silver)" />
        {statusFilter !== "all" && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700,
            background: statusFilter === "done" ? "rgba(16,185,129,.15)" : statusFilter === "overdue" ? "rgba(239,68,68,.15)" : "rgba(245,158,11,.15)",
            color: statusFilter === "done" ? "var(--green)" : statusFilter === "overdue" ? "var(--red)" : "var(--accent)" }}>
            {filterLabel[statusFilter]}
            <button onClick={() => setStatusFilter("all")} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, lineHeight: 1, fontSize: 14 }}>✕</button>
          </span>
        )}
        <select className="fi" style={{ width: "auto", padding: "8px 13px" }} value={jobFilter} onChange={e => setJobFilter(e.target.value)}>
          <option value="all">All Jobs</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select>
      </div>

      {shown.length === 0 && <div className="empty"><p>No {filterLabel[statusFilter].toLowerCase()} for the selected job.</p></div>}
      {shown.map(job => {
        const jt = statusFiltered.filter(t => t.jobId === job.id);
        if (!jt.length) return null;
        return <div key={job.id} className="jobsec">
          <div className="jobhead"><div><div className="jobname">{job.name}</div><MapAddr addr={job.address} /></div>
            <span className="tag-l">{jt.length} task{jt.length !== 1 ? "s" : ""}</span></div>
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

function AdminReceipts({ receipts, setReceipts, jobs, tasks, users, user }) {
  const [modal, setModal] = useState(false);
  const [nr, setNr] = useState({ jobId: "", taskId: "", crewId: "", store: "", amount: "", note: "", paidBy: "company", dataUrl: null });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const today = new Date().toISOString().split("T")[0];
  const jobTasks = tasks.filter(t => t.jobId === nr.jobId);

  const addReceipt = async () => {
    if (!nr.jobId || !nr.store || !nr.amount) return;
    setBusy(true);
    const id = "r" + Date.now();
    const receipt = { id, jobId: nr.jobId, taskId: nr.taskId || null, crewId: nr.crewId || user.id,
      dataUrl: nr.dataUrl, store: nr.store, amount: nr.amount, note: nr.note,
      paidBy: nr.paidBy, reimbursementStatus: nr.paidBy === "crew" ? "pending" : "na", createdAt: today };
    setReceipts(p => [...p, receipt]);
    const row = { id, job_id: nr.jobId, task_id: nr.taskId || null, crew_id: nr.crewId || user.id,
      data_url: nr.dataUrl, store: nr.store, amount: parseFloat(nr.amount) || 0, note: nr.note,
      paid_by: nr.paidBy, reimbursement_status: nr.paidBy === "crew" ? "pending" : "na" };
    try { await sbPost("field_receipts", row); } catch { enqueue({ table: "field_receipts", payload: row }); }
    setNr({ jobId: "", taskId: "", crewId: "", store: "", amount: "", note: "", paidBy: "company", dataUrl: null });
    setModal(false); setBusy(false);
  };

  const photoCapture = async e => {
    const file = e.target.files[0]; if (!file) return;
    const { dataUrl } = await compressImage(file, 1000, 0.6);
    setNr(p => ({ ...p, dataUrl }));
  };

  const markReimbursed = async (id) => {
    setReceipts(p => p.map(r => r.id === id ? { ...r, reimbursementStatus: "paid", reimbursementDate: today } : r));
    try { await sbPatch("field_receipts", id, { reimbursement_status: "paid", reimbursement_date: today }); } catch {}
  };

  const exportBills = () => {
    const payload = receipts.map(r => ({
      receipt_id: r.id, vendor: r.store || "", amount: +r.amount || 0,
      job_id: r.jobId, job_name: jobs.find(j => j.id === r.jobId)?.name || "",
      memo: r.note || "", receipt_date: r.createdAt,
      submitted_by: users.find(u => u.id === r.crewId)?.name || "Admin",
      image: r.dataUrl ? "[base64 attached]" : null, status: "pending_review",
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = "gsm-bills-export-" + today + ".json"; a.click(); URL.revokeObjectURL(url);
  };

  const pendingReimb = receipts.filter(r => r.paidBy === "crew" && r.reimbursementStatus !== "paid");
  const total = receipts.reduce((s, r) => s + (+r.amount || 0), 0);

  return (
    <div>
      <div className="flexb" style={{ marginBottom: 8 }}>
        <h2 className="h2">Receipts</h2>
        <div style={{ display: "flex", gap: 8 }}>
          {receipts.length > 0 && <button className="btn btn-s btn-sm" onClick={exportBills}><Icon n="receipt" s={14} /> Export for Bills</button>}
          <button className="btn btn-p" onClick={() => setModal(true)}><Icon n="plus" s={16} /> Add Receipt</button>
        </div>
      </div>

      {pendingReimb.length > 0 && (
        <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(249,115,22,.1)", border: "1px solid rgba(249,115,22,.3)", borderRadius: 10, color: "var(--orange)", fontSize: 13 }}>
          Crew reimbursement owed: <strong>${pendingReimb.reduce((s,r)=>s+(+r.amount||0),0).toFixed(2)}</strong> across {pendingReimb.length} receipt{pendingReimb.length!==1?"s":""}
        </div>
      )}

      {receipts.length === 0
        ? <div className="empty"><Icon n="receipt" s={48} c="var(--slate)" /><p>No receipts yet. Add one above or have crew capture in the field.</p></div>
        : <div className="card">
          <div className="flexb" style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
            <span className="muted">{receipts.length} receipt{receipts.length!==1?"s":""}</span>
            <span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 20, color: "var(--accent)" }}>${total.toFixed(2)}</span>
          </div>
          <div className="tbl-wrap"><table><thead><tr>
            <th>Date</th><th>By</th><th>Job</th><th>Vendor</th><th>Memo</th>
            <th>Paid By</th><th>Reimburse</th><th>Photo</th><th style={{ textAlign: "right" }}>Amount</th>
          </tr></thead>
          <tbody>{receipts.map(r => {
            const j=jobs.find(x=>x.id===r.jobId), cr=users.find(u=>u.id===r.crewId);
            const needsReimb=r.paidBy==="crew"&&r.reimbursementStatus!=="paid";
            return <tr key={r.id}>
              <td data-l="Date" className="muted">{r.createdAt}</td>
              <td data-l="By">{cr?.name||"Admin"}</td>
              <td data-l="Job"><span className="tag-l" style={{ fontSize: 11 }}>{j?.name}</span></td>
              <td data-l="Vendor">{r.store}</td>
              <td data-l="Memo" className="muted">{r.note}</td>
              <td data-l="Paid By"><span className={"tag " + (r.paidBy==="crew"?"tag-overdue":"tag-done")}>{r.paidBy==="crew"?"Crew":"Company"}</span></td>
              <td data-l="Reimburse">{r.paidBy==="crew"
                ?needsReimb
                  ?<button className="btn btn-sm" style={{ background:"rgba(249,115,22,.15)",color:"var(--orange)",padding:"4px 10px",fontSize:11,border:"1px solid rgba(249,115,22,.4)" }} onClick={()=>markReimbursed(r.id)}>Mark Paid</button>
                  :<span className="tag tag-done">Reimbursed</span>
                :<span className="muted">—</span>}</td>
              <td data-l="Photo">{r.dataUrl?<img src={r.dataUrl} alt="rcpt" style={{ width:40,height:40,objectFit:"cover",borderRadius:6 }} />:<span className="muted">—</span>}</td>
              <td data-l="Amount" style={{ textAlign:"right",fontWeight:700,color:needsReimb?"var(--orange)":"var(--accent)" }}>${(+r.amount).toFixed(2)}</td>
            </tr>;
          })}</tbody></table></div>
        </div>
      }

      {modal && <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setModal(false)}>
        <div className="modal"><div className="mt">Add Receipt</div>
          <div className="grid2">
            <div className="fg"><label className="fl">Job</label>
              <select className="fi" value={nr.jobId} onChange={e=>setNr(p=>({...p,jobId:e.target.value,taskId:""}))}>
                <option value="">Select Job</option>{jobs.filter(j=>j.status!=="closed").map(j=><option key={j.id} value={j.id}>{j.name}</option>)}</select></div>
            <div className="fg"><label className="fl">Task (optional)</label>
              <select className="fi" value={nr.taskId} onChange={e=>setNr(p=>({...p,taskId:e.target.value}))} disabled={!nr.jobId}>
                <option value="">General / No task</option>{jobTasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></div>
          </div>
          <div className="fg"><label className="fl">Submitted By</label>
            <select className="fi" value={nr.crewId} onChange={e=>setNr(p=>({...p,crewId:e.target.value}))}>
              <option value="">Admin (me)</option>
              {users.filter(u=>u.role==="crew").map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
            </select></div>
          <div className="grid2">
            <div className="fg"><label className="fl">Vendor / Store</label>
              <input className="fi" value={nr.store} onChange={e=>setNr(p=>({...p,store:e.target.value}))} placeholder="Home Depot" /></div>
            <div className="fg"><label className="fl">Amount ($)</label>
              <input className="fi" type="number" value={nr.amount} onChange={e=>setNr(p=>({...p,amount:e.target.value}))} placeholder="0.00" /></div>
          </div>
          <div className="fg"><label className="fl">Notes / Memo</label>
            <input className="fi" value={nr.note} onChange={e=>setNr(p=>({...p,note:e.target.value}))} placeholder="What was purchased" /></div>
          <div className="fg"><label className="fl">Who Paid?</label>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
              <button className={"btn btn-sm " + (nr.paidBy==="company"?"btn-p":"btn-s")} onClick={()=>setNr(p=>({...p,paidBy:"company"}))}>Company Card</button>
              <button className={"btn btn-sm " + (nr.paidBy==="crew"?"btn-a":"btn-s")} onClick={()=>setNr(p=>({...p,paidBy:"crew"}))}>Crew Paid — Needs Reimbursement</button>
            </div></div>
          <div className="fg"><label className="fl">Receipt Photo (optional)</label>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={photoCapture} />
            {nr.dataUrl
              ?<div style={{ display:"flex",gap:10,alignItems:"center" }}>
                  <img src={nr.dataUrl} alt="receipt" style={{ width:64,height:64,objectFit:"cover",borderRadius:8 }} />
                  <button className="btn btn-s btn-sm" onClick={()=>setNr(p=>({...p,dataUrl:null}))}>Remove</button>
                </div>
              :<div style={{ display:"flex",gap:8 }}>
                  <button className="btn btn-s btn-sm" onClick={()=>fileRef.current?.click()}><Icon n="camera" s={14} /> Take Photo</button>
                  <button className="btn btn-s btn-sm" onClick={()=>{fileRef.current?.removeAttribute("capture");fileRef.current?.click();}}><Icon n="photo" s={14} /> From Library</button>
                </div>
            }</div>
          <div className="macts">
            <button className="btn btn-s" onClick={()=>setModal(false)}>Cancel</button>
            <button className="btn btn-p" onClick={addReceipt} disabled={busy||!nr.jobId||!nr.store||!nr.amount}>
              {busy?<span className="spin" />:<><Icon n="check" s={14} /> Save Receipt</>}
            </button>
          </div>
        </div>
      </div>}
    </div>
  );
}


function AdminPhotos({ photos, setPhotos, tasks, jobs, users, user }) {
  const [jobFilter, setJobFilter] = useState("all");
  const [uploadJob, setUploadJob] = useState("");
  const [uploadTask, setUploadTask] = useState("");
  const [uploadType, setUploadType] = useState("progress");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0); // count saved this session for this job
  const fileRef = useRef();

  const jobTasks = tasks.filter(t => t.jobId === uploadJob);
  const sessionPhotos = photos.filter(p => p.jobId === uploadJob);

  const upload = async e => {
    const file = e.target.files[0];
    if (!file || !uploadJob) return;
    setBusy(true);
    const { dataUrl, sizeKB } = await compressImage(file);
    const id = "p" + Date.now();
    const photo = { id, dataUrl, type: uploadType, taskId: uploadTask || null, jobId: uploadJob, crewId: user.id, sizeKB, date: new Date().toISOString() };
    setPhotos(p => [...p, photo]);
    const row = { id, data_url: dataUrl, photo_type: uploadType, task_id: uploadTask || null, job_id: uploadJob, crew_id: user.id, size_kb: sizeKB };
    try { await sbPost("field_photos", row); } catch { enqueue({ table: "field_photos", payload: row }); }
    e.target.value = "";
    setSaved(s => s + 1);
    setBusy(false);
  };

  const nextJob = () => {
    setUploadJob(""); setUploadTask(""); setUploadType("progress"); setSaved(0);
    fileRef.current && (fileRef.current.value = "");
  };

  const shown = jobFilter === "all" ? photos : photos.filter(p => p.jobId === jobFilter);
  const byJob = jobs.filter(j => shown.some(p => p.jobId === j.id));

  return (
    <div>
      <div className="flexb" style={{ marginBottom: 20 }}>
        <h2 className="h2">Photos</h2>
        <span className="muted" style={{ fontSize: 13 }}>{photos.length} total</span>
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <div className="ct">Add Photo</div>
        <div className="grid2">
          <div className="fg"><label className="fl">Job</label>
            <select className="fi" value={uploadJob} onChange={e => { setUploadJob(e.target.value); setUploadTask(""); }}>
              <option value="">Select Job</option>
              {jobs.filter(j => j.status !== "closed").map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select></div>
          <div className="fg"><label className="fl">Task (optional)</label>
            <select className="fi" value={uploadTask} onChange={e => setUploadTask(e.target.value)} disabled={!uploadJob}>
              <option value="">General / No task</option>
              {jobTasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select></div>
        </div>
        <div className="fg"><label className="fl">Photo Type</label>
          <div style={{ display: "flex", gap: 8 }}>
            {["before", "progress", "after"].map(x => (
              <button key={x} className={"btn btn-sm " + (uploadType === x ? "btn-p" : "btn-s")} onClick={() => setUploadType(x)}
                style={{ textTransform: "capitalize" }}>{x}</button>
            ))}
          </div></div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={upload} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-p" disabled={!uploadJob || busy} onClick={() => { fileRef.current?.setAttribute("capture","environment"); fileRef.current?.click(); }}>
            {busy ? <span className="spin" /> : <><Icon n="camera" s={16} /> Take Photo</>}</button>
          <button className="btn btn-s" disabled={!uploadJob || busy} onClick={() => { fileRef.current?.removeAttribute("capture"); fileRef.current?.click(); }}>
            <Icon n="photo" s={16} /> From Library</button>
          {saved > 0 && (
            <button className="btn btn-g btn-sm" onClick={nextJob}>
              <Icon n="check" s={14} /> Done with this job — Next Job
            </button>
          )}
        </div>
        {!uploadJob && <p style={{ fontSize: 11, color: "var(--orange)", marginTop: 8 }}>Select a job first</p>}
        {saved > 0 && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, color: "var(--green)", marginBottom: 8, fontWeight: 600 }}>
              ✓ {saved} photo{saved !== 1 ? "s" : ""} saved for {jobs.find(j => j.id === uploadJob)?.name}
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {sessionPhotos.slice(-6).map((p, i) => (
                <div key={i} style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", position: "relative", border: "2px solid var(--green)" }}>
                  <img src={p.dataUrl} alt={p.type} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,.6)", fontSize: 9, textAlign: "center", color: "#fff", padding: "1px 0" }}>{p.type}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="toolbar">
        <Icon n="filter" s={16} c="var(--silver)" />
        <select className="fi" style={{ width: "auto", padding: "8px 13px" }} value={jobFilter} onChange={e => setJobFilter(e.target.value)}>
          <option value="all">All Jobs</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
      </div>

      {shown.length === 0
        ? <div className="empty"><Icon n="photo" s={48} c="var(--slate)" /><p>No photos yet. Add one above or have crew capture in the field.</p></div>
        : byJob.map(job => {
            const jp = shown.filter(p => p.jobId === job.id);
            return (
              <div key={job.id} className="card" style={{ marginBottom: 16 }}>
                <div className="ct" style={{ marginBottom: 12 }}>{job.name} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({jp.length} photo{jp.length !== 1 ? "s" : ""})</span></div>
                <div className="pgrid">
                  {jp.map((p, i) => {
                    const who = users.find(u => u.id === p.crewId);
                    return (
                      <div key={i} className="pthumb" title={(who?.name || "Admin") + " · " + (p.date || "").slice(0, 10)}>
                        {p.dataUrl ? <img src={p.dataUrl} alt={p.type} /> : <Icon n="camera" s={28} c="var(--slate)" />}
                        <div className="plabel" style={{ color: p.type === "before" ? "var(--orange)" : p.type === "after" ? "var(--green)" : "var(--sky2)" }}>
                          {p.type}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
      }
    </div>
  );
}


function Jobs({ jobs, setJobs, tasks }) {
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [syncConfirm, setSyncConfirm] = useState(null);
  const [nj, setNj] = useState({ name: "", street: "", city: "", state: "AL", gsmSync: false });
  const [showClosed, setShowClosed] = useState(false);

  const add = async () => {
    if (!nj.name || !nj.street) return;
    const id = "j" + Date.now();
    const address = [nj.street, nj.city, nj.state].filter(Boolean).join(", ");
    const job = { id, name: nj.name, address, status: "active", gsmSync: nj.gsmSync, gsmJobId: null };
    setJobs(p => [...p, job]); setNj({ name: "", street: "", city: "", state: "AL", gsmSync: false }); setModal(false);
    try { await sbPost("field_jobs", { id, name: nj.name, address, status: "active", gsm_sync: nj.gsmSync }); }
    catch { enqueue({ table: "field_jobs", payload: { id, name: nj.name, address, status: "active", gsm_sync: nj.gsmSync } }); }
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
            <MapAddr addr={job.address} cls="muted" />
            <div className="flexb" style={{ marginBottom: job.gsmSync ? 8 : 12 }}>
              <SyncBadge job={job} />
              <span className="muted" style={{ fontSize: 12 }}>{s.done}/{s.total} tasks</span>
            </div>
            {job.gsmSync && (
              <div style={{ marginBottom: 12, padding: "8px 10px", background: "rgba(16,185,129,.08)", borderRadius: 8, border: "1px solid rgba(16,185,129,.2)" }}>
                <label style={{ fontSize: 10, color: "var(--green)", display: "block", marginBottom: 4, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>GSM Builder Job ID</label>
                <input className="fi" style={{ padding: "6px 10px", fontSize: 12 }}
                  placeholder="JOB-001" defaultValue={job.gsmJobId || ""}
                  onBlur={async e => {
                    const val = e.target.value.trim().toUpperCase();
                    if (val === (job.gsmJobId || "")) return;
                    setJobs(p => p.map(j => j.id === job.id ? { ...j, gsmJobId: val } : j));
                    try { await sbPatch("field_jobs", job.id, { gsm_job_id: val || null }); } catch {}
                  }} />
                <div style={{ fontSize: 10, color: job.gsmJobId ? "var(--green)" : "var(--silver)", marginTop: 4 }}>
                  {job.gsmJobId ? "Linked to GSM Builder " + job.gsmJobId : "Enter the Job ID from GSM Builder (e.g. JOB-001)"}
                </div>
              </div>
            )}
            {s.total > 0 && <div style={{ marginBottom: 12 }}>
              <div className="bar"><div className="bar-f" style={{ width: (s.total ? Math.round(s.done/s.total*100) : 0) + "%", background: allDone ? "linear-gradient(90deg,#059669,var(--green))" : "linear-gradient(90deg,var(--sky-dim),var(--sky))" }} /></div>
              <div style={{ fontSize: 11, color: "var(--silver)", marginTop: 4 }}>{s.done}/{s.total} tasks complete</div>
            </div>}
            {s.total === 0 && <div style={{ fontSize: 12, color: "var(--slate)", marginBottom: 12 }}>No tasks added yet</div>}
            {allDone
              ? <button className="btn btn-g btn-sm btn-full" onClick={() => setConfirm(job)}><Icon n="check" s={13} /> All Done — Close Job</button>
              : <div style={{ fontSize: 11, color: "var(--slate)", textAlign: "center", padding: "8px 0" }}>Complete all tasks to close this job</div>
            }</div>; })}
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
            <input className="fi" value={nj.name} onChange={e => setNj(p => ({ ...p, name: e.target.value }))} placeholder="Henderson Residence" /></div>
          <div className="fg"><label className="fl">Street Address</label>
            <input className="fi" value={nj.street} onChange={e => setNj(p => ({ ...p, street: e.target.value }))} placeholder="123 Oak Ridge Drive" /></div>
          <div className="grid2">
            <div className="fg"><label className="fl">City</label>
              <input className="fi" value={nj.city} onChange={e => setNj(p => ({ ...p, city: e.target.value }))} placeholder="Chelsea" /></div>
            <div className="fg"><label className="fl">State</label>
              <input className="fi" value={nj.state} onChange={e => setNj(p => ({ ...p, state: e.target.value }))} placeholder="AL" style={{ maxWidth: 80 }} /></div>
          </div>
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

function CrewMgmt({ users, tasks, setActive, addUser, updateUser, removeUser, archiveCrew, unarchiveCrew, settings }) {
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
      <p className="muted" style={{ marginBottom: 18, fontSize: 13 }}>Add a member to generate their login + invite. Deactivate blocks access immediately. Archive moves them out of active crew but keeps all their records for bookkeeping.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 14 }}>
        {users.filter(u => u.role === "crew" && !u.archived).map(m => { const mt = tasks.filter(t => (Array.isArray(t.assignedTo) ? t.assignedTo.includes(m.id) : t.assignedTo === m.id)), done = mt.filter(t => t.status === "done").length;
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
            <div style={{ display: "flex", gap: 6 }}>
              <button className={`btn btn-sm ${active ? "btn-s" : "btn-g"}`} style={{ flex: 1 }} onClick={() => setActive(m.id, !active)}>
                <Icon n={active ? "lock" : "power"} s={13} /> {active ? "Deactivate" : "Reactivate"}
              </button>
              <button className="btn btn-sm btn-s" title="Archive — removes from active crew, keeps all records" onClick={() => archiveCrew(m.id)}
                style={{ padding: "8px 10px", color: "var(--slate)" }}>📦</button>
            </div>
          </div>; })}</div>

      {/* ── Archived crew ── */}
      {users.filter(u => u.role === "crew" && u.archived).length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 14, fontWeight: 700, color: "var(--slate)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
            📦 Archived Crew — kept for bookkeeping, no app access
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 10 }}>
            {users.filter(u => u.role === "crew" && u.archived).map(m => (
              <div key={m.id} className="card" style={{ borderTop: "4px solid var(--slate)", opacity: .7 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(100,116,139,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 16 }}>{m.name[0]}</div>
                  <div><div style={{ fontWeight: 700 }}>{m.name}</div><div className="muted" style={{ fontSize: 12 }}>{m.email}</div></div>
                </div>
                <span className="tag" style={{ background: "rgba(100,116,139,.15)", color: "var(--slate)", marginBottom: 10, display: "inline-block" }}>archived</span>
                <button className="btn btn-s btn-sm btn-full" onClick={() => unarchiveCrew(m.id)}>
                  <Icon n="power" s={13} /> Restore to Active
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
          <div className="macts" style={{ flexWrap: "wrap", gap: 8 }}>
            <button className="btn btn-s" onClick={() => setInvite(null)}>Close</button>
            <button className="btn btn-p" onClick={() => { navigator.clipboard?.writeText(inviteText(invite)); }}><Icon n="check" s={14} /> Copy</button>
            <button className="btn btn-g" onClick={async () => {
              if (!invite.phone) { alert("No phone on file for this crew member."); return; }
              const res = await fetch("/.netlify/functions/send-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: invite.phone, body: inviteText(invite) }) });
              const d = await res.json();
              alert(d.ok ? "✓ Text sent via Twilio!" : "SMS failed — check Twilio env vars in Netlify.");
            }}><Icon n="translate" s={14} /> Text (Twilio)</button>
            <a className="btn btn-s" href={`mailto:${invite.email}?subject=${encodeURIComponent("GS Masters Field App — Your Login")}&body=${encodeURIComponent(inviteText(invite))}`} style={{ textDecoration: "none" }}>✉ Email</a>
          </div></div></div>}

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
  const [f, setF] = useState({ gtKey: settings.gtKey || "", reminder: settings.reminder || "17:00", appUrl: settings.appUrl || "https://quiet-seahorse-2ba028.netlify.app" });
  const [saved, setSaved] = useState(false);

  const save = async () => {
    saveSettings(f);
    // Persist to Supabase so it survives browser clears
    try {
      await sbPost("field_integration_settings", { id: 1, app_url: f.appUrl, gt_key: f.gtKey, reminder_time: f.reminder });
    } catch {
      try { await sbFetch("field_integration_settings?id=eq.1", { method: "PATCH", body: JSON.stringify({ app_url: f.appUrl, gt_key: f.gtKey, reminder_time: f.reminder }), prefer: "return=minimal" }); } catch {}
    }
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const StatusRow = ({ label, value, color = "var(--green)" }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 11, color: "var(--silver)", fontFamily: "monospace" }}>{value}</span>
    </div>
  );

  return (
    <div><h2 className="h2" style={{ marginBottom: 20 }}>Settings</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 16, fontWeight: 700, color: "var(--sky2)", letterSpacing: 1, marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>Infrastructure — Already Configured</div>
        <StatusRow label="Supabase Database" value="mkibgjnzbgfqjkhowafr.supabase.co" />
        <StatusRow label="Twilio SMS" value="Credentials in Netlify env vars" />
        <StatusRow label="Daily Reminder" value="5:00 PM Central — Netlify cron" />
        <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>These are hardcoded at the server level. No entry needed here.</p>
      </div>

      <div className="card">
        <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 16, fontWeight: 700, color: "var(--sky2)", letterSpacing: 1, marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>Optional Settings</div>
        <div className="fg">
          <label className="fl">App URL — used in crew invite text messages</label>
          <input className="fi" value={f.appUrl} onChange={e => setF(p => ({ ...p, appUrl: e.target.value }))} placeholder="https://quiet-seahorse-2ba028.netlify.app" />
        </div>
        <div className="fg">
          <label className="fl">Google Translate API Key — auto-translates tasks to Spanish</label>
          <input className="fi" type="password" value={f.gtKey} onChange={e => setF(p => ({ ...p, gtKey: e.target.value }))} placeholder="AIzaSy... (optional)" />
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Without this, Spanish translations must be typed manually. Get free key at console.cloud.google.com → Translate API.</p>
        </div>
        <button className="btn btn-p" onClick={save} style={{ minWidth: 140 }}>{saved ? <><Icon n="check" s={16} /> Saved!</> : "Save Settings"}</button>
      </div>
    </div>
  );
}

// ─── ADMIN HOURS ──────────────────────────────────────────────────────
function AdminHours({ jobs, users }) {
  const [checkins, setCheckins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState(7); // days back
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const since = new Date(Date.now() - dateRange * 86400000).toISOString().split("T")[0];
      const rows = await sbGet("field_checkins", `work_date=gte.${since}&order=work_date.desc,check_in.desc`);
      if (rows) setCheckins(rows.map(fromCheckin));
    } catch {}
    setLoading(false); setRefreshing(false);
  };

  useEffect(() => { load(); }, [dateRange]);

  const crewName = id => users.find(u => u.id === id)?.name || "Unknown";
  const jobName  = id => jobs.find(j => j.id === id)?.name  || id;
  const fmt = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

  // Summary: total hours per crew per job
  const summary = {};
  checkins.filter(c => c.checkOut).forEach(c => {
    const key = `${c.crewId}|${c.jobId}`;
    if (!summary[key]) summary[key] = { crewId: c.crewId, jobId: c.jobId, hours: 0, days: new Set() };
    summary[key].hours += +(c.hours || 0);
    summary[key].days.add(c.date);
  });
  const summaryRows = Object.values(summary).sort((a, b) => b.hours - a.hours);
  const totalHours = summaryRows.reduce((s, r) => s + r.hours, 0);
  const openCount  = checkins.filter(c => !c.checkOut).length;

  return (
    <div>
      <div className="flexb" style={{ marginBottom: 20 }}>
        <h2 className="h2">Hours Tracking</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="fi" style={{ width: "auto", padding: "8px 12px" }} value={dateRange} onChange={e => setDateRange(+e.target.value)}>
            <option value={1}>Today</option>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button className="btn btn-s btn-sm" onClick={load} disabled={refreshing}>{refreshing ? <span className="spin" /> : "↻ Refresh"}</button>
        </div>
      </div>

      {openCount > 0 && (
        <div style={{ padding: "10px 14px", background: "rgba(16,185,129,.12)", border: "1px solid rgba(16,185,129,.25)", borderRadius: 10, marginBottom: 16, fontSize: 13, color: "var(--green)", fontWeight: 600 }}>
          ● {openCount} worker{openCount !== 1 ? "s" : ""} currently clocked in
        </div>
      )}

      {/* Summary cards */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="ct">Summary — {dateRange === 1 ? "Today" : `Last ${dateRange} days`} &nbsp;<span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({totalHours.toFixed(1)} total hrs)</span></div>
        {summaryRows.length === 0
          ? <div className="empty" style={{ padding: "20px 0" }}><p>No completed check-ins in this period.</p></div>
          : <div className="tbl-wrap"><table><thead><tr><th>Crew</th><th>Job</th><th>Days</th><th style={{ textAlign: "right" }}>Hours</th></tr></thead>
            <tbody>{summaryRows.map((r, i) => (
              <tr key={i}>
                <td data-l="Crew">{crewName(r.crewId)}</td>
                <td data-l="Job"><span className="tag-l" style={{ fontSize: 11 }}>{jobName(r.jobId)}</span></td>
                <td data-l="Days" className="muted">{r.days.size}</td>
                <td data-l="Hours" style={{ textAlign: "right", fontWeight: 700, color: "var(--accent)", fontFamily: "'Barlow Condensed'", fontSize: 16 }}>{r.hours.toFixed(1)}</td>
              </tr>
            ))}</tbody></table></div>
        }
      </div>

      {/* Raw log */}
      <div className="card">
        <div className="ct">Check-in Log</div>
        {loading ? <div style={{ padding: 20, textAlign: "center" }}><span className="spin" style={{ width: 24, height: 24, display: "inline-block" }} /></div>
          : checkins.length === 0 ? <div className="empty" style={{ padding: "20px 0" }}><p>No check-ins found.</p></div>
          : <div className="tbl-wrap"><table><thead><tr><th>Date</th><th>Crew</th><th>Job</th><th>In</th><th>Out</th><th style={{ textAlign: "right" }}>Hours</th></tr></thead>
            <tbody>{checkins.map(c => (
              <tr key={c.id}>
                <td data-l="Date" className="muted" style={{ whiteSpace: "nowrap" }}>{c.date}</td>
                <td data-l="Crew">{crewName(c.crewId)}</td>
                <td data-l="Job"><span className="tag-l" style={{ fontSize: 11 }}>{jobName(c.jobId)}</span></td>
                <td data-l="In" style={{ whiteSpace: "nowrap" }}>{fmt(c.checkIn)}</td>
                <td data-l="Out" style={{ whiteSpace: "nowrap", color: c.checkOut ? "inherit" : "var(--green)", fontWeight: c.checkOut ? 400 : 700 }}>
                  {c.checkOut ? fmt(c.checkOut) : "● On site"}
                </td>
                <td data-l="Hours" style={{ textAlign: "right", fontWeight: 700, color: c.checkOut ? "var(--accent)" : "var(--green)", fontFamily: "'Barlow Condensed'", fontSize: 15 }}>
                  {c.checkOut ? (+(c.hours||0)).toFixed(1) : "..."}
                </td>
              </tr>
            ))}</tbody></table></div>
        }
      </div>
    </div>
  );
}

// ─── ADMIN LIVE ACTIVITY ──────────────────────────────────────────────
function AdminActivity({ jobs, tasks, users, logs: initLogs, photos: initPhotos, receipts: initReceipts, setTasks, setLogs, setPhotos, setReceipts }) {
  const [logs,     setLocalLogs]     = useState(initLogs);
  const [photos,   setLocalPhotos]   = useState(initPhotos);
  const [receipts, setLocalReceipts] = useState(initReceipts);
  const [localTasks, setLocalTasks]  = useState(tasks);
  const [refreshing, setRefreshing]  = useState(false);
  const [lastAt, setLastAt]          = useState(new Date());

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [dbTasks, dbLogs, dbPhotos, dbReceipts] = await Promise.all([
        sbGet("field_tasks",    "order=created_at"),
        sbGet("field_logs",     "order=created_at.desc"),
        sbGet("field_photos",   "order=created_at.desc"),
        sbGet("field_receipts", "order=created_at.desc"),
      ]);
      if (dbTasks)    { setLocalTasks(dbTasks.map(fromTask));       setTasks(dbTasks.map(fromTask)); }
      if (dbLogs)     { setLocalLogs(dbLogs.map(fromLog));           setLogs(dbLogs.map(fromLog)); }
      if (dbPhotos)   { setLocalPhotos(dbPhotos.map(fromPhoto));     setPhotos(dbPhotos.map(fromPhoto)); }
      if (dbReceipts) { setLocalReceipts(dbReceipts.map(fromReceipt)); setReceipts(dbReceipts.map(fromReceipt)); }
      setLastAt(new Date());
    } catch {}
    setRefreshing(false);
  }, [setTasks, setLogs, setPhotos, setReceipts]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 30000);
    return () => clearInterval(iv);
  }, [refresh]);

  const activeJobs = jobs.filter(j => j.status !== "closed");
  const typeColor = k => ({ before:"var(--orange)", after:"var(--green)", concern:"var(--red)", progress:"var(--sky2)" })[k] || "var(--sky2)";
  const typeLabel = k => ({ before:"Before", after:"After", concern:"Concern", progress:"Concern" })[k] || k;

  const jobActivity = (job) => {
    const items = [];
    localLogs.filter(l => l.jobId === job.id).forEach(l => {
      items.push({ ts: l.date, type: "log", data: l });
    });
    photos.filter(p => p.jobId === job.id).forEach(p => {
      items.push({ ts: (p.date || "").slice(0,10), type: "photo", data: p });
    });
    receipts.filter(r => r.jobId === job.id).forEach(r => {
      items.push({ ts: r.createdAt, type: "receipt", data: r });
    });
    return items.sort((a, b) => b.ts.localeCompare(a.ts));
  };

  const crewName = id => users.find(u => u.id === id)?.name || "Crew";
  const taskPct  = job => { const jt = localTasks.filter(t => t.jobId === job.id); return jt.length ? `${jt.filter(t=>t.status==="done").length}/${jt.length}` : "0 tasks"; };

  return (
    <div>
      <div className="flexb" style={{ marginBottom: 20 }}>
        <h2 className="h2">Live Activity</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--slate)" }}>Updated {lastAt.toLocaleTimeString()}</span>
          <button className="btn btn-s btn-sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? <span className="spin" /> : "↻ Refresh"}
          </button>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--green)", fontWeight: 600 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", animation: "pulse 2s infinite", display: "inline-block" }} /> Live (30s)
          </span>
        </div>
      </div>

      {activeJobs.map(job => {
        const activity = jobActivity(job);
        const jt = localTasks.filter(t => t.jobId === job.id);
        const done = jt.filter(t => t.status === "done").length;
        const pct = jt.length ? Math.round(done / jt.length * 100) : 0;
        return (
          <div key={job.id} className="card" style={{ marginBottom: 20 }}>
            <div className="flexb" style={{ marginBottom: 10 }}>
              <div>
                <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 20, fontWeight: 800 }}>{job.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>{job.address}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 700, color: pct === 100 ? "var(--green)" : "var(--sky2)" }}>{done}/{jt.length} tasks · {pct}%</div>
                <div className="bar" style={{ width: 120, marginTop: 4 }}><div className="bar-f" style={{ width: pct+"%", background: pct===100?"linear-gradient(90deg,#059669,var(--green))":"linear-gradient(90deg,var(--sky-dim),var(--sky))" }} /></div>
              </div>
            </div>

            {/* Task completion grid */}
            {jt.length > 0 && (
              <div style={{ marginBottom: 14, padding: "10px 12px", background: "rgba(0,0,0,.2)", borderRadius: 10 }}>
                {jt.map(task => (
                  <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,.03)" }}>
                    <span style={{ fontSize: 14 }}>{task.status === "done" ? "✅" : "⬜"}</span>
                    <span style={{ flex: 1, fontSize: 13, textDecoration: task.status === "done" ? "line-through" : "none", opacity: task.status === "done" ? .6 : 1 }}>{task.title}</span>
                    <span style={{ fontSize: 11, color: "var(--silver)" }}>{(task.assignedTo||[]).map(id=>users.find(u=>u.id===id)?.name?.split(" ")[0]).filter(Boolean).join(", ")}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Activity timeline */}
            {activity.length === 0
              ? <div className="empty" style={{ padding: "16px 0" }}><p style={{ fontSize: 13 }}>No activity yet for this job.</p></div>
              : activity.map((item, i) => {
                if (item.type === "log") {
                  const l = item.data;
                  const isCompletion = l.en?.startsWith("Completed:");
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{isCompletion ? "✅" : "📝"}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: isCompletion ? "var(--green)" : "var(--white)" }}>{l.en}</div>
                        {l.es && l.es !== l.en && <div style={{ fontSize: 12, color: "var(--sky2)", fontStyle: "italic" }}>{l.es}</div>}
                        <div style={{ fontSize: 11, color: "var(--slate)", marginTop: 2 }}>{crewName(l.crewId)} · {l.date}{l.weather ? ` · ${l.weather}` : ""}</div>
                      </div>
                    </div>
                  );
                }
                if (item.type === "photo") {
                  const p = item.data;
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.04)", alignItems: "center" }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>📷</span>
                      {p.dataUrl && <img src={p.dataUrl} alt={p.type} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: `2px solid ${typeColor(p.type)}`, flexShrink: 0 }} />}
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: typeColor(p.type), textTransform: "uppercase", letterSpacing: 1 }}>{typeLabel(p.type)} Photo</span>
                        <div style={{ fontSize: 11, color: "var(--slate)", marginTop: 2 }}>{crewName(p.crewId)} · {(p.date||"").slice(0,10)}</div>
                      </div>
                    </div>
                  );
                }
                if (item.type === "receipt") {
                  const r = item.data;
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.04)", alignItems: "center" }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>🧾</span>
                      {r.dataUrl && <img src={r.dataUrl} alt="receipt" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{r.store} <span style={{ color: "var(--accent)", fontFamily: "'Barlow Condensed'", fontSize: 16 }}>${(+r.amount).toFixed(2)}</span></div>
                        {r.note && <div style={{ fontSize: 12, color: "var(--silver)" }}>{r.note}</div>}
                        <div style={{ fontSize: 11, color: "var(--slate)", marginTop: 2 }}>{crewName(r.crewId)} · {r.createdAt}
                          {r.paidBy === "crew" && <span style={{ marginLeft: 8, color: r.reimbursementStatus === "paid" ? "var(--green)" : "var(--orange)", fontWeight: 700 }}>
                            {r.reimbursementStatus === "paid" ? "✓ Reimbursed" : "⚠ Needs Reimbursement"}
                          </span>}
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })
            }
          </div>
        );
      })}
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
  const { user, tasks, setTasks, jobs, lang, t, settings, photos, setPhotos, receipts, setReceipts, logs, setLogs } = props;
  const closedJobIds = new Set(jobs.filter(j => j.status === "closed").map(j => j.id));
  const my = tasks.filter(t => (Array.isArray(t.assignedTo) ? t.assignedTo.includes(user.id) : t.assignedTo === user.id) && !closedJobIds.has(t.jobId));
  const today = new Date().toISOString().split("T")[0];
  const [checkedJob, setCheckedJob] = useState(null);
  const [gps, setGps] = useState(null);
  const [matModal, setMatModal] = useState(null);
  const [mat, setMat] = useState("");
  // Job-level quick actions
  const [activePanel, setActivePanel] = useState(null); // { jobId, type: 'photo'|'receipt'|'issue' }
  const [photoType, setPhotoType] = useState("before");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoSuccess, setPhotoSuccess] = useState(null); // jobId of last saved
  const [rcForm, setRcForm] = useState({ store: "", amount: "", note: "", paidBy: "crew", dataUrl: null });
  const [rcBusy, setRcBusy] = useState(false);
  const [issueText, setIssueText] = useState(""); const [issueDataUrl, setIssueDataUrl] = useState(null); const [issueBusy, setIssueBusy] = useState(false);
  const issuePhotoRef = useRef();
  const photoRef = useRef();
  const rcPhotoRef = useRef();

  const PHOTO_TYPES = [
    { k: "before",  l: t.before,  c: "var(--orange)" },
    { k: "after",   l: t.after,   c: "var(--green)"  },
    { k: "concern", l: t.concern, c: "var(--red)"    },
  ];

  const togglePanel = (jobId, type) => {
    if (activePanel?.jobId === jobId && activePanel?.type === type) {
      setActivePanel(null);
    } else {
      setActivePanel({ jobId, type });
      if (type === "receipt") setRcForm({ store: "", amount: "", note: "", paidBy: "crew", dataUrl: null });
    }
  };

  const captureJobPhoto = async (e) => {
    const file = e.target.files[0]; if (!file || !activePanel) return;
    setPhotoBusy(true);
    const { dataUrl, sizeKB } = await compressImage(file);
    const id = "p" + Date.now();
    const jobId = activePanel.jobId;
    const dbType = photoType === "concern" ? "progress" : photoType;
    const photo = { id, dataUrl, type: photoType, taskId: null, jobId, crewId: user.id, sizeKB, date: new Date().toISOString() };
    setPhotos(p => [...p, photo]);
    const row = { id, data_url: dataUrl, photo_type: dbType, task_id: null, job_id: jobId, crew_id: user.id, size_kb: sizeKB };
    try { await sbPost("field_photos", row); } catch { enqueue({ table: "field_photos", payload: row }); }
    e.target.value = "";
    setPhotoBusy(false);
    setActivePanel(null);
    setPhotoSuccess(jobId);
    setTimeout(() => setPhotoSuccess(null), 3000);
  };

  const captureRcPhoto = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const { dataUrl } = await compressImage(file, 1000, 0.6);
    setRcForm(p => ({ ...p, dataUrl }));
    e.target.value = "";
  };

  const submitJobReceipt = async (jobId) => {
    if (!rcForm.store || !rcForm.amount) return;
    setRcBusy(true);
    const id = "r" + Date.now();
    const receipt = { id, dataUrl: rcForm.dataUrl, taskId: null, jobId, crewId: user.id, store: rcForm.store, amount: rcForm.amount, note: rcForm.note, paidBy: rcForm.paidBy, reimbursementStatus: rcForm.paidBy === "crew" ? "pending" : "na", createdAt: today };
    setReceipts(p => [...p, receipt]);
    const row = { id, data_url: rcForm.dataUrl, task_id: null, job_id: jobId, crew_id: user.id, store: rcForm.store, amount: parseFloat(rcForm.amount) || 0, note: rcForm.note, paid_by: rcForm.paidBy, reimbursement_status: rcForm.paidBy === "crew" ? "pending" : "na" };
    try { await sbPost("field_receipts", row); } catch { enqueue({ table: "field_receipts", payload: row }); }
    // GSM Builder sync
    const job = jobs.find(j => j.id === jobId);
    if (job?.gsmSync && job?.gsmJobId) {
      fetch("/.netlify/functions/gsm-sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "receipt", gsmJobId: job.gsmJobId, data: receipt }),
      }).catch(() => {});
    }
    // Twilio notify admin of crew receipt
    if (rcForm.paidBy === "crew") {
      const msg = `[Field App] ${user.name} submitted a receipt needing reimbursement: ${rcForm.store} $${parseFloat(rcForm.amount).toFixed(2)} — ${job?.name || jobId}`;
      fetch("/.netlify/functions/send-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: "+12053699710", body: msg }) }).catch(() => {});
    }
    setRcForm({ store: "", amount: "", note: "", paidBy: "crew", dataUrl: null });
    setRcBusy(false);
    setActivePanel(null);
  };

  const captureIssuePhoto = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const { dataUrl } = await compressImage(file, 1000, 0.6);
    setIssueDataUrl(dataUrl); e.target.value = "";
  };

  const submitIssue = async (jobId) => {
    if (!issueText.trim() && !issueDataUrl) return;
    setIssueBusy(true);
    const logId = "l" + Date.now();
    const job = jobs.find(j => j.id === jobId);
    const enText = `[Issue] ${issueText}`;
    const esText = `[Problema] ${issueText}`;
    const log = { id: logId, en: enText, es: esText, weather: "", taskId: null, jobId, crewId: user.id, date: today };
    setLogs(p => [...p, log]);
    const row = { id: logId, text_en: enText, text_es: esText, task_id: null, job_id: jobId, crew_id: user.id, log_date: today };
    try { await sbPost("field_logs", row); } catch { enqueue({ table: "field_logs", payload: row }); }
    // Save photo if attached
    if (issueDataUrl) {
      const pid = "p" + Date.now();
      const photo = { id: pid, dataUrl: issueDataUrl, type: "concern", taskId: null, jobId, crewId: user.id, sizeKB: 0, date: new Date().toISOString() };
      setPhotos(p => [...p, photo]);
      const prow = { id: pid, data_url: issueDataUrl, photo_type: "progress", task_id: null, job_id: jobId, crew_id: user.id, size_kb: 0 };
      try { await sbPost("field_photos", prow); } catch { enqueue({ table: "field_photos", payload: prow }); }
    }
    // Twilio alert admin
    const msg = `⚠️ Field Issue — ${job?.name || jobId}\nWorker: ${user.name}\n"${issueText}"\nOpen app to review.`;
    fetch("/.netlify/functions/send-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: "+12053699710", body: msg }) }).catch(() => {});
    setIssueText(""); setIssueDataUrl(null); setIssueBusy(false);
    setActivePanel(null);
  };

  const toggle = async (id) => {
    const task = tasks.find(tk => tk.id === id);
    const next = task.status === "done" ? "pending" : "done";
    setTasks(p => p.map(tk => tk.id === id ? { ...tk, status: next } : tk));
    try { await sbPatch("field_tasks", id, { status: next, completed_at: next === "done" ? new Date().toISOString() : null }); } catch {}
    if (next === "done") {
      const logId = "l" + Date.now();
      const enText = `${T.en.completedTask}: ${task.title}`;
      const esText = `${T.es.completedTask}: ${task.titleEs || task.title}`;
      const log = { id: logId, en: enText, es: esText, weather: "", taskId: id, jobId: task.jobId, crewId: user.id, date: today };
      setLogs(p => [...p, log]);
      const row = { id: logId, text_en: enText, text_es: esText, task_id: id, job_id: task.jobId, crew_id: user.id, log_date: today };
      try { await sbPost("field_logs", row); } catch { enqueue({ table: "field_logs", payload: row }); }
      // GSM Builder sync
      const job = jobs.find(j => j.id === task.jobId);
      if (job?.gsmSync && job?.gsmJobId) {
        fetch("/.netlify/functions/gsm-sync", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "task_done", gsmJobId: job.gsmJobId, data: { id: logId, taskId: id, taskTitle: task.title, crewName: user.name, date: today } }),
        }).catch(() => {});
      }
    }
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

  const [openCheckins, setOpenCheckins] = useState({}); // { jobId: checkinRecord }

  const checkIn = async (job) => {
    const loc = await getLocation();
    setGps(loc);
    if (loc && job.lat) {
      const dist = distanceMi(loc, { lat: job.lat, lng: job.lng });
      setCheckedJob({ id: job.id, dist });
    } else setCheckedJob({ id: job.id, dist: null });
    // Save check-in to DB
    const id = "ci" + Date.now();
    const row = { id, crew_id: user.id, job_id: job.id, check_in: new Date().toISOString(), lat_in: loc?.lat || null, lng_in: loc?.lng || null, work_date: today };
    setOpenCheckins(p => ({ ...p, [job.id]: { id, jobId: job.id, checkIn: new Date().toISOString() } }));
    try { await sbPost("field_checkins", row); } catch { enqueue({ table: "field_checkins", payload: row }); }
  };

  const checkOut = async (job) => {
    const open = openCheckins[job.id];
    if (!open) return;
    const loc = await getLocation();
    const now = new Date();
    const inTime = new Date(open.checkIn);
    const hours = Math.round(((now - inTime) / 3600000) * 100) / 100;
    const patch = { check_out: now.toISOString(), lat_out: loc?.lat || null, lng_out: loc?.lng || null, hours };
    try { await sbFetch(`field_checkins?id=eq.${open.id}`, { method: "PATCH", body: JSON.stringify(patch), prefer: "return=minimal" }); } catch {}
    setOpenCheckins(p => { const n = { ...p }; delete n[job.id]; return n; });
    setCheckedJob(null);
  };

  const groups = [...new Set(my.map(t => t.jobId))];

  return (
    <div>
      {/* shared hidden file inputs — activePanel tracks which job they belong to */}
      <input ref={photoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={captureJobPhoto} />
      <input ref={rcPhotoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={captureRcPhoto} />
      <input ref={issuePhotoRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={captureIssuePhoto} />

      <div style={{ marginBottom: 18 }}>
        <h2 className="h2">{lang === "es" ? `Hola, ${user.name.split(" ")[0]}` : `Hey, ${user.name.split(" ")[0]}`}</h2>
        <p className="muted">{t.yourTasks}</p>
      </div>

      {my.length === 0
        ? <div className="empty"><Icon n="check" s={48} c="var(--green)" /><p style={{ marginTop: 12 }}>{t.noTasks}</p></div>
        : groups.map(jid => {
          const job = jobs.find(j => j.id === jid), jt = my.filter(t => t.jobId === jid);
          const ci = checkedJob?.id === jid;
          const panel = activePanel?.jobId === jid ? activePanel.type : null;

          return <div key={jid} className="jobsec">

            {/* ── Job header ── */}
            <div className="jobhead">
              <div>
                <div className="jobname">{job?.name}</div>
                {job?.address && (
                  <a href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`} target="_blank" rel="noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--sky2)", textDecoration: "none", marginTop: 2, padding: "2px 6px", background: "rgba(59,130,246,.12)", borderRadius: 6, border: "1px solid rgba(59,130,246,.25)" }}
                    onClick={e => e.stopPropagation()}>
                    <Icon n="pin" s={12} c="var(--sky2)" /> {job.address} — Navigate
                  </a>
                )}
              </div>
              {openCheckins[jid]
                ? <button className="btn btn-sm btn-a" onClick={() => checkOut(job)}>
                    <Icon n="power" s={13} /> {lang === "es" ? "Salir del trabajo" : "Check Out"}
                  </button>
                : <button className={`btn btn-sm ${ci ? "btn-g" : "btn-s"}`} onClick={() => checkIn(job)}>
                    <Icon n="pin" s={13} /> {ci ? t.checkedIn : t.checkIn}
                  </button>
              }
            </div>

            {/* ── Quick-action strip ── */}
            <div style={{ display: "flex", gap: 5, padding: "7px 12px", background: "rgba(0,0,0,.22)", borderBottom: "1px solid rgba(255,255,255,.04)", flexWrap: "wrap", alignItems: "center" }}>
              {PHOTO_TYPES.map(pt => (
                <button key={pt.k}
                  onClick={() => { setPhotoType(pt.k); togglePanel(jid, "photo"); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 8,
                    fontSize: 11, fontWeight: 700, fontFamily: "'Barlow Condensed'", letterSpacing: .5, border: "none", cursor: "pointer",
                    background: panel === "photo" && photoType === pt.k ? `rgba(${pt.k==="before"?"249,115,22":pt.k==="after"?"16,185,129":"239,68,68"},.18)` : "rgba(255,255,255,.07)",
                    color: panel === "photo" && photoType === pt.k ? pt.c : "var(--silver)",
                    outline: panel === "photo" && photoType === pt.k ? `1px solid ${pt.c}` : "none" }}>
                  <Icon n="camera" s={12} /> {pt.l}
                </button>
              ))}
              <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
                <button onClick={() => togglePanel(jid, "receipt")}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 8,
                    fontSize: 11, fontWeight: 700, fontFamily: "'Barlow Condensed'", letterSpacing: .5, border: "none", cursor: "pointer",
                    background: panel === "receipt" ? "rgba(245,158,11,.18)" : "rgba(255,255,255,.07)",
                    color: panel === "receipt" ? "var(--accent)" : "var(--silver)",
                    outline: panel === "receipt" ? "1px solid var(--accent)" : "none" }}>
                  <Icon n="receipt" s={12} /> {lang === "es" ? "Recibo" : "Receipt"}
                </button>
                <button onClick={() => { setIssueText(""); setIssueDataUrl(null); togglePanel(jid, "issue"); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 8,
                    fontSize: 11, fontWeight: 700, fontFamily: "'Barlow Condensed'", letterSpacing: .5, border: "none", cursor: "pointer",
                    background: panel === "issue" ? "rgba(239,68,68,.18)" : "rgba(255,255,255,.07)",
                    color: panel === "issue" ? "var(--red)" : "var(--silver)",
                    outline: panel === "issue" ? "1px solid var(--red)" : "none" }}>
                  ⚠ {lang === "es" ? "Problema" : "Flag Issue"}
                </button>
              </div>
            </div>

            {/* ── Photo success flash ── */}
            {photoSuccess === jid && (
              <div style={{ padding: "6px 14px", background: "rgba(16,185,129,.15)", color: "var(--green)", fontSize: 12, fontWeight: 600, borderBottom: "1px solid rgba(16,185,129,.2)" }}>
                ✓ {t.photoSaved}
              </div>
            )}

            {/* ── Photo panel ── */}
            {panel === "photo" && (
              <div style={{ padding: "14px 16px", background: "rgba(8,15,22,.85)", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  {PHOTO_TYPES.map(pt => (
                    <button key={pt.k} onClick={() => setPhotoType(pt.k)}
                      style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${photoType === pt.k ? pt.c : "transparent"}`,
                        background: photoType === pt.k ? `rgba(${pt.k==="before"?"249,115,22":pt.k==="after"?"16,185,129":"239,68,68"},.18)` : "rgba(255,255,255,.06)",
                        color: photoType === pt.k ? pt.c : "var(--silver)", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Barlow Condensed'" }}>
                      {pt.l}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="btn btn-p" disabled={photoBusy}
                    onClick={() => { photoRef.current?.setAttribute("capture","environment"); photoRef.current?.click(); }}>
                    {photoBusy ? <span className="spin" /> : <><Icon n="camera" s={15} /> {t.takePhoto}</>}
                  </button>
                  <button className="btn btn-s" disabled={photoBusy}
                    onClick={() => { photoRef.current?.removeAttribute("capture"); photoRef.current?.click(); }}>
                    <Icon n="photo" s={15} /> {t.library}
                  </button>
                  <button onClick={() => setActivePanel(null)}
                    style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--slate)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>
                </div>
                <p style={{ fontSize: 11, color: "var(--slate)", marginTop: 8 }}>
                  {t.photoType}: {PHOTO_TYPES.find(p=>p.k===photoType)?.l} — {t.photoSaved.toLowerCase()}
                </p>
              </div>
            )}

            {/* ── Receipt panel ── */}
            {panel === "receipt" && (
              <div style={{ padding: "14px 16px", background: "rgba(8,15,22,.85)", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                <div className="grid2" style={{ marginBottom: 10 }}>
                  <div><label className="fl">{t.store}</label>
                    <input className="fi" value={rcForm.store} onChange={e => setRcForm(p => ({ ...p, store: e.target.value }))} placeholder="Home Depot" style={{ padding: "9px 12px" }} /></div>
                  <div><label className="fl">{t.amount} ($)</label>
                    <input className="fi" type="number" value={rcForm.amount} onChange={e => setRcForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" style={{ padding: "9px 12px" }} /></div>
                </div>
                <div style={{ marginBottom: 10 }}><label className="fl">{t.notes}</label>
                  <input className="fi" value={rcForm.note} onChange={e => setRcForm(p => ({ ...p, note: e.target.value }))} placeholder={t.whatBought} style={{ padding: "9px 12px" }} /></div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <button className={`btn btn-sm ${rcForm.paidBy === "crew" ? "btn-a" : "btn-s"}`} onClick={() => setRcForm(p => ({ ...p, paidBy: "crew" }))}>
                    {t.iPaid}
                  </button>
                  <button className={`btn btn-sm ${rcForm.paidBy === "company" ? "btn-p" : "btn-s"}`} onClick={() => setRcForm(p => ({ ...p, paidBy: "company" }))}>
                    {t.companyPaid}
                  </button>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                    {rcForm.dataUrl && <img src={rcForm.dataUrl} alt="receipt" style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 6, border: "2px solid var(--green)" }} />}
                    <button className="btn btn-s btn-sm"
                      onClick={() => { rcPhotoRef.current?.setAttribute("capture","environment"); rcPhotoRef.current?.click(); }}>
                      <Icon n="camera" s={13} /> {rcForm.dataUrl ? t.retake : t.photo}
                    </button>
                  </div>
                </div>
                {rcForm.paidBy === "crew" && (
                  <p style={{ fontSize: 11, color: "var(--orange)", marginBottom: 10 }}>
                    ⚠ {t.flaggedReimb}
                  </p>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-p" style={{ flex: 1 }}
                    disabled={!rcForm.store || !rcForm.amount || rcBusy}
                    onClick={() => submitJobReceipt(jid)}>
                    {rcBusy ? <span className="spin" /> : <><Icon n="check" s={15} /> {t.submitReceipt}</>}
                  </button>
                  <button onClick={() => setActivePanel(null)}
                    style={{ background: "none", border: "none", color: "var(--slate)", cursor: "pointer", fontSize: 18, padding: "0 8px" }}>✕</button>
                </div>
              </div>
            )}

            {/* ── Issue / question panel ── */}
            {panel === "issue" && (
              <div style={{ padding: "14px 16px", background: "rgba(8,15,22,.85)", borderBottom: "1px solid rgba(239,68,68,.2)" }}>
                <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 14, fontWeight: 700, color: "var(--red)", marginBottom: 10 }}>
                  ⚠ {lang === "es" ? "Reportar problema / pregunta" : "Report Issue / Question"} — {lang === "es" ? "se alerta al admin" : "alerts admin immediately"}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <textarea className="fi" rows={3} value={issueText} onChange={e => setIssueText(e.target.value)}
                    placeholder={lang === "es" ? "Describe el problema o pregunta..." : "Describe the issue or question..."} />
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
                  {issueDataUrl
                    ? <img src={issueDataUrl} alt="issue" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "2px solid var(--red)" }} />
                    : null}
                  <button className="btn btn-s btn-sm" onClick={() => issuePhotoRef.current?.click()}>
                    <Icon n="camera" s={13} /> {issueDataUrl ? (lang === "es" ? "Cambiar foto" : "Retake") : (lang === "es" ? "Adjuntar foto" : "Attach Photo")}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-full" style={{ flex: 1, background: "linear-gradient(135deg,#dc2626,var(--red))", color: "#fff", justifyContent: "center" }}
                    disabled={(!issueText.trim() && !issueDataUrl) || issueBusy}
                    onClick={() => submitIssue(jid)}>
                    {issueBusy ? <span className="spin" /> : <><Icon n="check" s={15} /> {lang === "es" ? "Enviar al Admin" : "Send to Admin"}</>}
                  </button>
                  <button onClick={() => setActivePanel(null)}
                    style={{ background: "none", border: "none", color: "var(--slate)", cursor: "pointer", fontSize: 18, padding: "0 8px" }}>✕</button>
                </div>
              </div>
            )}

            {/* ── GPS distance banner ── */}
            {ci && checkedJob.dist != null && (
              <div style={{ padding: "6px 18px", fontSize: 12, color: checkedJob.dist < 0.5 ? "var(--green)" : "var(--orange)", background: "rgba(0,0,0,.2)" }}>
                📍 {checkedJob.dist < 0.5 ? t.onSite : `${checkedJob.dist.toFixed(1)} mi ${t.fromSite}`}
              </div>
            )}

            {/* ── Task rows ── */}
            <div className="jobbody">{jt.map(task => { const s = st(task);
              return <div key={task.id} className="trow">
                <div className="tchk"><input type="checkbox" checked={task.status === "done"} onChange={() => toggle(task.id)} /></div>
                <div className="tinfo">
                  <div className="ten" style={{ textDecoration: task.status === "done" ? "line-through" : "none", opacity: task.status === "done" ? .6 : 1 }}>{task.title}</div>
                  <div className="tes">{task.titleEs}</div>
                  <div className="tmeta"><span className={`tag tag-${s}`}>{t[s]}</span>
                    {task.dueDate && <span className="tag" style={{ background: "rgba(255,255,255,.06)", color: "var(--silver)" }}>{task.dueDate}</span>}</div>
                </div>
                <div className="tact">
                  <button className="btn btn-s btn-sm btn-ic" title="Materials" onClick={() => setMatModal(task.id)}><Icon n="tools" s={14} /></button>
                </div>
              </div>; })}
            </div>

          </div>;
        })}

      {matModal && <div className="modal-bg" onClick={e => e.target === e.currentTarget && setMatModal(null)}>
        <div className="modal"><div className="mt">{t.materials}</div>
          <div className="fg"><label className="fl">{t.whatNeed}</label>
            <textarea className="fi" value={mat} onChange={e => setMat(e.target.value)} placeholder={lang === "es" ? "ej. madera 2x4..." : "e.g. 2x4 lumber..."} /></div>
          <div className="macts"><button className="btn btn-s" onClick={() => setMatModal(null)}>{t.cancel}</button>
            <button className="btn btn-a" onClick={() => submitMat(matModal)}><Icon n="tools" s={14} /> {t.submit}</button></div></div></div>}
    </div>
  );
}


function CrewPhotos(props) {
  const { user, tasks, jobs, photos, setPhotos, t } = props;
  const my = tasks.filter(tk => Array.isArray(tk.assignedTo) ? tk.assignedTo.includes(user.id) : tk.assignedTo === user.id);
  const [task, setTask] = useState(""); const [type, setType] = useState("before"); const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const TYPES = [
    { k: "before",  l: t.before,  c: "var(--orange)" },
    { k: "after",   l: t.after,   c: "var(--green)"  },
    { k: "concern", l: t.concern, c: "var(--red)"    },
  ];
  const typeLabel = k => TYPES.find(x => x.k === k)?.l || k;
  const typeColor = k => ({ before:"var(--orange)", after:"var(--green)", concern:"var(--red)", progress:"var(--sky2)" })[k] || "var(--sky2)";
  const upload = async e => {
    const file = e.target.files[0]; if (!file || !task) return;
    setBusy(true);
    const { dataUrl, sizeKB } = await compressImage(file);
    const tk = tasks.find(x => x.id === task);
    const id = "p" + Date.now();
    const dbType = type === "concern" ? "progress" : type;
    const photo = { id, dataUrl, type, taskId: task, jobId: tk?.jobId, crewId: user.id, sizeKB, date: new Date().toISOString() };
    setPhotos(p => [...p, photo]);
    const row = { id, data_url: dataUrl, photo_type: dbType, task_id: task, job_id: tk?.jobId, crew_id: user.id, size_kb: sizeKB };
    try { await sbPost("field_photos", row); } catch { enqueue({ table: "field_photos", payload: row }); }
    e.target.value = ""; setBusy(false);
  };
  return (
    <div><h2 className="h2" style={{ marginBottom: 18 }}>{t.photos}</h2>
      <div className="card">
        <div className="fg"><label className="fl">{t.task}</label>
          <select className="fi" value={task} onChange={e => setTask(e.target.value)}>
            <option value="">{t.choose}</option>
            {my.map(tk => { const j = jobs.find(j => j.id === tk.jobId); return <option key={tk.id} value={tk.id}>{j?.name} — {tk.title}</option>; })}
          </select></div>
        <div className="fg"><label className="fl">{t.photoType}</label>
          <div style={{ display: "flex", gap: 8 }}>
            {TYPES.map(x => (
              <button key={x.k} className={`btn btn-sm ${type === x.k ? "btn-p" : "btn-s"}`}
                onClick={() => setType(x.k)} style={{ color: type === x.k ? "#fff" : x.c }}>{x.l}</button>
            ))}
          </div></div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={upload} />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-p" disabled={!task || busy}
            onClick={() => { fileRef.current?.setAttribute("capture","environment"); fileRef.current?.click(); }}>
            {busy ? <span className="spin" /> : <><Icon n="camera" s={16} /> {t.takePhoto}</>}
          </button>
          <button className="btn btn-s" disabled={!task || busy}
            onClick={() => { fileRef.current?.removeAttribute("capture"); fileRef.current?.click(); }}>
            <Icon n="photo" s={16} /> {t.library}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>{t.photoNote}</p>
      </div>
      {[...new Set(photos.filter(p => p.crewId === user.id).map(p => p.taskId))].map(tid => {
        const tk = tasks.find(x => x.id === tid), j = jobs.find(j => j.id === tk?.jobId), tp = photos.filter(p => p.taskId === tid);
        return <div key={tid} className="card"><div className="ct" style={{ fontSize: 15 }}>{j?.name} — {tk?.title}</div>
          <div className="pgrid">{tp.map((p, i) => <div key={i} className="pthumb">
            {p.dataUrl ? <img src={p.dataUrl} alt={p.type} /> : <Icon n="camera" s={28} c="var(--slate)" />}
            <div className="plabel" style={{ color: typeColor(p.type) }}>{typeLabel(p.type)} · {p.sizeKB}kb</div>
          </div>)}</div></div>;
      })}
    </div>
  );
}

function CrewReceipts(props) {
  const { user, tasks, jobs, receipts, setReceipts, t, lang } = props;
  const my = tasks.filter(t => Array.isArray(t.assignedTo) ? t.assignedTo.includes(user.id) : t.assignedTo === user.id);
  const [task, setTask] = useState(""); const [store, setStore] = useState(""); const [amount, setAmount] = useState(""); const [note, setNote] = useState(""); const [paidBy, setPaidBy] = useState("crew"); const [dataUrl, setDataUrl] = useState(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const fileRef = useRef();
  const capturePhoto = async e => {
    const file = e.target.files[0]; if (!file) return;
    const { dataUrl: url } = await compressImage(file, 1000, 0.6);
    setDataUrl(url);
    e.target.value = "";
  };
  const submit = async () => {
    if (!task || !store || !amount) return;
    setBusy(true);
    const tk = tasks.find(t => t.id === task);
    const id = "r" + Date.now();
    const today = new Date().toISOString().split("T")[0];
    const receipt = { id, dataUrl, taskId: task, jobId: tk?.jobId, crewId: user.id, store, amount, note, paidBy, reimbursementStatus: paidBy === "crew" ? "pending" : "na", createdAt: today };
    setReceipts(p => [...p, receipt]);
    const row = { id, data_url: dataUrl, task_id: task, job_id: tk?.jobId, crew_id: user.id, store, amount: parseFloat(amount) || 0, note, paid_by: paidBy, reimbursement_status: paidBy === "crew" ? "pending" : "na" };
    try { await sbPost("field_receipts", row); } catch { enqueue({ table: "field_receipts", payload: row }); }
    setTask(""); setStore(""); setAmount(""); setNote(""); setPaidBy("crew"); setDataUrl(null); setBusy(false);
    setDone(true); setTimeout(() => setDone(false), 3000);
  };
  return (
    <div><h2 className="h2" style={{ marginBottom: 18 }}>{t.receipts}</h2>
      {done && <div style={{ padding: "10px 14px", background: "rgba(16,185,129,.15)", border: "1px solid rgba(16,185,129,.3)", borderRadius: 10, marginBottom: 16, color: "var(--green)", fontWeight: 600 }}>✓ {t.receiptSubmitted}</div>}
      <div className="card">
        <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>{t.snapReceipt}</p>
        <div className="fg"><label className="fl">{t.task}</label>
          <select className="fi" value={task} onChange={e => setTask(e.target.value)}><option value="">{t.choose}</option>
            {my.map(tk => { const j = jobs.find(j => j.id === tk.jobId); return <option key={tk.id} value={tk.id}>{j?.name} — {tk.title}</option>; })}</select></div>
        <div className="grid2"><div className="fg"><label className="fl">{t.store}</label>
          <input className="fi" value={store} onChange={e => setStore(e.target.value)} placeholder="Home Depot" /></div>
          <div className="fg"><label className="fl">{t.amount} ($)</label>
            <input className="fi" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></div></div>
        <div className="fg"><label className="fl">{t.notes}</label>
          <input className="fi" value={note} onChange={e => setNote(e.target.value)} placeholder={t.whatBought} /></div>
        <div className="fg"><label className="fl">{t.whoPaid}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className={`btn btn-sm ${paidBy === "crew" ? "btn-a" : "btn-s"}`} onClick={() => setPaidBy("crew")}>{t.iPaid}</button>
            <button className={`btn btn-sm ${paidBy === "company" ? "btn-p" : "btn-s"}`} onClick={() => setPaidBy("company")}>{t.companyPaid}</button>
          </div>
          {paidBy === "crew" && <p style={{ fontSize: 11, color: "var(--orange)", marginTop: 6 }}>{t.flaggedReimb}</p>}
        </div>
        <div className="fg"><label className="fl">{t.receiptPhoto}</label>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={capturePhoto} />
          {dataUrl
            ? <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <img src={dataUrl} alt="receipt" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "2px solid var(--green)" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--green)" }}>✓ {t.photoReady}</span>
                  <button className="btn btn-s btn-sm" onClick={() => { setDataUrl(null); fileRef.current?.click(); }}><Icon n="camera" s={13} /> {t.retake}</button>
                </div>
              </div>
            : <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-s btn-sm" onClick={() => { fileRef.current?.setAttribute("capture","environment"); fileRef.current?.click(); }}><Icon n="camera" s={14} /> {t.takePhoto}</button>
                <button className="btn btn-s btn-sm" onClick={() => { fileRef.current?.removeAttribute("capture"); fileRef.current?.click(); }}><Icon n="photo" s={14} /> {t.library}</button>
              </div>
          }
        </div>
        <button className="btn btn-p btn-full" disabled={!task || !store || !amount || busy} onClick={submit}>
          {busy ? <span className="spin" /> : <><Icon n="check" s={16} /> {t.submitReceipt}</>}
        </button>
        {(!task || !store || !amount) && <p style={{ fontSize: 11, color: "var(--slate)", marginTop: 8, textAlign: "center" }}>{t.requireFields}</p>}
      </div>
      {receipts.filter(r => r.crewId === user.id).map(r => { const j = jobs.find(x => x.id === r.jobId);
        return <div key={r.id} className="card" style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {r.dataUrl && <img src={r.dataUrl} alt="receipt" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover" }} />}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{r.store}</div>
            <div className="muted">{j?.name} · {r.note}</div>
            {r.paidBy === "crew" && <span className={`tag ${r.reimbursementStatus === "paid" ? "tag-done" : "tag-overdue"}`} style={{ marginTop: 4, display: "inline-block" }}>{r.reimbursementStatus === "paid" ? t.reimbursed : t.awaitingReimb}</span>}
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
    <div><h2 className="h2">{t.logYourDay}</h2>
      <p className="muted" style={{ marginBottom: 16 }}>{t.tellUs}</p>
      {!loggedToday && <div style={{ padding: "10px 14px", background: "rgba(249,115,22,.12)", border: "1px solid rgba(249,115,22,.3)", borderRadius: 10, marginBottom: 16, color: "var(--orange)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
        <Icon n="report" s={16} /> {t.notLogged}</div>}
      {done && <div style={{ padding: "10px 14px", background: "rgba(16,185,129,.15)", border: "1px solid rgba(16,185,129,.3)", borderRadius: 10, marginBottom: 16, color: "var(--green)", fontWeight: 600 }}>✓ {t.logSubmitted}</div>}
      <div className="card">
        <div className="fg"><label className="fl">{t.task}</label>
          <select className="fi" value={task} onChange={e => setTask(e.target.value)}><option value="">{t.generalLog}</option>
            {my.map(tk => { const j = jobs.find(j => j.id === tk.jobId); return <option key={tk.id} value={tk.id}>{j?.name} — {tk.title}</option>; })}</select></div>
        <div className="fg"><label className="fl">{t.whatEn}</label>
          <textarea className="fi" value={en} onChange={e => setEn(e.target.value)} placeholder={t.descWork} /></div>
        <div className="fg"><label className="fl">{t.whatEs}</label>
          <textarea className="fi" value={es} onChange={e => setEs(e.target.value)} placeholder={t.descWorkEs} /></div>
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
