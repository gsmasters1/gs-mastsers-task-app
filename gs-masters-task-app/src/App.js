import { useState, useEffect, useRef, useCallback } from "react";

/* ════════════════════════════════════════════════════════════════════
   GS MASTERS FIELD APP — v2 "SUPERCHARGED"
   Superpowers: Supabase backend · Offline-first sync · GPS check-in
   · Cost roll-ups · Photo compression · Signature capture · Smart reminders
   ════════════════════════════════════════════════════════════════════ */

// ─── SUPABASE CONFIG ───────────────────────────────────────────────────
const SB_URL = "https://mkibgjnzbgfqjkhowafr.supabase.co";
const SB_KEY = "sb_publishable_zh5Soyi6iNGd8CLxPfD9Lg_dVdAwDe7";
const SB_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1raWJnam56YmdmcWpraG93YWZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NDM3NDMsImV4cCI6MjA4OTExOTc0M30.dFNsD-3JkDCChaVlWlJY5Ff_HtkWvNU6m9nbkNWNkow";

// ─── AUTH TOKEN (set after Supabase Auth login) ────────────────────────
let _authToken = null;
let _refreshToken = null;
let _tokenRefreshTimer = null;

function setSession(accessToken, refreshToken) {
  _authToken = accessToken;
  _refreshToken = refreshToken;
  if (accessToken) {
    sessionStorage.setItem("gsm_tok", accessToken);
    sessionStorage.setItem("gsm_rtok", refreshToken || "");
  } else {
    sessionStorage.removeItem("gsm_tok");
    sessionStorage.removeItem("gsm_rtok");
  }
}

function restoreSession() {
  _authToken   = sessionStorage.getItem("gsm_tok")  || null;
  _refreshToken = sessionStorage.getItem("gsm_rtok") || null;
}

function scheduleTokenRefresh(expiresInSec) {
  if (_tokenRefreshTimer) clearTimeout(_tokenRefreshTimer);
  const delay = Math.max((expiresInSec - 120) * 1000, 30000);
  _tokenRefreshTimer = setTimeout(refreshSession, delay);
}

async function sbAuthSignIn(profileId, pin) {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SB_JWT, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${profileId}@gsm.internal`, password: pin }),
  });
  if (!res.ok) throw new Error("auth_failed");
  const data = await res.json();
  setSession(data.access_token, data.refresh_token);
  scheduleTokenRefresh(data.expires_in || 3600);
  return data;
}

async function refreshSession() {
  if (!_refreshToken) return false;
  try {
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SB_JWT, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: _refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setSession(data.access_token, data.refresh_token);
    scheduleTokenRefresh(data.expires_in || 3600);
    return true;
  } catch { return false; }
}

async function sbFetch(path, opts = {}) {
  const token = _authToken || SB_JWT;
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_JWT,
      Authorization: `Bearer ${token}`,
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

async function uploadToStorage(dataUrl, path) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const r = await fetch(`${SB_URL}/storage/v1/object/portal-uploads/${path}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SB_KEY}`, "Content-Type": blob.type || "image/jpeg", "x-upsert": "true" },
    body: blob,
  });
  if (!r.ok) throw new Error("Storage upload failed");
  return path;
}
async function deleteFromStorage(path) {
  if (!path) return;
  await fetch(`${SB_URL}/storage/v1/object/portal-uploads`, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [path] }),
  });
}

// ─── SNAKE ↔ CAMEL TRANSFORMS ──────────────────────────────────────────
const fromProfile = r => ({ id: r.id, name: r.name, role: r.role, email: r.email, phone: r.phone || "", pin: r.pin, active: r.active !== false, archived: r.archived === true, is1099: r.is_1099 === true });
const fromJob     = r => ({ id: r.id, name: r.name, address: r.address || "", lat: r.lat, lng: r.lng, budget: r.budget, status: r.status, closedAt: r.closed_at, gsmJobId: r.gsm_job_id, gsmSync: r.gsm_sync || false });
const fromTask    = r => ({ id: r.id, jobId: r.job_id, title: r.title, titleEs: r.title_es || "", assignedTo: Array.isArray(r.assigned_to) ? r.assigned_to : (r.assigned_to ? [r.assigned_to] : []), status: r.status, dueDate: r.due_date || "", createdAt: (r.created_at || "").slice(0, 10), completedAt: r.completed_at || null, priority: r.priority === 1 ? "urgent" : "normal", recurring: r.recurring || false, photoRequired: r.photo_required === true });
const toPriority  = p => p === "urgent" ? 1 : 3;
const fromLog     = r => ({ id: r.id, taskId: r.task_id, jobId: r.job_id, crewId: r.crew_id, en: r.text_en, es: r.text_es, weather: r.weather, date: r.log_date, adminReply: r.admin_reply || null, resolved: r.resolved || false });
const fromPhoto   = r => ({ id: r.id, taskId: r.task_id, jobId: r.job_id, crewId: r.crew_id, dataUrl: r.storage_path ? `${SB_URL}/storage/v1/object/public/portal-uploads/${r.storage_path}` : (r.data_url || null), storagePath: r.storage_path || null, type: r.photo_type, sizeKB: r.size_kb, note: r.note || "", date: r.created_at });
const fromReceipt = r => ({ id: r.id, taskId: r.task_id, jobId: r.job_id, category: r.category || null, crewId: r.crew_id, dataUrl: r.storage_path ? `${SB_URL}/storage/v1/object/public/portal-uploads/${r.storage_path}` : (r.data_url || null), storagePath: r.storage_path || null, store: r.store, amount: r.amount, note: r.note, paidBy: r.paid_by || "crew", reimbursementStatus: r.reimbursement_status || "pending", reimbursementDate: r.reimbursement_date || null, billStatus: r.bill_status || "pending_review", createdAt: (r.created_at || "").slice(0, 10), integrationSentAt: r.integration_sent_at || null });
const fromMat     = r => ({ id: r.id, taskId: r.task_id, jobId: r.job_id, crewId: r.crew_id, en: r.text_en, es: r.text_es, fulfilled: r.fulfilled });
const fromCheckin  = r => ({ id: r.id, crewId: r.crew_id, jobId: r.job_id, checkIn: r.check_in, checkOut: r.check_out, hours: r.hours, date: r.work_date, latIn: r.lat_in, lngIn: r.lng_in, method: r.method || "qr", autoClosed: r.auto_closed === true });
const fromDispatch = r => ({ id: r.id, crewId: r.crew_id, date: r.date, jobIds: r.job_ids || [], customStops: r.custom_stops || [], createdBy: r.created_by });

// Overhead receipt destinations — expenses not tied to a job: [key, button label, saved category]
const RC_OVERHEAD = [["office","🏢 Office","Office"],["auto","🚗 Auto","Auto"],["tools","🔧 Tools","Tools"],["side","💼 Side Job","Side Job"]];
const rcDestCategory = (dest, customCat) => dest === "job" ? null : dest === "custom" ? (customCat || "").trim() : (RC_OVERHEAD.find(([k]) => k === dest)?.[2] || null);

// ─── LOCAL DATE HELPERS (device timezone, not UTC) ──────────────────────
// Using UTC causes tasks to "reset" at 7 PM CDT because UTC midnight ≠ local midnight
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const localDateOf = iso => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

// ─── GSM BUILDER INTEGRATION ────────────────────────────────────────────
async function pushReceiptToGSM(receipt, jobs, crewName) {
  const job = (jobs || []).find(j => j.id === receipt.jobId);
  if (!job?.gsmSync || !job?.gsmJobId) return false;
  try {
    const res = await fetch("/.netlify/functions/gsm-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "receipt", gsmJobId: job.gsmJobId, data: { ...receipt, crewName: crewName || "Field Crew" } }),
    });
    if (!res.ok) return false;
    await sbFetch(`field_receipts?id=eq.${receipt.id}`, { method: "PATCH", body: JSON.stringify({ bill_status: "posted", integration_sent_at: new Date().toISOString() }), prefer: "return=minimal" });
    return true;
  } catch { return false; }
}

// ─── PUSH NOTIFICATIONS ─────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = "BNuhXdjrECrBVABmhVdEe-qy4OMKQnkIZek8scMjJQ-xHg6zTX7-VEIQ2BadiWDh_kCvO1gs9MSboG77Xfl-b9o";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

async function registerPush(crewId) {
  try {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const id = "ps_" + crewId + "_" + btoa(sub.endpoint).slice(-12).replace(/[^a-z0-9]/gi, "");
    await sbFetch("push_subscriptions", {
      method: "POST",
      body: JSON.stringify({ id, crew_id: crewId, subscription: sub.toJSON() }),
      headers: { Prefer: "resolution=merge-duplicates" },
    });
  } catch {}
}

async function sendPush(crewIds, title, bodyText, url) {
  if (!crewIds?.length) return;
  fetch("/.netlify/functions/send-push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ crewIds, title, bodyText, url: url || "/" }),
  }).catch(() => {});
}

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
  return new Promise((resolve, reject) => {
    const img = new Image();
    let objUrl;
    try { objUrl = URL.createObjectURL(file); } catch { /* fall through to FileReader */ }

    const readRaw = () => {
      if (file.size > 500 * 1024) { reject(new Error("Image too large to process")); return; }
      const fr2 = new FileReader();
      fr2.onerror = () => reject(new Error("FileReader fallback failed"));
      fr2.onload = ev => resolve({ blob: file, dataUrl: ev.target.result, sizeKB: Math.round(file.size / 1024) });
      fr2.readAsDataURL(file);
    };

    const onImgLoad = () => {
      try {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(img.width  * scale) || 1;
        canvas.height = Math.round(img.height * scale) || 1;
        const ctx = canvas.getContext("2d");
        if (!ctx) { if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; } readRaw(); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (!dataUrl || dataUrl === "data:,") { readRaw(); return; }
        resolve({ blob: file, dataUrl, sizeKB: Math.round(dataUrl.length * 0.75 / 1024) });
      } catch {
        if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
        readRaw();
      }
    };

    img.onerror = () => {
      if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
      reject(new Error("Image load failed"));
    };
    img.onload = onImgLoad;

    if (objUrl) {
      img.src = objUrl;
    } else {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("FileReader failed"));
      fr.onload = (e) => { img.src = e.target.result; };
      fr.readAsDataURL(file);
    }
  });
}

// iOS PWA file-from-gallery helper — dynamic element bypasses iOS capture cache bug
function openGallery(onChange) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif";
  inp.style.cssText = "position:fixed;top:-200vh;left:-200vw;opacity:0";
  document.body.appendChild(inp);
  inp.addEventListener("change", (e) => { onChange(e); inp.remove(); });
  inp.addEventListener("cancel", () => inp.remove());
  inp.click();
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
    activeReceipts:"Active Receipts", archivedReceipts:"Archived (Paid)",
    noActiveReceipts:"No active receipts.", noArchivedReceipts:"No archived receipts yet.",
    paidByCheck:"Paid by check",
    // log
    logYourDay:"Log Your Day", tellUs:"Tell us what you did today.",
    whatEn:"What did you do? (English)", whatEs:"What did you do? (Spanish)",
    logSubmitted:"Log submitted!", notLogged:"You haven't logged today yet",
    generalLog:"General log", descWork:"Describe your work...", descWorkEs:"Describe tu trabajo...",
    // auto-log
    completedTask:"Completed", workedOnTask:"Worked on",
    workedToday:"Worked On This Today", loggedToday:"Logged for Today",
    // logout task gate
    taskCheckTitle:"Quick Task Check", taskCheckSub:"Before you log out, tell us about today's tasks:",
    completedTodayBtn:"✅ Completed", workedOnItBtn:"🔧 Worked On It",
    needPhotoFirst:"This task needs a photo before it can be marked complete — go back and add one, or mark that you worked on it instead.",
    // GPS
    onSite:"On site", fromSite:"from site",
    // net / greeting
    online:"Online", offline:"Offline",
    yourTasks:"Your tasks today",
    // crew actions
    checkOut:"Check Out", materials:"Materials", whatNeed:"What do you need?",
    flagIssue:"Flag Issue", navigate:"Navigate",
    photoFor:"Photo for:", receiptFor:"Receipt for:",
    sendToAdmin:"Send to Admin", reportIssue:"Report Issue / Question",
    alertsAdmin:"alerts admin immediately",
    describeIssue:"Describe the issue or question...",
    attachPhoto:"Attach Photo", noAddressFile:"No address on file — ask Gregory",
    whereToGoToday:"WHERE TO GO TODAY",
    googleMaps:"Google Maps", appleMaps:"Apple Maps",
    checkedOut:"Checked out", onSiteNow:"On site now",
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
    activeReceipts:"Recibos Activos", archivedReceipts:"Archivados (Pagados)",
    noActiveReceipts:"No hay recibos activos.", noArchivedReceipts:"Aún no hay recibos archivados.",
    paidByCheck:"Pagado con cheque",
    // log
    logYourDay:"Registro del Día", tellUs:"Cuéntanos qué hiciste hoy.",
    whatEn:"¿Qué hiciste? (Inglés)", whatEs:"¿Qué hiciste? (Español)",
    logSubmitted:"¡Registro enviado!", notLogged:"Aún no has registrado hoy",
    generalLog:"Registro general", descWork:"Describe tu trabajo...", descWorkEs:"Describe tu trabajo...",
    // auto-log
    completedTask:"Completada", workedOnTask:"Trabajó en",
    workedToday:"Trabajé en Esto Hoy", loggedToday:"Registrado Hoy",
    // logout task gate
    taskCheckTitle:"Revisión Rápida de Tareas", taskCheckSub:"Antes de salir, cuéntanos sobre las tareas de hoy:",
    completedTodayBtn:"✅ Completada", workedOnItBtn:"🔧 Trabajé en Esto",
    needPhotoFirst:"Esta tarea necesita una foto antes de marcarla como completa — agrega una foto, o marca que trabajaste en ella.",
    // GPS
    onSite:"En el sitio", fromSite:"del sitio",
    // net / greeting
    online:"En línea", offline:"Sin conexión",
    yourTasks:"Tus tareas de hoy",
    // crew actions
    checkOut:"Salir del trabajo", materials:"Materiales", whatNeed:"¿Qué necesitas?",
    flagIssue:"Reportar Problema", navigate:"Navegar",
    photoFor:"Foto para:", receiptFor:"Recibo para:",
    sendToAdmin:"Enviar al Admin", reportIssue:"Reportar problema / pregunta",
    alertsAdmin:"se alerta al admin de inmediato",
    describeIssue:"Describe el problema o pregunta...",
    attachPhoto:"Adjuntar foto", noAddressFile:"Sin dirección — pregunta a Gregory",
    whereToGoToday:"ADÓNDE IR HOY",
    googleMaps:"Google Maps", appleMaps:"Apple Maps",
    checkedOut:"Salida registrada", onSiteNow:"En el sitio ahora",
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
    archive:"M21 8v13H3V8 M1 3h22v5H1z M10 12h4",
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
.btn-ghost{background:none;border:none;color:var(--silver)}
.btn-ghost:hover{background:rgba(255,255,255,.08);color:var(--white)}

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
.tag-urgent{background:rgba(239,68,68,.2);color:var(--red);border:1px solid rgba(239,68,68,.35);font-weight:800}
.tag-recurring{background:rgba(245,158,11,.18);color:var(--accent);border:1px solid rgba(245,158,11,.35)}
.trow-urgent{border-left:3px solid var(--red)!important}
.trow-recurring{border-left:3px solid var(--accent)!important;background:rgba(245,158,11,.04)!important}
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

@media print{
  .topbar,.side,.cnav,.toolbar .btn,.modal-bg,.hamburger,.side-scrim{display:none!important}
  .content{padding:0}body{background:#fff;color:#000}
  .cal-grid,.card .ct,.cal-h{display:none!important}
  .print-task-list{display:block!important}
  .card{box-shadow:none;border:1px solid #ddd;page-break-inside:avoid}
}

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
.app.light .btn-ghost{color:#475569}.app.light .btn-ghost:hover{background:rgba(0,0,0,.06);color:#0f172a}
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


// ─── PWA INSTALL PROMPT ─────────────────────────────────────────────────
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

function InstallPrompt({ lang, externalShow, onExternalClose }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  // Capture Android deferred prompt
  useEffect(() => {
    if (window._pwaBeforeInstall) {
      setDeferredPrompt(window._pwaBeforeInstall);
      window._pwaBeforeInstall = null;
    }
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Button-driven: open immediately when parent requests it
  useEffect(() => {
    if (externalShow && !isInStandalone()) {
      setStep(0);
      setShow(true);
    }
  }, [externalShow]);

  // Auto-show on first visit (non-iOS gets native prompt via deferred; iOS gets hint)
  useEffect(() => {
    if (isInStandalone()) return;
    const dismissed = localStorage.getItem("gsm_install_dismissed");
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 86400000) return;
    if (!isIOS()) return; // Android handled by deferred prompt capture above
    const t = setTimeout(() => setShow(true), 4000);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    localStorage.setItem("gsm_install_dismissed", String(Date.now()));
    setShow(false);
    onExternalClose?.();
  };

  const installAndroid = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") localStorage.setItem("gsm_install_dismissed", "1");
      setDeferredPrompt(null);
    }
    setShow(false);
    onExternalClose?.();
  };

  if (!show) return null;

  const es = lang === "es";

  if (isIOS()) {
    const steps = es
      ? ["Toca el botón de compartir", "Botón de compartir (📤) en la barra inferior de Safari", "Toca «Agregar a pantalla de inicio»", "Toca «Agregar» — aparecerá el ícono en tu pantalla"]
      : ["Tap the Share button", "The share button (📤) is in Safari's bottom toolbar", "Tap 'Add to Home Screen'", "Tap 'Add' — the icon appears on your home screen"];
    return (
      <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:500, padding:"0 12px 12px", pointerEvents:"none" }}>
        <div style={{ background:"rgba(15,25,36,.97)", border:"1px solid rgba(59,130,246,.4)", borderRadius:18, padding:"18px 18px 14px", boxShadow:"0 -8px 40px rgba(0,0,0,.6)", pointerEvents:"all", maxWidth:480, margin:"0 auto" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
            <div>
              <div style={{ fontFamily:"'Barlow Condensed'", fontSize:18, fontWeight:800, color:"var(--sky2)" }}>
                {es ? "📲 Guarda la App en tu Teléfono" : "📲 Save the App to Your Phone"}
              </div>
              <div style={{ fontSize:12, color:"var(--silver)", marginTop:3 }}>
                {es ? "Ábrela como una app real — sin buscar el link" : "Open it like a real app — no searching for the link"}
              </div>
            </div>
            <button onClick={dismiss} style={{ background:"none", border:"none", color:"var(--slate)", cursor:"pointer", fontSize:22, lineHeight:1, padding:"0 4px" }}>✕</button>
          </div>

          {/* Step indicator */}
          <div style={{ display:"flex", gap:6, marginBottom:14 }}>
            {steps.map((_, i) => (
              <div key={i} style={{ flex:1, height:4, borderRadius:2, background: i <= step ? "var(--sky)" : "rgba(255,255,255,.12)", transition:".2s" }} />
            ))}
          </div>

          <div style={{ padding:"12px 14px", background:"rgba(59,130,246,.08)", borderRadius:12, border:"1px solid rgba(59,130,246,.2)", marginBottom:14 }}>
            <div style={{ fontSize:13, fontWeight:600, color:"var(--white)" }}>
              {es ? `Paso ${step + 1}:` : `Step ${step + 1}:`} {steps[step]}
            </div>
            {step === 0 && <div style={{ marginTop:8, textAlign:"center", fontSize:32 }}>📤</div>}
            {step === 1 && <div style={{ marginTop:8, fontSize:12, color:"var(--silver)" }}>{es ? "En la parte de abajo de Safari, no en la barra de dirección." : "In the bottom bar of Safari — NOT the address bar at the top."}</div>}
            {step === 2 && <div style={{ marginTop:8, textAlign:"center", fontSize:28 }}>🏠+</div>}
            {step === 3 && <div style={{ marginTop:8, fontSize:12, color:"var(--green)", fontWeight:600 }}>{es ? "✓ ¡Listo! Ya tienes la app en tu pantalla de inicio." : "✓ Done! The GSM Field app is on your home screen."}</div>}
          </div>

          <div style={{ display:"flex", gap:8 }}>
            {step > 0 && <button className="btn btn-s btn-sm" onClick={() => setStep(s => s - 1)}>{es ? "← Atrás" : "← Back"}</button>}
            {step < steps.length - 1
              ? <button className="btn btn-p btn-sm" style={{ flex:1, justifyContent:"center" }} onClick={() => setStep(s => s + 1)}>{es ? "Siguiente →" : "Next Step →"}</button>
              : <button className="btn btn-g btn-sm" style={{ flex:1, justifyContent:"center" }} onClick={dismiss}>{es ? "✓ Listo" : "✓ Done"}</button>}
            <button className="btn btn-s btn-sm" onClick={dismiss}>{es ? "Ahora no" : "Not now"}</button>
          </div>
        </div>
      </div>
    );
  }

  // Android / Chrome
  return (
    <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:500, padding:"0 12px 12px" }}>
      <div style={{ background:"rgba(15,25,36,.97)", border:"1px solid rgba(59,130,246,.4)", borderRadius:18, padding:"16px 18px", boxShadow:"0 -8px 40px rgba(0,0,0,.6)", maxWidth:480, margin:"0 auto", display:"flex", alignItems:"center", gap:14 }}>
        <img src="/icon-admin.png" alt="GSM" style={{ width:52, height:52, objectFit:"contain", flexShrink:0 }} />
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:"'Barlow Condensed'", fontSize:17, fontWeight:800, color:"var(--white)" }}>
            {es ? "Agregar app a tu teléfono" : "Add App to Your Phone"}
          </div>
          <div style={{ fontSize:12, color:"var(--silver)", marginTop:2 }}>
            {es ? "Abre rápido sin buscar el link" : "Open instantly — no link needed"}
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexShrink:0 }}>
          {deferredPrompt
            ? <button className="btn btn-p btn-sm" onClick={installAndroid}>{es ? "Instalar" : "Install"}</button>
            : <button className="btn btn-p btn-sm" onClick={() => { alert(es ? "En Chrome: toca los 3 puntos (⋮) → 'Agregar a pantalla de inicio'" : "In Chrome: tap the 3-dot menu (⋮) → 'Add to Home Screen'"); dismiss(); }}>{es ? "¿Cómo?" : "How?"}</button>}
          <button className="btn btn-s btn-sm" onClick={dismiss}>{es ? "No" : "Skip"}</button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
export default function App() {
  // Restore session — ?login=1 forces fresh login (crew invite links use this)
  const [user, setUser] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("login") === "1") {
        localStorage.removeItem("gsm_session");
        localStorage.removeItem("gsm_quick");
        // Strip ?login=1 from the address bar now — otherwise "Add to Home Screen"
        // saves this exact URL, and every future tap of that icon wipes the
        // session and forces a fresh login instead of staying signed in.
        params.delete("login");
        const clean = window.location.pathname + (params.toString() ? `?${params}` : "");
        window.history.replaceState(null, "", clean);
        return null;
      }
      return JSON.parse(localStorage.getItem("gsm_session") || "null");
    } catch { return null; }
  });
  const [sessionChecked, setSessionChecked] = useState(false);
  const [lang, setLang] = useState(() => localStorage.getItem("gsm_lang") || "en");
  const [theme, setTheme] = useState(() => localStorage.getItem("gsm_theme") || "dark");
  const [online, setOnline] = useState(navigator.onLine);
  const [tab, setTab] = useState("dash");
  const [showInstall, setShowInstall] = useState(false);
  const [logoutGateTasks, setLogoutGateTasks] = useState(null); // tasks to resolve before logout is allowed
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
  const [dispatches, setDispatches] = useState([]);
  const t = T[lang];

  // Restore auth token from sessionStorage on mount
  useEffect(() => { restoreSession(); }, []);

  const login = (u) => {
    localStorage.setItem("gsm_session", JSON.stringify(u));
    localStorage.setItem("gsm_quick", JSON.stringify({ id: u.id, name: u.name, role: u.role, email: u.email }));
    setUser(u);
    setSessionChecked(true);
  };
  const logout = (clearQuick = false) => {
    localStorage.removeItem("gsm_session");
    if (clearQuick) localStorage.removeItem("gsm_quick");
    setSession(null, null);
    if (_tokenRefreshTimer) clearTimeout(_tokenRefreshTimer);
    setUser(null); setRevoked(false);
  };

  // Validate cached session on every load — if no auth token, force fresh login
  useEffect(() => {
    if (!user) { setSessionChecked(true); return; }
    if (!_authToken) {
      localStorage.removeItem("gsm_session");
      setUser(null); setSessionChecked(true); return;
    }
    sbGet("field_profiles", `id=eq.${user.id}&select=id,role,active,name,email`)
      .then(rows => {
        const match = rows?.[0];
        if (!match || match.active === false) {
          // Account gone or deactivated — clear session
          localStorage.removeItem("gsm_session");
          setUser(null);
        } else if (match.role !== user.role) {
          // Role changed in DB — update session to reflect new role
          const updated = { ...user, role: match.role };
          localStorage.setItem("gsm_session", JSON.stringify(updated));
          setUser(updated);
        }
        setSessionChecked(true);
      })
      .catch(() => setSessionChecked(true)); // offline — trust cached session
  }, []);
  useEffect(() => { localStorage.setItem("gsm_lang", lang); }, [lang]);

  // ── LOAD ALL DATA FROM SUPABASE ───────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      try {
        const [dbUsers, dbJobs, dbTasks, dbLogs, dbPhotos, dbReceipts, dbMats, dbDispatch] = await Promise.all([
          sbGet("field_profiles", "order=created_at"),
          sbGet("field_jobs", "order=created_at"),
          sbGet("field_tasks", "order=created_at"),
          sbGet("field_logs", "order=created_at.desc"),
          sbGet("field_photos", "order=created_at.desc"),
          sbGet("field_receipts", "order=created_at.desc"),
          sbGet("field_material_requests", "order=created_at.desc"),
          sbGet("field_dispatch", "order=date.desc"),
        ]);
        if (dbUsers)    setUsers(dbUsers.map(fromProfile));
        if (dbJobs)     setJobs(dbJobs.map(fromJob));
        if (dbTasks)    setTasks(dbTasks.map(fromTask));
        if (dbLogs)     setLogs(dbLogs.map(fromLog));
        if (dbPhotos)   setPhotos(dbPhotos.map(fromPhoto));
        if (dbReceipts) setReceipts(dbReceipts.map(fromReceipt));
        if (dbMats)     setMats(dbMats.map(fromMat));
        if (dbDispatch) setDispatches(dbDispatch.map(fromDispatch));
        if (navigator.onLine) flushQueue();
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
        const [dbTasks, dbLogs, dbPhotos, dbReceipts, dbMats, dbDispatch] = await Promise.all([
          sbGet("field_tasks",            "order=created_at"),
          sbGet("field_logs",             "order=created_at.desc"),
          sbGet("field_photos",           "order=created_at.desc"),
          sbGet("field_receipts",         "order=created_at.desc"),
          sbGet("field_material_requests","order=created_at.desc"),
          sbGet("field_dispatch",         "order=date.desc"),
        ]);
        if (dbTasks)    setTasks(dbTasks.map(fromTask));
        if (dbLogs)     setLogs(dbLogs.map(fromLog));
        if (dbPhotos)   setPhotos(dbPhotos.map(fromPhoto));
        if (dbReceipts) setReceipts(dbReceipts.map(fromReceipt));
        if (dbMats)     setMats(dbMats.map(fromMat));
        if (dbDispatch) setDispatches(dbDispatch.map(fromDispatch));
      } catch {}
    };
    const iv = setInterval(sync, 30000); // 30s — crew needs to see new tasks quickly
    window.addEventListener("focus", sync); // still instant on tab focus
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
  const setIs1099 = async (id, val) => {
    setUsers(u => u.map(x => x.id === id ? { ...x, is1099: val } : x));
    try { await sbPatch("field_profiles", id, { is_1099: val }); } catch {}
  };

  const deletePhoto = async (id) => {
    const photo = photos.find(p => p.id === id);
    setPhotos(p => p.filter(x => x.id !== id));
    try { await sbDelete("field_photos", id); } catch {}
    if (photo?.storagePath) { try { await deleteFromStorage(photo.storagePath); } catch {} }
  };
  const deleteReceipt = async (id) => {
    setReceipts(p => p.filter(x => x.id !== id));
    try { await sbDelete("field_receipts", id); } catch {}
  };
  const deleteLog = async (id) => {
    setLogs(p => p.filter(x => x.id !== id));
    try { await sbDelete("field_logs", id); } catch {}
  };
  const reassignPhoto = async (id, patch) => {
    setPhotos(p => p.map(x => x.id === id ? { ...x, ...patch } : x));
    const dbPatch = {};
    if (patch.jobId  !== undefined) dbPatch.job_id  = patch.jobId;
    if (patch.taskId !== undefined) dbPatch.task_id = patch.taskId;
    try { await sbFetch(`field_photos?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(dbPatch), prefer: "return=minimal" }); } catch {}
  };
  const reassignReceipt = async (id, patch) => {
    setReceipts(p => p.map(x => x.id === id ? { ...x, ...patch } : x));
    const dbPatch = {};
    if (patch.jobId    !== undefined) dbPatch.job_id   = patch.jobId;
    if (patch.taskId   !== undefined) dbPatch.task_id  = patch.taskId;
    if (patch.category !== undefined) dbPatch.category = patch.category;
    try { await sbFetch(`field_receipts?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(dbPatch), prefer: "return=minimal" }); } catch {}
  };
  const upsertDispatch = async (entry) => {
    const id = "d_" + entry.crewId + "_" + entry.date;
    const row = { id, crew_id: entry.crewId, date: entry.date, job_ids: entry.jobIds, custom_stops: entry.customStops, created_by: user.id };
    const isNew = !dispatches.some(d => d.crewId === entry.crewId && d.date === entry.date);
    setDispatches(p => [...p.filter(d => !(d.crewId === entry.crewId && d.date === entry.date)), { id, ...entry, createdBy: user.id }]);
    try { await sbFetch(`field_dispatch?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }); } catch {}
    try { await sbPost("field_dispatch", row); } catch {}
    // Notify crew member when dispatch is first set (not every toggle)
    if (isNew && (entry.jobIds.length > 0 || entry.customStops.length > 0)) {
      const member = users.find(u => u.id === entry.crewId);
      const appUrl = settings?.appUrl || window.location.origin;
      const stopCount = entry.jobIds.length + entry.customStops.length;
      const msg = `📍 New dispatch for ${entry.date}: you have ${stopCount} stop${stopCount !== 1 ? "s" : ""} assigned. Open your app to see where to go. ${appUrl}/?tab=tasks`;
      if (member?.phone) {
        fetch("/.netlify/functions/send-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: member.phone, body: msg }) }).catch(() => {});
      }
      sendPush([entry.crewId], "📍 New Dispatch", `You have ${stopCount} stop${stopCount !== 1 ? "s" : ""} for ${entry.date}. Tap to see where to go.`, "/?tab=tasks");
    }
  };
  const deleteDispatch = async (id) => {
    setDispatches(p => p.filter(d => d.id !== id));
    try { await sbDelete("field_dispatch", id); } catch {}
  };
  const addUser = async (member) => {
    const id = "u" + Date.now();
    const email = member.email?.trim() || `crew_${id}@gsm.local`;
    const role = member.role || "crew";
    const row = { id, name: member.name, role, email, phone: member.phone || "", pin: member.pin, active: true };
    setUsers(u => [...u, { ...row }]);
    try { await sbPost("field_profiles", row); } catch { enqueue({ table: "field_profiles", payload: row }); }
    // Supabase trigger auto-creates auth.users entry on field_profiles INSERT
  };
  const updateUser = async (id, patch) => {
    setUsers(u => u.map(x => x.id === id ? { ...x, ...patch } : x));
    const dbPatch = {};
    if (patch.name)  dbPatch.name  = patch.name;
    if (patch.email) dbPatch.email = patch.email;
    if (patch.phone) dbPatch.phone = patch.phone;
    if (patch.pin)   dbPatch.pin   = patch.pin;
    if (patch.role)  dbPatch.role  = patch.role;
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
    const iv = setInterval(check, 300000); // 5 min — revocation doesn't need 15s polling
    window.addEventListener("focus", check); // still checks on tab focus
    return () => { clearInterval(iv); window.removeEventListener("focus", check); };
  }, [user?.id]);

  useEffect(() => {
    const on = () => { setOnline(true); flushQueue(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Deep link: SMS links route crew to the right tab
  // Also register push subscription for crew members
  useEffect(() => {
    if (!user || user.role !== "crew") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("log") === "1") setTab("log");
    const tabParam = params.get("tab");
    if (tabParam) setTab(tabParam);
    // Register push — fires on login, silently no-ops if already subscribed or denied
    registerPush(user.id);
  }, [user]);

  const saveSettings = async (s) => {
    setSettings(s);
    localStorage.setItem("gsm_set", JSON.stringify(s));
    try {
      await sbFetch("field_integration_settings?id=eq.1", {
        method: "PATCH",
        body: JSON.stringify({ gt_key: s.gtKey || null, app_url: s.appUrl || null, reminder_time: s.reminder || null, admin_phone: s.adminPhone || null }),
        prefer: "return=minimal",
      });
    } catch {}
  };

  // Load settings from Supabase on startup (overrides stale localStorage)
  useEffect(() => {
    sbGet("field_integration_settings", "id=eq.1").then(rows => {
      const r = rows?.[0];
      if (!r) return;
      const merged = {
        ...JSON.parse(localStorage.getItem("gsm_set") || "{}"),
        gtKey: r.gt_key || "",
        appUrl: r.app_url || "",
        reminder: r.reminder_time || "17:00",
        adminPhone: r.admin_phone || "",
      };
      setSettings(merged);
      localStorage.setItem("gsm_set", JSON.stringify(merged));
    }).catch(() => {});
  }, []);

  // QR clock-in intercept — ?job=X&checkin=1 always takes priority
  const _qrp = new URLSearchParams(window.location.search);
  if (_qrp.get("checkin") === "1" && _qrp.get("job")) {
    return <QRClockIn jobId={_qrp.get("job")} theme={theme} loggedInUser={user} />;
  }

  // Wait for session validation before rendering anything
  if (!sessionChecked) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--steel)" }}>
      <style>{CSS}</style>
      <div className="spin" style={{ width: 36, height: 36 }} />
    </div>
  );

  if (!user) {
    const quickUser = (() => { try { return JSON.parse(localStorage.getItem("gsm_quick") || "null"); } catch { return null; } })();
    if (quickUser) return <QuickPIN quick={quickUser} onLogin={login} onSwitch={() => { localStorage.removeItem("gsm_quick"); window.location.reload(); }} theme={theme} lang={lang} />;
    return <Login onLogin={login} t={t} lang={lang} setLang={setLang} theme={theme} toggleTheme={toggleTheme} />;
  }

  if (revoked) return <LockedOut user={user} lang={lang} onAck={logout} />;

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--steel)" }}>
      <style>{CSS}</style>
      <div style={{ textAlign: "center" }}><div className="spin" style={{ width: 36, height: 36, margin: "0 auto 16px" }} />
        <p style={{ color: "var(--silver)", fontSize: 13 }}>Loading...</p></div>
    </div>
  );

  // ── Logout gate — crew must account for today's assigned tasks first ──
  // Fixes crew constantly forgetting to log work: on logout we check the
  // job site(s) they clocked into today for any assigned pending task with
  // no "worked on" or "completed" entry yet, and block until each one is
  // marked either worked-on or done.
  const requestLogout = async () => {
    if (user.role !== "crew") { logout(); return; }
    try {
      const todayD = localDate();
      const checkins = await sbGet("field_checkins", `crew_id=eq.${user.id}&work_date=eq.${todayD}`);
      const todayJobIds = new Set((checkins || []).map(c => c.job_id));
      if (todayJobIds.size === 0) { logout(); return; }
      const already = new Set(
        logs.filter(l => l.crewId === user.id && l.date === todayD &&
          (l.en?.startsWith(`${T.en.workedOnTask}:`) || l.en?.startsWith(`${T.en.completedTask}:`)))
          .map(l => l.taskId)
      );
      const pend = tasks.filter(tk =>
        tk.status === "pending" && !tk.recurring && todayJobIds.has(tk.jobId) &&
        (Array.isArray(tk.assignedTo) ? tk.assignedTo.includes(user.id) : tk.assignedTo === user.id) &&
        !already.has(tk.id)
      );
      if (pend.length === 0) { logout(); return; }
      setLogoutGateTasks(pend);
    } catch { logout(); } // offline/error — never trap someone from logging out
  };

  const resolveTaskComplete = async (task) => {
    if (task.photoRequired && !photos.some(p => p.taskId === task.id)) return false;
    const todayD = localDate();
    setTasks(p => p.map(tk => tk.id === task.id ? { ...tk, status: "done" } : tk));
    try { await sbPatch("field_tasks", task.id, { status: "done", completed_at: new Date().toISOString() }); } catch {}
    const logId = "l" + Date.now();
    const enText = `${T.en.completedTask}: ${task.title}`;
    const esText = `${T.es.completedTask}: ${task.titleEs || task.title}`;
    const log = { id: logId, en: enText, es: esText, weather: "", taskId: task.id, jobId: task.jobId, crewId: user.id, date: todayD };
    setLogs(p => [...p, log]);
    const row = { id: logId, text_en: enText, text_es: esText, task_id: task.id, job_id: task.jobId, crew_id: user.id, log_date: todayD };
    try { await sbPost("field_logs", row); } catch { enqueue({ table: "field_logs", payload: row }); }
    const job = jobs.find(j => j.id === task.jobId);
    if (job?.gsmSync && job?.gsmJobId) {
      fetch("/.netlify/functions/gsm-sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "task_done", gsmJobId: job.gsmJobId, data: { id: logId, taskId: task.id, taskTitle: task.title, crewName: user.name, date: todayD } }),
      }).catch(() => {});
    }
    return true;
  };

  const resolveTaskWorkedOn = async (task) => {
    const todayD = localDate();
    const logId = "l" + Date.now();
    const enText = `${T.en.workedOnTask}: ${task.title}`;
    const esText = `${T.es.workedOnTask}: ${task.titleEs || task.title}`;
    const log = { id: logId, en: enText, es: esText, weather: "", taskId: task.id, jobId: task.jobId, crewId: user.id, date: todayD };
    setLogs(p => [...p, log]);
    const row = { id: logId, text_en: enText, text_es: esText, task_id: task.id, job_id: task.jobId, crew_id: user.id, log_date: todayD };
    try { await sbPost("field_logs", row); } catch { enqueue({ table: "field_logs", payload: row }); }
  };

  const shared = { user, lang, t, jobs, setJobs, tasks, setTasks, receipts, setReceipts,
                   logs, setLogs, photos, setPhotos, mats, setMats, settings, saveSettings, users,
                   online, setActive, setIs1099, addUser, updateUser, removeUser, archiveCrew, unarchiveCrew,
                   dispatches, setDispatches, upsertDispatch, deleteDispatch,
                   deletePhoto, deleteReceipt, deleteLog, reassignPhoto, reassignReceipt };

  return (
    <div className={`app${theme === "light" ? " light" : ""}`}>
      <style>{CSS}</style>
      <TopBar user={user} onLogout={requestLogout} t={t} lang={lang} setLang={setLang} online={online}
        theme={theme} toggleTheme={toggleTheme}
        showMenu={user.role === "admin"} menuOpen={menuOpen} setMenuOpen={setMenuOpen}
        onInstall={() => setShowInstall(true)} />
      {user.role === "admin"
        ? <Admin {...shared} tab={tab} setTab={setTab} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
        : <Crew {...shared} tab={tab} setTab={setTab} />}
      <InstallPrompt lang={lang} externalShow={showInstall} onExternalClose={() => setShowInstall(false)} />
      {logoutGateTasks && (
        <LogoutTaskGate tasks={logoutGateTasks} jobs={jobs} lang={lang} t={t}
          onComplete={resolveTaskComplete} onWorkedOn={resolveTaskWorkedOn}
          onDone={() => { setLogoutGateTasks(null); logout(); }} />
      )}
    </div>
  );
}

// ─── LOGOUT TASK GATE ───────────────────────────────────────────────────
// Blocks logout until every task assigned to the crew member at today's
// job site(s) is marked either worked-on or completed. No skip, no
// backdrop-dismiss — this exists because crew kept forgetting to log work.
function LogoutTaskGate({ tasks, jobs, lang, t, onComplete, onWorkedOn, onDone }) {
  const [remaining, setRemaining] = useState(tasks);
  const [busyId, setBusyId] = useState(null);
  const [warnId, setWarnId] = useState(null);
  const tt = task => lang === "es" ? (task.titleEs || task.title) : task.title;
  const jobName = jid => jobs.find(j => j.id === jid)?.name || "";

  useEffect(() => { if (remaining.length === 0) onDone(); }, [remaining, onDone]);

  const handleComplete = async (task) => {
    setBusyId(task.id); setWarnId(null);
    try {
      const ok = await onComplete(task);
      if (!ok) { setWarnId(task.id); return; }
      setRemaining(r => r.filter(x => x.id !== task.id));
    } catch {
      // Save failed (offline/etc) — let them through rather than trap on a spinner.
      setRemaining(r => r.filter(x => x.id !== task.id));
    } finally {
      setBusyId(null);
    }
  };

  const handleWorkedOn = async (task) => {
    setBusyId(task.id); setWarnId(null);
    try {
      await onWorkedOn(task);
    } catch {
      // Save failed (offline/etc) — let them through rather than trap on a spinner.
    } finally {
      setRemaining(r => r.filter(x => x.id !== task.id));
      setBusyId(null);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(8,15,22,.92)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#10202e", border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 14, maxWidth: 480, width: "100%", maxHeight: "88vh", overflowY: "auto", padding: "22px 20px" }}>
        <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 20, fontWeight: 800, color: "#f8fafc", marginBottom: 4 }}>
          🔧 {t.taskCheckTitle}
        </div>
        <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 16 }}>{t.taskCheckSub}</p>

        {remaining.map(task => (
          <div key={task.id} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)",
            borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#f8fafc", marginBottom: 2 }}>{tt(task)}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>{jobName(task.jobId)}</div>
            {warnId === task.id && (
              <div style={{ fontSize: 12, color: "#f97316", marginBottom: 10 }}>📷 {t.needPhotoFirst}</div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm" style={{ flex: 1, justifyContent: "center",
                  background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", color: "#fff" }}
                disabled={busyId === task.id} onClick={() => handleComplete(task)}>
                {busyId === task.id ? <span className="spin" /> : t.completedTodayBtn}
              </button>
              <button className="btn btn-sm" style={{ flex: 1, justifyContent: "center",
                  background: "rgba(255,255,255,.07)", color: "#cbd5e1", border: "1px solid rgba(59,130,246,.15)" }}
                disabled={busyId === task.id} onClick={() => handleWorkedOn(task)}>
                {busyId === task.id ? <span className="spin" /> : t.workedOnItBtn}
              </button>
            </div>
          </div>
        ))}
      </div>
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

// ─── QUICK PIN ────────────────────────────────────────────────────────
function QuickPIN({ quick, onLogin, onSwitch, theme, lang }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const es = lang === "es";

  const addDigit = (d) => {
    if (pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    setErr("");
    if (next.length >= 4) verify(next);
  };

  const backspace = () => setPin(p => p.slice(0, -1));

  const verify = async (code) => {
    setBusy(true);
    try {
      const rows = await sbGet("field_profiles", `id=eq.${quick.id}&select=id,name,role,email,phone,active,archived`);
      const u = rows?.[0];
      if (!u) { setErr(es ? "Cuenta no encontrada." : "Account not found."); setPin(""); setBusy(false); return; }
      if (u.active === false) { setErr(es ? "Cuenta desactivada." : "Account deactivated."); setBusy(false); return; }
      await sbAuthSignIn(u.id, code);
      onLogin(fromProfile(u));
    } catch (e) {
      setErr(e.message === "auth_failed"
        ? (es ? "PIN incorrecto. Intenta de nuevo." : "Wrong PIN. Try again.")
        : (es ? "Error de conexión." : "Connection error. Try again."));
      setPin("");
      setBusy(false);
    }
  };

  const KEYS = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

  return (
    <div className={`app${theme === "light" ? " light" : ""}`}>
      <style>{CSS}</style>
      <div className="login" style={{ padding: 24 }}>
        <div className="login-card" style={{ maxWidth: 340 }}>
          {/* Avatar */}
          <div style={{ textAlign:"center", marginBottom: 24 }}>
            <div style={{ width:72, height:72, borderRadius:"50%", background:"linear-gradient(135deg,var(--sky-dim),var(--sky))", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px", fontFamily:"'Barlow Condensed'", fontWeight:800, fontSize:32, color:"#fff" }}>
              {quick.name[0]}
            </div>
            <div style={{ fontFamily:"'Barlow Condensed'", fontSize:22, fontWeight:800 }}>
              {es ? "Bienvenido, " : "Welcome back,"}<br/>{quick.name.split(" ")[0]}
            </div>
            <div className="muted" style={{ fontSize:12, marginTop:4 }}>
              {es ? "Ingresa tu PIN para continuar" : "Enter your PIN to continue"}
            </div>
          </div>

          {/* PIN dots */}
          <div style={{ display:"flex", justifyContent:"center", gap:14, marginBottom:28 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ width:18, height:18, borderRadius:"50%", border:"2px solid var(--sky)", background: pin.length > i ? "var(--sky)" : "transparent", transition:".15s" }} />
            ))}
          </div>

          {/* Error */}
          {err && <p style={{ color:"var(--red)", fontSize:13, textAlign:"center", marginBottom:16 }}>{err}</p>}

          {/* Number pad */}
          {busy
            ? <div style={{ textAlign:"center", padding:24 }}><span className="spin" style={{ width:32, height:32, display:"inline-block" }} /></div>
            : <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:20 }}>
                {KEYS.map((k, i) => (
                  k === ""
                    ? <div key={i} />
                    : <button key={i}
                        onClick={() => k === "⌫" ? backspace() : addDigit(k)}
                        disabled={k !== "⌫" && pin.length >= 6}
                        style={{ padding:"18px 0", fontSize: k === "⌫" ? 22 : 26, fontWeight:700, fontFamily:"'Barlow Condensed'", borderRadius:14,
                          border:"1px solid var(--border)", background: k === "⌫" ? "rgba(255,255,255,.05)" : "rgba(59,130,246,.1)",
                          color:"var(--white)", cursor:"pointer", transition:".12s", lineHeight:1 }}>
                        {k}
                      </button>
                ))}
              </div>
          }

          {/* Switch account */}
          <button onClick={onSwitch}
            style={{ width:"100%", background:"none", border:"none", color:"var(--slate)", fontSize:12, cursor:"pointer", textDecoration:"underline", padding:"4px 0" }}>
            {es ? "¿No eres tú? Cambiar cuenta" : "Not you? Switch account"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── QR CLOCK-IN ─────────────────────────────────────────────────────
const QR_MAX_DIST_MI = 0.5;

function QRClockIn({ jobId, theme, loggedInUser }) {
  const [job, setJob] = useState(null);
  const [users, setUsers] = useState([]);
  const [jobProgress, setJobProgress] = useState(null); // { done, total, pct }
  const [step, setStep] = useState("loading"); // loading | pick | pin | confirm-out | done | error
  const [selected, setSelected] = useState(loggedInUser || null);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [openCheckin, setOpenCheckin] = useState(null); // existing open check-in at this job
  const [doneAction, setDoneAction] = useState("in");   // "in" | "out"
  const [doneTime, setDoneTime] = useState(null);
  const [doneHrs, setDoneHrs] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [jobRows, userRows, taskRows] = await Promise.all([
          sbGet("field_jobs", `id=eq.${jobId}&select=*`),
          sbGet("field_profiles", "active=eq.true&archived=eq.false&order=name"),
          sbGet("field_tasks", `job_id=eq.${jobId}&recurring=eq.false&select=id,status`),
        ]);
        if (!jobRows?.[0]) { setErrMsg("Job not found."); setStep("error"); return; }
        setJob(fromJob(jobRows[0]));
        setUsers(userRows.map(fromProfile));
        if (taskRows?.length) {
          const done = taskRows.filter(t => t.status === "done").length;
          setJobProgress({ done, total: taskRows.length, pct: Math.round(done / taskRows.length * 100) });
        }
        setStep(loggedInUser ? "pin" : "pick");
      } catch { setErrMsg("Connection error. Try again."); setStep("error"); }
    };
    load();
  }, [jobId]);

  const doClockIn = async (u) => {
    setBusy(true);
    const gps = await getLocation();
    if (gps && job?.lat && job?.lng) {
      const dist = distanceMi(gps, { lat: job.lat, lng: job.lng });
      if (dist !== null && dist > QR_MAX_DIST_MI) {
        setPinErr(`Too far from site (${dist.toFixed(2)} mi away). Must be within ½ mile. / Demasiado lejos del sitio.`);
        setBusy(false);
        return;
      }
    }
    try {
      const now = new Date();
      const today = localDate();
      // Auto-close any open check-ins at OTHER jobs (job switch)
      const openRows = await sbGet("field_checkins", `crew_id=eq.${u.id}&check_out=is.null`);
      for (const other of (openRows || []).filter(r => r.job_id !== jobId)) {
        const hrs = Math.round((now - new Date(other.check_in)) / 36000) / 100;
        await sbFetch(`field_checkins?id=eq.${other.id}`, {
          method: "PATCH",
          body: JSON.stringify({ check_out: now.toISOString(), hours: hrs, method: "auto" }),
          prefer: "return=minimal",
        });
      }
      // Clock IN
      await sbPost("field_checkins", {
        id: "ci_" + Date.now(),
        crew_id: u.id,
        job_id: jobId,
        check_in: now.toISOString(),
        work_date: today,
        lat_in: gps?.lat || null,
        lng_in: gps?.lng || null,
        method: "qr",
      });
      setDoneAction("in");
      setDoneTime(now);
      setStep("done");
    } catch { setPinErr("Save failed. Try again."); }
    setBusy(false);
  };

  const doClockOut = async () => {
    if (!openCheckin) return;
    setBusy(true);
    const gps = await getLocation();
    const now = new Date();
    const hrs = Math.round((now - new Date(openCheckin.checkIn)) / 36000) / 100;
    try {
      await sbFetch(`field_checkins?id=eq.${openCheckin.id}`, {
        method: "PATCH",
        body: JSON.stringify({ check_out: now.toISOString(), hours: hrs, lat_out: gps?.lat || null, lng_out: gps?.lng || null, method: "qr" }),
        prefer: "return=minimal",
      });
      setDoneAction("out");
      setDoneTime(now);
      setDoneHrs(hrs);
      setStep("done");
    } catch { setPinErr("Save failed. Try again."); }
    setBusy(false);
  };

  const addDigit = (d) => {
    if (pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    setPinErr("");
    if (next.length >= 4) verifyPin(next);
  };

  const verifyPin = async (code) => {
    setBusy(true);
    try {
      const rows = await sbGet("field_profiles", `id=eq.${selected.id}&select=pin,active`);
      const u = rows?.[0];
      if (!u || u.pin !== code) { setPinErr("Wrong PIN. / PIN incorrecto."); setPin(""); setBusy(false); return; }
      if (u.active === false) { setPinErr("Account deactivated."); setBusy(false); return; }

      // Check all open check-ins for this user
      const open = await sbGet("field_checkins", `crew_id=eq.${selected.id}&check_out=is.null`);
      const sameJobOpen = (open || []).find(r => r.job_id === jobId);

      if (sameJobOpen) {
        const now = new Date();
        const minsSince = (now - new Date(sameJobOpen.check_in)) / 60000;
        if (minsSince < 15) {
          // Within 15 min — block duplicate to prevent accidental double check-in
          const since = new Date(sameJobOpen.check_in).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const minsLeft = Math.ceil(15 - minsSince);
          setPinErr(`Already clocked in at ${since}. Rescan in ${minsLeft} min to clock out. / Ya registrado a las ${since}. Vuelve a escanear en ${minsLeft} min para salir.`);
          setPin("");
          setBusy(false);
        } else {
          // After 15 min on same job — rescan = clock out
          setOpenCheckin(fromCheckin(sameJobOpen));
          setBusy(false);
          setStep("confirm-out");
        }
        return;
      }

      // Not clocked in at this job — proceed with clock-in (handles job switch internally)
      await doClockIn(selected);
    } catch { setPinErr("Connection error."); setBusy(false); }
  };

  const KEYS = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

  const dismiss = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("job");
    url.searchParams.delete("checkin");
    window.history.replaceState({}, "", url.toString());
    window.location.reload();
  };

  const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className={`app${theme === "light" ? " light" : ""}`}>
      <style>{CSS}</style>
      <div className="login">
        <div className="login-card" style={{ maxWidth: 360 }}>

          {step === "loading" && (
            <div style={{ textAlign: "center", padding: 48 }}>
              <div className="spin" style={{ width: 36, height: 36, display: "inline-block" }} />
            </div>
          )}

          {step === "error" && (
            <div style={{ textAlign: "center", padding: 24 }}>
              <div style={{ color: "var(--red)", marginBottom: 16 }}>{errMsg}</div>
              <button className="btn btn-s" onClick={dismiss}>Go to App</button>
            </div>
          )}

          {step === "pick" && (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div className="logo-mark" style={{ background: "linear-gradient(135deg,var(--accent),#b45309)" }}>
                  <Icon n="pin" s={28} c="#fff" />
                </div>
                <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 24, fontWeight: 800, marginTop: 14 }}>{job?.name}</div>
                {job?.address && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{job.address}</div>}
                {jobProgress && (
                  <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(59,130,246,.1)", borderRadius: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: "var(--slate)" }}>Job Progress</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: jobProgress.pct === 100 ? "var(--green)" : "var(--sky2)" }}>{jobProgress.done}/{jobProgress.total} · {jobProgress.pct}%</span>
                    </div>
                    <div style={{ height: 4, background: "rgba(255,255,255,.1)", borderRadius: 2 }}>
                      <div style={{ height: 4, borderRadius: 2, width: jobProgress.pct + "%", background: jobProgress.pct === 100 ? "var(--green)" : "var(--sky)", transition: ".3s" }} />
                    </div>
                  </div>
                )}
                <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>Who are you? · ¿Quién eres tú?</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {users.map(u => (
                  <button key={u.id}
                    onClick={() => { setSelected(u); setStep("pin"); setPin(""); setPinErr(""); }}
                    style={{ padding: "13px 16px", borderRadius: 12, border: "1px solid var(--border)",
                      background: "rgba(59,130,246,.08)", color: "var(--white)", cursor: "pointer",
                      fontFamily: "'Barlow Condensed'", fontSize: 18, fontWeight: 700, textAlign: "left",
                      display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%",
                      background: "linear-gradient(135deg,var(--sky-dim),var(--sky))",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 16, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
                      {u.name[0]}
                    </div>
                    {u.name}
                  </button>
                ))}
              </div>
              <button onClick={dismiss}
                style={{ width: "100%", background: "none", border: "none", color: "var(--slate)", fontSize: 12, cursor: "pointer", textDecoration: "underline", marginTop: 16, padding: "4px 0" }}>
                Not clocking in? Go to app →
              </button>
            </>
          )}

          {step === "pin" && (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ width: 60, height: 60, borderRadius: "50%",
                  background: "linear-gradient(135deg,var(--sky-dim),var(--sky))",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 12px", fontSize: 26, fontWeight: 800, color: "#fff" }}>
                  {selected?.name?.[0]}
                </div>
                <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 20, fontWeight: 800 }}>{selected?.name}</div>
                <div style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13, marginTop: 4 }}>{job?.name}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Enter your PIN / Ingresa tu PIN</div>
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 14, marginBottom: 24 }}>
                {[0,1,2,3].map(i => (
                  <div key={i} style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid var(--sky)",
                    background: pin.length > i ? "var(--sky)" : "transparent", transition: ".15s" }} />
                ))}
              </div>
              {pinErr && <p style={{ color: "var(--red)", fontSize: 13, textAlign: "center", marginBottom: 16 }}>{pinErr}</p>}
              {busy
                ? <div style={{ textAlign: "center", padding: 24 }}><span className="spin" style={{ width: 32, height: 32, display: "inline-block" }} /></div>
                : <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
                    {KEYS.map((k, i) => (
                      k === "" ? <div key={i} />
                        : <button key={i}
                            onClick={() => k === "⌫" ? (setPin(p => p.slice(0,-1)), setPinErr("")) : addDigit(k)}
                            style={{ padding: "18px 0", fontSize: k === "⌫" ? 22 : 26, fontWeight: 700,
                              fontFamily: "'Barlow Condensed'", borderRadius: 14,
                              border: "1px solid var(--border)",
                              background: k === "⌫" ? "rgba(255,255,255,.05)" : "rgba(59,130,246,.1)",
                              color: "var(--white)", cursor: "pointer", lineHeight: 1 }}>
                            {k}
                          </button>
                    ))}
                  </div>
              }
              {!loggedInUser && (
                <button onClick={() => { setStep("pick"); setSelected(null); setPin(""); setPinErr(""); }}
                  style={{ width: "100%", background: "none", border: "none", color: "var(--slate)", fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: "4px 0" }}>
                  ← Back / Regresar
                </button>
              )}
            </>
          )}

          {step === "confirm-out" && openCheckin && (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ width: 60, height: 60, borderRadius: "50%",
                background: "linear-gradient(135deg,var(--sky-dim),var(--sky))",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 14px", fontSize: 26, fontWeight: 800, color: "#fff" }}>
                {selected?.name?.[0]}
              </div>
              <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 20, fontWeight: 800, marginBottom: 4 }}>{selected?.name}</div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--accent)", marginBottom: 16 }}>{job?.name}</div>
              <div style={{ background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.3)", borderRadius: 12, padding: "14px 16px", marginBottom: 20 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Currently clocked in since</div>
                <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 28, fontWeight: 800, color: "var(--green)" }}>{fmtTime(openCheckin.checkIn)}</div>
                <div style={{ fontSize: 12, color: "var(--slate)", marginTop: 4 }}>
                  {(() => { const m = Math.round((Date.now() - new Date(openCheckin.checkIn)) / 60000); return m < 60 ? `${m} min on site` : `${(m/60).toFixed(1)} hrs on site`; })()}
                </div>
              </div>
              {pinErr && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{pinErr}</p>}
              <button onClick={doClockOut} disabled={busy}
                style={{ width: "100%", padding: "16px", borderRadius: 12, border: "none",
                  background: "linear-gradient(135deg,#059669,#10b981)", color: "#fff",
                  fontFamily: "'Barlow Condensed'", fontSize: 20, fontWeight: 800, cursor: "pointer", marginBottom: 10 }}>
                {busy ? "..." : "Clock Out · Salida"}
              </button>
              <button onClick={() => { setStep("pick"); setOpenCheckin(null); setPin(""); setPinErr(""); }}
                style={{ background: "none", border: "none", color: "var(--slate)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
                ← Back
              </button>
            </div>
          )}

          {step === "done" && (
            <div style={{ textAlign: "center", padding: 24 }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%",
                background: doneAction === "out" ? "linear-gradient(135deg,#059669,#10b981)" : "linear-gradient(135deg,var(--sky-dim),var(--sky))",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 18px" }}>
                <Icon n="check" s={32} c="#fff" />
              </div>
              <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 28, fontWeight: 800, marginBottom: 6 }}>
                {doneAction === "out" ? "Clocked Out!" : "Clocked In!"}
              </div>
              <div style={{ color: "var(--accent)", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{job?.name}</div>
              <div className="muted" style={{ fontSize: 13 }}>{selected?.name} · {fmtTime(doneTime)}</div>
              {doneAction === "out" && doneHrs !== null && (
                <div style={{ marginTop: 10, fontFamily: "'Barlow Condensed'", fontSize: 22, fontWeight: 800, color: "var(--green)" }}>
                  {doneHrs.toFixed(1)} hrs
                </div>
              )}
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {doneAction === "out" ? "Salida registrada ✓" : "Entrada registrada ✓"}
              </div>
              <button className="btn btn-s" onClick={dismiss} style={{ marginTop: 24 }}>Done →</button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────
function Login({ onLogin, t, lang, setLang, theme, toggleTheme }) {
  const [login, setLogin] = useState(""), [pin, setPin] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const go = async () => {
    if (!login || !pin) return setErr(lang === "en" ? "Enter email or phone, and PIN." : "Ingresa email o teléfono, y PIN.");
    setBusy(true); setErr("");
    try {
      const val = login.trim().toLowerCase();
      let rows = await sbGet("field_profiles", `email=eq.${encodeURIComponent(val)}&select=id,name,role,email,phone,active,archived`);
      if (!rows?.length) {
        const digitsIn = login.trim().replace(/\D/g, "").slice(-10);
        const allProfiles = await sbGet("field_profiles", "select=id,name,role,email,phone,active,archived");
        rows = (allProfiles || []).filter(p => p.phone && p.phone.replace(/\D/g, "").slice(-10) === digitsIn);
      }
      const u = rows?.[0];
      if (!u) { setErr(lang === "en" ? "Invalid credentials." : "Credenciales inválidas."); setBusy(false); return; }
      if (u.active === false) { setErr(lang === "en" ? "Account deactivated." : "Cuenta desactivada."); setBusy(false); return; }
      await sbAuthSignIn(u.id, pin);
      onLogin(fromProfile(u));
    } catch (e) {
      setErr(e.message === "auth_failed"
        ? (lang === "en" ? "Invalid credentials." : "Credenciales inválidas.")
        : (lang === "en" ? "Connection error. Try again." : "Error de conexión."));
    }
    setBusy(false);
  };
  return (
    <div className={`app${theme === "light" ? " light" : ""}`}><div className="login"><style>{CSS}</style>
      <div className="login-card">
        <div className="logo-mark"><Icon n="briefcase" s={32} c="#fff" /></div>
        <div className="logo-title">GS MASTERS</div>
        <div className="logo-sub">Field App</div>
        <div style={{ marginTop: 32 }}>
          <div className="fg"><label className="fl">Email or Phone Number</label>
            <input className="fi" type="text" value={login} onChange={e => setLogin(e.target.value)} placeholder="email or (205) 555-1234" /></div>
          <div className="fg"><label className="fl">PIN</label>
            <input className="fi" type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="••••" maxLength={6}
              onKeyDown={e => e.key === "Enter" && go()} />
            <p style={{ fontSize: 11, color: "var(--slate)", marginTop: 4 }}>
              {lang === "es" ? "Usa tu correo o número de teléfono" : "Use your email or phone number to sign in"}
            </p></div>
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
function TopBar({ user, onLogout, t, lang, setLang, online, showMenu, menuOpen, setMenuOpen, theme, toggleTheme, onInstall }) {
  const iconSrc = "/icon-admin.png";
  const installed = isInStandalone();
  return (
    <div className="topbar">
      <div className="tb-brand">
        {showMenu && <button className="btn btn-ghost btn-ic hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
          <Icon n={menuOpen ? "x" : "menu"} s={18} /></button>}
        <div style={{ width:36, height:36, borderRadius:8, background:'#052f69', flexShrink:0, position:'relative', overflow:'hidden' }}>
          <img src={iconSrc} alt="GSM" style={{ width:44, height:44, position:'absolute', top:-6, left:-4, clipPath:'inset(17% 19% 10% 19% round 5px)' }} />
        </div>
        <span className="tb-title">GS MASTERS FIELD</span></div>
      <div className="tb-right">
        <span className={`net-dot ${online ? "net-on" : "net-off"}`}>
          <Icon n={online ? "wifi" : "wifiOff"} s={12} /> <span className="net-txt">{online ? t.online : t.offline}</span></span>
        {!installed && (
          <button className="btn btn-s btn-sm" onClick={onInstall} title={lang === "es" ? "Agregar a pantalla de inicio" : "Add to Home Screen"}
            style={{ fontWeight: 700, color: "var(--sky2)", borderColor: "rgba(59,130,246,.4)" }}>
            📲 {lang === "es" ? "Instalar" : "Install"}
          </button>
        )}
        <button className="btn btn-ghost btn-sm btn-ic" onClick={toggleTheme} title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          style={{ fontSize: 15 }}>{theme === "dark" ? "☀️" : "🌙"}</button>
        <button className="btn btn-s btn-sm" onClick={() => setLang(lang === "en" ? "es" : "en")}>
          <Icon n="translate" s={14} /> {lang === "en" ? "ES" : "EN"}</button>
        <span className="muted tb-name" style={{ fontSize: 13 }}>{user.name}</span>
        <span className={`badge badge-${user.role}`}>{user.role}</span>
        <button className="btn btn-ghost btn-sm btn-ic" onClick={onLogout}><Icon n="logout" s={16} /></button>
      </div>
    </div>
  );
}

// ─── ADMIN ────────────────────────────────────────────────────────────
function Admin(props) {
  const { t, tab, setTab, menuOpen, setMenuOpen } = props;
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedJobId, setSelectedJobId] = useState(null);
  const nav = [
    { k: "dash",     i: "home",      l: "Dashboard"    },
    { k: "dispatch", i: "pin",       l: "Dispatch"     },
    { k: "activity", i: "report",    l: "Live Activity" },
    { k: "tasks",    i: "tasks",     l: t.tasks        },
    { k: "archive",  i: "archive",   l: "Archive"      },
    { k: "cal",      i: "calendar",  l: "Calendar"     },
    { k: "report",   i: "report",   l: "Reports"      },
    { k: "receipts", i: "receipt",   l: t.receipts     },
    { k: "photos",   i: "photo",     l: "Photos"       },
    { k: "jobs",     i: "briefcase", l: "Jobs"         },
    { k: "crew",     i: "users",     l: "Crew"         },
    { k: "hours",    i: "calendar",  l: "Hours"        },
    { k: "qr",       i: "pin",       l: "QR Codes"     },
    { k: "set",      i: "settings",  l: "Settings"     },
    { k: "field",    i: "pin",       l: "📱 Field Mode" },
  ];
  const pick = k => { setTab(k); setStatusFilter("all"); setMenuOpen(false); };
  const navTo = (destTab, filter) => { setTab(destTab); setStatusFilter(filter); setMenuOpen(false); };
  const openJobDetail = (jobId) => { setSelectedJobId(jobId); setTab("jobdetail"); setMenuOpen(false); };
  return (
    <div className="layout">
      {menuOpen && <div className="side-scrim" onClick={() => setMenuOpen(false)} />}
      <div className={`side ${menuOpen ? "side-open" : ""}`}><div className="nav-sec">Navigation</div>
        {nav.map(n => <div key={n.k} className={`nav ${tab === n.k ? "on" : ""}`} onClick={() => pick(n.k)}>
          <Icon n={n.i} s={17} /> {n.l}</div>)}</div>
      <div className="content">
        {tab === "dash"     && <Dash {...props} navTo={navTo} setTab={setTab} openJobDetail={openJobDetail} mats={props.mats} setMats={props.setMats} />}
        {tab === "dispatch" && <AdminDispatch {...props} />}
        {tab === "activity" && <AdminActivity {...props} />}
        {tab === "tasks"    && <AdminTasks {...props} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />}
        {tab === "archive"  && <AdminArchive {...props} />}
        {tab === "cal"      && <Calendar {...props} />}
        {tab === "report"   && <Report {...props} />}
        {tab === "receipts" && <AdminReceipts {...props} />}
        {tab === "photos"   && <AdminPhotos {...props} />}
        {tab === "jobs"     && <Jobs {...props} />}
        {tab === "crew"     && <CrewMgmt {...props} />}
        {tab === "hours"    && <AdminHours {...props} />}
        {tab === "qr"       && <AdminQRCodes {...props} />}
        {tab === "set"      && <Settings {...props} />}
        {tab === "field"    && <AdminFieldMode {...props} />}
        {tab === "jobdetail"&& <JobDetail {...props} selectedJobId={selectedJobId} setTab={setTab} />}
      </div>
    </div>
  );
}

function Dash({ tasks, jobs, users, receipts, mats, setMats, setTab, navTo, openJobDetail, settings }) {
  const today = localDate();
  const [checkins, setCheckins] = useState([]);
  const [checkinLoading, setCheckinLoading] = useState(true);
  const [issues, setIssues] = useState([]);
  const [replyOpen, setReplyOpen] = useState(null);
  const [replyText, setReplyText] = useState("");

  const loadCheckins = () =>
    sbGet("field_checkins", `work_date=eq.${today}&order=check_in.asc`)
      .then(rows => { if (rows) setCheckins(rows.map(fromCheckin)); })
      .catch(() => {})
      .finally(() => setCheckinLoading(false));

  const loadIssues = () =>
    sbGet("field_logs", `log_date=eq.${today}&text_en=ilike.*ISSUE*&order=created_at.desc`)
      .then(rows => { if (rows) setIssues(rows); })
      .catch(() => {});

  const clockOutCrew = async (ci) => {
    const now = new Date();
    const hrs = Math.round(((now - new Date(ci.checkIn)) / 3600000) * 100) / 100;
    setCheckins(p => p.map(c => c.id === ci.id ? { ...c, checkOut: now.toISOString(), hours: hrs } : c));
    try { await sbFetch(`field_checkins?id=eq.${ci.id}`, { method: "PATCH", body: JSON.stringify({ check_out: now.toISOString(), hours: hrs }), prefer: "return=minimal" }); } catch {}
  };

  const pendingMats = (mats || []).filter(m => !m.fulfilled);

  const fulfillMat = async (id) => {
    setMats(p => p.map(m => m.id === id ? { ...m, fulfilled: true } : m));
    try { await sbFetch(`field_material_requests?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ fulfilled: true }), prefer: "return=minimal" }); } catch {}
    const m = (mats || []).find(x => x.id === id);
    const crewPhone = m && users.find(u => u.id === m.crewId)?.phone;
    if (crewPhone) {
      const j = m ? jobs.find(x => x.id === m.jobId)?.name : "";
      fetch("/.netlify/functions/send-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: crewPhone, body: `🔧 Your material request has been fulfilled: "${m.en}"${j ? " — " + j : ""}. Check the job site. — G.S. Masters` }) }).catch(() => {});
    }
  };

  const resolveIssue = async (id) => {
    setIssues(p => p.map(i => i.id === id ? { ...i, resolved: true } : i));
    try { await sbFetch(`field_logs?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ resolved: true }), prefer: "return=minimal" }); } catch {}
  };

  const sendReply = async (issue) => {
    if (!replyText.trim()) return;
    const reply = replyText.trim();
    setIssues(p => p.map(i => i.id === issue.id ? { ...i, admin_reply: reply } : i));
    setReplyOpen(null);
    setReplyText("");
    try { await sbFetch(`field_logs?id=eq.${issue.id}`, { method: "PATCH", body: JSON.stringify({ admin_reply: reply }), prefer: "return=minimal" }); } catch {}
    const crewMember = users.find(u => u.id === issue.crewId);
    if (crewMember?.phone) {
      const crewFirstName = crewMember.name?.split(" ")[0] || "Crew";
      const smsBody = `Hi ${crewFirstName}, Admin replied to your issue: "${reply}" — GS Masters Field App`;
      fetch("/.netlify/functions/send-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: crewMember.phone, body: smsBody }) }).catch(() => {});
    }
    sendPush([issue.crewId], "💬 Admin Reply", reply.slice(0, 100), "/?log=1");
  };

  useEffect(() => {
    loadCheckins();
    loadIssues();
    const iv = setInterval(() => { loadCheckins(); loadIssues(); }, 90000);
    return () => clearInterval(iv);
  }, []);

  const crewName = id => users.find(u => u.id === id)?.name || "Unknown";
  const jobName  = id => jobs.find(j => j.id === id)?.name  || id;
  const fmt = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

  const onSite = checkins.filter(c => !c.checkOut);
  const activeJobs = jobs.filter(j => j.status !== "closed");
  const done    = tasks.filter(t => t.status === "done").length;
  const overdue = tasks.filter(t => t.status === "pending" && t.dueDate && t.dueDate < today).length;
  const pending = tasks.filter(t => t.status === "pending" && (!t.dueDate || t.dueDate >= today)).length;

  return (
    <div>
      <h2 className="h2 fade" style={{ marginBottom: 18 }}>Dashboard</h2>

      {/* ── TODAY'S ATTENDANCE ────────────────────────────────── */}
      <div className="card fade" style={{ marginBottom: 20, border: onSite.length > 0 ? "1px solid rgba(16,185,129,.4)" : "1px solid var(--border)" }}>
        <div className="flexb" style={{ marginBottom: checkins.length > 0 ? 14 : 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: onSite.length > 0 ? "var(--green)" : "var(--silver)" }}>
              {onSite.length > 0 ? "●" : "○"} Today's Attendance
            </span>
            {onSite.length > 0 && (
              <span style={{ background: "rgba(16,185,129,.18)", color: "var(--green)", fontWeight: 800, fontSize: 12, padding: "2px 8px", borderRadius: 20, fontFamily: "'Barlow Condensed'" }}>
                {onSite.length} on site
              </span>
            )}
          </div>
          <button onClick={loadCheckins} title="Refresh"
            style={{ background: "none", border: "none", color: "var(--slate)", fontSize: 14, cursor: "pointer", padding: "2px 8px", lineHeight: 1 }}>↻</button>
        </div>

        {checkinLoading
          ? <div style={{ padding: "14px 0", textAlign: "center" }}><span className="spin" style={{ width: 20, height: 20, display: "inline-block" }} /></div>
          : checkins.length === 0
            ? <div className="muted" style={{ fontSize: 13 }}>No check-ins yet today.</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {/* Header row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px 70px 50px 90px", gap: "0 8px", padding: "0 4px 8px", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
                  {["Name","Job","In","Out","Hrs",""].map(h => (
                    <div key={h} style={{ fontSize: 10, fontWeight: 700, color: "var(--slate)", textTransform: "uppercase", letterSpacing: 1 }}>{h}</div>
                  ))}
                </div>
                {checkins.map(ci => {
                  const open = !ci.checkOut;
                  const hrs = ci.checkOut && !ci.autoClosed
                    ? (+(ci.hours || 0)).toFixed(1)
                    : ci.checkOut && ci.autoClosed ? "—" : null;
                  return (
                    <div key={ci.id}
                      style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px 70px 50px 90px", gap: "0 8px", padding: "7px 4px", borderBottom: "1px solid rgba(255,255,255,.04)", cursor: open ? "default" : "pointer", borderRadius: 6 }}
                      onClick={() => !open && setTab("hours")}>
                      {/* Name */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                          background: open ? "linear-gradient(135deg,var(--sky-dim),var(--sky))" : "rgba(255,255,255,.1)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 13, color: "#fff" }}>
                          {crewName(ci.crewId)[0]}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {crewName(ci.crewId)}
                        </span>
                      </div>
                      {/* Job */}
                      <div style={{ fontSize: 12, color: open ? "var(--white)" : "var(--silver)", fontWeight: open ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", alignSelf: "center" }}>
                        {jobName(ci.jobId)}
                      </div>
                      {/* In */}
                      <div style={{ fontSize: 12, color: "var(--sky2)", fontFamily: "'Barlow Condensed'", fontWeight: 700, alignSelf: "center" }}>
                        {fmt(ci.checkIn)}
                      </div>
                      {/* Out */}
                      <div style={{ fontSize: 12, fontFamily: "'Barlow Condensed'", fontWeight: 700, alignSelf: "center",
                        color: open ? "var(--green)" : ci.autoClosed ? "var(--slate)" : "var(--silver)" }}>
                        {open ? "● on site" : ci.autoClosed ? `${fmt(ci.checkOut)} (auto)` : fmt(ci.checkOut)}
                      </div>
                      {/* Hours */}
                      <div style={{ fontSize: 13, fontFamily: "'Barlow Condensed'", fontWeight: 800, alignSelf: "center",
                        color: open ? "var(--green)" : ci.autoClosed ? "var(--slate)" : "var(--accent)" }}>
                        {open ? "…" : hrs}
                      </div>
                      {/* Clock Out */}
                      <div style={{ alignSelf: "center" }}>
                        {open ? (
                          <button onClick={e => { e.stopPropagation(); clockOutCrew(ci); }}
                            style={{ fontSize: 11, fontWeight: 700, padding: "4px 9px", borderRadius: 7, border: "1px solid rgba(16,185,129,.5)", background: "rgba(16,185,129,.12)", color: "var(--green)", cursor: "pointer", whiteSpace: "nowrap" }}>
                            Clock Out
                          </button>
                        ) : (
                          <span style={{ fontSize: 10, color: "var(--slate)", cursor: "pointer" }} onClick={e => { e.stopPropagation(); setTab("hours"); }}>view →</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
        }
      </div>

      {/* ── FLAGGED ISSUES TODAY ─────────────────────────────── */}
      {issues.length > 0 && (
        <div className="card fade" style={{ marginBottom: 20, border: `1px solid ${issues.some(i => !i.resolved) ? "rgba(239,68,68,.4)" : "rgba(16,185,129,.3)"}`, background: issues.some(i => !i.resolved) ? "rgba(239,68,68,.04)" : "rgba(16,185,129,.04)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 16 }}>🚩</span>
            <span style={{ fontWeight: 800, fontSize: 15, color: issues.some(i => !i.resolved) ? "var(--red)" : "var(--green)" }}>Issues Flagged Today</span>
            {issues.filter(i => !i.resolved).length > 0 && <span style={{ background: "rgba(239,68,68,.18)", color: "var(--red)", fontWeight: 800, fontSize: 12, padding: "2px 8px", borderRadius: 20, fontFamily: "'Barlow Condensed'" }}>{issues.filter(i => !i.resolved).length} open</span>}
            {issues.filter(i => i.resolved).length > 0 && <span style={{ background: "rgba(16,185,129,.18)", color: "var(--green)", fontWeight: 800, fontSize: 12, padding: "2px 8px", borderRadius: 20, fontFamily: "'Barlow Condensed'" }}>{issues.filter(i => i.resolved).length} resolved</span>}
          </div>
          {issues.map(issue => {
            const name = users.find(u => u.id === issue.crew_id)?.name || "Crew";
            const msg = (issue.text_en || "").replace(/^🚩 ISSUE from [^:]+: /, "");
            const isResolved = issue.resolved;
            const isReplyOpen = replyOpen === issue.id;
            return (
              <div key={issue.id} style={{ padding: "10px 12px", background: isResolved ? "rgba(16,185,129,.06)" : "rgba(239,68,68,.07)", borderRadius: 8, marginBottom: 6, borderLeft: `3px solid ${isResolved ? "var(--green)" : "var(--red)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: isResolved ? "var(--green)" : "var(--red)" }}>{name}{isResolved ? " ✓" : ""}</div>
                  {!isResolved && (
                    <div style={{ display: "flex", gap: 4, flexShrink: 0, marginLeft: 8 }}>
                      <button onClick={() => { setReplyOpen(isReplyOpen ? null : issue.id); setReplyText(""); }}
                        style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(59,130,246,.4)", background: isReplyOpen ? "rgba(59,130,246,.2)" : "rgba(59,130,246,.1)", color: "var(--sky2)", cursor: "pointer" }}>
                        💬 Reply
                      </button>
                      <button onClick={() => resolveIssue(issue.id)}
                        style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(16,185,129,.4)", background: "rgba(16,185,129,.1)", color: "var(--green)", cursor: "pointer" }}>
                        ✓ Resolved
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 13 }}>{msg}</div>
                {issue.admin_reply && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "var(--sky2)", background: "rgba(59,130,246,.08)", borderRadius: 6, padding: "5px 8px", borderLeft: "2px solid var(--sky2)" }}>
                    <span style={{ fontWeight: 700 }}>Admin:</span> {issue.admin_reply}
                  </div>
                )}
                {isReplyOpen && (
                  <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                    <input type="text" value={replyText} onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && sendReply(issue)}
                      placeholder="Type reply — sends SMS to crew…"
                      style={{ flex: 1, background: "rgba(255,255,255,.07)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "var(--white)" }} />
                    <button onClick={() => sendReply(issue)}
                      style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "var(--sky)", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Send</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── MATERIAL REQUESTS ─────────────────────────────────── */}
      {pendingMats.length > 0 && (
        <div className="card fade" style={{ marginBottom: 20, border: "1px solid rgba(245,158,11,.4)", background: "rgba(245,158,11,.04)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 16 }}>🔧</span>
            <span style={{ fontWeight: 800, fontSize: 15, color: "var(--accent)" }}>Material Requests</span>
            <span style={{ background: "rgba(245,158,11,.18)", color: "var(--accent)", fontWeight: 800, fontSize: 12, padding: "2px 8px", borderRadius: 20, fontFamily: "'Barlow Condensed'" }}>{pendingMats.length} pending</span>
          </div>
          {pendingMats.map(m => {
            const cr = users.find(u => u.id === m.crewId);
            const j  = jobs.find(j => j.id === m.jobId);
            const tk = tasks.find(t => t.id === m.taskId);
            return (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "rgba(245,158,11,.07)", borderRadius: 8, marginBottom: 6, borderLeft: "3px solid var(--accent)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{m.en}</div>
                  <div style={{ fontSize: 11, color: "var(--slate)", marginTop: 2 }}>
                    {cr?.name}{j ? ` · ${j.name}` : ""}{tk ? ` · ${tk.title}` : ""}
                  </div>
                </div>
                <button onClick={() => fulfillMat(m.id)}
                  style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(16,185,129,.4)", background: "rgba(16,185,129,.1)", color: "var(--green)", cursor: "pointer", whiteSpace: "nowrap" }}>
                  ✓ Fulfilled
                </button>
              </div>
            );
          })}
        </div>
      )}

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
              return <div key={job.id} className="job-prog" onClick={() => openJobDetail ? openJobDetail(job.id) : setTab("tasks")} style={{ marginBottom: 14, cursor: "pointer" }}>
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
  const { tasks, setTasks, jobs, users, t, lang, settings, statusFilter = "all", setStatusFilter, photos, setPhotos, user } = props;
  const [jobFilter, setJobFilter] = useState("all");
  const [modal, setModal] = useState(false);
  const [nt, setNt] = useState({ title: "", titleEs: "", jobId: "", assignedTo: [], dueDate: "", priority: "normal", recurring: false, photoRequired: false });
  const [editTask, setEditTask] = useState(null); // task being edited
  const [editForm, setEditForm] = useState({});
  const [busy, setBusy] = useState(false);
  const today = localDate();
  // Photo attachment on task creation
  const [taskPhoto, setTaskPhoto] = useState(null);   // { dataUrl, sizeKB }
  const [taskPhotoNote, setTaskPhotoNote] = useState("");
  const [taskPhotoType, setTaskPhotoType] = useState("before");
  const photoRef = useRef();
  const captureTaskPhoto = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const { dataUrl, sizeKB } = await compressImage(file); setTaskPhoto({ dataUrl, sizeKB }); }
    catch { alert("Could not process image. Try again."); }
    e.target.value = "";
  };

  // Apply status filter first, then job filter
  // Done tasks older than 24h are archived — never shown here
  const adminCutoff24h = new Date(Date.now() - 24 * 3600000).toISOString();
  const statusFiltered = tasks.filter(task => {
    if (task.status === "done" && task.completedAt && task.completedAt < adminCutoff24h) return false;
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
    if (!nt.title || !nt.jobId) return;
    if (!nt.recurring && !nt.assignedTo.length) return;
    setBusy(true);
    let es;
    try { es = settings?.gtKey ? await translateText(nt.title, "es", settings.gtKey) : nt.title; }
    catch { es = nt.title; }
    const id = "t" + Date.now();
    const task = { id, jobId: nt.jobId, title: nt.title, titleEs: es || nt.title, assignedTo: nt.assignedTo, dueDate: nt.dueDate, status: "pending", createdAt: today, priority: nt.priority, recurring: nt.recurring, photoRequired: nt.photoRequired };
    setTasks(p => [...p, task]);
    const row = { id, job_id: nt.jobId, title: nt.title, title_es: es || nt.title, assigned_to: nt.assignedTo, due_date: nt.dueDate || null, status: "pending", priority: toPriority(nt.priority), recurring: nt.recurring, photo_required: nt.photoRequired };
    try { await sbPost("field_tasks", row); } catch { enqueue({ table: "field_tasks", payload: row }); }
    // Save attached photo if provided
    if (taskPhoto && nt.jobId) {
      const pid = "p" + Date.now();
      let storagePath = null;
      try { storagePath = await uploadToStorage(taskPhoto.dataUrl, `${user?.id||"admin"}/${pid}.jpg`); } catch {}
      const prow = { id: pid, data_url: storagePath ? null : taskPhoto.dataUrl, storage_path: storagePath, photo_type: taskPhotoType, task_id: id, job_id: nt.jobId, crew_id: user?.id || "admin", size_kb: taskPhoto.sizeKB, note: taskPhotoNote || null };
      if (setPhotos) setPhotos(p => [...p, { id: pid, dataUrl: taskPhoto.dataUrl, type: taskPhotoType, taskId: id, jobId: nt.jobId, crewId: user?.id || "admin", sizeKB: taskPhoto.sizeKB, note: taskPhotoNote, date: new Date().toISOString() }]);
      try { await sbPost("field_photos", prow); } catch { enqueue({ table: "field_photos", payload: prow }); }
    }
    // Notify each assigned crew member — SMS + Web Push
    const jobName = jobs.find(j => j.id === nt.jobId)?.name || "";
    const appUrl = settings?.appUrl || window.location.origin;
    const pushTitle = `📋 New Task: ${nt.title}`;
    const pushBody = `Job: ${jobName}${nt.dueDate ? ` · Due ${nt.dueDate}` : ""}`;
    for (const crewId of nt.assignedTo) {
      const member = users.find(u => u.id === crewId);
      if (member?.phone) {
        const msg = `New task assigned to you: "${nt.title}"\nJob: ${jobName}${nt.dueDate ? `\nDue: ${nt.dueDate}` : ""}\nOpen your crew app: ${appUrl}/?tab=tasks`;
        fetch("/.netlify/functions/send-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: member.phone, body: msg }) }).catch(() => {});
      }
    }
    sendPush(nt.assignedTo, pushTitle, pushBody, "/?tab=tasks");
    setNt({ title: "", jobId: "", assignedTo: [], dueDate: "", priority: "normal", recurring: false, photoRequired: false });
    setTaskPhoto(null); setTaskPhotoNote(""); setTaskPhotoType("before");
    setModal(false); setBusy(false);
  };
  const openEdit = (task) => { setEditTask(task); setEditForm({ title: task.title, dueDate: task.dueDate, priority: task.priority || "normal", recurring: task.recurring || false, assignedTo: task.assignedTo || [] }); };
  const saveEdit = async () => {
    if (!editTask) return;
    let es = editTask.titleEs;
    if (editForm.title !== editTask.title && settings?.gtKey) {
      try { es = await translateText(editForm.title, "es", settings.gtKey); }
      catch { es = editForm.title; }
    }
    const patch = { title: editForm.title, title_es: es || editForm.title, due_date: editForm.dueDate || null, priority: toPriority(editForm.priority), recurring: editForm.recurring, assigned_to: editForm.assignedTo };
    setTasks(p => p.map(t => t.id === editTask.id ? { ...t, title: editForm.title, titleEs: es || editForm.title, dueDate: editForm.dueDate, priority: editForm.priority, recurring: editForm.recurring, assignedTo: editForm.assignedTo } : t));
    try { await sbFetch(`field_tasks?id=eq.${editTask.id}`, { method: "PATCH", body: JSON.stringify(patch), prefer: "return=minimal" }); } catch {}
    setEditTask(null);
  };
  const toggleEditCrew = (id) => setEditForm(p => ({ ...p, assignedTo: p.assignedTo.includes(id) ? p.assignedTo.filter(x => x !== id) : [...p.assignedTo, id] }));
  const toggle = async (id) => {
    const task = tasks.find(t => t.id === id);
    const next = task.status === "done" ? "pending" : "done";
    setTasks(p => p.map(t => t.id === id ? { ...t, status: next } : t));
    try { await sbPatch("field_tasks", id, { status: next, completed_at: next === "done" ? new Date().toISOString() : null }); } catch {}
  };
  const deleteTask = async (id) => {
    if (tasks.find(t => t.id === id)?.status === "done") return;
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
        const allJobTasks = tasks.filter(t => t.jobId === job.id);
        const recurringTasks = allJobTasks.filter(t => t.recurring);
        const regularTasks = statusFiltered
          .filter(t => t.jobId === job.id && !t.recurring)
          .sort((a, b) => {
            if (a.priority === "urgent" && b.priority !== "urgent") return -1;
            if (a.priority !== "urgent" && b.priority === "urgent") return 1;
            return 0;
          });
        if (!recurringTasks.length && !regularTasks.length) return null;
        return (
          <div key={job.id} className="jobsec">
            <div className="jobhead">
              <div><div className="jobname">{job.name}</div><MapAddr addr={job.address} /></div>
              <span className="tag-l">{allJobTasks.length} task{allJobTasks.length !== 1 ? "s" : ""}</span>
            </div>

            {/* ── Recurring subsection ── */}
            {recurringTasks.length > 0 && (
              <div style={{ margin: "0 0 12px", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(245,158,11,.4)" }}>
                <div style={{ padding: "8px 14px", background: "rgba(245,158,11,.15)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13 }}>🔁</span>
                  <span style={{ fontWeight: 800, fontSize: 12, color: "var(--accent)", textTransform: "uppercase", letterSpacing: 1, fontFamily: "'Barlow Condensed'" }}>
                    Recurring Tasks
                  </span>
                  <span style={{ fontSize: 11, color: "var(--accent)", opacity: .7 }}>— crew checks daily, never removed unless deleted</span>
                </div>
                {recurringTasks.map(task => {
                  const crew = (task.assignedTo || []).map(id => users.find(u => u.id === id)).filter(Boolean);
                  const doneToday = task.completedAt && localDateOf(task.completedAt) === today;
                  return (
                    <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                      background: doneToday ? "rgba(245,158,11,.08)" : "rgba(245,158,11,.04)",
                      borderTop: "1px solid rgba(245,158,11,.2)" }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                      <div className="tinfo" style={{ flex: 1 }}>
                        <div className="ten">
                          {lang === "es" && task.titleEs && task.titleEs !== task.title ? task.titleEs : task.title}
                        </div>
                        {task.titleEs && task.titleEs !== task.title && (
                          <div style={{ fontSize: 11, color: "var(--slate)", fontStyle: "italic", marginTop: 1 }}>
                            {lang === "es" ? task.title : task.titleEs}
                          </div>
                        )}
                        <div className="tmeta">
                          {crew.length > 0
                            ? crew.map(a => <span key={a.id} className="tag-l" style={{ marginRight: 3 }}>{a.name}</span>)
                            : <span className="muted" style={{ fontSize: 11 }}>All crew</span>}
                          {doneToday && <span style={{ fontSize: 10, color: "var(--green)", fontWeight: 700, marginLeft: 4 }}>✓ Done today</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button className="btn btn-s btn-sm btn-ic" title="Edit" onClick={() => openEdit(task)}><Icon n="pen" s={14} /></button>
                        {task.status !== "done" && <button className="btn btn-s btn-sm btn-ic" style={{ color: "var(--red)" }} title="Delete" onClick={() => deleteTask(task.id)}><Icon n="x" s={14} /></button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Regular tasks subsection ── */}
            {regularTasks.length > 0 && (
              <div className="jobbody">{regularTasks.map(task => {
                const s = st(task), crew = (task.assignedTo || []).map(id => users.find(u => u.id === id)).filter(Boolean);
                const rowClass = `trow${task.priority === "urgent" ? " trow-urgent" : ""}`;
                return <div key={task.id} className={rowClass}>
                  <div className="tchk"><input type="checkbox" checked={task.status === "done"} onChange={() => toggle(task.id)} /></div>
                  <div className="tinfo">
                    <div className="ten" style={{ textDecoration: task.status === "done" ? "line-through" : "none", opacity: task.status === "done" ? .6 : 1 }}>
                      {lang === "es" && task.titleEs && task.titleEs !== task.title ? task.titleEs : task.title}
                    </div>
                    {task.titleEs && task.titleEs !== task.title && (
                      <div style={{ fontSize: 11, color: "var(--slate)", marginTop: 1, fontStyle: "italic" }}>
                        {lang === "es" ? task.title : task.titleEs}
                      </div>
                    )}
                    <div className="tmeta">
                      {task.priority === "urgent" && <span className="tag tag-urgent">⚡ Urgent</span>}
                      <span className={`tag tag-${s}`}>{t[s]}</span>
                      {task.dueDate && <span className="tag" style={{ background: "rgba(255,255,255,.06)", color: "var(--silver)" }}>Due {task.dueDate}</span>}
                      {crew.map(a => <span key={a.id} className="tag-l" style={{ marginRight: 3 }}>{a.name}</span>)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button className="btn btn-s btn-sm btn-ic" title="Edit" onClick={() => openEdit(task)}><Icon n="pen" s={14} /></button>
                    {task.status !== "done" && <button className="btn btn-s btn-sm btn-ic" style={{ color: "var(--red)" }} title="Delete" onClick={() => deleteTask(task.id)}><Icon n="x" s={14} /></button>}
                  </div>
                </div>;
              })}</div>
            )}
          </div>
        );
      })}

      {/* ── Edit Task Modal ── */}
      {editTask && <div className="modal-bg" onClick={e => e.target === e.currentTarget && setEditTask(null)}>
        <div className="modal"><div className="mt">Edit Task</div>
          <div className="fg"><label className="fl">Task Description</label>
            <input className="fi" value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} />
            {settings?.gtKey && <p style={{ fontSize:11, color:"var(--slate)", marginTop:5 }}>Auto-translates to Spanish for crew</p>}</div>
          <div className="fg"><label className="fl">Due Date</label>
            <input className="fi" type="date" value={editForm.dueDate} onChange={e => setEditForm(p => ({ ...p, dueDate: e.target.value }))} /></div>
          <div className="grid2" style={{ marginBottom: 18 }}>
            <div>
              <label className="fl">Priority</label>
              <div style={{ display:"flex", gap:8 }}>
                {["normal","urgent"].map(p => (
                  <button key={p} type="button" onClick={() => setEditForm(n => ({ ...n, priority: p }))}
                    style={{ flex:1, padding:"9px 0", borderRadius:10, border:`1px solid ${editForm.priority===p?(p==="urgent"?"var(--red)":"var(--border)"):"var(--border)"}`,
                      background: editForm.priority===p?(p==="urgent"?"rgba(239,68,68,.18)":"rgba(59,130,246,.12)"):"rgba(255,255,255,.04)",
                      color: editForm.priority===p?(p==="urgent"?"var(--red)":"var(--sky2)"):"var(--silver)",
                      fontFamily:"'Barlow Condensed'", fontWeight:700, fontSize:13, letterSpacing:1, textTransform:"uppercase", cursor:"pointer" }}>
                    {p === "urgent" ? "⚡ Urgent" : "Normal"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="fl">Type</label>
              <button type="button" onClick={() => setEditForm(n => ({ ...n, recurring: !n.recurring }))}
                style={{ width:"100%", padding:"9px 0", borderRadius:10,
                  border:`1px solid ${editForm.recurring?"var(--accent)":"var(--border)"}`,
                  background: editForm.recurring?"rgba(245,158,11,.15)":"rgba(255,255,255,.04)",
                  color: editForm.recurring?"var(--accent)":"var(--silver)",
                  fontFamily:"'Barlow Condensed'", fontWeight:700, fontSize:13, letterSpacing:1, textTransform:"uppercase", cursor:"pointer" }}>
                🔁 {editForm.recurring ? "Recurring" : "One-Time"}
              </button>
            </div>
          </div>
          <div className="fg"><label className="fl">Assigned To</label>
            <div style={{ background:"rgba(0,0,0,.15)", borderRadius:10, padding:"6px 4px", border:"1px solid var(--border)" }}>
              {users.filter(u => u.active && !u.archived).sort((a,b) => (a.role==="crew"?0:1)-(b.role==="crew"?0:1) || a.name.localeCompare(b.name)).map(u => (
                <label key={u.id} style={{ display:"flex", alignItems:"center", gap:11, padding:"8px 12px", cursor:"pointer", borderRadius:8,
                  background: editForm.assignedTo.includes(u.id) ? "rgba(59,130,246,.12)" : "transparent" }}>
                  <input type="checkbox" checked={editForm.assignedTo.includes(u.id)} onChange={() => toggleEditCrew(u.id)}
                    style={{ width:17, height:17, accentColor:"var(--sky)", flexShrink:0 }} />
                  <span style={{ fontSize:14, fontWeight:500 }}>{u.name}</span>
                  {u.role === "admin" && <span style={{ fontSize:10, color:"var(--accent)", marginLeft:4, fontWeight:700 }}>ADMIN</span>}
                </label>
              ))}
            </div>
          </div>
          <div className="macts">
            <button className="btn btn-s" onClick={() => setEditTask(null)}>Cancel</button>
            <button className="btn btn-p" onClick={saveEdit}>Save Changes</button>
          </div>
        </div>
      </div>}

      {modal && <div className="modal-bg" onClick={e => e.target === e.currentTarget && setModal(false)}>
        <div className="modal"><div className="mt">Add Task</div>
          <div className="fg"><label className="fl">Job</label>
            <select className="fi" value={nt.jobId} onChange={e => setNt(p => ({ ...p, jobId: e.target.value }))}>
              <option value="">Select Job</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select></div>
          <div className="fg"><label className="fl">Task Description</label>
            <input className="fi" value={nt.title} onChange={e => setNt(p => ({ ...p, title: e.target.value }))} placeholder="Task..." />
            {settings?.gtKey && <p style={{ fontSize:11, color:"var(--slate)", marginTop:5 }}>Auto-translates to Spanish for crew</p>}</div>
          <div className="fg">
            <label className="fl">Assign To <span style={{ color: "var(--silver)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— select one or more</span></label>
            <div style={{ background: "rgba(0,0,0,.15)", borderRadius: 10, padding: "6px 4px", border: "1px solid var(--border)" }}>
              {users.filter(u => u.active && !u.archived).sort((a,b) => (a.role==="crew"?0:1)-(b.role==="crew"?0:1) || a.name.localeCompare(b.name)).map(u => (
                <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 12px", cursor: "pointer", borderRadius: 8,
                  background: nt.assignedTo.includes(u.id) ? "rgba(59,130,246,.12)" : "transparent", transition: ".15s" }}>
                  <input type="checkbox" checked={nt.assignedTo.includes(u.id)} onChange={() => toggleCrew(u.id)}
                    style={{ width: 17, height: 17, accentColor: "var(--sky)", flexShrink: 0 }} />
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: nt.assignedTo.includes(u.id) ? "linear-gradient(135deg,var(--sky-dim),var(--sky))" : "rgba(255,255,255,.1)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{u.name[0]}</div>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{u.name}</span>
                  {u.role === "admin" && <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>ADMIN</span>}
                  {nt.assignedTo.includes(u.id) && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--sky2)" }}>✓ assigned</span>}
                </label>
              ))}
              {!users.filter(u => u.active && !u.archived).length && <p className="muted" style={{ padding: "10px 12px", fontSize: 13 }}>No users added yet.</p>}
            </div>
            {!nt.assignedTo.length && !nt.recurring && <p style={{ fontSize: 11, color: "var(--orange)", marginTop: 6 }}>Select at least one person (or toggle 🔁 Recurring for all-crew tasks)</p>}
            {!nt.assignedTo.length && nt.recurring && <p style={{ fontSize: 11, color: "var(--accent)", marginTop: 6 }}>🔁 Recurring tasks show for all crew — no assignment needed</p>}
          </div>
          <div className="fg"><label className="fl">Due Date</label>
            <input className="fi" type="date" value={nt.dueDate} onChange={e => setNt(p => ({ ...p, dueDate: e.target.value }))} /></div>

          <div className="grid2" style={{ marginBottom: 18 }}>
            <div>
              <label className="fl">Priority</label>
              <div style={{ display: "flex", gap: 8 }}>
                {["normal","urgent"].map(p => (
                  <button key={p} type="button" onClick={() => setNt(n => ({ ...n, priority: p }))}
                    style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: `1px solid ${nt.priority === p ? (p === "urgent" ? "var(--red)" : "var(--border)") : "var(--border)"}`,
                      background: nt.priority === p ? (p === "urgent" ? "rgba(239,68,68,.18)" : "rgba(59,130,246,.12)") : "rgba(255,255,255,.04)",
                      color: nt.priority === p ? (p === "urgent" ? "var(--red)" : "var(--sky2)") : "var(--silver)",
                      fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>
                    {p === "urgent" ? "⚡ Urgent" : "Normal"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="fl">Type</label>
              <button type="button" onClick={() => setNt(n => ({ ...n, recurring: !n.recurring }))}
                style={{ width: "100%", padding: "9px 0", borderRadius: 10,
                  border: `1px solid ${nt.recurring ? "var(--accent)" : "var(--border)"}`,
                  background: nt.recurring ? "rgba(245,158,11,.15)" : "rgba(255,255,255,.04)",
                  color: nt.recurring ? "var(--accent)" : "var(--silver)",
                  fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>
                🔁 {nt.recurring ? "Recurring" : "One-Time"}
              </button>
              <button type="button" onClick={() => setNt(n => ({ ...n, photoRequired: !n.photoRequired }))}
                style={{ flex: 1, padding: "9px 0", borderRadius: 10,
                  border: `1px solid ${nt.photoRequired ? "var(--sky)" : "var(--border)"}`,
                  background: nt.photoRequired ? "rgba(59,130,246,.15)" : "rgba(255,255,255,.04)",
                  color: nt.photoRequired ? "var(--sky2)" : "var(--silver)",
                  fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>
                📷 {nt.photoRequired ? "Photo Required" : "Photo Optional"}
              </button>
            </div>
          </div>

          {/* ── Photo at task creation ── */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 4 }}>
            <label className="fl" style={{ marginBottom: 8 }}>📷 Attach a Photo (optional)</label>
            <input ref={photoRef} type="file" accept="image/*" style={{ display:"none" }} onChange={captureTaskPhoto} />
            {!taskPhoto ? (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <button className="btn btn-s btn-sm" style={{ justifyContent:"center" }}
                  onClick={() => { photoRef.current?.setAttribute("capture","environment"); photoRef.current?.click(); }}>
                  <Icon n="camera" s={15}/> Open Camera
                </button>
                <button className="btn btn-s btn-sm" style={{ justifyContent:"center" }}
                  onClick={() => openGallery(captureTaskPhoto)}>
                  <Icon n="photo" s={15}/> From Library
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display:"flex", gap:10, marginBottom:10, alignItems:"flex-start" }}>
                  <img src={taskPhoto.dataUrl} alt="preview" style={{ width:72, height:72, objectFit:"cover", borderRadius:8, border:"2px solid var(--border)", flexShrink:0 }} />
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                      {["before","after","concern"].map(k => (
                        <button key={k} onClick={() => setTaskPhotoType(k)}
                          style={{ padding:"4px 10px", borderRadius:6, border:`1px solid ${taskPhotoType===k?k==="before"?"var(--orange)":k==="after"?"var(--green)":"var(--red)":"transparent"}`,
                            background: taskPhotoType===k?`rgba(${k==="before"?"249,115,22":k==="after"?"16,185,129":"239,68,68"},.18)`:"rgba(255,255,255,.06)",
                            color: taskPhotoType===k?k==="before"?"var(--orange)":k==="after"?"var(--green)":"var(--red)":"var(--silver)",
                            fontSize:11, fontWeight:700, cursor:"pointer", textTransform:"capitalize" }}>
                          {k}
                        </button>
                      ))}
                    </div>
                    <input className="fi" value={taskPhotoNote} onChange={e => setTaskPhotoNote(e.target.value)}
                      placeholder="Describe what this photo shows..." style={{ padding:"7px 10px", fontSize:12 }} />
                  </div>
                </div>
                <button className="btn btn-s btn-sm" style={{ color:"var(--red)" }} onClick={() => setTaskPhoto(null)}>✕ Remove photo</button>
              </div>
            )}
          </div>

          <div className="macts"><button className="btn btn-s" onClick={() => { setModal(false); setTaskPhoto(null); }}>Cancel</button>
            <button className="btn btn-p" onClick={add} disabled={busy}>{busy ? <span className="spin" /> : "Add Task"}</button></div>
        </div></div>}
    </div>
  );
}

function AdminArchive({ tasks, jobs, users }) {
  const cutoff = new Date(Date.now() - 24 * 3600000).toISOString();
  const archived = tasks.filter(t => t.status === "done" && t.completedAt && t.completedAt < cutoff);
  const byJob = jobs
    .map(j => ({ job: j, jt: archived.filter(t => t.jobId === j.id) }))
    .filter(x => x.jt.length > 0);
  const crewName = id => users.find(u => u.id === id)?.name || id;

  return (
    <div>
      <div className="flexb" style={{ marginBottom: 6 }}><h2 className="h2">Archive</h2></div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>Completed tasks older than 24 hours — read-only record for payroll and reporting. Tasks here can never be deleted.</p>
      {byJob.length === 0
        ? <div className="empty"><p>No archived tasks yet.</p></div>
        : byJob.map(({ job, jt }) => (
          <div key={job.id} className="jobsec">
            <div className="jobhead">
              <div><div className="jobname">{job.name}</div><MapAddr addr={job.address} /></div>
              <span className="tag-l">{jt.length} archived</span>
            </div>
            {jt.sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || "")).map(task => {
              const crew = (task.assignedTo || []).map(id => crewName(id));
              return (
                <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,.05)" }}>
                  <Icon n="check" s={14} c="var(--green)" />
                  <div className="tinfo" style={{ flex: 1 }}>
                    <div className="ten" style={{ textDecoration: "line-through", opacity: 0.65 }}>{task.title}</div>
                    <div className="tmeta">
                      {crew.map((n, i) => <span key={i} className="tag-l" style={{ marginRight: 3 }}>{n}</span>)}
                      {task.completedAt && <span className="tag" style={{ background: "rgba(16,185,129,.12)", color: "var(--green)" }}>
                        Done {localDateOf(task.completedAt)}
                      </span>}
                      {task.dueDate && <span className="tag" style={{ background: "rgba(255,255,255,.06)", color: "var(--silver)" }}>Due {task.dueDate}</span>}
                    </div>
                  </div>
                  <Icon n="lock" s={13} c="var(--slate)" />
                </div>
              );
            })}
          </div>
        ))
      }
    </div>
  );
}

function CalendarReport({ rangeStart, rangeEnd, reportJob, setReportJob, onClose, tasks, receipts, jobs, users, today, photos }) {
  const lo = rangeStart < rangeEnd ? rangeStart : rangeEnd;
  const hi = rangeStart < rangeEnd ? rangeEnd   : rangeStart;
  const rTasks    = tasks.filter(t => (reportJob === "all" || t.jobId === reportJob) && t.dueDate && t.dueDate >= lo && t.dueDate <= hi);
  const rReceipts = receipts.filter(r => (reportJob === "all" || r.jobId === reportJob) && r.createdAt >= lo && r.createdAt <= hi);
  const rPhotos   = (photos||[]).filter(p => (reportJob === "all" || p.jobId === reportJob) && (p.date||"").slice(0,10) >= lo && (p.date||"").slice(0,10) <= hi);
  const totalSpend = rReceipts.reduce((s, r) => s + (+r.amount || 0), 0);
  const jobName = reportJob === "all" ? "All Jobs" : jobs.find(j => j.id === reportJob)?.name || reportJob;
  const [lightbox, setLightbox] = useState(null);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 700, width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div className="flexb" style={{ marginBottom: 18 }}>
          <div>
            <div className="mt" style={{ marginBottom: 4 }}>📊 Job Report</div>
            <div className="muted" style={{ fontSize: 12 }}>{lo} → {hi} · {jobName}</div>
          </div>
          <button className="btn btn-p btn-sm" onClick={() => window.print()}><Icon n="print" s={14} /> Print</button>
        </div>
        <div className="fg"><label className="fl">Filter by Job</label>
          <select className="fi" value={reportJob} onChange={e => setReportJob(e.target.value)}>
            <option value="all">All Jobs</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 18 }}>
          {[["Tasks", rTasks.length, "var(--sky2)"], ["Complete", rTasks.filter(t=>t.status==="done").length, "var(--green)"], [`$${totalSpend.toFixed(2)} spent`, "", "var(--accent)"]].map(([l,n,c]) => (
            <div key={l} style={{ textAlign:"center",padding:"12px 8px",background:"rgba(0,0,0,.2)",borderRadius:10 }}>
              <div style={{ fontFamily:"'Barlow Condensed'",fontSize:24,fontWeight:800,color:c }}>{n}</div>
              <div className="muted" style={{ fontSize:11 }}>{l}</div>
            </div>
          ))}
        </div>
        {rTasks.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontFamily:"'Barlow Condensed'",fontSize:15,fontWeight:700,marginBottom:10,color:"var(--sky2)" }}>TASKS</div>
            <div className="tbl-wrap"><table><thead><tr><th>Job</th><th>Task</th><th>Assigned</th><th>Due</th><th>Status</th></tr></thead>
              <tbody>{rTasks.map(t => {
                const job = jobs.find(j=>j.id===t.jobId);
                const assigned = (t.assignedTo||[]).map(id=>users.find(u=>u.id===id)?.name?.split(" ")[0]).filter(Boolean).join(", ");
                const s = t.status==="done"?"done":(t.dueDate&&t.dueDate<today?"overdue":"pending");
                return <tr key={t.id}>
                  <td data-l="Job"><span className="tag-l" style={{ fontSize:11 }}>{job?.name}</span></td>
                  <td data-l="Task" style={{ fontWeight:600 }}>{t.title}</td>
                  <td data-l="Assigned" className="muted">{assigned}</td>
                  <td data-l="Due" className="muted">{t.dueDate}</td>
                  <td data-l="Status"><span className={`tag tag-${s}`}>{s}</span></td>
                </tr>;
              })}</tbody>
            </table></div>

          </div>
        )}
        {rReceipts.length > 0 && (
          <div>
            <div style={{ fontFamily:"'Barlow Condensed'",fontSize:15,fontWeight:700,marginBottom:10,color:"var(--accent)" }}>RECEIPTS</div>
            <div className="tbl-wrap"><table><thead><tr><th>Date</th><th>Job</th><th>Vendor</th><th>By</th><th>Paid By</th><th style={{ textAlign:"right" }}>Amount</th></tr></thead>
              <tbody>{rReceipts.map(r => {
                const j=jobs.find(x=>x.id===r.jobId), cr=users.find(u=>u.id===r.crewId);
                return <tr key={r.id}>
                  <td data-l="Date" className="muted">{r.createdAt}</td>
                  <td data-l="Job"><span className="tag-l" style={{ fontSize:11 }}>{j?.name}</span></td>
                  <td data-l="Vendor">{r.store}</td>
                  <td data-l="By" className="muted">{cr?.name}</td>
                  <td data-l="Paid"><span className={"tag "+(r.paidBy==="crew"?"tag-overdue":"tag-done")}>{r.paidBy==="crew"?"Crew":"Company"}</span></td>
                  <td data-l="Amount" style={{ textAlign:"right",fontWeight:700,color:"var(--accent)",fontFamily:"'Barlow Condensed'",fontSize:15 }}>${(+r.amount).toFixed(2)}</td>
                </tr>;
              })}</tbody>
            </table></div>
            <div style={{ textAlign:"right",marginTop:10,fontFamily:"'Barlow Condensed'",fontSize:20,fontWeight:800,color:"var(--accent)" }}>Total: ${totalSpend.toFixed(2)}</div>
          </div>
        )}
        {/* Photos */}
        {rPhotos.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontFamily:"'Barlow Condensed'",fontSize:15,fontWeight:700,marginBottom:10,color:"var(--sky2)" }}>
              PHOTOS ({rPhotos.length})
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {rPhotos.map((p, i) => (
                <div key={i} onClick={() => setLightbox(p)}
                  style={{ position:"relative", width:72, height:72, borderRadius:8, overflow:"hidden", cursor:"zoom-in", flexShrink:0,
                    border:`2px solid ${p.type==="before"?"var(--orange)":p.type==="after"?"var(--green)":"var(--red)"}` }}>
                  {p.dataUrl
                    ? <img src={p.dataUrl} alt={p.type} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                    : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,.3)" }}><Icon n="camera" s={22} c="var(--slate)" /></div>}
                  <div style={{ position:"absolute", bottom:0, left:0, right:0, background:"rgba(0,0,0,.65)", fontSize:9, textAlign:"center", color:"#fff", padding:"1px 0", fontWeight:700, textTransform:"uppercase" }}>
                    {p.type}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {rTasks.length === 0 && rReceipts.length === 0 && rPhotos.length === 0 && (
          <div className="empty"><p>No data in this range for {jobName}.</p></div>
        )}
        <div className="macts"><button className="btn btn-s" onClick={onClose}>Close</button></div>

        {/* Lightbox */}
        {lightbox && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.92)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, padding:18 }}
            onClick={() => setLightbox(null)}>
            <div style={{ maxWidth:"90vw", textAlign:"center" }} onClick={e => e.stopPropagation()}>
              <img src={lightbox.dataUrl} alt={lightbox.type} style={{ maxWidth:"100%", maxHeight:"75vh", borderRadius:12, objectFit:"contain" }} />
              {lightbox.note && <div style={{ marginTop:10, color:"var(--white)", fontSize:14, background:"rgba(0,0,0,.5)", padding:"6px 14px", borderRadius:8, display:"inline-block" }}>{lightbox.note}</div>}
              <div style={{ marginTop:12 }}><button className="btn btn-s" onClick={() => setLightbox(null)}>Close</button></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Calendar({ tasks, setTasks, jobs, users, receipts }) {
  const [d, setD]         = useState(new Date());
  const [view, setView]   = useState("job");
  const [filter, setFilter] = useState("all");
  const [rangeStart, setRangeStart] = useState(null);
  const [rangeEnd,   setRangeEnd]   = useState(null);
  const [dragging,   setDragging]   = useState(false);
  const [reportModal, setReportModal] = useState(false);
  const [reportJob,  setReportJob]  = useState("all");
  const [selectedDay, setSelectedDay] = useState(null); // date string — day detail panel
  const [editTask,   setEditTask]   = useState(null);   // task being edited
  const [editForm,   setEditForm]   = useState({});
  const [confirmDel, setConfirmDel] = useState(null);   // taskId to delete
  const [addForDay,  setAddForDay]  = useState(null);   // date string — add task for day
  const [newTask,    setNewTask]    = useState({ jobId:"", title:"", assignedTo:[] });
  const y = d.getFullYear(), mo = d.getMonth();
  const first = new Date(y, mo, 1).getDay(), days = new Date(y, mo + 1, 0).getDate();
  const today = localDate();
  const mn = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dn = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  const ds = (day) => `${y}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;

  const inRange = (dateStr) => {
    if (!rangeStart || !rangeEnd) return false;
    const lo = rangeStart < rangeEnd ? rangeStart : rangeEnd;
    const hi = rangeStart < rangeEnd ? rangeEnd   : rangeStart;
    return dateStr >= lo && dateStr <= hi;
  };
  const isRangeEdge = (dateStr) => dateStr === rangeStart || dateStr === rangeEnd;

  const handleDayDown = (day) => { const ds2 = ds(day); setRangeStart(ds2); setRangeEnd(ds2); setDragging(true); };
  const handleDayEnter = (day) => { if (dragging) setRangeEnd(ds(day)); };
  const handleDayUp = () => setDragging(false);

  const clearRange = () => { setRangeStart(null); setRangeEnd(null); };

  const openDay = (dateStr, e) => {
    // Don't open day panel while doing range drag
    if (dragging) return;
    setSelectedDay(dateStr);
    setAddForDay(null);
  };

  const todayStr = localDate();

  const toggleTaskStatus = async (task) => {
    const next = task.status === "done" ? "pending" : "done";
    setTasks(p => p.map(t => t.id === task.id ? { ...t, status: next } : t));
    try { await sbPatch("field_tasks", task.id, { status: next, completed_at: next === "done" ? new Date().toISOString() : null }); } catch {}
  };

  const deleteCalTask = async (id) => {
    if (tasks.find(t => t.id === id)?.status === "done") { setConfirmDel(null); return; }
    setTasks(p => p.filter(t => t.id !== id));
    try { await sbDelete("field_tasks", id); } catch {}
    setConfirmDel(null);
  };

  const saveEditTask = async () => {
    if (!editTask) return;
    setTasks(p => p.map(t => t.id === editTask.id ? { ...t, ...editForm } : t));
    const patch = {};
    if (editForm.title)   patch.title    = editForm.title;
    if (editForm.dueDate !== undefined) patch.due_date = editForm.dueDate || null;
    try { await sbFetch(`field_tasks?id=eq.${editTask.id}`, { method:"PATCH", body: JSON.stringify(patch), prefer:"return=minimal" }); } catch {}
    setEditTask(null);
  };

  const addTaskForDay = async () => {
    if (!newTask.title || !newTask.jobId) return;
    const id = "t" + Date.now();
    const task = { id, jobId: newTask.jobId, title: newTask.title, titleEs: newTask.title, assignedTo: newTask.assignedTo, dueDate: addForDay, status:"pending", createdAt: todayStr };
    setTasks(p => [...p, task]);
    const row = { id, job_id: newTask.jobId, title: newTask.title, title_es: newTask.title, assigned_to: newTask.assignedTo, due_date: addForDay, status:"pending" };
    try { await sbPost("field_tasks", row); } catch { enqueue({ table:"field_tasks", payload: row }); }
    setNewTask({ jobId:"", title:"", assignedTo:[] });
    setAddForDay(null);
  };

  // Status colors (primary visual language)
  const statusColor = task => {
    if (task.status === "done")    return "#10b981"; // green
    if (task.dueDate && task.dueDate < today) return "#ef4444"; // red overdue
    return "#3b82f6"; // blue pending
  };

  // Per-worker palette for worker view legend
  const crew = users.filter(u => u.role === "crew" && !u.archived);
  const workerColors = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#f97316","#84cc16"];
  const workerColor  = id => workerColors[crew.findIndex(u => u.id === id) % workerColors.length] || "#64748b";

  // Filtered tasks
  const ft = tasks.filter(task => {
    if (filter === "all") return true;
    if (view === "job")    return task.jobId === filter;
    if (view === "worker") return (Array.isArray(task.assignedTo) ? task.assignedTo.includes(filter) : task.assignedTo === filter);
    return true;
  });

  // Events per day: issued (createdAt) + due (dueDate)
  const eventsForDay = (day) => {
    const date = ds(day);
    const evs = [];
    ft.forEach(task => {
      if (task.dueDate === date)   evs.push({ task, kind: "due" });
      else if (task.createdAt === date) evs.push({ task, kind: "issued" });
    });
    return evs;
  };

  const chipColor = (ev) => {
    if (ev.kind === "issued") return "#64748b"; // grey = issued/assigned
    return statusColor(ev.task);               // status color on due date
  };

  const chipLabel = (ev) => {
    const base = ev.task.title.slice(0, 14);
    const suffix = view === "job"
      ? (ev.task.assignedTo?.[0] ? " · " + (users.find(u=>u.id===ev.task.assignedTo[0])?.name?.split(" ")[0]||"") : "")
      : (" · " + (jobs.find(j=>j.id===ev.task.jobId)?.name?.slice(0,10)||""));
    return (ev.kind === "issued" ? "📋 " : "") + base + suffix;
  };

  return (
    <div>
      {/* ── Controls ── */}
      <div className="flexb" style={{ marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 className="h2">Calendar</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* View toggle */}
          <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button onClick={() => { setView("job");    setFilter("all"); }}
              style={{ padding: "7px 14px", fontSize: 12, fontWeight: 700, fontFamily: "'Barlow Condensed'", border: "none", cursor: "pointer",
                background: view==="job" ? "var(--sky-dim)" : "rgba(255,255,255,.06)", color: view==="job" ? "#fff" : "var(--silver)" }}>
              By Job
            </button>
            <button onClick={() => { setView("worker"); setFilter("all"); }}
              style={{ padding: "7px 14px", fontSize: 12, fontWeight: 700, fontFamily: "'Barlow Condensed'", border: "none", cursor: "pointer",
                background: view==="worker" ? "var(--sky-dim)" : "rgba(255,255,255,.06)", color: view==="worker" ? "#fff" : "var(--silver)" }}>
              By Worker
            </button>
          </div>
          {/* Filter dropdown */}
          <select className="fi" style={{ width: "auto", padding: "8px 13px" }} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">{view === "job" ? "All Jobs" : "All Workers"}</option>
            {view === "job"
              ? jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)
              : crew.map(u => <option key={u.id} value={u.id}>{u.name}</option>)
            }
          </select>
          {/* Month nav */}
          <button className="btn btn-s btn-sm" onClick={() => setD(new Date(y, mo-1, 1))}>‹</button>
          <span style={{ padding: "8px 14px", fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 17, whiteSpace: "nowrap" }}>{mn[mo]} {y}</span>
          <button className="btn btn-s btn-sm" onClick={() => setD(new Date(y, mo+1, 1))}>›</button>
          <button className="btn btn-s btn-sm" onClick={() => window.print()}><Icon n="print" s={14} /> Print</button>
          {rangeStart && rangeEnd && rangeStart !== rangeEnd && (
            <button className="btn btn-a btn-sm" onClick={() => { setReportJob("all"); setReportModal(true); }}>
              📊 Report ({rangeStart} → {rangeEnd})
            </button>
          )}
          {rangeStart && <button className="btn btn-s btn-sm" onClick={clearRange}>✕ Clear</button>}
        </div>
      </div>

      {/* ── Calendar grid ── */}
      <div className="card" style={{ padding: 14 }}
        onMouseLeave={() => { if (dragging) setDragging(false); }}
        onMouseUp={handleDayUp}>
        <p style={{ fontSize: 11, color: "var(--slate)", marginBottom: 8 }}>Click + drag days to select a date range, then click <strong>Report</strong>.</p>
        <div className="cal-grid">
          {dn.map(x => <div key={x} className="cal-h">{x}</div>)}
          {Array(first).fill(0).map((_, i) => <div key={"e"+i} className="cal-d" style={{ opacity: .2 }} />)}
          {Array(days).fill(0).map((_, i) => {
            const day = i + 1, evs = eventsForDay(day), date = ds(day);
            const ranged = inRange(date), edge = isRangeEdge(date);
            const isSelected = selectedDay === date;
            return <div key={day}
              className={`cal-d ${date === today ? "today" : ""}`}
              style={{ cursor:"pointer", userSelect:"none",
                background: isSelected ? "rgba(245,158,11,.18)" : edge ? "rgba(59,130,246,.35)" : ranged ? "rgba(59,130,246,.15)" : undefined,
                borderColor: isSelected ? "var(--accent)" : edge ? "var(--sky)" : ranged ? "rgba(59,130,246,.4)" : undefined }}
              onMouseDown={() => handleDayDown(day)}
              onMouseEnter={() => handleDayEnter(day)}
              onMouseUp={() => { handleDayUp(); openDay(date); }}>
              <div style={{ fontWeight:700, color: isSelected ? "var(--accent)" : edge ? "var(--sky2)" : "var(--silver)", marginBottom:3 }}>{day}</div>
              {evs.slice(0, 3).map((ev, ei) => (
                <div key={ei} className="cal-ev"
                  title={`${ev.task.title} — ${ev.kind === "issued" ? "Issued" : ev.task.status}`}
                  style={{ background: chipColor(ev), opacity: ev.kind === "issued" ? .75 : 1, cursor:"pointer" }}
                  onClick={e => { e.stopPropagation(); setSelectedDay(date); }}>
                  {chipLabel(ev).slice(0, 18)}
                </div>
              ))}
              {evs.length > 3 && <div style={{ fontSize:9, color:"var(--slate)", marginTop:2 }}>+{evs.length-3} more</div>}
            </div>;
          })}
        </div>
      </div>

      {/* ── Day Detail Panel ── */}
      {selectedDay && (() => {
        const dayTasks = ft.filter(t => t.dueDate === selectedDay || t.createdAt === selectedDay);
        const dn2 = new Date(selectedDay + "T12:00:00").toLocaleDateString([], { weekday:"long", month:"long", day:"numeric" });
        return (
          <div className="card" style={{ marginBottom: 16, borderLeft:"4px solid var(--accent)" }}>
            <div className="flexb" style={{ marginBottom:12 }}>
              <div>
                <div style={{ fontFamily:"'Barlow Condensed'", fontSize:18, fontWeight:800, color:"var(--accent)" }}>{dn2}</div>
                <div className="muted" style={{ fontSize:12 }}>{dayTasks.length} task{dayTasks.length!==1?"s":""} on this date</div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn btn-p btn-sm" onClick={() => { setAddForDay(selectedDay); setNewTask({ jobId:"", title:"", assignedTo:[] }); }}>
                  + Add Task
                </button>
                <button className="btn btn-s btn-sm" onClick={() => setSelectedDay(null)}>✕</button>
              </div>
            </div>

            {dayTasks.length === 0
              ? <div className="empty" style={{ padding:"12px 0" }}><p style={{ fontSize:13 }}>No tasks due or created on this day.</p></div>
              : dayTasks.map(task => {
                  const job = jobs.find(j => j.id === task.jobId);
                  const assigned = (task.assignedTo||[]).map(id => users.find(u => u.id === id)?.name?.split(" ")[0]).filter(Boolean).join(", ");
                  const s = task.status === "done" ? "done" : (task.dueDate && task.dueDate < todayStr ? "overdue" : "pending");
                  return (
                    <div key={task.id} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"10px 0", borderBottom:"1px solid rgba(255,255,255,.05)" }}>
                      <input type="checkbox" checked={task.status === "done"} onChange={() => toggleTaskStatus(task)}
                        style={{ width:18, height:18, accentColor:"var(--sky)", marginTop:2, flexShrink:0 }} />
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:600, fontSize:14, textDecoration:task.status==="done"?"line-through":"none", opacity:task.status==="done"?.6:1 }}>{task.title}</div>
                        <div style={{ fontSize:11, color:"var(--silver)", marginTop:2 }}>
                          <span className={`tag tag-${s}`} style={{ marginRight:6 }}>{s}</span>
                          {job?.name && <span className="tag-l" style={{ fontSize:10, marginRight:6 }}>{job.name}</span>}
                          {assigned && <span style={{ color:"var(--slate)" }}>{assigned}</span>}
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                        <button className="btn btn-s btn-sm btn-ic" title="Edit" onClick={() => { setEditTask(task); setEditForm({ title:task.title, dueDate:task.dueDate||"" }); }}>
                          <Icon n="pen" s={13}/>
                        </button>
                        {task.status !== "done" && <button className="btn btn-s btn-sm btn-ic" style={{ color:"var(--red)" }} title="Delete" onClick={() => setConfirmDel(task.id)}>
                          <Icon n="x" s={13}/>
                        </button>}
                      </div>
                    </div>
                  );
                })
            }
          </div>
        );
      })()}

      {/* ── Legend ── */}
      <div className="card">
        <div className="ct">Legend</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          {[["#64748b","📋 Issued / Assigned"],["#3b82f6","Pending (due)"],["#10b981","✓ Complete"],["#ef4444","⚠ Overdue"]].map(([c,l]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 13, height: 13, borderRadius: 3, background: c }} /><span style={{ fontSize: 13 }}>{l}</span>
            </div>
          ))}
        </div>
        {view === "worker" && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid var(--border)" }}>
            {crew.map(u => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: workerColor(u.id) }} />{u.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Edit Task Modal ── */}
      {editTask && (
        <div className="modal-bg" onClick={() => setEditTask(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">Edit Task</div>
            <div className="fg"><label className="fl">Task Title</label>
              <input className="fi" value={editForm.title} onChange={e => setEditForm(p=>({...p,title:e.target.value}))} /></div>
            <div className="fg"><label className="fl">Due Date</label>
              <input className="fi" type="date" value={editForm.dueDate} onChange={e => setEditForm(p=>({...p,dueDate:e.target.value}))} /></div>
            <div className="macts">
              {editTask?.status !== "done" && <button className="btn btn-s" style={{ marginRight:"auto", color:"var(--red)" }} onClick={() => { setConfirmDel(editTask.id); setEditTask(null); }}>Delete</button>}
              <button className="btn btn-s" onClick={() => setEditTask(null)}>Cancel</button>
              <button className="btn btn-p" onClick={saveEditTask}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {confirmDel && (
        <div className="modal-bg" onClick={() => setConfirmDel(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">Delete this task?</div>
            <p className="muted" style={{ lineHeight:1.6 }}>Permanently removes the task and all its history. Cannot be undone.</p>
            <div className="macts">
              <button className="btn btn-s" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="btn" style={{ background:"linear-gradient(135deg,#dc2626,var(--red))",color:"#fff" }} onClick={() => deleteCalTask(confirmDel)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Task for Day ── */}
      {addForDay && (
        <div className="modal-bg" onClick={() => setAddForDay(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">Add Task — {new Date(addForDay+"T12:00:00").toLocaleDateString([], { month:"long", day:"numeric" })}</div>
            <div className="fg"><label className="fl">Job</label>
              <select className="fi" value={newTask.jobId} onChange={e => setNewTask(p=>({...p,jobId:e.target.value}))}>
                <option value="">Select job...</option>
                {jobs.filter(j=>j.status!=="closed").map(j=><option key={j.id} value={j.id}>{j.name}</option>)}
              </select></div>
            <div className="fg"><label className="fl">Task Description</label>
              <input className="fi" value={newTask.title} onChange={e => setNewTask(p=>({...p,title:e.target.value}))} placeholder="What needs to be done..." /></div>
            <div className="fg"><label className="fl">Assign To</label>
              <div style={{ background:"rgba(0,0,0,.15)", borderRadius:10, padding:"4px", border:"1px solid var(--border)" }}>
                {users.filter(u=>u.role==="crew"&&!u.archived).map(u => (
                  <label key={u.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", cursor:"pointer", borderRadius:8,
                    background:newTask.assignedTo.includes(u.id)?"rgba(59,130,246,.1)":"transparent" }}>
                    <input type="checkbox" checked={newTask.assignedTo.includes(u.id)}
                      onChange={() => setNewTask(p=>({...p, assignedTo: p.assignedTo.includes(u.id)?p.assignedTo.filter(x=>x!==u.id):[...p.assignedTo,u.id] }))}
                      style={{ accentColor:"var(--sky)", width:16, height:16 }} />
                    <span style={{ fontSize:14 }}>{u.name}</span>
                  </label>
                ))}
              </div></div>
            <div className="macts">
              <button className="btn btn-s" onClick={() => setAddForDay(null)}>Cancel</button>
              <button className="btn btn-p" disabled={!newTask.title||!newTask.jobId} onClick={addTaskForDay}>Add Task</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Report Modal ── */}
      {reportModal && rangeStart && rangeEnd && (
        <CalendarReport rangeStart={rangeStart} rangeEnd={rangeEnd} reportJob={reportJob}
          setReportJob={setReportJob} onClose={() => setReportModal(false)}
          tasks={tasks} receipts={receipts || []} photos={photos || []} jobs={jobs} users={users} today={today} />
      )}

      {/* ── Print-only task list ── */}
      <div style={{ display: "none" }} className="print-task-list">
        <h3 style={{ marginBottom: 12 }}>{mn[mo]} {y} — {view === "job" ? "By Job" : "By Worker"}{filter !== "all" ? ` — ${view==="job" ? jobs.find(j=>j.id===filter)?.name : users.find(u=>u.id===filter)?.name}` : ""}</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ borderBottom: "2px solid #000" }}><th style={{ textAlign:"left",padding:"4px 8px" }}>Task</th><th style={{ textAlign:"left",padding:"4px 8px" }}>Job</th><th style={{ textAlign:"left",padding:"4px 8px" }}>Worker</th><th style={{ textAlign:"left",padding:"4px 8px" }}>Issued</th><th style={{ textAlign:"left",padding:"4px 8px" }}>Due</th><th style={{ textAlign:"left",padding:"4px 8px" }}>Status</th></tr></thead>
          <tbody>{ft.sort((a,b)=>(a.dueDate||"").localeCompare(b.dueDate||"")).map(task => {
            const job = jobs.find(j=>j.id===task.jobId);
            const assigned = (task.assignedTo||[]).map(id=>users.find(u=>u.id===id)?.name).filter(Boolean).join(", ");
            const s = task.status === "done" ? "✓ Done" : (task.dueDate && task.dueDate < today ? "Overdue" : "Pending");
            return <tr key={task.id} style={{ borderBottom: "1px solid #ddd" }}>
              <td style={{ padding:"4px 8px" }}>{task.title}</td>
              <td style={{ padding:"4px 8px" }}>{job?.name}</td>
              <td style={{ padding:"4px 8px" }}>{assigned}</td>
              <td style={{ padding:"4px 8px" }}>{task.createdAt}</td>
              <td style={{ padding:"4px 8px" }}>{task.dueDate||"—"}</td>
              <td style={{ padding:"4px 8px", fontWeight: 700 }}>{s}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

function Report({ tasks, jobs, users, logs, photos, receipts }) {
  const today = localDate();
  const offsetDay = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const [rangeStart, setRangeStart] = useState(offsetDay(-6));
  const [rangeEnd,   setRangeEnd]   = useState(today);
  const [jobFilter,  setJobFilter]  = useState("all");

  const lo = rangeStart || "0000-00-00";
  const hi = rangeEnd   || "9999-99-99";
  const inRange = (d) => d && d.slice(0,10) >= lo && d.slice(0,10) <= hi;

  const rTasks    = tasks.filter(tk => (jobFilter === "all" || tk.jobId === jobFilter) && inRange(tk.dueDate || tk.createdAt));
  const rLogs     = (logs    || []).filter(l => (jobFilter === "all" || l.jobId  === jobFilter) && inRange(l.date));
  const rPhotos   = (photos  || []).filter(p => (jobFilter === "all" || p.jobId  === jobFilter) && inRange((p.date||"").slice(0,10)));
  const rReceipts = (receipts|| []).filter(r => (jobFilter === "all" || r.jobId  === jobFilter) && inRange(r.createdAt));

  const shownJobs = jobs.filter(j => jobFilter === "all" || j.id === jobFilter)
    .filter(j => rTasks.some(t=>t.jobId===j.id) || rLogs.some(l=>l.jobId===j.id) || rPhotos.some(p=>p.jobId===j.id) || rReceipts.some(r=>r.jobId===j.id));

  const userName = id => users.find(u=>u.id===id)?.name || "Unknown";
  const statusColor = s => s==="done"?"#16a34a":s==="overdue"?"#dc2626":"#d97706";

  const printReport = () => {
    const w = window.open("", "_blank", "width=950,height=1200");
    const logoUrl = `${window.location.origin}/icon-admin.png`;

    const photoHtml = (ph) => ph.map(p => `
      <div style="width:130px;flex-shrink:0">
        <img src="${p.dataUrl||''}" style="width:130px;height:100px;object-fit:cover;border-radius:6px;border:2px solid ${p.type==="before"?"#f97316":p.type==="after"?"#16a34a":"#ef4444"}" onerror="this.style.display='none'"/>
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:${p.type==="before"?"#f97316":p.type==="after"?"#16a34a":"#ef4444"};margin-top:3px">${p.type}${p.note?` — ${p.note}`:""}</div>
        <div style="font-size:8px;color:#999">${(p.date||"").slice(0,10)} · ${userName(p.crewId)}</div>
      </div>`).join("");

    const jobBlocks = shownJobs.map(job => {
      const jTasks    = rTasks.filter(t=>t.jobId===job.id);
      const jLogs     = rLogs.filter(l=>l.jobId===job.id);
      const jPhotos   = rPhotos.filter(p=>p.jobId===job.id);
      const jReceipts = rReceipts.filter(r=>r.jobId===job.id);
      const done = jTasks.filter(t=>t.status==="done").length;

      const taskRows = jTasks.map(tk => {
        const s = tk.status==="done"?"done":(tk.dueDate&&tk.dueDate<today?"overdue":"pending");
        const tphotos = jPhotos.filter(p=>p.taskId===tk.id);
        const crew = (Array.isArray(tk.assignedTo)?tk.assignedTo:[tk.assignedTo]).map(id=>userName(id)).join(", ");
        return `
          <tr style="page-break-inside:avoid">
            <td style="padding:8px 10px;vertical-align:top;font-size:13px;font-weight:600;border-bottom:1px solid #e5e7eb">${tk.title}</td>
            <td style="padding:8px 10px;vertical-align:top;font-size:11px;color:#6b7280;font-style:italic;border-bottom:1px solid #e5e7eb">${tk.titleEs||""}</td>
            <td style="padding:8px 10px;vertical-align:top;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;white-space:nowrap">${crew}</td>
            <td style="padding:8px 10px;vertical-align:top;font-size:11px;color:#6b7280;border-bottom:1px solid #e5e7eb;white-space:nowrap">${tk.dueDate||tk.createdAt||""}</td>
            <td style="padding:8px 10px;vertical-align:top;border-bottom:1px solid #e5e7eb"><span style="background:${statusColor(s)}22;color:${statusColor(s)};padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase">${s}</span></td>
          </tr>
          ${tphotos.length?`<tr style="page-break-inside:avoid"><td colspan="5" style="padding:6px 10px 12px;border-bottom:1px solid #e5e7eb;background:#fafafa">
            <div style="font-size:10px;color:#9ca3af;margin-bottom:6px">📷 ${tphotos.length} photo${tphotos.length!==1?"s":""}</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">${photoHtml(tphotos)}</div>
          </td></tr>`:""}`;
      }).join("");

      const jobOnlyPhotos = jPhotos.filter(p=>!p.taskId);
      const logRows = jLogs.map(l => {
        const lphoto = jPhotos.find(p=>p.taskId===null&&Math.abs(new Date(p.date)-new Date(l.date+"T00:00:00"))<86400000*2&&!l.consumed);
        return `<div style="padding:8px 14px;border-bottom:1px solid #e5e7eb">
          <div style="font-size:11px;color:#6b7280;margin-bottom:3px">${l.date} — <strong>${userName(l.crewId)}</strong></div>
          <div style="font-size:13px">${l.en||""}</div>
          ${lphoto?`<div style="margin-top:6px"><img src="${lphoto.dataUrl||''}" style="width:100px;height:75px;object-fit:cover;border-radius:6px" onerror="this.style.display='none'"/></div>`:""}
        </div>`;
      }).join("");

      const receiptRows = jReceipts.map(r => `
        <tr>
          <td style="padding:6px 10px;font-size:12px;border-bottom:1px solid #e5e7eb">${r.createdAt||""}</td>
          <td style="padding:6px 10px;font-size:12px;border-bottom:1px solid #e5e7eb">${r.store||""}</td>
          <td style="padding:6px 10px;font-size:12px;border-bottom:1px solid #e5e7eb">${userName(r.crewId)}</td>
          <td style="padding:6px 10px;font-size:12px;border-bottom:1px solid #e5e7eb">${r.note||""}</td>
          <td style="padding:6px 10px;font-size:12px;text-align:right;font-weight:700;border-bottom:1px solid #e5e7eb;color:${r.paidBy==="crew"?"#f97316":"#1a1a1a"}">$${(+r.amount||0).toFixed(2)}</td>
          <td style="padding:6px 10px;font-size:11px;border-bottom:1px solid #e5e7eb">${r.paidBy==="crew"?"Crew/Reimb":"Company"}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${r.dataUrl?`<img src="${r.dataUrl}" style="width:48px;height:36px;object-fit:cover;border-radius:4px" onerror="this.style.display='none'"/>`:"—"}</td>
        </tr>`).join("");

      return `
        <div style="margin-bottom:32px;page-break-inside:avoid">
          <div style="background:#4a2c1a;color:#fff;padding:10px 16px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:16px;font-weight:bold">${job.name}</div>
            <div style="font-size:11px;opacity:.75">${done}/${jTasks.length} tasks done${job.address?` · ${job.address}`:""}</div>
          </div>

          ${jTasks.length?`
          <div style="background:#fdf8f3;padding:6px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#7c3f1e;border:1px solid #e8d5c4;border-top:none">Tasks</div>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e8d5c4;border-top:none;border-radius:0 0 0 0">
            <thead><tr style="background:#f9f5f1">
              <th style="padding:7px 10px;text-align:left;font-size:11px;color:#7c3f1e;border-bottom:2px solid #e8d5c4">Task</th>
              <th style="padding:7px 10px;text-align:left;font-size:11px;color:#7c3f1e;border-bottom:2px solid #e8d5c4">Tarea (ES)</th>
              <th style="padding:7px 10px;text-align:left;font-size:11px;color:#7c3f1e;border-bottom:2px solid #e8d5c4">Assigned</th>
              <th style="padding:7px 10px;text-align:left;font-size:11px;color:#7c3f1e;border-bottom:2px solid #e8d5c4">Due</th>
              <th style="padding:7px 10px;text-align:left;font-size:11px;color:#7c3f1e;border-bottom:2px solid #e8d5c4">Status</th>
            </tr></thead>
            <tbody>${taskRows}</tbody>
          </table>
          `:""}

          ${jobOnlyPhotos.length?`
          <div style="background:#f0f4ff;padding:6px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#3b82f6;border:1px solid #dbeafe;border-top:none">Job Photos (No Specific Task)</div>
          <div style="border:1px solid #dbeafe;border-top:none;padding:10px 14px"><div style="display:flex;gap:10px;flex-wrap:wrap">${photoHtml(jobOnlyPhotos)}</div></div>
          `:""}

          ${jLogs.length?`
          <div style="background:#f0fdf4;padding:6px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#16a34a;border:1px solid #bbf7d0;border-top:none">Site Notes</div>
          <div style="border:1px solid #bbf7d0;border-top:none">${logRows}</div>
          `:""}

          ${jReceipts.length?`
          <div style="background:#fffbeb;padding:6px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#d97706;border:1px solid #fde68a;border-top:none">Receipts — Total: $${jReceipts.reduce((s,r)=>s+(+r.amount||0),0).toFixed(2)}</div>
          <table style="width:100%;border-collapse:collapse;border:1px solid #fde68a;border-top:none">
            <thead><tr style="background:#fffdf0">
              <th style="padding:5px 10px;text-align:left;font-size:10px;color:#d97706;border-bottom:1px solid #fde68a">Date</th>
              <th style="padding:5px 10px;text-align:left;font-size:10px;color:#d97706;border-bottom:1px solid #fde68a">Vendor</th>
              <th style="padding:5px 10px;text-align:left;font-size:10px;color:#d97706;border-bottom:1px solid #fde68a">By</th>
              <th style="padding:5px 10px;text-align:left;font-size:10px;color:#d97706;border-bottom:1px solid #fde68a">Note</th>
              <th style="padding:5px 10px;text-align:right;font-size:10px;color:#d97706;border-bottom:1px solid #fde68a">Amount</th>
              <th style="padding:5px 10px;text-align:left;font-size:10px;color:#d97706;border-bottom:1px solid #fde68a">Paid By</th>
              <th style="padding:5px 10px;text-align:left;font-size:10px;color:#d97706;border-bottom:1px solid #fde68a">Photo</th>
            </tr></thead>
            <tbody>${receiptRows}</tbody>
          </table>
          `:""}
        </div>`;
    }).join("");

    w.document.write(`<!DOCTYPE html><html><head><title>GSM Field Report — ${lo} to ${hi}</title>
<style>
@page{size:8.5in 11in;margin:.4in}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;background:#fff;font-size:13px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div style="display:flex;align-items:center;gap:14px;padding-bottom:12px;border-bottom:3px solid #7c3f1e;margin-bottom:20px">
  <img src="${logoUrl}" style="width:52px;height:52px;object-fit:contain;border-radius:8px"/>
  <div>
    <div style="font-size:20px;font-weight:bold;color:#4a2c1a">G.S. MASTERS, INC.</div>
    <div style="font-size:11px;color:#888">255 Grande View Pkwy, Maylene AL 35114 · (205) 620-1698</div>
  </div>
  <div style="margin-left:auto;text-align:right">
    <div style="font-size:14px;font-weight:700;color:#4a2c1a">Field Report</div>
    <div style="font-size:11px;color:#888">${lo} – ${hi}</div>
    <div style="font-size:10px;color:#bbb">Printed ${new Date().toLocaleString()}</div>
  </div>
</div>
${jobBlocks || '<p style="color:#888;text-align:center;padding:40px">No activity in selected date range.</p>'}
<script>window.onload=function(){window.print();}</script>
</body></html>`);
    w.document.close();
  };

  return (
    <div>
      <div className="flexb" style={{ marginBottom: 16 }}>
        <h2 className="h2">Reports</h2>
        <button className="btn btn-p" onClick={printReport}><Icon n="print" s={15} /> Generate &amp; Print Report</button>
      </div>
      <div className="card" style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end", marginBottom:16 }}>
        <div className="fg" style={{ flex:"none" }}><label className="fl">From</label>
          <input type="date" className="fi" value={rangeStart} onChange={e=>setRangeStart(e.target.value)} style={{ width:"auto" }} /></div>
        <div className="fg" style={{ flex:"none" }}><label className="fl">To</label>
          <input type="date" className="fi" value={rangeEnd} onChange={e=>setRangeEnd(e.target.value)} style={{ width:"auto" }} /></div>
        <div className="fg" style={{ flex:"none" }}><label className="fl">Job</label>
          <select className="fi" style={{ width:"auto" }} value={jobFilter} onChange={e=>setJobFilter(e.target.value)}>
            <option value="all">All Jobs</option>
            {jobs.map(j=><option key={j.id} value={j.id}>{j.name}</option>)}
          </select></div>
      </div>
      <div className="card" style={{ padding:"14px 18px" }}>
        <div style={{ fontFamily:"'Barlow Condensed'", fontWeight:700, fontSize:13, letterSpacing:1, color:"var(--slate)", marginBottom:12 }}>REPORT PREVIEW — {lo} to {hi}</div>
        {shownJobs.length === 0
          ? <div className="empty"><Icon n="report" s={40} c="var(--slate)" /><p>No activity in selected date range.</p></div>
          : shownJobs.map(job => {
              const jt = rTasks.filter(t=>t.jobId===job.id);
              const jl = rLogs.filter(l=>l.jobId===job.id);
              const jp = rPhotos.filter(p=>p.jobId===job.id);
              const jr = rReceipts.filter(r=>r.jobId===job.id);
              return <div key={job.id} style={{ marginBottom:14, padding:"10px 14px", background:"rgba(255,255,255,.04)", borderRadius:10, border:"1px solid var(--border)" }}>
                <div style={{ fontFamily:"'Barlow Condensed'", fontWeight:800, fontSize:15, marginBottom:6 }}>{job.name}</div>
                <div style={{ display:"flex", gap:14, fontSize:12, color:"var(--silver)", flexWrap:"wrap" }}>
                  {jt.length > 0 && <span>✓ {jt.length} task{jt.length!==1?"s":""} ({jt.filter(t=>t.status==="done").length} done)</span>}
                  {jp.length > 0 && <span>📷 {jp.length} photo{jp.length!==1?"s":""}</span>}
                  {jl.length > 0 && <span>📝 {jl.length} note{jl.length!==1?"s":""}</span>}
                  {jr.length > 0 && <span>🧾 {jr.length} receipt{jr.length!==1?"s":""} (${jr.reduce((s,r)=>s+(+r.amount||0),0).toFixed(2)})</span>}
                </div>
              </div>;
            })
        }
      </div>
    </div>
  );
}

function AdminReceipts({ receipts, setReceipts, jobs, tasks, users, user, deleteReceipt, reassignReceipt }) {
  const [modal, setModal] = useState(false);
  const [nr, setNr] = useState({ dest: "job", customCat: "", jobId: "", taskId: "", crewId: "", store: "", amount: "", note: "", paidBy: "company", dataUrl: null });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const [lightbox, setLightbox] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [reassign, setReassign] = useState(null); // receipt object
  const [reassignJob, setReassignJob] = useState("");
  const [reassignTask, setReassignTask] = useState("");
  const [reassignConfirm, setReassignConfirm] = useState(false);
  const today = localDate();
  const jobTasks = tasks.filter(t => t.jobId === nr.jobId);

  const addReceipt = async () => {
    const usingJob = nr.dest === "job";
    if ((usingJob && !nr.jobId) || !nr.store || !nr.amount) return;
    if (nr.dest === "custom" && !nr.customCat.trim()) return;
    const category = rcDestCategory(nr.dest, nr.customCat);
    const jobIdVal = usingJob ? nr.jobId : null;
    setBusy(true);
    const id = "r" + Date.now();
    let storagePath = null;
    if (nr.dataUrl) { try { storagePath = await uploadToStorage(nr.dataUrl, `${nr.crewId||user.id}/${id}.jpg`); } catch {} }
    const receipt = { id, jobId: jobIdVal, category, taskId: usingJob ? nr.taskId || null : null, crewId: nr.crewId || user.id,
      dataUrl: nr.dataUrl, store: nr.store, amount: nr.amount, note: nr.note,
      paidBy: nr.paidBy, reimbursementStatus: nr.paidBy === "crew" ? "pending" : "na", createdAt: today };
    setReceipts(p => [...p, receipt]);
    const row = { id, job_id: jobIdVal, category, task_id: usingJob ? nr.taskId || null : null, crew_id: nr.crewId || user.id,
      data_url: storagePath ? null : nr.dataUrl, storage_path: storagePath, store: nr.store, amount: parseFloat(nr.amount) || 0, note: nr.note,
      paid_by: nr.paidBy, reimbursement_status: nr.paidBy === "crew" ? "pending" : "na" };
    try { await sbPost("field_receipts", row); } catch { enqueue({ table: "field_receipts", payload: row }); }
    pushReceiptToGSM(receipt, jobs, users.find(u => u.id === receipt.crewId)?.name);
    setNr({ dest: "job", customCat: "", jobId: "", taskId: "", crewId: "", store: "", amount: "", note: "", paidBy: "company", dataUrl: null });
    setModal(false); setBusy(false);
  };

  const photoCapture = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { const { dataUrl } = await compressImage(file, 1000, 0.6); setNr(p => ({ ...p, dataUrl })); }
    catch { alert("Could not process image. Try again."); }
  };

  const markReimbursed = async (id) => {
    setReceipts(p => p.map(r => r.id === id ? { ...r, reimbursementStatus: "paid", reimbursementDate: today } : r));
    try { await sbPatch("field_receipts", id, { reimbursement_status: "paid", reimbursement_date: today }); } catch {}
    const r = receipts.find(x => x.id === id);
    const crewPhone = r && users.find(u => u.id === r.crewId)?.phone;
    if (crewPhone) {
      const j = r ? jobs.find(x => x.id === r.jobId)?.name : "";
      fetch("/.netlify/functions/send-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: crewPhone, body: `✅ Your receipt has been reimbursed: ${r.store} $${(+r.amount||0).toFixed(2)}${j ? " — " + j : ""}. — G.S. Masters` }) }).catch(() => {});
    }
  };

  const exportBills = () => {
    const payload = receipts.map(r => ({
      receipt_id: r.id, vendor: r.store || "", amount: +r.amount || 0,
      job_id: r.jobId, job_name: jobs.find(j => j.id === r.jobId)?.name || "", category: r.category || null,
      memo: r.note || "", receipt_date: r.createdAt,
      submitted_by: users.find(u => u.id === r.crewId)?.name || "Admin",
      image: r.dataUrl ? "[base64 attached]" : null, status: "pending_review",
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = "gsm-bills-export-" + today + ".json"; a.click(); URL.revokeObjectURL(url);
  };

  const printReceipt = (r) => {
    const j    = jobs.find(x => x.id === r.jobId);
    const cr   = users.find(u => u.id === r.crewId);
    const tk   = tasks.find(t => t.id === r.taskId);
    const reimb = r.paidBy === "crew" ? (r.reimbursementStatus === "paid" ? "Crew — Reimbursed ✓" : "Crew — Pending Reimbursement") : "Company";
    const extras = [tk ? `Task: ${tk.title}` : "", r.note ? `Note: ${r.note}` : ""].filter(Boolean).join("  ·  ");
    const w = window.open("", "_blank", "width=850,height=1100");
    w.document.write(`<!DOCTYPE html><html><head><title>Receipt — ${r.store || ""}</title>
<style>
@page{size:8.5in 11in;margin:.35in}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:10.3in;max-height:10.3in;overflow:hidden}
body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;background:#fff;display:flex;flex-direction:column;overflow:hidden}
.hdr{display:flex;align-items:center;gap:12px;padding-bottom:8px;border-bottom:2px solid #7c3f1e;flex-shrink:0}
.logo{width:44px;height:44px;object-fit:contain;border-radius:6px;flex-shrink:0}
.co-name{font-size:16px;font-weight:bold;color:#4a2c1a;letter-spacing:.3px}
.co-sub{font-size:9px;color:#888;margin-top:1px}
.badge{margin-left:auto;background:#4a2c1a;color:#fff;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:1.5px;padding:4px 10px;border-radius:4px;white-space:nowrap}
.info{display:flex;gap:0;border:1px solid #d4b896;border-radius:6px;overflow:hidden;margin:8px 0;flex-shrink:0}
.cell{flex:1;padding:7px 10px;background:#fdf8f3;border-right:1px solid #d4b896}
.cell:last-child{border-right:none}
.cell.wide{flex:2}
.cell .lbl{font-size:7px;font-weight:bold;color:#7c3f1e;text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:2px}
.cell .val{font-size:11px;font-weight:600;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.amt-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-shrink:0}
.amt-box{background:#4a2c1a;color:#fff;padding:6px 18px;border-radius:6px;display:flex;align-items:baseline;gap:6px}
.amt-lbl{font-size:8px;text-transform:uppercase;letter-spacing:1px;opacity:.75}
.amt-val{font-size:26px;font-weight:bold;line-height:1}
.extras{font-size:10px;color:#666;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.photo-wrap{flex:1 1 0;min-height:0;max-height:100%;overflow:hidden;border-radius:6px;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;background:#f7f7f7}
.photo-wrap img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;margin:0 auto}
.no-photo{flex:1;display:flex;align-items:center;justify-content:center;color:#aaa;font-style:italic;font-size:13px;border:1px dashed #ddd;border-radius:6px}
.foot{flex-shrink:0;margin-top:6px;font-size:7.5px;color:#bbb;text-align:center}
@media print{
  html,body{height:10.3in!important;max-height:10.3in!important;overflow:hidden!important}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .photo-wrap,.hdr,.info,.amt-row,.foot{page-break-inside:avoid}
}
</style></head><body>
<div class="hdr">
  <img class="logo" src="https://quiet-seahorse-2ba028.netlify.app/icon-admin.png" alt="GSM"/>
  <div>
    <div class="co-name">G.S. MASTERS, INC.</div>
    <div class="co-sub">255 Grande View Pkwy, Maylene AL 35114 &nbsp;&middot;&nbsp; (205) 620-1698</div>
  </div>
  <div class="badge">Field Receipt</div>
</div>
<div class="info">
  <div class="cell"><span class="lbl">Date</span><span class="val">${r.createdAt}</span></div>
  <div class="cell wide"><span class="lbl">${j ? "Job" : "Category"}</span><span class="val">${j?.name || r.category || "—"}</span></div>
  <div class="cell wide"><span class="lbl">Vendor</span><span class="val">${r.store || "—"}</span></div>
  <div class="cell"><span class="lbl">Submitted By</span><span class="val">${cr?.name || "Admin"}</span></div>
  <div class="cell"><span class="lbl">Paid By</span><span class="val">${reimb}</span></div>
</div>
<div class="amt-row">
  <div class="amt-box"><span class="amt-lbl">Amount</span><span class="amt-val">$${(+r.amount || 0).toFixed(2)}</span></div>
  ${extras ? `<div class="extras">${extras}</div>` : ""}
</div>
${r.dataUrl
  ? `<div class="photo-wrap"><img src="${r.dataUrl}" alt="Receipt"/></div>`
  : `<div class="no-photo">No photo attached</div>`}
<div class="foot">GS Masters Field App &nbsp;&middot;&nbsp; Printed ${new Date().toLocaleString()} &nbsp;&middot;&nbsp; ID: ${r.id}</div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}</script>
</body></html>`);
    w.document.close();
  };

  const pendingReimb = receipts.filter(r => r.paidBy === "crew" && r.reimbursementStatus !== "paid");
  const total = receipts.reduce((s, r) => s + (+r.amount || 0), 0);

  const gsmEligible = receipts.filter(r => {
    const j = jobs.find(x => x.id === r.jobId);
    return j?.gsmSync && j?.gsmJobId && r.billStatus !== "posted";
  });
  const [postingAll, setPostingAll] = useState(false);
  const postAllToGSM = async () => {
    if (!gsmEligible.length || postingAll) return;
    setPostingAll(true);
    let ok = 0;
    for (const r of gsmEligible) {
      const cr = users.find(u => u.id === r.crewId);
      if (await pushReceiptToGSM(r, jobs, cr?.name)) {
        ok++;
        setReceipts(p => p.map(x => x.id === r.id ? { ...x, billStatus: "posted", integrationSentAt: new Date().toISOString() } : x));
      }
    }
    setPostingAll(false);
    alert(`Posted ${ok} of ${gsmEligible.length} receipt${gsmEligible.length !== 1 ? "s" : ""} to GSM Builder`);
  };

  return (
    <div>
      <div className="flexb" style={{ marginBottom: 8 }}>
        <h2 className="h2">Receipts</h2>
        <div style={{ display: "flex", gap: 8 }}>
          {gsmEligible.length > 0 && <button className="btn btn-s btn-sm" disabled={postingAll} onClick={postAllToGSM}
            style={{ background:"rgba(59,130,246,.15)", color:"var(--sky2)", border:"1px solid rgba(59,130,246,.35)" }}>
            {postingAll ? <span className="spin" /> : <>Post All → GSM ({gsmEligible.length})</>}
          </button>}
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
          {(() => {
            const byJob = {}, byCrew = {};
            receipts.forEach(r => {
              const jk = r.jobId || (r.category ? "cat:" + r.category : "unknown");
              if (!byJob[jk]) byJob[jk] = { name: r.jobId ? (jobs.find(j=>j.id===r.jobId)?.name||"Unknown Job") : (r.category ? `📌 ${r.category}` : "Uncategorized"), total:0 };
              byJob[jk].total += +r.amount||0;
              const ck = r.crewId || "unknown";
              if (!byCrew[ck]) byCrew[ck] = { name: users.find(u=>u.id===ck)?.name||"Unknown", total:0 };
              byCrew[ck].total += +r.amount||0;
            });
            return (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
                <div style={{ padding:"10px 14px", background:"rgba(255,255,255,.03)", borderRadius:10, border:"1px solid var(--border)" }}>
                  <div style={{ fontFamily:"'Barlow Condensed'", fontWeight:700, fontSize:12, letterSpacing:1, marginBottom:8, color:"var(--slate)" }}>BY JOB</div>
                  {Object.values(byJob).sort((a,b)=>b.total-a.total).map((j,i)=>(
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"2px 0" }}>
                      <span className="muted" style={{ fontSize:12 }}>{j.name}</span>
                      <span style={{ fontWeight:700, color:"var(--accent)" }}>${j.total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div style={{ padding:"10px 14px", background:"rgba(255,255,255,.03)", borderRadius:10, border:"1px solid var(--border)" }}>
                  <div style={{ fontFamily:"'Barlow Condensed'", fontWeight:700, fontSize:12, letterSpacing:1, marginBottom:8, color:"var(--slate)" }}>BY CREW</div>
                  {Object.values(byCrew).sort((a,b)=>b.total-a.total).map((c,i)=>(
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"2px 0" }}>
                      <span className="muted" style={{ fontSize:12 }}>{c.name}</span>
                      <span style={{ fontWeight:700, color:"var(--accent)" }}>${c.total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          <div className="tbl-wrap"><table><thead><tr>
            <th>Photo</th><th>Date</th><th>By</th><th>Job</th><th>Vendor</th><th>Memo</th>
            <th>Paid By</th><th>Reimburse</th><th>GSM Builder</th><th style={{ textAlign: "right" }}>Amount</th><th></th>
          </tr></thead>
          <tbody>{receipts.map(r => {
            const j=jobs.find(x=>x.id===r.jobId), cr=users.find(u=>u.id===r.crewId);
            const needsReimb=r.paidBy==="crew"&&r.reimbursementStatus!=="paid";
            return <tr key={r.id}>
              <td data-l="Photo">
                {r.dataUrl
                  ? <img src={r.dataUrl} alt="rcpt" onClick={() => setLightbox(r.dataUrl)}
                      style={{ width:48,height:48,objectFit:"cover",borderRadius:6,cursor:"zoom-in",border:"2px solid var(--border)" }} />
                  : <span className="muted">—</span>}
              </td>
              <td data-l="Date" className="muted">{r.createdAt}</td>
              <td data-l="By">{cr?.name||"Admin"}</td>
              <td data-l="Job">
                <button onClick={() => { setReassign(r); setReassignJob(r.jobId||""); setReassignTask(r.taskId||""); setReassignConfirm(false); }}
                  style={{ background:"none",border:"none",cursor:"pointer",color:"var(--sky2)",fontSize:12,textDecoration:"underline",padding:0 }}>
                  {j?.name || (r.category ? `📌 ${r.category}` : "—")}
                </button>
              </td>
              <td data-l="Vendor">{r.store}</td>
              <td data-l="Memo" className="muted">{r.note}</td>
              <td data-l="Paid By"><span className={"tag " + (r.paidBy==="crew"?"tag-overdue":"tag-done")}>{r.paidBy==="crew"?"Crew":"Company"}</span></td>
              <td data-l="Reimburse">{r.paidBy==="crew"
                ?needsReimb
                  ?<button className="btn btn-sm" style={{ background:"rgba(249,115,22,.15)",color:"var(--orange)",padding:"4px 10px",fontSize:11,border:"1px solid rgba(249,115,22,.4)" }} onClick={()=>markReimbursed(r.id)}>Mark Paid</button>
                  :<span className="tag tag-done">Reimbursed</span>
                :<span className="muted">—</span>}</td>
              <td data-l="GSM Builder">
                {j?.gsmSync && j?.gsmJobId
                  ? r.billStatus === "posted"
                    ? <span className="tag tag-done" style={{ fontSize: 10 }}>✓ Posted</span>
                    : <button className="btn btn-sm"
                        style={{ fontSize: 10, padding: "3px 8px", background: "rgba(59,130,246,.15)", color: "var(--sky2)", border: "1px solid rgba(59,130,246,.35)" }}
                        onClick={async () => {
                          const ok = await pushReceiptToGSM(r, jobs, cr?.name);
                          if (ok) setReceipts(p => p.map(x => x.id === r.id ? { ...x, billStatus: "posted", integrationSentAt: new Date().toISOString() } : x));
                        }}>
                        Post →
                      </button>
                  : <span className="muted" style={{ fontSize: 10 }}>—</span>}
              </td>
              <td data-l="Amount" style={{ textAlign:"right",fontWeight:700,color:needsReimb?"var(--orange)":"var(--accent)" }}>${(+r.amount).toFixed(2)}</td>
              <td style={{ whiteSpace:"nowrap" }}>
                <button onClick={() => printReceipt(r)} title="Print receipt" style={{ background:"none",border:"none",cursor:"pointer",color:"var(--sky2)",fontSize:15,padding:"2px 5px" }}>🖨</button>
                <button onClick={() => setConfirmDel(r.id)} style={{ background:"none",border:"none",cursor:"pointer",color:"var(--red)",fontSize:16,padding:"2px 5px" }}>✕</button>
              </td>
            </tr>;
          })}</tbody></table></div>
        </div>
      }

      {/* Lightbox */}
      {lightbox && (
        <div className="modal-bg" onClick={() => setLightbox(null)}>
          <div style={{ position: "relative", maxWidth: "90vw" }} onClick={e => e.stopPropagation()}>
            <img src={lightbox} alt="receipt" style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: 12 }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
              <button className="btn btn-s" onClick={() => setLightbox(null)}>Close</button>
              <button className="btn btn-p" onClick={() => { const w = window.open("","_blank"); w.document.write(`<html><body style="margin:0"><img src="${lightbox}" style="max-width:100%;display:block"/></body></html>`); w.print(); }}><Icon n="print" s={14} /> Print Receipt</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="modal-bg" onClick={() => setConfirmDel(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">Delete this receipt?</div>
            <p className="muted" style={{ lineHeight: 1.6 }}>Permanently removes the receipt and cannot be undone.</p>
            <div className="macts">
              <button className="btn btn-s" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="btn" style={{ background: "linear-gradient(135deg,#dc2626,var(--red))", color: "#fff" }} onClick={() => { deleteReceipt(confirmDel); setConfirmDel(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Reassign receipt */}
      {reassign && (() => {
        const jobTasks2 = tasks.filter(t => t.jobId === reassignJob);
        return (
          <div className="modal-bg" onClick={() => { setReassign(null); setReassignConfirm(false); }}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="mt">Reassign Receipt</div>
              <p className="muted" style={{ marginBottom: 14 }}>Currently: <strong>{jobs.find(j=>j.id===reassign.jobId)?.name || (reassign.category ? `📌 ${reassign.category}` : "—")}</strong></p>
              {!reassignConfirm ? (
                <>
                  <div className="fg"><label className="fl">Move to</label>
                    <select className="fi" value={reassignJob} onChange={e => { setReassignJob(e.target.value); setReassignTask(""); }}>
                      <option value="">Select Job or Category</option>
                      <optgroup label="Jobs">{jobs.filter(j=>j.status!=="closed").map(j=><option key={j.id} value={j.id}>{j.name}</option>)}</optgroup>
                      <optgroup label="Overhead (no job)">{RC_OVERHEAD.map(([k,label,cat])=><option key={k} value={"cat:"+cat}>{label}</option>)}</optgroup>
                    </select></div>
                  {!reassignJob.startsWith("cat:") && <div className="fg"><label className="fl">Task (optional)</label>
                    <select className="fi" value={reassignTask} onChange={e => setReassignTask(e.target.value)} disabled={!reassignJob}>
                      <option value="">No specific task</option>{jobTasks2.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
                    </select></div>}
                  <div className="macts">
                    <button className="btn btn-s" onClick={() => { setReassign(null); }}>Cancel</button>
                    <button className="btn btn-p" disabled={!reassignJob} onClick={() => setReassignConfirm(true)}>Apply Change</button>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ color: "var(--orange)", marginBottom: 14, fontWeight: 600 }}>
                    ⚠ Move receipt to "{reassignJob.startsWith("cat:") ? reassignJob.slice(4) : jobs.find(j=>j.id===reassignJob)?.name}"? This cannot be undone.
                  </p>
                  <div className="macts">
                    <button className="btn btn-s" onClick={() => setReassignConfirm(false)}>No — Go Back</button>
                    <button className="btn btn-g" onClick={() => {
                      const patch = reassignJob.startsWith("cat:")
                        ? { jobId: null, taskId: null, category: reassignJob.slice(4) }
                        : { jobId: reassignJob, taskId: reassignTask || null, category: null };
                      reassignReceipt(reassign.id, patch); setReassign(null); setReassignConfirm(false);
                    }}>Yes — Move It</button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {modal && <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setModal(false)}>
        <div className="modal"><div className="mt">Add Receipt</div>
          <div className="fg"><label className="fl">Charge this to</label>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {[["job","🏗 Job"],...RC_OVERHEAD.map(([k,label])=>[k,label]),["custom","📌 Custom"]].map(([k,label]) => (
                <button key={k} className={`btn btn-sm ${nr.dest===k?"btn-a":"btn-s"}`} onClick={()=>setNr(p=>({...p,dest:k}))}>{label}</button>
              ))}
            </div>
            {nr.dest === "custom" && (
              <input className="fi" value={nr.customCat} onChange={e=>setNr(p=>({...p,customCat:e.target.value}))} placeholder="e.g. Marketing, Legal, Storage Unit" style={{ marginTop:8 }} />
            )}
          </div>
          {nr.dest === "job" && <div className="grid2">
            <div className="fg"><label className="fl">Job</label>
              <select className="fi" value={nr.jobId} onChange={e=>setNr(p=>({...p,jobId:e.target.value,taskId:""}))}>
                <option value="">Select Job</option>{jobs.filter(j=>j.status!=="closed").map(j=><option key={j.id} value={j.id}>{j.name}</option>)}</select></div>
            <div className="fg"><label className="fl">Task (optional)</label>
              <select className="fi" value={nr.taskId} onChange={e=>setNr(p=>({...p,taskId:e.target.value}))} disabled={!nr.jobId}>
                <option value="">General / No task</option>{jobTasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></div>
          </div>}
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
                  <button className="btn btn-s btn-sm" onClick={() => openGallery(photoCapture)}><Icon n="photo" s={14} /> From Library</button>
                </div>
            }</div>
          <div className="macts">
            <button className="btn btn-s" onClick={()=>setModal(false)}>Cancel</button>
            <button className="btn btn-p" onClick={addReceipt} disabled={busy||!nr.store||!nr.amount||(nr.dest==="job"&&!nr.jobId)||(nr.dest==="custom"&&!nr.customCat.trim())}>
              {busy?<span className="spin" />:<><Icon n="check" s={14} /> Save Receipt</>}
            </button>
          </div>
        </div>
      </div>}
    </div>
  );
}


function AdminPhotos({ photos, setPhotos, tasks, jobs, users, user, deletePhoto, reassignPhoto }) {
  const [jobFilter, setJobFilter] = useState("all");
  const [uploadJob, setUploadJob] = useState("");
  const [uploadTask, setUploadTask] = useState("");
  const [uploadType, setUploadType] = useState("progress");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const fileRef = useRef();
  const [lightbox, setLightbox] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [reassign, setReassign] = useState(null);
  const [reassignJob, setReassignJob] = useState("");
  const [reassignTask, setReassignTask] = useState("");
  const [reassignConfirm, setReassignConfirm] = useState(false);
  const [pendingAdminPhoto, setPendingAdminPhoto] = useState(null); // { dataUrl, sizeKB }
  const [adminPhotoNote, setAdminPhotoNote] = useState("");

  const jobTasks = tasks.filter(t => t.jobId === uploadJob);
  const sessionPhotos = photos.filter(p => p.jobId === uploadJob);

  const upload = async e => {
    const file = e.target.files[0];
    if (!file || !uploadJob) return;
    setBusy(true);
    let compressed;
    try { compressed = await compressImage(file); }
    catch { setBusy(false); alert("Could not process image. Try again."); e.target.value = ""; return; }
    const { dataUrl, sizeKB } = compressed;
    e.target.value = "";
    setBusy(false);
    setPendingAdminPhoto({ dataUrl, sizeKB });
    setAdminPhotoNote("");
  };

  const saveAdminPhoto = async (note) => {
    if (!pendingAdminPhoto || !uploadJob) return;
    setBusy(true);
    const id = "p" + Date.now();
    const { dataUrl, sizeKB } = pendingAdminPhoto;
    let storagePath = null;
    try { storagePath = await uploadToStorage(dataUrl, `${user.id}/${id}.jpg`); } catch {}
    const photo = { id, dataUrl, type: uploadType, taskId: uploadTask || null, jobId: uploadJob, crewId: user.id, sizeKB, note: note || "", date: new Date().toISOString() };
    setPhotos(p => [...p, photo]);
    const row = { id, data_url: storagePath ? null : dataUrl, storage_path: storagePath, photo_type: uploadType, task_id: uploadTask || null, job_id: uploadJob, crew_id: user.id, size_kb: sizeKB, note: note || null };
    try { await sbPost("field_photos", row); } catch { enqueue({ table: "field_photos", payload: row }); }
    setPendingAdminPhoto(null);
    setAdminPhotoNote("");
    setBusy(false);
    setSaved(s => s + 1);
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
          <button className="btn btn-s" disabled={!uploadJob || busy} onClick={() => openGallery(upload)}>
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
                      <div key={i} style={{ display:"flex", flexDirection:"column", width:110 }}>
                        <div className="pthumb" title={(who?.name || "Admin") + " · " + (p.date || "").slice(0, 10)} style={{ position:"relative", width:110, height:110, flexShrink:0 }}>
                          {p.dataUrl
                            ? <img src={p.dataUrl} alt={p.type} onClick={() => setLightbox(p)} style={{ cursor: "zoom-in" }} />
                            : <Icon n="camera" s={28} c="var(--slate)" />}
                          <div className="plabel" style={{ color: p.type === "before" ? "var(--orange)" : p.type === "after" ? "var(--green)" : "var(--sky2)" }}>{p.type}</div>
                          <button onClick={() => setConfirmDel(p.id)}
                            style={{ position:"absolute",top:3,right:3,background:"rgba(239,68,68,.85)",border:"none",borderRadius:4,color:"#fff",cursor:"pointer",fontSize:10,padding:"2px 4px",lineHeight:1 }}>✕</button>
                          <button onClick={() => { setReassign(p); setReassignJob(p.jobId||""); setReassignTask(p.taskId||""); setReassignConfirm(false); }}
                            style={{ position:"absolute",top:3,left:3,background:"rgba(59,130,246,.85)",border:"none",borderRadius:4,color:"#fff",cursor:"pointer",fontSize:10,padding:"2px 4px",lineHeight:1 }}>✎</button>
                        </div>
                        {p.note && <div style={{ fontSize:10, color:"var(--silver)", marginTop:4, lineHeight:1.3, wordBreak:"break-word", maxHeight:36, overflow:"hidden" }}>{p.note}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
      }

      {/* Admin photo description modal */}
      {pendingAdminPhoto && (
        <div className="modal-bg">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">📷 Describe this photo</div>
            <div style={{ display:"flex", gap:12, marginBottom:16, alignItems:"flex-start" }}>
              <img src={pendingAdminPhoto.dataUrl} alt="preview"
                style={{ width:90, height:90, objectFit:"cover", borderRadius:10, flexShrink:0, border:"2px solid var(--border)" }} />
              <div style={{ flex:1 }}>
                <p className="muted" style={{ fontSize:12, marginBottom:8 }}>Add a description so this photo is searchable and understood in reports.</p>
                <textarea className="fi" rows={4} autoFocus
                  value={adminPhotoNote} onChange={e => setAdminPhotoNote(e.target.value)}
                  placeholder="e.g. North wall framing complete, moisture issue under deck, tile layout before grouting..." />
              </div>
            </div>
            <div className="macts">
              <button className="btn btn-s" onClick={() => saveAdminPhoto("")}>Save without description</button>
              <button className="btn btn-p" disabled={busy} onClick={() => saveAdminPhoto(adminPhotoNote)}>
                {busy ? <span className="spin"/> : <><Icon n="check" s={14}/> Save Photo</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo lightbox */}
      {lightbox && (
        <div className="modal-bg" onClick={() => setLightbox(null)}>
          <div style={{ maxWidth: "90vw" }} onClick={e => e.stopPropagation()}>
            <img src={lightbox.dataUrl} alt={lightbox.type} style={{ maxWidth: "100%", maxHeight: "75vh", borderRadius: 12, objectFit: "contain" }} />
            {lightbox.note && (
              <div style={{ marginTop:10, padding:"8px 14px", background:"rgba(0,0,0,.5)", borderRadius:8, color:"var(--white)", fontSize:14, textAlign:"center" }}>
                {lightbox.note}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
              <button className="btn btn-s" onClick={() => setLightbox(null)}>Close</button>
              <button className="btn btn-p" onClick={() => { const w = window.open("","_blank"); w.document.write(`<html><body style="margin:0"><img src="${lightbox.dataUrl}" style="max-width:100%;display:block"/></body></html>`); w.print(); }}><Icon n="print" s={14} /> Print</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="modal-bg" onClick={() => setConfirmDel(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">Delete this photo?</div>
            <p className="muted">This permanently removes the photo and cannot be undone.</p>
            <div className="macts">
              <button className="btn btn-s" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="btn" style={{ background: "linear-gradient(135deg,#dc2626,var(--red))", color: "#fff" }} onClick={() => { deletePhoto(confirmDel); setConfirmDel(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Reassign photo */}
      {reassign && (() => {
        const jobTasks2 = tasks.filter(t => t.jobId === reassignJob);
        return (
          <div className="modal-bg" onClick={() => { setReassign(null); setReassignConfirm(false); }}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="mt">Reassign Photo</div>
              <p className="muted" style={{ marginBottom: 14 }}>Currently: <strong>{jobs.find(j=>j.id===reassign.jobId)?.name || "—"}</strong> · {reassign.type}</p>
              {!reassignConfirm ? (
                <>
                  <div className="fg"><label className="fl">New Job</label>
                    <select className="fi" value={reassignJob} onChange={e => { setReassignJob(e.target.value); setReassignTask(""); }}>
                      <option value="">Select Job</option>{jobs.filter(j=>j.status!=="closed").map(j=><option key={j.id} value={j.id}>{j.name}</option>)}
                    </select></div>
                  <div className="fg"><label className="fl">Task (optional)</label>
                    <select className="fi" value={reassignTask} onChange={e => setReassignTask(e.target.value)} disabled={!reassignJob}>
                      <option value="">No specific task</option>{jobTasks2.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
                    </select></div>
                  <div className="macts">
                    <button className="btn btn-s" onClick={() => setReassign(null)}>Cancel</button>
                    <button className="btn btn-p" disabled={!reassignJob} onClick={() => setReassignConfirm(true)}>Apply Change</button>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ color: "var(--orange)", marginBottom: 14, fontWeight: 600 }}>
                    ⚠ Move photo to "{jobs.find(j=>j.id===reassignJob)?.name}"? This cannot be undone.
                  </p>
                  <div className="macts">
                    <button className="btn btn-s" onClick={() => setReassignConfirm(false)}>No — Go Back</button>
                    <button className="btn btn-g" onClick={() => { reassignPhoto(reassign.id, { jobId: reassignJob, taskId: reassignTask || null }); setReassign(null); setReassignConfirm(false); }}>Yes — Move It</button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}


function Jobs({ jobs, setJobs, tasks }) {
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [syncConfirm, setSyncConfirm] = useState(null);
  const [nj, setNj] = useState({ name: "", street: "", city: "", state: "AL", gsmSync: false, gsmJobId: "" });
  const [showClosed, setShowClosed] = useState(false);
  const [gsmJobs, setGsmJobs] = useState([]); // live list from GSM Builder for the link dropdown

  useEffect(() => {
    sbGet("gsm_jobs", "select=id,data").then(rows => {
      setGsmJobs((rows || []).map(r => ({ id: r.id, name: r.data?.name || r.id, status: r.data?.status || "" }))
        .filter(j => j.status !== "Complete").sort((a, b) => a.id.localeCompare(b.id)));
    }).catch(() => {});
  }, []);

  const GsmJobSelect = ({ value, onChange, style }) => (
    <select className="fi" style={style} value={value || ""} onChange={e => onChange(e.target.value)}>
      <option value="">— Not linked —</option>
      {gsmJobs.map(g => <option key={g.id} value={g.id}>{g.id} · {g.name}</option>)}
      {value && !gsmJobs.some(g => g.id === value) && <option value={value}>{value}</option>}
    </select>
  );

  const add = async () => {
    if (!nj.name || !nj.street) return;
    const id = "j" + Date.now();
    const address = [nj.street, nj.city, nj.state].filter(Boolean).join(", ");
    const gsmJobId = nj.gsmSync ? (nj.gsmJobId || null) : null;
    const job = { id, name: nj.name, address, status: "active", gsmSync: nj.gsmSync, gsmJobId };
    setJobs(p => [...p, job]); setNj({ name: "", street: "", city: "", state: "AL", gsmSync: false, gsmJobId: "" }); setModal(false);
    const row = { id, name: nj.name, address, status: "active", gsm_sync: nj.gsmSync, gsm_job_id: gsmJobId };
    try { await sbPost("field_jobs", row); }
    catch { enqueue({ table: "field_jobs", payload: row }); }
  };

  const setStatus = async (id, status) => {
    const closedAt = status === "closed" ? localDate() : null;
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
                <label style={{ fontSize: 10, color: "var(--green)", display: "block", marginBottom: 4, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>GSM Builder Job</label>
                <GsmJobSelect value={job.gsmJobId} style={{ padding: "6px 10px", fontSize: 12 }}
                  onChange={async val => {
                    setJobs(p => p.map(j => j.id === job.id ? { ...j, gsmJobId: val || null } : j));
                    try { await sbPatch("field_jobs", job.id, { gsm_job_id: val || null }); } catch {}
                  }} />
                <div style={{ fontSize: 10, color: job.gsmJobId ? "var(--green)" : "var(--orange)", marginTop: 4 }}>
                  {job.gsmJobId
                    ? "Linked to GSM Builder " + job.gsmJobId
                    : "⚠ Not linked — hours, receipts & tasks will NOT appear in GSM Builder"}
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
            {nj.gsmSync && (
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 10, color: "var(--green)", display: "block", marginBottom: 4, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>Link to GSM Builder Job</label>
                <GsmJobSelect value={nj.gsmJobId} onChange={val => setNj(p => ({ ...p, gsmJobId: val }))} style={{ padding: "6px 10px", fontSize: 12 }} />
                <p style={{ fontSize: 11, color: nj.gsmJobId ? "var(--green)" : "var(--orange)", marginTop: 6 }}>
                  {nj.gsmJobId
                    ? "✓ Hours, receipts & tasks will flow into " + nj.gsmJobId
                    : "⚠ Pick the GSM Builder job now — without a link, nothing reaches accounting. Create the job in GSM Builder first if it's not in the list."}
                </p>
              </div>
            )}
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

function CrewMgmt({ users, tasks, setActive, setIs1099, addUser, updateUser, removeUser, archiveCrew, unarchiveCrew, settings }) {
  const [modal, setModal] = useState(null); // 'add' | user object (edit)
  const [invite, setInvite] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", pin: "" });
  const isActive = m => m.active !== false;
  const appUrl = settings?.appUrl || (typeof window !== "undefined" ? window.location.origin : "https://your-app.netlify.app");

  const openAdd = () => { setForm({ name: "", email: "", phone: "", pin: String(Math.floor(1000 + Math.random() * 9000)), role: "crew" }); setModal("add"); };
  const openEdit = m => { setForm({ name: m.name, email: m.email, phone: m.phone || "", pin: m.pin, role: m.role || "crew" }); setModal(m); };
  const save = () => {
    if (!form.name || !form.pin) return;
    if (modal === "add") { addUser(form); setInvite({ ...form }); }
    else updateUser(modal.id, form);
    setModal(null);
  };
  const inviteText = (m) => {
    const isAdmin = m.role === "admin";
    // ?login=1 clears any cached session so the device always shows the login screen
    const link = `${appUrl}/?login=1`;
    const dashboardNote = isAdmin
      ? "Once logged in you'll see the full admin dashboard."
      : "Once logged in you'll see your personal crew task dashboard — not the admin pages.";
    const displayPhone = m.phone ? m.phone.replace(/\D/g, "").slice(-10).replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3") : "(your phone number)";
    const loginId = m.email && !m.email.includes("@gsm.local") ? `Email: ${m.email}` : `Phone: ${displayPhone}`;
    return `Hi ${m.name.split(" ")[0]}! Here's the G.S. Masters Field App.\n\n1. Open this link: ${link}\n2. Tap "Add to Home Screen" to save it\n3. Log in with:\n   ${loginId}\n   PIN: ${m.pin}\n\n${dashboardNote}\n\nText me if you have trouble. — Gregory`;
  };

  return (
    <div>
      <div className="flexb" style={{ marginBottom: 8 }}><h2 className="h2">Crew</h2>
        <button className="btn btn-p" onClick={openAdd}><Icon n="plus" s={16} /> Add Crew</button></div>
      <p className="muted" style={{ marginBottom: 18, fontSize: 13 }}>Add a member to generate their login + invite. Deactivate blocks access immediately. Archive moves them out of active crew but keeps all their records for bookkeeping.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 14 }}>
        {users.filter(u => !u.archived).sort((a,b) => (a.role==="admin"?0:1)-(b.role==="admin"?0:1) || a.name.localeCompare(b.name)).map(m => { const mt = tasks.filter(t => (Array.isArray(t.assignedTo) ? t.assignedTo.includes(m.id) : t.assignedTo === m.id)), done = mt.filter(t => t.status === "done").length;
          const active = isActive(m);
          const isAdmin = m.role === "admin";
          return <div key={m.id} className="card" style={{ borderTop: `4px solid ${isAdmin ? "var(--accent)" : active ? "var(--sky)" : "var(--red)"}`, opacity: active ? 1 : .75 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div style={{ width: 46, height: 46, borderRadius: "50%", background: isAdmin ? "linear-gradient(135deg,#b45309,var(--accent))" : active ? "linear-gradient(135deg,var(--sky-dim),var(--sky))" : "linear-gradient(135deg,#7f1d1d,var(--red))", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 19 }}>{m.name[0]}</div>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 16, display:"flex", alignItems:"center", gap:6 }}>{m.name}{isAdmin && <span style={{ fontSize:10, fontWeight:800, color:"var(--accent)", background:"rgba(245,158,11,.15)", border:"1px solid rgba(245,158,11,.3)", borderRadius:4, padding:"1px 5px" }}>ADMIN</span>}</div><div className="muted" style={{ fontSize: 12 }}>{m.email}</div></div></div>
            <div className="grid2" style={{ marginBottom: 12 }}><div style={{ textAlign: "center", padding: 10, background: "rgba(0,0,0,.2)", borderRadius: 8 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--sky2)" }}>{mt.length}</div><div className="muted" style={{ fontSize: 11 }}>Tasks</div></div>
              <div style={{ textAlign: "center", padding: 10, background: "rgba(0,0,0,.2)", borderRadius: 8 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--green)" }}>{done}</div><div className="muted" style={{ fontSize: 11 }}>Done</div></div></div>
            <div className="flexb" style={{ marginBottom: 10 }}>
              <span className={`tag tag-${active ? "done" : "overdue"}`}>{active ? "● Active" : "● Locked"}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-s btn-sm btn-ic" title="Invite" onClick={() => setInvite(m)}><Icon n="translate" s={13} /></button>
                <button className="btn btn-s btn-sm btn-ic" title="Edit" onClick={() => openEdit(m)}><Icon n="pen" s={13} /></button></div></div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <button className={`btn btn-sm ${active ? "btn-s" : "btn-g"}`} style={{ flex: 1 }} onClick={() => setActive(m.id, !active)}>
                <Icon n={active ? "lock" : "power"} s={13} /> {active ? "Deactivate" : "Reactivate"}
              </button>
              <button className="btn btn-sm btn-s" title="Archive — removes from active crew, keeps all records" onClick={() => archiveCrew(m.id)}
                style={{ padding: "8px 10px", color: "var(--slate)" }}>📦</button>
            </div>
            <button className={`btn btn-sm btn-full`}
              style={{ fontSize: 11, color: m.is1099 ? "var(--accent)" : "var(--slate)", borderColor: m.is1099 ? "rgba(245,158,11,.5)" : "var(--border)", background: m.is1099 ? "rgba(245,158,11,.08)" : "transparent" }}
              onClick={() => setIs1099(m.id, !m.is1099)}>
              {m.is1099 ? "✓ 1099 Crew — shows in GSM Crew Pay" : "○ Not 1099 — hidden from GSM Crew Pay"}
            </button>
          </div>; })}</div>

      {/* ── Archived crew ── */}
      {users.filter(u => u.archived).length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 14, fontWeight: 700, color: "var(--slate)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
            📦 Archived — kept for bookkeeping, no app access
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 10 }}>
            {users.filter(u => u.archived).map(m => (
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
        <div className="modal"><div className="mt">{modal === "add" ? "Add Team Member" : "Edit Team Member"}</div>
          <div className="fg"><label className="fl">Full Name</label><input className="fi" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Juan Martinez" /></div>
          <div className="fg"><label className="fl">Email (optional — for login &amp; invite)</label><input className="fi" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="juan@gsm.com (optional)" /></div>
          <div className="grid2">
            <div className="fg"><label className="fl">Phone</label><input className="fi" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+1205..." /></div>
            <div className="fg"><label className="fl">PIN</label><input className="fi" value={form.pin} onChange={e => setForm(p => ({ ...p, pin: e.target.value.replace(/\D/g, "").slice(0, 6) }))} placeholder="4-digit" /></div>
          </div>
          <div className="fg">
            <label className="fl">Role</label>
            <div style={{ display: "flex", gap: 8 }}>
              <button className={"btn btn-sm flex-1 " + (form.role === "crew" ? "btn-p" : "btn-s")}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setForm(p => ({ ...p, role: "crew" }))}>
                👷 Crew Worker
              </button>
              <button className={"btn btn-sm " + (form.role === "admin" ? "btn-a" : "btn-s")}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setForm(p => ({ ...p, role: "admin" }))}>
                🔑 Admin
              </button>
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 5 }}>
              {form.role === "crew" ? "Crew sees their task dashboard (mobile-first)" : "Admin sees full management dashboard"}
            </p>
          </div>
          <div className="macts">
            {modal !== "add" && <button className="btn btn-s" style={{ marginRight: "auto", color: "var(--red)" }} onClick={() => { setConfirm(modal); setModal(null); }}>Remove</button>}
            <button className="btn btn-s" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-p" onClick={save}>{modal === "add" ? "Add & Get Invite" : "Save"}</button>
          </div>
        </div>
      </div>}

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
      const since = localDateOf(new Date(Date.now() - dateRange * 86400000).toISOString());
      const rows = await sbGet("field_checkins", `work_date=gte.${since}&order=work_date.desc,check_in.desc`);
      if (rows) setCheckins(rows.map(fromCheckin));
    } catch {}
    setLoading(false); setRefreshing(false);
  };

  useEffect(() => { load(); }, [dateRange]);

  const exportCSV = () => {
    const crewName = id => users.find(u => u.id === id)?.name || "Unknown";
    const jobName  = id => jobs.find(j => j.id === id)?.name  || id;
    const fmt = ts => ts ? new Date(ts).toLocaleString() : "";
    const rows = [["Date","Crew","Job","Clock In","Clock Out","Hours","Method","Auto Closed"]];
    checkins.filter(c => c.checkOut && !c.autoClosed).forEach(c => {
      rows.push([c.date, crewName(c.crewId), jobName(c.jobId), fmt(c.checkIn), fmt(c.checkOut), (+(c.hours||0)).toFixed(2), c.method, c.autoClosed ? "Yes" : "No"]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `timesheet-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const crewName = id => users.find(u => u.id === id)?.name || "Unknown";
  const jobName  = id => jobs.find(j => j.id === id)?.name  || id;
  const fmt = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  const fmtFull = ts => ts ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  // Summary: total hours per crew per job
  const summary = {};
  checkins.filter(c => c.checkOut && !c.autoClosed).forEach(c => {
    const key = `${c.crewId}|${c.jobId}`;
    if (!summary[key]) summary[key] = { crewId: c.crewId, jobId: c.jobId, hours: 0, days: new Set() };
    summary[key].hours += +(c.hours || 0);
    summary[key].days.add(c.date);
  });
  const summaryRows = Object.values(summary).sort((a, b) => b.hours - a.hours);
  const totalHours = summaryRows.reduce((s, r) => s + r.hours, 0);
  const openCount  = checkins.filter(c => !c.checkOut).length;

  const printHoursReport = () => {
    const rangeLabel = dateRange === 1 ? "Today" : `Last ${dateRange} Days`;
    const since = new Date(Date.now() - dateRange * 86400000).toLocaleDateString();
    const through = new Date().toLocaleDateString();
    const completedCheckins = checkins.filter(c => c.checkOut && !c.autoClosed);

    // Build per-crew summary for print
    const perCrew = {};
    completedCheckins.forEach(c => {
      if (!perCrew[c.crewId]) perCrew[c.crewId] = { name: crewName(c.crewId), hours: 0, days: new Set(), jobs: {} };
      perCrew[c.crewId].hours += +(c.hours || 0);
      perCrew[c.crewId].days.add(c.date);
      const jn = jobName(c.jobId);
      perCrew[c.crewId].jobs[jn] = (perCrew[c.crewId].jobs[jn] || 0) + +(c.hours || 0);
    });
    const crewRows = Object.values(perCrew).sort((a, b) => b.hours - a.hours);

    const summaryHtml = crewRows.map(r => `
      <tr>
        <td style="font-weight:600">${r.name}</td>
        <td style="color:#555">${Object.keys(r.jobs).join(", ")}</td>
        <td style="text-align:center">${r.days.size}</td>
        <td style="text-align:right;font-weight:bold;font-size:15px;color:#4a2c1a">${r.hours.toFixed(1)}</td>
      </tr>`).join("");

    const detailHtml = completedCheckins.map(c => `
      <tr>
        <td style="color:#555;white-space:nowrap">${c.date}</td>
        <td style="font-weight:600">${crewName(c.crewId)}</td>
        <td style="color:#555">${jobName(c.jobId)}</td>
        <td style="white-space:nowrap;color:#2563eb">${fmt(c.checkIn)}</td>
        <td style="white-space:nowrap">${fmt(c.checkOut)}</td>
        <td style="text-align:right;font-weight:bold;color:#7c3f1e">${(+(c.hours||0)).toFixed(1)}</td>
      </tr>`).join("");

    const w = window.open("", "_blank", "width=900,height=1100");
    w.document.write(`<!DOCTYPE html><html><head><title>GSM Hours Report — ${rangeLabel}</title>
<style>
@page{size:8.5in 11in;margin:.5in}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Georgia',serif;color:#1a1a1a;background:#fff;font-size:11px}
.hdr{display:flex;align-items:center;gap:16px;border-bottom:3px solid #7c3f1e;padding-bottom:12px;margin-bottom:16px}
.logo{width:56px;height:56px;object-fit:contain;border-radius:8px}
.co h1{font-size:19px;font-weight:bold;color:#4a2c1a}
.co p{font-size:9px;color:#777;margin-top:2px}
.co .dt{font-size:10px;font-weight:bold;color:#7c3f1e;text-transform:uppercase;letter-spacing:1.5px;margin-top:4px}
.period{background:#fdf8f3;border:1px solid #d4b896;border-radius:6px;padding:10px 14px;margin-bottom:14px;display:flex;gap:24px;align-items:center}
.period .lbl{font-size:8px;font-weight:bold;color:#7c3f1e;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:2px}
.period .val{font-size:13px;font-weight:600}
.totbox{display:inline-block;background:#4a2c1a;color:#fff;padding:8px 18px;border-radius:6px;margin-left:auto}
.totbox .tl{font-size:8px;text-transform:uppercase;letter-spacing:1px;opacity:.75}
.totbox .tv{font-size:22px;font-weight:bold}
h2{font-size:11px;font-weight:bold;color:#7c3f1e;text-transform:uppercase;letter-spacing:1px;margin:14px 0 6px}
table{width:100%;border-collapse:collapse}
th{font-size:8px;font-weight:bold;color:#7c3f1e;text-transform:uppercase;letter-spacing:.5px;padding:5px 8px;border-bottom:2px solid #d4b896;text-align:left;background:#fdf8f3}
td{padding:5px 8px;border-bottom:1px solid #eee;font-size:10px}
tr:last-child td{border-bottom:none}
.foot{margin-top:14px;border-top:1px solid #ddd;padding-top:8px;font-size:8px;color:#aaa;text-align:center}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="hdr">
  <img class="logo" src="https://quiet-seahorse-2ba028.netlify.app/icon-admin.png" alt="GSM"/>
  <div class="co">
    <h1>G.S. MASTERS, INC.</h1>
    <p>Custom Home Builder &middot; 255 Grande View Pkwy, Maylene AL 35114 &middot; (205) 620-1698</p>
    <div class="dt">Weekly Hours Report</div>
  </div>
</div>
<div class="period">
  <div><span class="lbl">Period</span><span class="val">${rangeLabel}</span></div>
  <div><span class="lbl">From</span><span class="val">${since}</span></div>
  <div><span class="lbl">Through</span><span class="val">${through}</span></div>
  <div style="margin-left:auto">
    <div class="totbox"><div class="tl">Total Hours</div><div class="tv">${totalHours.toFixed(1)}</div></div>
  </div>
</div>

<h2>Summary by Crew Member</h2>
<table>
  <thead><tr><th>Name</th><th>Jobs</th><th style="text-align:center">Days</th><th style="text-align:right">Total Hrs</th></tr></thead>
  <tbody>${summaryHtml || "<tr><td colspan='4' style='color:#aaa;text-align:center;padding:12px'>No completed check-ins in this period.</td></tr>"}</tbody>
</table>

<h2 style="margin-top:18px">Detailed Check-in Log</h2>
<table>
  <thead><tr><th>Date</th><th>Crew</th><th>Job</th><th>Clock In</th><th>Clock Out</th><th style="text-align:right">Hours</th></tr></thead>
  <tbody>${detailHtml || "<tr><td colspan='6' style='color:#aaa;text-align:center;padding:12px'>No records.</td></tr>"}</tbody>
</table>

<div class="foot">Printed from GS Masters Field App &middot; ${new Date().toLocaleString()} &middot; ${completedCheckins.length} record${completedCheckins.length !== 1 ? "s" : ""}</div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}</script>
</body></html>`);
    w.document.close();
  };

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
          <button className="btn btn-s btn-sm" onClick={exportCSV} title="Download timesheet CSV">⬇ CSV</button>
          <button className="btn btn-s btn-sm" onClick={printHoursReport} title="Print hours report"><Icon n="print" s={14} /> Print</button>
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
                <td data-l="Out" style={{ whiteSpace: "nowrap", color: c.checkOut ? (c.autoClosed ? "var(--slate)" : "inherit") : "var(--green)", fontWeight: c.checkOut ? 400 : 700 }}>
                  {c.checkOut ? (c.autoClosed ? `${fmt(c.checkOut)} (auto)` : fmt(c.checkOut)) : "● On site"}
                </td>
                <td data-l="Hours" style={{ textAlign: "right", fontWeight: 700, color: c.autoClosed ? "var(--slate)" : (c.checkOut ? "var(--accent)" : "var(--green)"), fontFamily: "'Barlow Condensed'", fontSize: 15 }}>
                  {c.checkOut ? (c.autoClosed ? "—" : (+(c.hours||0)).toFixed(1)) : "..."}
                </td>
              </tr>
            ))}</tbody></table></div>
        }
      </div>
    </div>
  );
}

// ─── ADMIN QR CODES ───────────────────────────────────────────────────
function AdminQRCodes({ jobs }) {
  const activeJobs = jobs.filter(j => j.status === "active");
  const appUrl = window.location.origin + window.location.pathname.replace(/\/$/, "");
  const qrUrl = (jobId) => `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(`${appUrl}/?job=${jobId}&checkin=1`)}&size=160x160&margin=6`;
  const qrUrlLg = (jobId) => `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(`${appUrl}/?job=${jobId}&checkin=1`)}&size=300x300&margin=10`;
  // Fallback: if qrserver.com is down, show URL text
  const handleQRError = (e, url) => {
    const parent = e.target.parentNode;
    e.target.remove();
    const fb = document.createElement("div");
    fb.style.cssText = "padding:8px;background:#fff;border-radius:8px;font-size:9px;color:#333;word-break:break-all;border:1px solid #ccc;width:100px;";
    fb.textContent = url;
    parent.insertBefore(fb, parent.firstChild);
  };

  const printCard = (job) => {
    const jobUrl = `${appUrl}/?job=${job.id}&checkin=1`;
    const win = window.open("", "_blank");
    win.document.write(`<!DOCTYPE html><html><head><title>QR – ${job.name}</title>
<style>
  body{font-family:Georgia,serif;padding:48px;text-align:center;max-width:480px;margin:0 auto;}
  .co{font-size:13px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;}
  .job{font-size:30px;font-weight:700;margin:0 0 6px;}
  .addr{font-size:15px;color:#666;margin-bottom:28px;}
  img{border:1px solid #ddd;border-radius:8px;padding:8px;}
  .inst{font-size:17px;margin-top:20px;color:#333;}
  .inst-es{font-size:15px;color:#888;margin-top:4px;}
  .fallback-url{font-size:10px;color:#555;margin-top:12px;word-break:break-all;}
  @media print{button{display:none!important;}}
</style></head><body>
<div class="co">G.S. Masters, Inc.</div>
<div class="job">${job.name}</div>
<div class="addr">${job.address || ""}</div>
<img id="qr" src="${qrUrlLg(job.id)}" width="300" height="300"
  onerror="document.getElementById('qr').remove();document.getElementById('qr-fb').style.display='block'"/>
<div id="qr-fb" style="display:none;padding:16px;border:2px solid #ccc;border-radius:8px;display:none;">
  <div style="font-size:13px;color:#555;margin-bottom:8px;">QR code unavailable — scan this URL:</div>
  <div class="fallback-url">${jobUrl}</div>
</div>
<div class="inst">Scan to clock in</div>
<div class="inst-es">Escanea para registrar entrada</div>
</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  };

  return (
    <div>
      <h2 className="h2" style={{ marginBottom: 6 }}>QR Codes</h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Print and post at each job site. Crew scans to clock in with GPS verification.</p>
      <div style={{ background: "rgba(245,158,11,.12)", border: "1px solid rgba(245,158,11,.4)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "var(--accent)", marginBottom: 20 }}>
        ⚠️ <strong>Reprint required when jobs are added or re-created.</strong> Old printed QR codes encode stale job IDs and will show "Job not found." Always reprint from this page after adding new jobs.
      </div>
      {activeJobs.length === 0
        ? <div className="empty"><p>No active jobs.</p></div>
        : <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {activeJobs.map(job => {
              const jobUrl = `${appUrl}/?job=${job.id}&checkin=1`;
              return (
                <div key={job.id} className="card" style={{ display: "flex", alignItems: "center", gap: 18 }}>
                  <img src={qrUrl(job.id)} alt={job.name} width={100} height={100}
                    style={{ borderRadius: 8, border: "1px solid var(--border)", background: "#fff", flexShrink: 0 }}
                    onError={e => handleQRError(e, jobUrl)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>{job.name}</div>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>{job.address || "No address set"}</div>
                    <button className="btn btn-s btn-sm" onClick={() => printCard(job)}>
                      Print QR Card
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}

// ─── ADMIN FIELD MODE ─────────────────────────────────────────────────
function AdminFieldMode({ jobs, tasks, setTasks, photos, setPhotos, receipts, setReceipts, logs, setLogs, users, settings, user }) {
  const today = localDate();
  const activeJobs = jobs.filter(j => j.status !== "closed");
  const [selJob, setSelJob] = useState("");
  const [mode, setMode] = useState("photo"); // 'photo' | 'receipt' | 'task' | 'log'

  // Photo state
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [photoNote, setPhotoNote] = useState("");
  const [photoType, setPhotoType] = useState("before");
  const [photoSaved, setPhotoSaved] = useState(0);
  const photoRef = useRef();

  // Receipt state
  const [rcForm, setRcForm] = useState({ store:"", amount:"", note:"", paidBy:"crew" });
  const [rcPhoto, setRcPhoto] = useState(null);
  const [rcBusy, setRcBusy] = useState(false);
  const [rcDest, setRcDest] = useState("job"); // "job" | "office" | "auto" | "custom"
  const [rcCustomCat, setRcCustomCat] = useState("");
  const rcPhotoRef = useRef();

  // Task state
  const [taskTitle, setTaskTitle] = useState("");
  const [taskAssign, setTaskAssign] = useState([]);
  const [taskDue, setTaskDue] = useState("");
  const [taskRecurring, setTaskRecurring] = useState(false);
  const [taskPhoto, setTaskPhoto] = useState(null);
  const [taskPhotoNote, setTaskPhotoNote] = useState("");
  const [taskBusy, setTaskBusy] = useState(false);
  const taskPhotoRef = useRef();

  // Log state
  const [logText, setLogText] = useState("");
  const [logBusy, setLogBusy] = useState(false);

  const capturePhoto = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const { dataUrl, sizeKB } = await compressImage(file); setPendingPhoto({ dataUrl, sizeKB }); setPhotoNote(""); }
    catch { alert("Could not process image. Try again."); }
    e.target.value = "";
  };
  const savePhoto = async (done) => {
    if (!pendingPhoto || !selJob) return;
    const id = "p" + Date.now();
    let storagePath = null;
    try { storagePath = await uploadToStorage(pendingPhoto.dataUrl, `${user.id}/${id}.jpg`); } catch {}
    const photo = { id, dataUrl: pendingPhoto.dataUrl, type: photoType, taskId: null, jobId: selJob, crewId: user.id, sizeKB: pendingPhoto.sizeKB, note: photoNote, date: new Date().toISOString() };
    setPhotos(p => [...p, photo]);
    const row = { id, data_url: storagePath ? null : pendingPhoto.dataUrl, storage_path: storagePath, photo_type: photoType, task_id: null, job_id: selJob, crew_id: user.id, size_kb: pendingPhoto.sizeKB, note: photoNote || null };
    try { await sbPost("field_photos", row); } catch { enqueue({ table: "field_photos", payload: row }); }
    setPhotoSaved(n => n + 1); setPendingPhoto(null); setPhotoNote("");
    if (done) setPhotoSaved(0);
  };

  const captureRcPhoto = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const { dataUrl } = await compressImage(file, 1000, 0.6); setRcPhoto(dataUrl); }
    catch { alert("Could not process image. Try again."); }
    e.target.value = "";
  };
  const saveReceipt = async () => {
    const usingJob = rcDest === "job";
    if ((usingJob && !selJob) || !rcForm.store || !rcForm.amount) return;
    if (rcDest === "custom" && !rcCustomCat.trim()) return;
    const category = rcDestCategory(rcDest, rcCustomCat);
    const jobIdVal = usingJob ? selJob : null;
    setRcBusy(true);
    const id = "r" + Date.now();
    let storagePath = null;
    if (rcPhoto) { try { storagePath = await uploadToStorage(rcPhoto, `${user.id}/${id}.jpg`); } catch {} }
    const receipt = { id, dataUrl: rcPhoto, taskId: null, jobId: jobIdVal, category, crewId: user.id, store: rcForm.store, amount: rcForm.amount, note: rcForm.note, paidBy: rcForm.paidBy, reimbursementStatus: rcForm.paidBy === "crew" ? "pending" : "na", createdAt: today };
    setReceipts(p => [...p, receipt]);
    const row = { id, data_url: storagePath ? null : rcPhoto, storage_path: storagePath, task_id: null, job_id: jobIdVal, category, crew_id: user.id, store: rcForm.store, amount: parseFloat(rcForm.amount)||0, note: rcForm.note, paid_by: rcForm.paidBy, reimbursement_status: rcForm.paidBy==="crew"?"pending":"na" };
    try { await sbPost("field_receipts", row); } catch { enqueue({ table: "field_receipts", payload: row }); }
    pushReceiptToGSM(receipt, jobs, user.name);
    setRcForm({ store:"", amount:"", note:"", paidBy:"crew" }); setRcPhoto(null); setRcBusy(false); setRcDest("job"); setRcCustomCat("");
    alert("Receipt saved!");
  };

  const captureTaskPhoto = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const { dataUrl, sizeKB } = await compressImage(file); setTaskPhoto({ dataUrl, sizeKB }); }
    catch { alert("Could not process image. Try again."); }
    e.target.value = "";
  };
  const saveTask = async () => {
    if (!selJob || !taskTitle.trim()) return;
    setTaskBusy(true);
    const id = "t" + Date.now();
    let esTitle = taskTitle;
    try { if (settings?.gtKey) esTitle = (await translateText(taskTitle, "es", settings.gtKey)) || taskTitle; } catch {}
    const task = { id, jobId: selJob, title: taskTitle, titleEs: esTitle, assignedTo: taskAssign, dueDate: taskDue, status: "pending", createdAt: today, priority: "normal", recurring: taskRecurring };
    setTasks(p => [...p, task]);
    const row = { id, job_id: selJob, title: taskTitle, title_es: esTitle, assigned_to: taskAssign, due_date: taskDue || null, status: "pending", priority: 3, recurring: taskRecurring };
    try { await sbPost("field_tasks", row); } catch { enqueue({ table: "field_tasks", payload: row }); }
    if (taskPhoto) {
      const pid = "p" + Date.now();
      let storagePath = null;
      try { storagePath = await uploadToStorage(taskPhoto.dataUrl, `${user.id}/${pid}.jpg`); } catch {}
      const prow = { id: pid, data_url: storagePath ? null : taskPhoto.dataUrl, storage_path: storagePath, photo_type: "before", task_id: id, job_id: selJob, crew_id: user.id, size_kb: taskPhoto.sizeKB, note: taskPhotoNote || null };
      setPhotos(p => [...p, { id: pid, dataUrl: taskPhoto.dataUrl, type:"before", taskId: id, jobId: selJob, crewId: user.id, note: taskPhotoNote, date: new Date().toISOString() }]);
      try { await sbPost("field_photos", prow); } catch { enqueue({ table: "field_photos", payload: prow }); }
    }
    setTaskTitle(""); setTaskAssign([]); setTaskDue(""); setTaskRecurring(false); setTaskPhoto(null); setTaskPhotoNote(""); setTaskBusy(false);
    alert("Task created!");
  };

  const saveLog = async () => {
    if (!selJob || !logText.trim()) return;
    setLogBusy(true);
    const id = "l" + Date.now();
    const row = { id, text_en: logText, text_es: logText, task_id: null, job_id: selJob, crew_id: user.id, log_date: today };
    setLogs(p => [...p, { id, en: logText, es: logText, taskId: null, jobId: selJob, crewId: user.id, date: today }]);
    try { await sbPost("field_logs", row); } catch { enqueue({ table: "field_logs", payload: row }); }
    setLogText(""); setLogBusy(false); alert("Note saved!");
  };

  const crew = users.filter(u => u.active && !u.archived).sort((a,b) => (a.role==="crew"?0:1)-(b.role==="crew"?0:1) || a.name.localeCompare(b.name));
  const MODES = [
    { k:"status",  label:"☑ Status",  desc:"Update task status" },
    { k:"photo",   label:"📷 Photo",  desc:"Take or upload a photo" },
    { k:"receipt", label:"🧾 Receipt",desc:"Log a purchase" },
    { k:"task",    label:"✅ Task",   desc:"Create a task" },
    { k:"log",     label:"📝 Note",   desc:"Write a site note" },
  ];

  return (
    <div style={{ maxWidth: 600 }}>
      <div className="flexb" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h2">📱 Field Mode</h2>
          <p className="muted" style={{ fontSize: 12 }}>Mobile-friendly. Log anything from a job site.</p>
        </div>
      </div>

      {/* Job selector — always visible */}
      <div className="card" style={{ marginBottom: 16, padding:"14px 16px" }}>
        <label className="fl" style={{ marginBottom:6 }}>Which job are you at?</label>
        <select className="fi" value={selJob} onChange={e => setSelJob(e.target.value)}>
          <option value="">Select a job...</option>
          {activeJobs.map(j => <option key={j.id} value={j.id}>{j.name} — {j.address}</option>)}
        </select>
      </div>

      {/* Mode picker */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:16 }}>
        {MODES.map(m => (
          <button key={m.k} onClick={() => setMode(m.k)}
            style={{ padding:"14px 12px", borderRadius:12, border:`2px solid ${mode===m.k?"var(--sky)":"var(--border)"}`,
              background: mode===m.k?"rgba(59,130,246,.12)":"rgba(0,0,0,.15)", cursor:"pointer", textAlign:"center",
              color: mode===m.k?"var(--sky2)":"var(--silver)", transition:".15s" }}>
            <div style={{ fontSize:20, marginBottom:4 }}>{m.label.split(" ")[0]}</div>
            <div style={{ fontFamily:"'Barlow Condensed'", fontWeight:700, fontSize:14 }}>{m.label.split(" ").slice(1).join(" ")}</div>
            <div style={{ fontSize:11, color:"var(--slate)", marginTop:2 }}>{m.desc}</div>
          </button>
        ))}
      </div>

      {!selJob && mode !== "receipt" && <div style={{ padding:"16px", background:"rgba(245,158,11,.08)", borderRadius:10, border:"1px solid rgba(245,158,11,.3)", fontSize:13, color:"var(--accent)", textAlign:"center" }}>Select a job above to continue</div>}

      {(selJob || mode === "receipt") && (
        <div className="card">

          {/* STATUS MODE */}
          {mode === "status" && (() => {
            const jobTasks = tasks.filter(t => t.jobId === selJob);
            const todayStr = localDate();
            const toggleDone = async (task) => {
              if (task.recurring) {
                // Recurring tasks: only toggle completed_at, never change status
                const doneToday = task.completedAt && localDateOf(task.completedAt) === todayStr;
                const nextAt = doneToday ? null : new Date().toISOString();
                setTasks(p => p.map(t => t.id === task.id ? { ...t, completedAt: nextAt } : t));
                try { await sbFetch(`field_tasks?id=eq.${task.id}`, { method: "PATCH", body: JSON.stringify({ completed_at: nextAt }), prefer: "return=minimal" }); } catch {}
                return;
              }
              const next = task.status === "done" ? "pending" : "done";
              setTasks(p => p.map(t => t.id === task.id ? { ...t, status: next, completedAt: next === "done" ? new Date().toISOString() : null } : t));
              try { await sbFetch(`field_tasks?id=eq.${task.id}`, { method: "PATCH", body: JSON.stringify({ status: next, completed_at: next === "done" ? new Date().toISOString() : null }), prefer: "return=minimal" }); } catch {}
            };
            return (
              <div>
                <div style={{ fontFamily:"'Barlow Condensed'", fontSize:16, fontWeight:700, marginBottom:12 }}>☑ Task Status</div>
                {jobTasks.length === 0
                  ? <div className="muted" style={{ fontSize:13 }}>No tasks for this job.</div>
                  : <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {jobTasks.map(task => {
                        const done = task.status === "done";
                        const assignees = (task.assignedTo || []).map(id => users.find(u => u.id === id)?.name?.split(" ")[0]).filter(Boolean).join(", ");
                        return (
                          <div key={task.id}
                            onClick={() => toggleDone(task)}
                            style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", borderRadius:10, cursor:"pointer",
                              background: done ? "rgba(16,185,129,.1)" : "rgba(255,255,255,.04)",
                              border: `1px solid ${done ? "rgba(16,185,129,.3)" : "var(--border)"}`, transition:".15s" }}>
                            <div style={{ width:26, height:26, borderRadius:6, flexShrink:0, border:`2px solid ${done?"var(--green)":"var(--slate)"}`,
                              background: done ? "var(--green)" : "transparent",
                              display:"flex", alignItems:"center", justifyContent:"center" }}>
                              {done && <Icon n="check" s={14} c="#fff" />}
                            </div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:14, fontWeight:600, textDecoration: done ? "line-through" : "none", color: done ? "var(--slate)" : "var(--white)", lineHeight:1.3 }}>{task.title}</div>
                              {assignees && <div style={{ fontSize:11, color:"var(--slate)", marginTop:2 }}>{assignees}</div>}
                            </div>
                            <div style={{ fontSize:11, fontWeight:700, color: done ? "var(--green)" : "var(--slate)", fontFamily:"'Barlow Condensed'", flexShrink:0 }}>
                              {done ? "DONE" : "PENDING"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                }
              </div>
            );
          })()}

          {/* PHOTO MODE */}
          {mode === "photo" && (
            <div>
              <div style={{ fontFamily:"'Barlow Condensed'", fontSize:16, fontWeight:700, marginBottom:12 }}>📷 Take a Photo</div>
              {photoSaved > 0 && <div style={{ marginBottom:10, padding:"6px 12px", background:"rgba(16,185,129,.12)", borderRadius:8, fontSize:12, color:"var(--green)", fontWeight:600 }}>✓ {photoSaved} photo(s) saved — take another or switch modes</div>}
              <input ref={photoRef} type="file" accept="image/*" style={{ display:"none" }} onChange={capturePhoto} />

              {!pendingPhoto ? (
                <>
                  <div style={{ display:"flex", gap:6, marginBottom:12 }}>
                    {["before","after","concern"].map(k => (
                      <button key={k} onClick={() => setPhotoType(k)}
                        style={{ flex:1, padding:"8px", borderRadius:8, border:`1px solid ${photoType===k?k==="before"?"var(--orange)":k==="after"?"var(--green)":"var(--red)":"transparent"}`,
                          background: photoType===k?`rgba(${k==="before"?"249,115,22":k==="after"?"16,185,129":"239,68,68"},.18)`:"rgba(255,255,255,.06)",
                          color: photoType===k?k==="before"?"var(--orange)":k==="after"?"var(--green)":"var(--red)":"var(--silver)",
                          fontSize:12, fontWeight:700, cursor:"pointer", textTransform:"capitalize" }}>
                        {k}
                      </button>
                    ))}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <button className="btn btn-p" style={{ justifyContent:"center", padding:"16px", fontSize:15 }}
                      onClick={() => { photoRef.current?.setAttribute("capture","environment"); photoRef.current?.click(); }}>
                      <Icon n="camera" s={20}/><span style={{ display:"block", fontSize:11, marginTop:4 }}>Open Camera</span>
                    </button>
                    <button className="btn btn-s" style={{ justifyContent:"center", padding:"16px", fontSize:15 }}
                      onClick={() => openGallery(capturePhoto)}>
                      <Icon n="photo" s={20}/><span style={{ display:"block", fontSize:11, marginTop:4 }}>From Library</span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display:"flex", gap:12, marginBottom:12, alignItems:"flex-start" }}>
                    <img src={pendingPhoto.dataUrl} alt="preview" style={{ width:90, height:90, objectFit:"cover", borderRadius:10, flexShrink:0, border:"2px solid var(--orange)" }} />
                    <div style={{ flex:1 }}>
                      <label className="fl" style={{ marginBottom:4 }}>What does this photo show?</label>
                      <textarea className="fi" rows={3} value={photoNote} onChange={e => setPhotoNote(e.target.value)} autoFocus
                        placeholder="e.g. Progress on north wall, crack in foundation..." style={{ resize:"none" }} />
                    </div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    <button className="btn btn-p" style={{ justifyContent:"center" }} onClick={() => savePhoto(false)}>💾 Save + Take Another</button>
                    <button className="btn btn-g" style={{ justifyContent:"center" }} onClick={() => savePhoto(true)}>✓ Save & Done</button>
                  </div>
                  <button onClick={() => setPendingPhoto(null)} style={{ marginTop:8, background:"none", border:"none", color:"var(--slate)", cursor:"pointer", fontSize:12, textDecoration:"underline" }}>✕ Discard</button>
                </>
              )}
            </div>
          )}

          {/* RECEIPT MODE */}
          {mode === "receipt" && (
            <div>
              <div style={{ fontFamily:"'Barlow Condensed'", fontSize:16, fontWeight:700, marginBottom:12 }}>🧾 Log a Receipt</div>
              <input ref={rcPhotoRef} type="file" accept="image/*" style={{ display:"none" }} onChange={captureRcPhoto} />
              <div className="fg">
                <label className="fl">Charge this to</label>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom: rcDest==="custom" ? 8 : 12 }}>
                  {[["job","🏗 Job"],...RC_OVERHEAD.map(([k,label])=>[k,label]),["custom","📌 Custom"]].map(([k,label]) => (
                    <button key={k} className={`btn btn-sm ${rcDest===k?"btn-a":"btn-s"}`} onClick={()=>setRcDest(k)}>{label}</button>
                  ))}
                </div>
                {rcDest === "job" && !selJob && <div style={{ fontSize:12, color:"var(--accent)", marginBottom:12 }}>Select a job above to charge this receipt to a job.</div>}
                {rcDest === "custom" && (
                  <input className="fi" value={rcCustomCat} onChange={e=>setRcCustomCat(e.target.value)} placeholder="e.g. Marketing, Legal, Storage Unit" style={{ marginBottom:12 }} />
                )}
              </div>
              <div className="grid2" style={{ marginBottom:10 }}>
                <div><label className="fl">Vendor / Store</label>
                  <input className="fi" value={rcForm.store} onChange={e => setRcForm(p=>({...p,store:e.target.value}))} placeholder="Home Depot" /></div>
                <div><label className="fl">Amount ($)</label>
                  <input className="fi" type="number" value={rcForm.amount} onChange={e => setRcForm(p=>({...p,amount:e.target.value}))} placeholder="0.00" /></div>
              </div>
              <div className="fg"><label className="fl">What was purchased</label>
                <input className="fi" value={rcForm.note} onChange={e => setRcForm(p=>({...p,note:e.target.value}))} placeholder="Lumber, screws, paint..." /></div>
              <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                <button className={`btn btn-sm ${rcForm.paidBy==="crew"?"btn-a":"btn-s"}`} onClick={()=>setRcForm(p=>({...p,paidBy:"crew"}))}>I Paid — Need Reimbursement</button>
                <button className={`btn btn-sm ${rcForm.paidBy==="company"?"btn-p":"btn-s"}`} onClick={()=>setRcForm(p=>({...p,paidBy:"company"}))}>Company Card</button>
              </div>
              <div style={{ display:"flex", gap:8, marginBottom:12, alignItems:"center" }}>
                {rcPhoto && <img src={rcPhoto} alt="rcpt" style={{ width:48, height:48, objectFit:"cover", borderRadius:6, border:"2px solid var(--green)" }} />}
                <button className="btn btn-s btn-sm" onClick={()=>{rcPhotoRef.current?.setAttribute("capture","environment");rcPhotoRef.current?.click();}}>
                  <Icon n="camera" s={14}/> {rcPhoto ? "Retake Receipt Photo" : "Snap Receipt Photo"}
                </button>
              </div>
              <button className="btn btn-p btn-full" disabled={rcBusy||!rcForm.store||!rcForm.amount||(rcDest==="job"&&!selJob)||(rcDest==="custom"&&!rcCustomCat.trim())} onClick={saveReceipt} style={{ justifyContent:"center" }}>
                {rcBusy?<span className="spin"/>:"Save Receipt"}
              </button>
            </div>
          )}

          {/* TASK MODE */}
          {mode === "task" && (
            <div>
              <div style={{ fontFamily:"'Barlow Condensed'", fontSize:16, fontWeight:700, marginBottom:12 }}>✅ Create a Task</div>
              <input ref={taskPhotoRef} type="file" accept="image/*" style={{ display:"none" }} onChange={captureTaskPhoto} />
              <div className="fg"><label className="fl">Task Description</label>
                <input className="fi" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="What needs to be done..." /></div>
              <div className="fg">
                <label className="fl">Assign To</label>
                <div style={{ background:"rgba(0,0,0,.15)", borderRadius:10, padding:"6px 4px", border:"1px solid var(--border)" }}>
                  {crew.map(u => (
                    <label key={u.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", cursor:"pointer", borderRadius:8,
                      background: taskAssign.includes(u.id)?"rgba(59,130,246,.1)":"transparent" }}>
                      <input type="checkbox" checked={taskAssign.includes(u.id)}
                        onChange={() => setTaskAssign(p => p.includes(u.id)?p.filter(x=>x!==u.id):[...p,u.id])}
                        style={{ accentColor:"var(--sky)", width:16, height:16 }} />
                      <span style={{ fontSize:14 }}>{u.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="fg"><label className="fl">Due Date (optional)</label>
                <input className="fi" type="date" value={taskDue} onChange={e => setTaskDue(e.target.value)} /></div>

              <div className="fg">
                <button type="button" onClick={() => setTaskRecurring(r => !r)}
                  style={{ width:"100%", padding:"11px", borderRadius:10, cursor:"pointer", fontFamily:"'Barlow Condensed'", fontWeight:700, fontSize:15,
                    border:`1px solid ${taskRecurring?"var(--accent)":"var(--border)"}`,
                    background: taskRecurring?"rgba(245,158,11,.15)":"rgba(255,255,255,.04)",
                    color: taskRecurring?"var(--accent)":"var(--silver)" }}>
                  🔁 {taskRecurring ? "Recurring — crew checks daily" : "One-Time Task"}
                </button>
              </div>

              {/* Optional photo */}
              <div style={{ borderTop:"1px solid var(--border)", paddingTop:12, marginBottom:14 }}>
                <label className="fl" style={{ marginBottom:8 }}>📷 Attach a Photo (optional)</label>
                {!taskPhoto
                  ? <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                      <button className="btn btn-s btn-sm" style={{ justifyContent:"center" }} onClick={()=>{taskPhotoRef.current?.setAttribute("capture","environment");taskPhotoRef.current?.click();}}>
                        <Icon n="camera" s={14}/> Camera
                      </button>
                      <button className="btn btn-s btn-sm" style={{ justifyContent:"center" }} onClick={() => openGallery(captureTaskPhoto)}>
                        <Icon n="photo" s={14}/> Library
                      </button>
                    </div>
                  : <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                      <img src={taskPhoto.dataUrl} alt="preview" style={{ width:64, height:64, objectFit:"cover", borderRadius:8, border:"2px solid var(--orange)", flexShrink:0 }} />
                      <div style={{ flex:1 }}>
                        <input className="fi" value={taskPhotoNote} onChange={e => setTaskPhotoNote(e.target.value)} placeholder="Describe the photo..." style={{ marginBottom:6 }} />
                        <button onClick={() => setTaskPhoto(null)} style={{ background:"none", border:"none", color:"var(--red)", cursor:"pointer", fontSize:12 }}>✕ Remove</button>
                      </div>
                    </div>
                }
              </div>
              <button className="btn btn-p btn-full" disabled={taskBusy||!taskTitle.trim()} onClick={saveTask} style={{ justifyContent:"center" }}>
                {taskBusy?<span className="spin"/>:"Create Task"}
              </button>
            </div>
          )}

          {/* LOG / NOTE MODE */}
          {mode === "log" && (
            <div>
              <div style={{ fontFamily:"'Barlow Condensed'", fontSize:16, fontWeight:700, marginBottom:12 }}>📝 Site Note</div>
              <div className="fg"><label className="fl">What's happening at the job?</label>
                <textarea className="fi" rows={5} value={logText} onChange={e => setLogText(e.target.value)}
                  placeholder="Describe what you're seeing, progress made, issues, decisions made on site..." /></div>
              <button className="btn btn-p btn-full" disabled={logBusy||!logText.trim()} onClick={saveLog} style={{ justifyContent:"center" }}>
                {logBusy?<span className="spin"/>:"Save Note"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ADMIN LIVE ACTIVITY ──────────────────────────────────────────────
function AdminActivity({ jobs, tasks, users, logs: initLogs, photos: initPhotos, receipts: initReceipts, setTasks, setLogs, setPhotos, setReceipts }) {
  const [localLogs,     setLocalLogs]     = useState(initLogs);
  const [localPhotos,   setLocalPhotos]   = useState(initPhotos);
  const [localReceipts, setLocalReceipts] = useState(initReceipts);
  const [localTasks, setLocalTasks]    = useState(tasks);
  const [checkins,   setCheckins]      = useState([]);
  const [refreshing, setRefreshing]    = useState(false);
  const [lastAt,     setLastAt]        = useState(new Date());

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const today = localDate();
      const [dbTasks, dbLogs, dbPhotos, dbReceipts, dbCheckins] = await Promise.all([
        sbGet("field_tasks",    "order=created_at"),
        sbGet("field_logs",     "order=created_at.desc"),
        sbGet("field_photos",   "order=created_at.desc"),
        sbGet("field_receipts", "order=created_at.desc"),
        sbGet("field_checkins", `work_date=gte.${today}&order=check_in.desc`),
      ]);
      if (dbTasks)    { setLocalTasks(dbTasks.map(fromTask));         setTasks(dbTasks.map(fromTask)); }
      if (dbLogs)     { setLocalLogs(dbLogs.map(fromLog));            setLogs(dbLogs.map(fromLog)); }
      if (dbPhotos)   { setLocalPhotos(dbPhotos.map(fromPhoto));      setPhotos(dbPhotos.map(fromPhoto)); }
      if (dbReceipts) { setLocalReceipts(dbReceipts.map(fromReceipt)); setReceipts(dbReceipts.map(fromReceipt)); }
      if (dbCheckins) setCheckins(dbCheckins.map(fromCheckin));
      setLastAt(new Date());
    } catch {}
    setRefreshing(false);
  }, [setTasks, setLogs, setPhotos, setReceipts]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 900000); // 15 min — Live Activity; hit ↻ Refresh for instant update
    return () => clearInterval(iv);
  }, [refresh]);

  const activeJobs  = jobs.filter(j => j.status !== "closed");
  const typeColor   = k => ({ before:"var(--orange)", after:"var(--green)", concern:"var(--red)", progress:"var(--sky2)" })[k] || "var(--sky2)";
  const typeLabel   = k => ({ before:"Before", after:"After", concern:"Concern", progress:"Progress" })[k] || k;
  const crewName    = id => users.find(u => u.id === id)?.name || "Crew";
  const jobName     = id => jobs.find(j => j.id === id)?.name  || id;
  const fmt         = ts => ts ? new Date(ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) : "—";
  const elapsed     = ts => { const m = Math.round((Date.now() - new Date(ts)) / 60000); return m < 60 ? `${m}m` : `${(m/60).toFixed(1)}h`; };

  // Who is on site RIGHT NOW (open check-ins = no checkout)
  const onSiteNow = checkins.filter(c => !c.checkOut);

  const jobActivity = (job) => {
    const items = [];
    localLogs.filter(l => l.jobId === job.id).forEach(l =>
      items.push({ ts: l.date, type: "log", data: l }));
    localPhotos.filter(p => p.jobId === job.id).forEach(p =>
      items.push({ ts: (p.date || "").slice(0,10), type: "photo", data: p }));
    localReceipts.filter(r => r.jobId === job.id).forEach(r =>
      items.push({ ts: r.createdAt, type: "receipt", data: r }));
    checkins.filter(c => c.jobId === job.id).forEach(c =>
      items.push({ ts: (c.checkIn || "").slice(0,10), type: "checkin", data: c }));
    return items.sort((a, b) => b.ts.localeCompare(a.ts));
  };

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
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", animation: "pulse 2s infinite", display: "inline-block" }} /> Auto-refresh 15min
          </span>
        </div>
      </div>

      {/* ── WHO'S ON SITE NOW ── */}
      <div className="card" style={{ marginBottom: 22, borderLeft: "4px solid var(--green)" }}>
        <div style={{ fontFamily:"'Barlow Condensed'", fontSize:16, fontWeight:800, color:"var(--green)", letterSpacing:1, marginBottom:12 }}>
          🟢 WHO'S ON SITE RIGHT NOW
        </div>
        {onSiteNow.length === 0
          ? <div className="muted" style={{ fontSize:13 }}>No crew currently checked in.</div>
          : <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {onSiteNow.map(c => (
                <div key={c.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background:"rgba(16,185,129,.08)", borderRadius:10, border:"1px solid rgba(16,185,129,.25)" }}>
                  <div style={{ width:40, height:40, borderRadius:"50%", background:"linear-gradient(135deg,#059669,var(--green))", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed'", fontWeight:800, fontSize:18, flexShrink:0 }}>
                    {crewName(c.crewId)[0]}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, fontSize:15 }}>{crewName(c.crewId)}</div>
                    <div style={{ fontSize:12, color:"var(--silver)" }}>{jobName(c.jobId)}</div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"var(--green)" }}>● On Site</div>
                    <div style={{ fontSize:11, color:"var(--slate)" }}>Checked in {fmt(c.checkIn)} · {elapsed(c.checkIn)} ago</div>
                  </div>
                </div>
              ))}
            </div>
        }
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
                  const isWorkedOn = l.en?.startsWith("Worked on:");
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{isCompletion ? "✅" : isWorkedOn ? "🔧" : "📝"}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: isCompletion ? "var(--green)" : isWorkedOn ? "var(--orange)" : "var(--white)" }}>{l.en}</div>
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
                if (item.type === "checkin") {
                  const c = item.data;
                  const isOpen = !c.checkOut;
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.04)", alignItems: "center" }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{isOpen ? "🟢" : "🔵"}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: isOpen ? "var(--green)" : "var(--sky2)" }}>
                          {isOpen ? "Checked In — On Site Now" : "Checked Out"}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--slate)", marginTop: 2 }}>
                          {crewName(c.crewId)} · In: {fmt(c.checkIn)}{c.checkOut ? ` · Out: ${fmt(c.checkOut)} · ${c.hours?.toFixed(1) || "?"}h` : ` · ${elapsed(c.checkIn)} on site`}
                        </div>
                      </div>
                      {isOpen && <span style={{ fontSize: 11, padding:"2px 8px", borderRadius:20, background:"rgba(16,185,129,.15)", color:"var(--green)", fontWeight:700 }}>● LIVE</span>}
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

// ─── DISPATCH CREW ROW (sub-component avoids hooks-in-map) ────────────
// Parse a custom stop — stored as JSON {label,address} or legacy plain string
function parseStop(s) {
  try { const p = JSON.parse(s); return { label: p.label || s, address: p.address || "" }; }
  catch { return { label: s, address: "" }; }
}

function DispatchCrewRow({ member, date, activeJobs, dispatch: d, toggleJob, addStop, removeStop, clearAll, onNotify, notified }) {
  const [stopLabel, setStopLabel] = useState("");
  const [stopAddress, setStopAddress] = useState("");
  return (
    <div className="card" style={{ marginBottom: 18, borderLeft: d.jobIds.length > 0 ? "4px solid var(--accent)" : "4px solid var(--steel3)" }}>
      <div className="flexb" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: "50%", background: "linear-gradient(135deg,var(--sky-dim),var(--sky))", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 17 }}>{member.name[0]}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{member.name}</div>
            {d.jobIds.length > 0
              ? <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>📍 {d.jobIds.length} location{d.jobIds.length !== 1 ? "s" : ""} assigned</div>
              : <div style={{ fontSize: 11, color: "var(--slate)" }}>No dispatch for this day</div>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {d.jobIds.length > 0 && (
            <button className="btn btn-sm" onClick={onNotify}
              style={{ background: notified ? "rgba(16,185,129,.2)" : "rgba(59,130,246,.15)", color: notified ? "var(--green)" : "var(--sky2)", border: `1px solid ${notified ? "rgba(16,185,129,.4)" : "rgba(59,130,246,.35)"}`, fontWeight: 700, fontSize: 12 }}>
              {notified ? "✓ Sent!" : "📣 Notify"}
            </button>
          )}
          {d.jobIds.length > 0 && (
            <button className="btn btn-s btn-sm" style={{ color: "var(--red)" }} onClick={() => clearAll(member.id)}>✕ Clear</button>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div className="fl" style={{ marginBottom: 8 }}>Job Sites (select up to 3)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {activeJobs.map(job => {
            const on = d.jobIds.includes(job.id);
            return (
              <label key={job.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, cursor: "pointer",
                border: `1px solid ${on ? "rgba(245,158,11,.5)" : "var(--border)"}`,
                background: on ? "rgba(245,158,11,.08)" : "rgba(0,0,0,.12)", transition: ".15s" }}>
                <input type="checkbox" checked={on} onChange={() => toggleJob(member.id, job.id)}
                  style={{ accentColor: "var(--accent)", width: 16, height: 16 }} disabled={!on && d.jobIds.length >= 3} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{job.name}</div>
                  {job.address && <div style={{ fontSize: 11, color: "var(--silver)" }}>{job.address}</div>}
                </div>
                {on && <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 700 }}>✓</span>}
              </label>
            );
          })}
        </div>
        {d.jobIds.length >= 3 && <p style={{ fontSize: 11, color: "var(--orange)", marginTop: 6 }}>Max 3 locations selected</p>}
      </div>

      <div>
        <div className="fl" style={{ marginBottom: 8 }}>Custom Stops — with navigation address</div>
        {d.customStops.map((s, i) => {
          const stop = parseStop(s);
          return (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8, padding: "8px 12px", background: "rgba(59,130,246,.08)", borderRadius: 10, border: "1px solid rgba(59,130,246,.2)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>🛑 {stop.label}</div>
                {stop.address
                  ? <div style={{ fontSize: 11, color: "var(--sky2)", marginTop: 3 }}>📍 {stop.address}</div>
                  : <div style={{ fontSize: 11, color: "var(--orange)", marginTop: 3 }}>⚠ No address — worker cannot navigate</div>}
              </div>
              <button onClick={() => removeStop(member.id, i)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", fontSize: 16, lineHeight: 1, flexShrink: 0 }}>✕</button>
            </div>
          );
        })}
        <div style={{ background: "rgba(0,0,0,.15)", borderRadius: 10, padding: "12px", border: "1px solid var(--border)" }}>
          <div className="fg" style={{ marginBottom: 8 }}>
            <label className="fl" style={{ marginBottom: 4 }}>What / Why</label>
            <input className="fi" value={stopLabel} onChange={e => setStopLabel(e.target.value)}
              placeholder="e.g. Pick up lumber at Lowe's, Client walkthrough"
              style={{ padding: "8px 12px" }} />
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="fl" style={{ marginBottom: 4 }}>Full Address <span style={{ color: "var(--orange)", fontWeight: 400 }}>— required for GPS navigation</span></label>
            <input className="fi" value={stopAddress} onChange={e => setStopAddress(e.target.value)}
              placeholder="e.g. 2350 John Hawkins Pkwy, Hoover, AL 35244"
              style={{ padding: "8px 12px" }} />
          </div>
          <button className="btn btn-s btn-sm"
            disabled={!stopLabel.trim()}
            onClick={() => {
              addStop(member.id, date, JSON.stringify({ label: stopLabel.trim(), address: stopAddress.trim() }));
              setStopLabel(""); setStopAddress("");
            }}>
            + Add Stop
          </button>
          {stopLabel && !stopAddress && <p style={{ fontSize: 11, color: "var(--orange)", marginTop: 6 }}>Add an address so the worker can get GPS directions.</p>}
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN DISPATCH ───────────────────────────────────────────────────
function AdminDispatch({ users, jobs, dispatches, upsertDispatch, deleteDispatch, settings }) {
  const today = localDate();
  const [date, setDate] = useState(today);
  const [notified, setNotified] = useState({}); // crewId → true
  const crew = users.filter(u => u.active !== false && !u.archived).sort((a,b) => (a.role==="crew"?0:1)-(b.role==="crew"?0:1) || a.name.localeCompare(b.name));

  const getDispatch = (crewId) => dispatches.find(d => d.crewId === crewId && d.date === date) || { jobIds: [], customStops: [] };

  const notifyNow = (crewId) => {
    const d = getDispatch(crewId);
    const member = users.find(u => u.id === crewId);
    const stopCount = d.jobIds.length + d.customStops.length;
    if (stopCount === 0) return;
    const appUrl = settings?.appUrl || window.location.origin;
    const msg = `📍 Dispatch for ${date}: ${stopCount} stop${stopCount !== 1 ? "s" : ""} assigned. Open your app: ${appUrl}/?tab=tasks`;
    if (member?.phone) {
      fetch("/.netlify/functions/send-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: member.phone, body: msg }) }).catch(() => {});
    }
    sendPush([crewId], "📍 Dispatch Update", `${stopCount} stop${stopCount !== 1 ? "s" : ""} assigned for ${date}. Tap to see where to go.`, "/?tab=tasks");
    setNotified(p => ({ ...p, [crewId]: true }));
    setTimeout(() => setNotified(p => ({ ...p, [crewId]: false })), 3000);
  };

  const toggleJob = (crewId, jobId) => {
    const cur = getDispatch(crewId);
    const has = cur.jobIds.includes(jobId);
    const next = has ? cur.jobIds.filter(x => x !== jobId) : cur.jobIds.length < 3 ? [...cur.jobIds, jobId] : cur.jobIds;
    upsertDispatch({ crewId, date, jobIds: next, customStops: cur.customStops });
  };

  const addStop = (crewId, dispatchDate, stopValue) => {
    if (!stopValue) return;
    const cur = getDispatch(crewId);
    upsertDispatch({ crewId, date: dispatchDate, jobIds: cur.jobIds, customStops: [...cur.customStops, stopValue] });
  };

  const removeStop = (crewId, idx) => {
    const cur = getDispatch(crewId);
    upsertDispatch({ crewId, date, jobIds: cur.jobIds, customStops: cur.customStops.filter((_, i) => i !== idx) });
  };

  const clearAll = (crewId) => {
    const d = dispatches.find(x => x.crewId === crewId && x.date === date);
    if (d) deleteDispatch(d.id);
  };

  const activeJobs = jobs.filter(j => j.status !== "closed");

  return (
    <div>
      <div className="flexb" style={{ marginBottom: 20 }}>
        <h2 className="h2">📍 Daily Dispatch</h2>
        <input className="fi" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: "auto", padding: "8px 13px" }} />
      </div>
      <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        Tell each worker where to go today. Select up to 3 job sites per person. Workers see this at the top of their app — read-only.
      </p>

      {crew.length === 0 && <div className="empty"><p>No crew members added yet.</p></div>}

      {crew.map(member => (
        <DispatchCrewRow key={member.id} member={member} date={date} activeJobs={activeJobs}
          dispatch={getDispatch(member.id)} toggleJob={toggleJob} addStop={addStop} removeStop={removeStop} clearAll={clearAll}
          onNotify={() => notifyNow(member.id)} notified={!!notified[member.id]} />
      ))}
    </div>
  );
}

// ─── JOB DETAIL DASHBOARD ─────────────────────────────────────────────
function JobDetail({ selectedJobId, jobs, tasks, photos, receipts, logs, users, setTab, deletePhoto, deleteReceipt, deleteLog }) {
  const job = jobs.find(j => j.id === selectedJobId);
  const today = localDate();
  const threeMonthsAgo = localDateOf(new Date(Date.now() - 90 * 86400000).toISOString());
  const [from, setFrom] = useState(threeMonthsAgo);
  const [to, setTo]     = useState(today);
  const [section, setSection] = useState("tasks");
  const [lightbox, setLightbox] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null); // { type, id }

  if (!job) return <div className="empty"><p>Job not found.</p><button className="btn btn-s btn-sm" style={{ marginTop: 12 }} onClick={() => setTab("dash")}>← Back</button></div>;

  const inRange = (dateStr) => dateStr >= from && dateStr <= to;

  const jTasks    = tasks.filter(t => t.jobId === job.id);
  const jPhotos   = photos.filter(p => p.jobId === job.id && inRange((p.date || "").slice(0,10)));
  const jReceipts = receipts.filter(r => r.jobId === job.id && inRange(r.createdAt || ""));
  const jLogs     = logs.filter(l => l.jobId === job.id && inRange(l.date || ""));

  const done    = jTasks.filter(t => t.status === "done").length;
  const pending = jTasks.filter(t => t.status === "pending").length;
  const total   = jTasks.length;
  const pct     = total ? Math.round(done / total * 100) : 0;
  const crewName = id => users.find(u => u.id === id)?.name || "Unknown";
  const today2 = localDate();
  const st = task => task.status === "done" ? "done" : (task.dueDate && task.dueDate < today2 ? "overdue" : "pending");
  const totalSpend = jReceipts.reduce((s, r) => s + (+r.amount || 0), 0);

  const handleDelete = () => {
    if (!confirmDel) return;
    if (confirmDel.type === "photo")   deletePhoto(confirmDel.id);
    if (confirmDel.type === "receipt") deleteReceipt(confirmDel.id);
    if (confirmDel.type === "log")     deleteLog(confirmDel.id);
    setConfirmDel(null);
  };

  const tabs = [
    { k: "tasks",    l: `Tasks (${total})` },
    { k: "photos",   l: `Photos (${jPhotos.length})` },
    { k: "receipts", l: `Receipts (${jReceipts.length})` },
    { k: "logs",     l: `Logs (${jLogs.length})` },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <button className="btn btn-s btn-sm" style={{ marginBottom: 12 }} onClick={() => setTab("dash")}>← Dashboard</button>
        <h2 className="h2">{job.name}</h2>
        {job.address && (
          <a href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`} target="_blank" rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--sky2)", textDecoration: "none", marginTop: 4 }}>
            <Icon n="pin" s={12} /> {job.address}
          </a>
        )}
      </div>

      {/* Stats row */}
      <div className="stats" style={{ marginBottom: 20 }}>
        {[["Total Tasks", total, "var(--sky2)"], ["Complete", done, "var(--green)"], ["Pending", pending, "var(--accent)"],
          ["Photos", jPhotos.length, "var(--sky2)"], ["Receipts", jReceipts.length, "var(--silver)"],
          [`Spend $${totalSpend.toFixed(0)}`, jReceipts.length, "var(--orange)"]].map(([l, n, c]) => (
          <div key={l} className="stat">
            <div className="stat-n" style={{ color: c, fontSize: 26 }}>{l.startsWith("Spend") ? "" : n}</div>
            <div className="stat-l">{l}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="card" style={{ marginBottom: 18, padding: "14px 18px" }}>
        <div className="flexb" style={{ marginBottom: 8 }}>
          <span style={{ fontWeight: 700 }}>Overall Progress</span>
          <span className="muted">{done}/{total} · {pct}%</span>
        </div>
        <div className="bar"><div className="bar-f" style={{ width: pct + "%", background: pct === 100 ? "linear-gradient(90deg,#059669,var(--green))" : "linear-gradient(90deg,var(--sky-dim),var(--sky))" }} /></div>
      </div>

      {/* Date range filter */}
      <div className="card" style={{ marginBottom: 18, padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--silver)", letterSpacing: 1, textTransform: "uppercase" }}>Date Range</span>
          <input className="fi" type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: "auto", padding: "6px 10px", fontSize: 13 }} />
          <span className="muted">to</span>
          <input className="fi" type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: "auto", padding: "6px 10px", fontSize: 13 }} />
          <button className="btn btn-s btn-sm" onClick={() => window.print()}><Icon n="print" s={14} /> Print</button>
        </div>
      </div>

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {tabs.map(tb => (
          <button key={tb.k} onClick={() => setSection(tb.k)}
            className={"btn btn-sm " + (section === tb.k ? "btn-p" : "btn-s")}>
            {tb.l}
          </button>
        ))}
      </div>

      {/* Tasks section */}
      {section === "tasks" && (
        <div>
          {jTasks.length === 0
            ? <div className="empty"><p>No tasks for this job.</p></div>
            : ["pending","done"].map(status => {
                const group = jTasks.filter(t => t.status === status);
                if (!group.length) return null;
                return (
                  <div key={status} style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 14, fontWeight: 700, color: status === "done" ? "var(--green)" : "var(--accent)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
                      {status === "done" ? "✓ Complete" : "⏳ Pending"}
                    </div>
                    <div className="jobbody">
                      {group.map(task => {
                        const s = st(task);
                        const crew = (task.assignedTo || []).map(id => users.find(u => u.id === id)).filter(Boolean);
                        return (
                          <div key={task.id} className="trow">
                            <div className="tinfo">
                              <div className="ten" style={{ textDecoration: task.status === "done" ? "line-through" : "none", opacity: task.status === "done" ? .6 : 1 }}>{task.title}</div>
                              {task.titleEs && task.titleEs !== task.title && <div className="tes">{task.titleEs}</div>}
                              <div className="tmeta">
                                <span className={`tag tag-${s}`}>{s}</span>
                                {task.dueDate && <span className="tag" style={{ background: "rgba(255,255,255,.06)", color: "var(--silver)" }}>Due {task.dueDate}</span>}
                                {crew.map(a => <span key={a.id} className="tag-l">{a.name}</span>)}
                              </div>
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
      )}

      {/* Photos section */}
      {section === "photos" && (
        <div>
          {jPhotos.length === 0
            ? <div className="empty"><p>No photos in this date range.</p></div>
            : <div className="pgrid">
                {jPhotos.map((p, i) => (
                  <div key={i} className="pthumb" style={{ position: "relative" }}>
                    {p.dataUrl
                      ? <img src={p.dataUrl} alt={p.type} onClick={() => setLightbox(p.dataUrl)} style={{ cursor: "zoom-in" }} />
                      : <Icon n="camera" s={28} c="var(--slate)" />}
                    <div className="plabel" style={{ color: p.type === "before" ? "var(--orange)" : p.type === "after" ? "var(--green)" : "var(--sky2)" }}>{p.type}</div>
                    <button onClick={() => setConfirmDel({ type: "photo", id: p.id })}
                      style={{ position: "absolute", top: 4, right: 4, background: "rgba(239,68,68,.8)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 11, padding: "2px 5px", lineHeight: 1 }}>✕</button>
                  </div>
                ))}
              </div>
          }
        </div>
      )}

      {/* Receipts section */}
      {section === "receipts" && (
        <div>
          {jReceipts.length === 0
            ? <div className="empty"><p>No receipts in this date range.</p></div>
            : <div className="card"><div className="flexb" style={{ marginBottom: 12 }}>
                <span className="muted">{jReceipts.length} receipts</span>
                <span style={{ fontFamily: "'Barlow Condensed'", fontSize: 20, fontWeight: 800, color: "var(--accent)" }}>${totalSpend.toFixed(2)}</span>
              </div>
              <div className="tbl-wrap"><table><thead><tr><th>Date</th><th>By</th><th>Vendor</th><th>Memo</th><th>Paid By</th><th>Photo</th><th style={{ textAlign: "right" }}>Amount</th><th></th></tr></thead>
                <tbody>{jReceipts.map(r => (
                  <tr key={r.id}>
                    <td data-l="Date" className="muted">{r.createdAt}</td>
                    <td data-l="By">{crewName(r.crewId)}</td>
                    <td data-l="Vendor">{r.store}</td>
                    <td data-l="Memo" className="muted">{r.note}</td>
                    <td data-l="Paid"><span className={"tag " + (r.paidBy === "crew" ? "tag-overdue" : "tag-done")}>{r.paidBy === "crew" ? "Crew" : "Company"}</span></td>
                    <td data-l="Photo">{r.dataUrl ? <img src={r.dataUrl} alt="rcpt" onClick={() => setLightbox(r.dataUrl)} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, cursor: "zoom-in", border: "1px solid var(--border)" }} /> : <span className="muted">—</span>}</td>
                    <td data-l="Amount" style={{ textAlign: "right", fontWeight: 700, color: "var(--accent)", fontFamily: "'Barlow Condensed'", fontSize: 15 }}>${(+r.amount).toFixed(2)}</td>
                    <td><button onClick={() => setConfirmDel({ type: "receipt", id: r.id })} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", fontSize: 16 }}>✕</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          }
        </div>
      )}

      {/* Logs section */}
      {section === "logs" && (
        <div>
          {jLogs.length === 0
            ? <div className="empty"><p>No logs in this date range.</p></div>
            : jLogs.map(l => (
                <div key={l.id} className="log" style={{ position: "relative" }}>
                  <div className="log-en">{l.en}</div>
                  {l.es && l.es !== l.en && <div className="log-es">{l.es}</div>}
                  <div className="log-m">{crewName(l.crewId)} · {l.date}</div>
                  <button onClick={() => setConfirmDel({ type: "log", id: l.id })}
                    style={{ position: "absolute", top: 6, right: 6, background: "none", border: "none", cursor: "pointer", color: "var(--red)", fontSize: 14 }}>✕</button>
                </div>
              ))
          }
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="modal-bg" onClick={() => setLightbox(null)} style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "relative", maxWidth: "90vw" }} onClick={e => e.stopPropagation()}>
            <img src={lightbox} alt="full" style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: 12, objectFit: "contain" }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
              <button className="btn btn-s" onClick={() => setLightbox(null)}>Close</button>
              <button className="btn btn-p" onClick={() => { const w = window.open("","_blank"); w.document.write(`<img src="${lightbox}" style="max-width:100%"/>`); w.print(); }}><Icon n="print" s={14} /> Print</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="modal-bg" onClick={() => setConfirmDel(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">Delete this {confirmDel.type}?</div>
            <p className="muted" style={{ lineHeight: 1.6 }}>This permanently removes it and cannot be undone.</p>
            <div className="macts">
              <button className="btn btn-s" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="btn" style={{ background: "linear-gradient(135deg,#dc2626,var(--red))", color: "#fff" }} onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CREW ─────────────────────────────────────────────────────────────
function Crew(props) {
  const { t, tab, setTab, user, jobs, settings, lang } = props;
  const [openCheckin, setOpenCheckin] = useState(null);
  const [staleCheckin, setStaleCheckin] = useState(null);
  const [manualDate, setManualDate] = useState("");
  const [manualTime, setManualTime] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [clockingOut, setClockingOut] = useState(false);
  const [issueModal, setIssueModal] = useState(false);
  const [issueText, setIssueText] = useState("");
  const [issuePhoto, setIssuePhoto] = useState(null);
  const [issueBusy, setIssueBusy] = useState(false);
  const [pushBanner, setPushBanner] = useState(null);
  const issueRef = useRef();

  useEffect(() => {
    if (!("Notification" in window)) return;
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    const perm = Notification.permission;
    if (isIOS && !isStandalone) { setPushBanner("ios-install"); return; }
    if (isIOS && isStandalone && perm === "denied") { setPushBanner("ios-settings"); return; }
    if (!isIOS && perm === "denied") { setPushBanner("browser-denied"); }
  }, []);

  const submitIssue = async () => {
    if (!issueText.trim()) return;
    setIssueBusy(true);
    const id = "l" + Date.now();
    const today = localDate();
    const note = `🚩 ISSUE from ${user.name}: ${issueText}`;
    const row = { id, text_en: note, text_es: note, task_id: null, job_id: null, crew_id: user.id, log_date: today };
    try { await sbPost("field_logs", row); } catch {}
    // SMS to admin
    const adminPhone = settings?.adminPhone || "+12053699710";
    fetch("/.netlify/functions/send-sms", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: adminPhone, body: `🚩 ISSUE — ${user.name}: ${issueText}${issuePhoto ? " [photo attached]" : ""}` }),
    }).catch(() => {});
    setIssueText(""); setIssuePhoto(null); setIssueModal(false); setIssueBusy(false);
    alert("Issue reported to admin.");
  };

  useEffect(() => {
    const today = localDate();
    // Query ALL open check-ins (not just today) to catch forgotten checkouts
    sbGet("field_checkins", `crew_id=eq.${user.id}&check_out=is.null&order=check_in.desc&limit=1`)
      .then(rows => {
        if (!rows?.[0]) return;
        const ci = fromCheckin(rows[0]);
        if (ci.date === today) {
          setOpenCheckin(ci);
        } else {
          // Stale — from a previous day, need manual checkout time
          setStaleCheckin(ci);
          const d = new Date(ci.checkIn);
          setManualDate(ci.date);
          // Default checkout time = 5:00pm on the day they checked in
          setManualTime("17:00");
        }
      })
      .catch(() => {});
  }, [user.id]);

  const clockOut = async () => {
    if (!openCheckin || clockingOut) return;
    setClockingOut(true);
    const now = new Date();
    const hrs = Math.round((now - new Date(openCheckin.checkIn)) / 36000) / 100;
    const gps = await getLocation();
    try {
      await sbFetch(`field_checkins?id=eq.${openCheckin.id}`, {
        method: "PATCH",
        body: JSON.stringify({ check_out: now.toISOString(), hours: hrs, lat_out: gps?.lat || null, lng_out: gps?.lng || null }),
        prefer: "return=minimal",
      });
      setOpenCheckin(null);
    } catch {}
    setClockingOut(false);
  };

  const submitManualCheckout = async () => {
    if (!staleCheckin || !manualDate || !manualTime || manualBusy) return;
    setManualBusy(true);
    try {
      const checkoutDt = new Date(`${manualDate}T${manualTime}:00`);
      const hrs = Math.max(0, Math.round((checkoutDt - new Date(staleCheckin.checkIn)) / 36000) / 100);
      await sbFetch(`field_checkins?id=eq.${staleCheckin.id}`, {
        method: "PATCH",
        body: JSON.stringify({ check_out: checkoutDt.toISOString(), hours: hrs }),
        prefer: "return=minimal",
      });
      setStaleCheckin(null);
    } catch {}
    setManualBusy(false);
  };

  const ctab = (tab === "dash" || !tab) ? "tasks" : tab;
  const openJobName  = openCheckin  ? (jobs.find(j => j.id === openCheckin.jobId)?.name  || openCheckin.jobId)  : null;
  const staleJobName = staleCheckin ? (jobs.find(j => j.id === staleCheckin.jobId)?.name || staleCheckin.jobId) : null;
  const nav = [{ k: "tasks", i: "tasks", l: t.tasks }, { k: "cam", i: "camera", l: t.photos },
    { k: "rec", i: "receipt", l: t.receipts }, { k: "log", i: "report", l: t.log }];
  return (
    <div style={{ minHeight: "calc(100vh - 62px)", background: "var(--steel)" }}>

      {/* ── Stale check-in — forgot to clock out ── */}
      {staleCheckin && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--steel)", border: "2px solid var(--red)", borderRadius: 16, padding: 24, maxWidth: 360, width: "100%" }}>
            <div style={{ fontSize: 32, textAlign: "center", marginBottom: 8 }}>⚠️</div>
            <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 20, fontWeight: 800, color: "var(--red)", textAlign: "center", marginBottom: 6 }}>
              {lang === "es" ? "¡Olvidaste registrar tu salida!" : "You forgot to clock out!"}
            </div>
            <div style={{ fontSize: 13, color: "var(--slate)", textAlign: "center", marginBottom: 20, lineHeight: 1.5 }}>
              {lang === "es"
                ? `Quedaste registrado en ${staleJobName} el ${staleCheckin.date} a las ${new Date(staleCheckin.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. ¿A qué hora saliste?`
                : `You were clocked in at ${staleJobName} on ${staleCheckin.date} at ${new Date(staleCheckin.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. What time did you leave?`}
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--slate)", marginBottom: 4 }}>{lang === "es" ? "Fecha" : "Date"}</div>
                <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14 }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--slate)", marginBottom: 4 }}>{lang === "es" ? "Hora de salida" : "Time left"}</div>
                <input type="time" value={manualTime} onChange={e => setManualTime(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14 }} />
              </div>
            </div>
            <button onClick={submitManualCheckout} disabled={manualBusy || !manualDate || !manualTime}
              style={{ width: "100%", padding: "13px 0", borderRadius: 10, border: "none", background: "var(--accent)", color: "#000", fontFamily: "'Barlow Condensed'", fontSize: 17, fontWeight: 800, cursor: "pointer" }}>
              {manualBusy ? "..." : (lang === "es" ? "Guardar hora de salida" : "Save Checkout Time")}
            </button>
          </div>
        </div>
      )}

      {openCheckin && (
        <div style={{ padding: "10px 18px", background: "rgba(16,185,129,.12)", borderBottom: "1px solid rgba(16,185,129,.25)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>● Clocked in</span>
            <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>{openJobName} · {new Date(openCheckin.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <button onClick={clockOut} disabled={clockingOut}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid var(--green)", background: "rgba(16,185,129,.15)", color: "var(--green)", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            {clockingOut ? "..." : "Clock Out"}
          </button>
        </div>
      )}

      {/* ── Push Notification Banner ── */}
      {pushBanner && (
        <div style={{ padding: "10px 18px", background: "rgba(245,158,11,.15)", borderBottom: "1px solid rgba(245,158,11,.3)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔔</span>
          <div style={{ flex: 1, fontSize: 12, color: "var(--text)" }}>
            {pushBanner === "ios-install" && (lang === "es"
              ? <><b>Activa notificaciones:</b> En Safari, toca Compartir (⬆) → "Agregar a pantalla de inicio" → abre la app desde el ícono</>
              : <><b>Enable notifications:</b> In Safari tap Share (⬆) → "Add to Home Screen" → then open app from that icon</>
            )}
            {pushBanner === "ios-settings" && (lang === "es"
              ? <><b>Notificaciones bloqueadas.</b> Ve a Ajustes de iPhone → Safari → este sitio → Notificaciones → Permitir</>
              : <><b>Notifications blocked.</b> Go to iPhone Settings → Safari → this site → Notifications → Allow</>
            )}
            {pushBanner === "browser-denied" && (lang === "es"
              ? <><b>Notificaciones bloqueadas.</b> Toca el candado en la barra de dirección → Notificaciones → Permitir</>
              : <><b>Notifications blocked.</b> Tap the lock icon in your address bar → Notifications → Allow</>
            )}
          </div>
        </div>
      )}

      {/* ── Quick Action Bar ── */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)" }}>
        <button onClick={() => setTab("rec")}
          style={{ flex: 1, padding: "13px 8px", border: "none", borderRight: "1px solid var(--border)",
            background: ctab === "rec" ? "rgba(245,158,11,.18)" : "rgba(245,158,11,.08)", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 22 }}>🧾</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: "var(--accent)", fontFamily: "'Barlow Condensed'", letterSpacing: .5 }}>
            {lang === "es" ? "RECIBO" : "RECEIPT"}
          </span>
        </button>
        <button onClick={() => setTab("cam")}
          style={{ flex: 1, padding: "13px 8px", border: "none", borderRight: "1px solid var(--border)",
            background: ctab === "cam" ? "rgba(59,130,246,.18)" : "rgba(59,130,246,.06)", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 22 }}>📷</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: "var(--sky2)", fontFamily: "'Barlow Condensed'", letterSpacing: .5 }}>
            {lang === "es" ? "FOTOS" : "PHOTOS"}
          </span>
        </button>
        <button onClick={() => setTab("log")}
          style={{ flex: 1, padding: "13px 8px", border: "none", borderRight: "1px solid var(--border)",
            background: ctab === "log" ? "rgba(100,116,139,.25)" : "rgba(100,116,139,.08)", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 22 }}>📋</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: "var(--silver)", fontFamily: "'Barlow Condensed'", letterSpacing: .5 }}>
            {lang === "es" ? "REGISTRO" : "LOG DAY"}
          </span>
        </button>
        <button onClick={() => setIssueModal(true)}
          style={{ flex: 1, padding: "13px 8px", border: "none",
            background: "rgba(239,68,68,.08)", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 22 }}>🚩</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: "var(--red)", fontFamily: "'Barlow Condensed'", letterSpacing: .5 }}>
            {lang === "es" ? "PROBLEMA" : "FLAG ISSUE"}
          </span>
        </button>
      </div>

      <div style={{ padding: 18, paddingBottom: 24 }}>
        {ctab === "tasks" && <CrewTasks {...props} />}
        {ctab === "cam" && <CrewPhotos {...props} />}
        {ctab === "rec" && <CrewReceipts {...props} />}
        {ctab === "log" && <CrewLog {...props} />}
      </div>

      {/* Issue modal */}
      {issueModal && (
        <div className="modal-bg" onClick={() => setIssueModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt" style={{ color: "var(--red)" }}>🚩 Flag an Issue</div>
            <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>Describe the problem. Greg gets a text immediately.</p>
            <textarea className="fi" rows={4} value={issueText} onChange={e => setIssueText(e.target.value)}
              placeholder="What's the problem? Be specific — location, what happened, what's needed..."
              style={{ resize: "vertical", fontFamily: "inherit" }} />
            <input ref={issueRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
              onChange={async e => { const f = e.target.files[0]; if (!f) return; try { const { dataUrl } = await compressImage(f); setIssuePhoto(dataUrl); } catch { alert("Could not process image. Try again."); } e.target.value = ""; }} />
            {issuePhoto
              ? <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                  <img src={issuePhoto} alt="issue" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8 }} />
                  <button onClick={() => setIssuePhoto(null)} style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 12 }}>✕ Remove</button>
                </div>
              : <button className="btn btn-s btn-sm" style={{ marginTop: 10 }} onClick={() => issueRef.current?.click()}>
                  <Icon n="camera" s={13} /> Add Photo
                </button>
            }
            <div className="macts" style={{ marginTop: 16 }}>
              <button className="btn btn-s" onClick={() => setIssueModal(false)}>Cancel</button>
              <button className="btn" style={{ background: "linear-gradient(135deg,#dc2626,var(--red))", color: "#fff" }}
                disabled={!issueText.trim() || issueBusy} onClick={submitIssue}>
                {issueBusy ? "Sending..." : "Report Issue"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="cnav">{nav.map(n => <div key={n.k} className={`cnav-i ${ctab === n.k ? "on" : ""}`} onClick={() => setTab(n.k)}>
        <Icon n={n.i} s={22} /><span className="cnav-l">{n.l}</span></div>)}</div>
    </div>
  );
}

function CrewTasks(props) {
  const { user, tasks, setTasks, jobs, lang, t, settings, photos, setPhotos, receipts, setReceipts, logs, setLogs, dispatches, mats } = props;
  const closedJobIds = new Set(jobs.filter(j => j.status === "closed").map(j => j.id));
  const my = tasks.filter(t => (Array.isArray(t.assignedTo) ? t.assignedTo.includes(user.id) : t.assignedTo === user.id) && !closedJobIds.has(t.jobId));
  const today = localDate();
  const [checkedJob, setCheckedJob] = useState(null);
  const [gps, setGps] = useState(null);
  const [matModal, setMatModal] = useState(null);
  const [mat, setMat] = useState("");
  // Job-level quick actions
  const [activePanel, setActivePanel] = useState(null); // { jobId, type: 'photo'|'receipt'|'issue' }
  const [photoType, setPhotoType] = useState("before");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoSuccess, setPhotoSuccess] = useState(null);
  const [pendingJobPhoto, setPendingJobPhoto] = useState(null); // { dataUrl, sizeKB, jobId, type }
  const [jobPhotoNote, setJobPhotoNote] = useState("");
  const [rcForm, setRcForm] = useState({ store: "", amount: "", note: "", paidBy: "crew", dataUrl: null });
  const [rcBusy, setRcBusy] = useState(false);
  const [issueText, setIssueText] = useState(""); const [issueDataUrl, setIssueDataUrl] = useState(null); const [issueBusy, setIssueBusy] = useState(false);
  const issuePhotoRef = useRef();
  const photoRef = useRef();
  const rcPhotoRef = useRef();
  // ── Task-specific photo/receipt panels ──────────────────────────────
  const [taskPanel, setTaskPanel] = useState(null); // { taskId, jobId, type:'photo'|'receipt', photoType:'before' }
  const [taskRcForm, setTaskRcForm] = useState({ store: "", amount: "", note: "", paidBy: "crew", dataUrl: null });
  const [taskRcBusy, setTaskRcBusy] = useState(false);
  const [taskPhotoBusy, setTaskPhotoBusy] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [photoNote, setPhotoNote] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const [crewLightbox, setCrewLightbox] = useState(null); // { dataUrl, note, type }
  const taskPhotoRef    = useRef();
  const taskPhotoCamRef = useRef();
  const taskRcPhotoRef  = useRef();
  const photoCamRef     = useRef();

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
    try {
      const { dataUrl, sizeKB } = await compressImage(file);
      setPendingJobPhoto({ dataUrl, sizeKB, jobId: activePanel.jobId, type: photoType });
      setJobPhotoNote("");
    } catch { alert("Could not process image. Try again."); }
    e.target.value = "";
    setPhotoBusy(false);
    setActivePanel(null); // close the type-picker panel, description modal takes over
  };

  const saveJobPhoto = async (note) => {
    if (!pendingJobPhoto) return;
    setPhotoBusy(true);
    const id = "p" + Date.now();
    const { dataUrl, sizeKB, jobId, type } = pendingJobPhoto;
    const dbType = type === "concern" ? "progress" : type;
    let storagePath = null;
    try { storagePath = await uploadToStorage(dataUrl, `${user.id}/${id}.jpg`); } catch {}
    const photo = { id, dataUrl, type, taskId: null, jobId, crewId: user.id, sizeKB, note: note || "", date: new Date().toISOString() };
    setPhotos(p => [...p, photo]);
    const row = { id, data_url: storagePath ? null : dataUrl, storage_path: storagePath, photo_type: dbType, task_id: null, job_id: jobId, crew_id: user.id, size_kb: sizeKB, note: note || null };
    try { await sbPost("field_photos", row); } catch { enqueue({ table: "field_photos", payload: row }); }
    setPendingJobPhoto(null);
    setJobPhotoNote("");
    setPhotoBusy(false);
    setPhotoSuccess(jobId);
    setTimeout(() => setPhotoSuccess(null), 3000);
  };

  const captureRcPhoto = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const { dataUrl } = await compressImage(file, 1000, 0.6); setRcForm(p => ({ ...p, dataUrl })); }
    catch { alert("Could not process image. Try again."); }
    e.target.value = "";
  };

  const submitJobReceipt = async (jobId) => {
    if (!rcForm.store || !rcForm.amount) return;
    setRcBusy(true);
    const id = "r" + Date.now();
    let storagePath = null;
    if (rcForm.dataUrl) { try { storagePath = await uploadToStorage(rcForm.dataUrl, `${user.id}/${id}.jpg`); } catch {} }
    const receipt = { id, dataUrl: rcForm.dataUrl, taskId: null, jobId, crewId: user.id, store: rcForm.store, amount: rcForm.amount, note: rcForm.note, paidBy: rcForm.paidBy, reimbursementStatus: rcForm.paidBy === "crew" ? "pending" : "na", createdAt: today };
    setReceipts(p => [...p, receipt]);
    const row = { id, data_url: storagePath ? null : rcForm.dataUrl, storage_path: storagePath, task_id: null, job_id: jobId, crew_id: user.id, store: rcForm.store, amount: parseFloat(rcForm.amount) || 0, note: rcForm.note, paid_by: rcForm.paidBy, reimbursement_status: rcForm.paidBy === "crew" ? "pending" : "na" };
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

  const removePhoto = async (photo) => {
    setPhotos(p => p.filter(x => x.id !== photo.id));
    try { await sbDelete("field_photos", photo.id); } catch {}
    if (photo.storagePath) { try { await deleteFromStorage(photo.storagePath); } catch {} }
  };

  const captureIssuePhoto = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const { dataUrl } = await compressImage(file, 1000, 0.6); setIssueDataUrl(dataUrl); }
    catch { alert("Could not process image. Try again."); }
    e.target.value = "";
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
      let storagePath = null;
      try { storagePath = await uploadToStorage(issueDataUrl, `${user.id}/${pid}.jpg`); } catch {}
      const photo = { id: pid, dataUrl: issueDataUrl, type: "concern", taskId: null, jobId, crewId: user.id, sizeKB: 0, date: new Date().toISOString() };
      setPhotos(p => [...p, photo]);
      const prow = { id: pid, data_url: storagePath ? null : issueDataUrl, storage_path: storagePath, photo_type: "progress", task_id: null, job_id: jobId, crew_id: user.id, size_kb: 0 };
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
    if (next === "done" && task.photoRequired && !photos.some(p => p.taskId === task.id)) {
      alert(lang === "es"
        ? "📷 Esta tarea requiere al menos una foto antes de marcarla como terminada."
        : "📷 This task requires at least one photo before marking it done.");
      return;
    }
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

  // "Worked on this today" — logs progress without marking the task done.
  // Lets crew show hours spent on a multi-day task; admin/crew still marks it
  // complete separately via the checkbox above.
  const loggedWorkToday = (taskId) =>
    logs.some(l => l.taskId === taskId && l.crewId === user.id && l.date === today && l.en?.startsWith(`${T.en.workedOnTask}:`));

  const workedOnTask = async (task) => {
    if (loggedWorkToday(task.id) || task.status === "done") return;
    const logId = "l" + Date.now();
    const enText = `${T.en.workedOnTask}: ${task.title}`;
    const esText = `${T.es.workedOnTask}: ${task.titleEs || task.title}`;
    const log = { id: logId, en: enText, es: esText, weather: "", taskId: task.id, jobId: task.jobId, crewId: user.id, date: today };
    setLogs(p => [...p, log]);
    const row = { id: logId, text_en: enText, text_es: esText, task_id: task.id, job_id: task.jobId, crew_id: user.id, log_date: today };
    try { await sbPost("field_logs", row); } catch { enqueue({ table: "field_logs", payload: row }); }
  };

  const submitMat = async (taskId) => {
    if (!mat.trim()) return;
    const tk = tasks.find(t => t.id === taskId);
    const id = "m" + Date.now();
    const row = { id, task_id: taskId, job_id: tk?.jobId || null, crew_id: user.id, text_en: mat, text_es: null, fulfilled: false };
    try { await sbPost("field_material_requests", row); } catch { enqueue({ table: "field_material_requests", payload: row }); }
    setMat(""); setMatModal(null);
  };

  // Language-aware task title helpers
  const tt  = task => lang === "es" ? (task.titleEs || task.title) : task.title;
  const tts = task => lang === "es" ? task.title : (task.titleEs || "");

  const captureTaskPhoto = async (e) => {
    const file = e.target.files[0]; if (!file || !taskPanel) return;
    setTaskPhotoBusy(true);
    try {
      const { dataUrl, sizeKB } = await compressImage(file);
      setPendingPhoto({ dataUrl, sizeKB });
      setPhotoNote("");
    } catch { alert("Could not process image. Try again."); }
    e.target.value = "";
    setTaskPhotoBusy(false);
  };

  const saveTaskPhoto = async (andDone = false) => {
    if (!pendingPhoto || !taskPanel) return;
    setTaskPhotoBusy(true);
    const id = "p" + Date.now();
    const ptype = taskPanel.photoType || "before";
    let storagePath = null;
    try { storagePath = await uploadToStorage(pendingPhoto.dataUrl, `${user.id}/${id}.jpg`); } catch {}
    const photo = { id, dataUrl: pendingPhoto.dataUrl, type: ptype, taskId: taskPanel.taskId, jobId: taskPanel.jobId, crewId: user.id, sizeKB: pendingPhoto.sizeKB, note: photoNote, date: new Date().toISOString() };
    setPhotos(p => [...p, photo]);
    const row = { id, data_url: storagePath ? null : pendingPhoto.dataUrl, storage_path: storagePath, photo_type: ptype, task_id: taskPanel.taskId, job_id: taskPanel.jobId, crew_id: user.id, size_kb: pendingPhoto.sizeKB, note: photoNote || null };
    try { await sbPost("field_photos", row); } catch { enqueue({ table: "field_photos", payload: row }); }
    setSavedCount(n => n + 1);
    setPendingPhoto(null);
    setPhotoNote("");
    setTaskPhotoBusy(false);
    if (andDone) {
      setTaskPanel(null);
      setSavedCount(0);
      setPhotoSuccess(taskPanel.jobId);
      setTimeout(() => setPhotoSuccess(null), 3000);
    }
  };

  const captureTaskRcPhoto = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const { dataUrl } = await compressImage(file, 1000, 0.6); setTaskRcForm(p => ({ ...p, dataUrl })); }
    catch { alert("Could not process image. Try again."); }
    e.target.value = "";
  };

  const submitTaskReceipt = async () => {
    if (!taskRcForm.store || !taskRcForm.amount || !taskPanel) return;
    setTaskRcBusy(true);
    const id = "r" + Date.now();
    let storagePath = null;
    if (taskRcForm.dataUrl) { try { storagePath = await uploadToStorage(taskRcForm.dataUrl, `${user.id}/${id}.jpg`); } catch {} }
    const receipt = { id, dataUrl: taskRcForm.dataUrl, taskId: taskPanel.taskId, jobId: taskPanel.jobId, crewId: user.id, store: taskRcForm.store, amount: taskRcForm.amount, note: taskRcForm.note, paidBy: taskRcForm.paidBy, reimbursementStatus: taskRcForm.paidBy === "crew" ? "pending" : "na", createdAt: today };
    setReceipts(p => [...p, receipt]);
    const row = { id, data_url: storagePath ? null : taskRcForm.dataUrl, storage_path: storagePath, task_id: taskPanel.taskId, job_id: taskPanel.jobId, crew_id: user.id, store: taskRcForm.store, amount: parseFloat(taskRcForm.amount) || 0, note: taskRcForm.note, paid_by: taskRcForm.paidBy, reimbursement_status: taskRcForm.paidBy === "crew" ? "pending" : "na" };
    try { await sbPost("field_receipts", row); } catch { enqueue({ table: "field_receipts", payload: row }); }
    if (taskRcForm.paidBy === "crew") {
      const job = jobs.find(j => j.id === taskPanel.jobId);
      const msg = `[Field App] ${user.name} submitted a receipt: ${taskRcForm.store} $${parseFloat(taskRcForm.amount).toFixed(2)} — ${job?.name}`;
      fetch("/.netlify/functions/send-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: "+12053699710", body: msg }) }).catch(() => {});
    }
    setTaskRcForm({ store: "", amount: "", note: "", paidBy: "crew", dataUrl: null });
    setTaskRcBusy(false);
    setTaskPanel(null);
  };

  const st = task => task.status === "done" ? "done" : (task.dueDate && task.dueDate < today ? "overdue" : "pending");

  const [openCheckins, setOpenCheckins] = useState({}); // { jobId: checkinRecord }
  const [checkoutGate, setCheckoutGate] = useState(null); // { job, tasks } pending resolution before checkout

  // Load open check-ins from DB on mount so refresh doesn't lose state
  useEffect(() => {
    sbGet("field_checkins", `crew_id=eq.${user.id}&check_out=is.null`)
      .then(rows => {
        if (!rows?.length) return;
        const now = new Date();
        const map = {};
        rows.forEach(r => {
          // Auto-close stale check-ins from previous days
          if (r.work_date && r.work_date < today) {
            const hrs = Math.round((now - new Date(r.check_in)) / 36000) / 100;
            sbFetch(`field_checkins?id=eq.${r.id}`, { method: "PATCH", body: JSON.stringify({ check_out: now.toISOString(), hours: hrs, auto_closed: true, method: "auto" }), prefer: "return=minimal" }).catch(() => {});
          } else {
            map[r.job_id] = { id: r.id, jobId: r.job_id, checkIn: r.check_in };
          }
        });
        setOpenCheckins(map);
      })
      .catch(() => {});
  }, [user.id]);

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

  // Gate check-out on unresolved tasks for THIS job — this is the moment
  // crew actually leave, so it's the real fix for forgotten task logs
  // (the account-level logout gate in App() is a secondary safety net).
  const requestCheckOut = (job) => {
    const open = openCheckins[job.id];
    // Checked in only to immediately check out (backfilling a forgotten
    // morning check-in) — not a real end-of-day moment, skip the gate.
    if (open && (Date.now() - new Date(open.checkIn).getTime()) < 5 * 60000) {
      checkOut(job);
      return;
    }
    const already = new Set(
      logs.filter(l => l.crewId === user.id && l.date === today &&
        (l.en?.startsWith(`${T.en.workedOnTask}:`) || l.en?.startsWith(`${T.en.completedTask}:`)))
        .map(l => l.taskId)
    );
    const pend = tasks.filter(tk =>
      tk.status === "pending" && !tk.recurring && tk.jobId === job.id &&
      (Array.isArray(tk.assignedTo) ? tk.assignedTo.includes(user.id) : tk.assignedTo === user.id) &&
      !already.has(tk.id)
    );
    if (pend.length === 0) { checkOut(job); return; }
    setCheckoutGate({ job, tasks: pend });
  };
  const gateComplete = async (task) => {
    if (task.photoRequired && !photos.some(p => p.taskId === task.id)) return false;
    await toggle(task.id);
    return true;
  };
  const gateWorkedOn = async (task) => { await workedOnTask(task); };

  const myRecurring = tasks.filter(t =>
    t.recurring && !closedJobIds.has(t.jobId)
  );
  const toggleRecurring = async (task) => {
    const doneToday = task.completedAt && localDateOf(task.completedAt) === today;
    const next = doneToday ? null : new Date().toISOString();
    setTasks(p => p.map(tk => tk.id === task.id ? { ...tk, completedAt: next } : tk));
    try { await sbFetch(`field_tasks?id=eq.${task.id}`, { method: "PATCH", body: JSON.stringify({ completed_at: next }), prefer: "return=minimal" }); } catch {}
    // Log completion to daily report
    if (!doneToday) {
      const logId = "l" + Date.now();
      const enText = `✓ Recurring: ${task.title}`;
      const esText = `✓ Recurrente: ${task.titleEs || task.title}`;
      const log = { id: logId, en: enText, es: esText, taskId: task.id, jobId: task.jobId, crewId: user.id, date: today };
      setLogs(p => [...p, log]);
      try { await sbPost("field_logs", { id: logId, text_en: enText, text_es: esText, task_id: task.id, job_id: task.jobId, crew_id: user.id, log_date: today }); } catch {}
    }
  };

  const crew24hCutoff = new Date(Date.now() - 24 * 3600000).toISOString();
  const myRegularVisible = my.filter(t => !t.recurring && (t.status !== "done" || !t.completedAt || t.completedAt >= crew24hCutoff));
  const groups = [...new Set(myRegularVisible.map(t => t.jobId))];

  return (
    <div>
      {/* shared hidden file inputs — separate cam/gallery to avoid iOS capture attr bug */}
      <input ref={photoRef}        type="file" accept="image/*" style={{ display: "none" }} onChange={captureJobPhoto} />
      <input ref={photoCamRef}     type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={captureJobPhoto} />
      <input ref={rcPhotoRef}      type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={captureRcPhoto} />
      <input ref={issuePhotoRef}   type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={captureIssuePhoto} />
      {/* task-specific file inputs */}
      <input ref={taskPhotoRef}    type="file" accept="image/*" style={{ display: "none" }} onChange={captureTaskPhoto} />
      <input ref={taskPhotoCamRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={captureTaskPhoto} />
      <input ref={taskRcPhotoRef}  type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={captureTaskRcPhoto} />

      {/* ── RECURRING TASKS — absolute top ─────────────────────── */}
      {myRecurring.length > 0 && (() => {
        const recurringGroups = [...new Set(myRecurring.map(t => t.jobId))];
        const doneCount = myRecurring.filter(t => t.completedAt && localDateOf(t.completedAt) === today).length;
        const allDone = doneCount === myRecurring.length;
        return (
          <div className="card" style={{ marginBottom: 20, border: allDone ? "1px solid rgba(16,185,129,.4)" : "1px solid rgba(245,158,11,.35)", background: allDone ? "rgba(16,185,129,.04)" : "rgba(245,158,11,.04)" }}>
            <div className="flexb" style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>🔁</span>
                <span style={{ fontWeight: 800, fontSize: 16, fontFamily: "'Barlow Condensed'" }}>
                  {lang === "es" ? "Tareas Recurrentes" : "Recurring Tasks"}
                </span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: allDone ? "var(--green)" : "var(--accent)", fontFamily: "'Barlow Condensed'" }}>
                {doneCount}/{myRecurring.length} {lang === "es" ? "hoy" : "today"}
              </span>
            </div>
            {recurringGroups.map(jid => {
              const jobR = jobs.find(j => j.id === jid);
              const jtasks = myRecurring.filter(t => t.jobId === jid);
              return (
                <div key={jid} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--slate)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                    {jobR?.name || jid}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {jtasks.map(task => {
                      const doneToday = task.completedAt && localDateOf(task.completedAt) === today;
                      return (
                        <div key={task.id} onClick={() => toggleRecurring(task)}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                            background: doneToday ? "rgba(16,185,129,.1)" : "rgba(255,255,255,.04)",
                            border: `1px solid ${doneToday ? "rgba(16,185,129,.3)" : "var(--border)"}`, transition: ".15s" }}>
                          <div style={{ width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                            border: `2px solid ${doneToday ? "var(--green)" : "var(--accent)"}`,
                            background: doneToday ? "var(--green)" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {doneToday && <Icon n="check" s={14} c="#fff" />}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: doneToday ? "var(--slate)" : "var(--white)", textDecoration: doneToday ? "line-through" : "none" }}>
                              {lang === "es" && task.titleEs ? task.titleEs : task.title}
                            </div>
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: doneToday ? "var(--green)" : "var(--slate)", fontFamily: "'Barlow Condensed'", flexShrink: 0 }}>
                            {doneToday ? (lang === "es" ? "HECHO" : "DONE") : (lang === "es" ? "PENDIENTE" : "PENDING")}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── WHERE TO GO TODAY (admin-dispatched) ── */}
      {(() => {
        const todayDispatch = dispatches?.find(d => d.crewId === user.id && d.date === today);
        const dispatchJobs = todayDispatch ? todayDispatch.jobIds.map(id => jobs.find(j => j.id === id)).filter(Boolean) : [];
        const customStops = todayDispatch?.customStops || [];
        if (!todayDispatch || (dispatchJobs.length === 0 && customStops.length === 0)) return null;
        return (
          <div style={{ marginBottom: 20, background: "linear-gradient(135deg,rgba(245,158,11,.1),rgba(59,130,246,.08))", border: "1px solid rgba(245,158,11,.3)", borderRadius: 14, padding: 16 }}>
            <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 16, fontWeight: 800, letterSpacing: 1, color: "var(--accent)", marginBottom: 12 }}>
              📍 {t.whereToGoToday}
            </div>
            {dispatchJobs.map((job, i) => (
              <div key={job.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, padding: "8px 12px", background: "rgba(0,0,0,.2)", borderRadius: 10, border: "1px solid rgba(245,158,11,.2)" }}>
                <span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, color: "var(--accent)", fontSize: 18, width: 22, textAlign: "center" }}>{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{job.name}</div>
                  {job.address && (
                    <a href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`} target="_blank" rel="noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--sky2)", textDecoration: "none", marginTop: 2 }}>
                      <Icon n="pin" s={11} /> {job.address} — Navigate
                    </a>
                  )}
                </div>
              </div>
            ))}
            {customStops.map((s, i) => {
              const stop = parseStop(s);
              const gMapUrl = stop.address ? `https://maps.google.com/?q=${encodeURIComponent(stop.address)}` : null;
              const aMapUrl = stop.address ? `maps://maps.apple.com/?q=${encodeURIComponent(stop.address)}` : null;
              return (
                <div key={i} style={{ marginBottom: 8, padding: "10px 12px", background: "rgba(59,130,246,.08)", borderRadius: 10, border: "1px solid rgba(59,130,246,.2)" }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>🛑 {stop.label}</div>
                  {stop.address && (
                    <div style={{ fontSize: 12, color: "var(--silver)", marginBottom: 6 }}>📍 {stop.address}</div>
                  )}
                  {gMapUrl && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <a href={gMapUrl} target="_blank" rel="noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 8, background: "rgba(59,130,246,.2)", color: "var(--sky2)", fontSize: 12, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(59,130,246,.35)" }}>
                        <Icon n="pin" s={13} /> {t.googleMaps}
                      </a>
                      <a href={aMapUrl} target="_blank" rel="noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 8, background: "rgba(59,130,246,.12)", color: "var(--sky2)", fontSize: 12, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(59,130,246,.2)" }}>
                        <Icon n="pin" s={13} /> {t.appleMaps}
                      </a>
                    </div>
                  )}
                  {!stop.address && <div style={{ fontSize: 11, color: "var(--orange)" }}>{t.noAddressFile}</div>}
                </div>
              );
            })}
          </div>
        );
      })()}

      <div style={{ marginBottom: 18 }}>
        <h2 className="h2">{lang === "es" ? `Hola, ${user.name.split(" ")[0]}` : `Hey, ${user.name.split(" ")[0]}`}</h2>
        <p className="muted">{t.yourTasks}</p>
      </div>

      {groups.length === 0
        ? <div className="empty"><Icon n="check" s={48} c="var(--green)" /><p style={{ marginTop: 12 }}>{t.noTasks}</p></div>
        : groups.map(jid => {
          const job = jobs.find(j => j.id === jid);
          const jt = myRegularVisible.filter(t => t.jobId === jid).sort((a, b) => {
            if (a.priority === "urgent" && b.priority !== "urgent") return -1;
            if (a.priority !== "urgent" && b.priority === "urgent") return 1;
            return 0;
          });
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
                    <Icon n="pin" s={12} c="var(--sky2)" /> {job.address} — {t.navigate}
                  </a>
                )}
              </div>
              {openCheckins[jid]
                ? <button className="btn btn-sm btn-a" onClick={() => requestCheckOut(job)}>
                    <Icon n="power" s={13} /> {t.checkOut}
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
                  ⚠ {t.flagIssue}
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
                    onClick={() => photoCamRef.current?.click()}>
                    {photoBusy ? <span className="spin" /> : <><Icon n="camera" s={15} /> {t.takePhoto}</>}
                  </button>
                  <button className="btn btn-s" disabled={photoBusy}
                    onClick={() => openGallery(captureJobPhoto)}>
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
                  ⚠ {t.reportIssue} — {t.alertsAdmin}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <textarea className="fi" rows={3} value={issueText} onChange={e => setIssueText(e.target.value)}
                    placeholder={t.describeIssue} />
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
                  {issueDataUrl
                    ? <img src={issueDataUrl} alt="issue" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "2px solid var(--red)" }} />
                    : null}
                  <button className="btn btn-s btn-sm" onClick={() => issuePhotoRef.current?.click()}>
                    <Icon n="camera" s={13} /> {issueDataUrl ? t.retake : t.attachPhoto}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-full" style={{ flex: 1, background: "linear-gradient(135deg,#dc2626,var(--red))", color: "#fff", justifyContent: "center" }}
                    disabled={(!issueText.trim() && !issueDataUrl) || issueBusy}
                    onClick={() => submitIssue(jid)}>
                    {issueBusy ? <span className="spin" /> : <><Icon n="check" s={15} /> {t.sendToAdmin}</>}
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
            <div className="jobbody">{jt.map(task => {
              const s = st(task);
              const tp = taskPanel?.taskId === task.id ? taskPanel.type : null;
              const TPTYPES = [
                { k: "before", l: t.before, c: "var(--orange)" },
                { k: "after",  l: t.after,  c: "var(--green)"  },
                { k: "concern",l: t.concern,c: "var(--red)"    },
              ];
              const rowCls = `trow${task.recurring ? " trow-recurring" : task.priority === "urgent" ? " trow-urgent" : ""}`;
              return (
                <div key={task.id}>
                  {/* ── Row ── */}
                  <div className={rowCls}>
                    <div className="tchk"><input type="checkbox" checked={task.status === "done"} onChange={() => toggle(task.id)} /></div>
                    <div className="tinfo">
                      <div className="ten" style={{ textDecoration: task.status === "done" ? "line-through" : "none", opacity: task.status === "done" ? .6 : 1 }}>
                        {task.recurring && <span style={{ fontSize: 11, marginRight: 4 }}>🔁</span>}
                        {tt(task)}
                      </div>
                      <div className="tmeta">
                        {task.recurring && <span className="tag tag-recurring">{lang === "es" ? "Recurrente" : "Recurring"}</span>}
                        {task.priority === "urgent" && <span className="tag tag-urgent">⚡ {lang === "es" ? "Urgente" : "Urgent"}</span>}
                        <span className={`tag tag-${s}`}>{t[s]}</span>
                        {task.dueDate && <span className="tag" style={{ background: "rgba(255,255,255,.06)", color: "var(--silver)" }}>{task.dueDate}</span>}
                        {task.photoRequired && !photos.some(p => p.taskId === task.id) && task.status !== "done" && <span className="tag" style={{ background: "rgba(249,115,22,.15)", color: "var(--orange)", border: "1px solid rgba(249,115,22,.35)" }}>📷 {lang === "es" ? "Foto requerida" : "Photo required"}</span>}
                        {task.status !== "done" && loggedWorkToday(task.id) && <span className="tag" style={{ background: "rgba(16,185,129,.15)", color: "var(--green)", border: "1px solid rgba(16,185,129,.35)" }}>🔧 {t.loggedToday}</span>}
                      </div>
                    </div>
                    <div className="tact" style={{ gap: 5 }}>
                      {task.status !== "done" && (
                        <button title={t.workedToday} disabled={loggedWorkToday(task.id)}
                          onClick={() => workedOnTask(task)}
                          style={{ padding:"7px 9px", borderRadius:9, border:"none", cursor: loggedWorkToday(task.id) ? "default" : "pointer", fontSize:15,
                            background: loggedWorkToday(task.id) ? "rgba(16,185,129,.15)" : "rgba(255,255,255,.07)",
                            color: loggedWorkToday(task.id) ? "var(--green)" : "var(--slate)" }}>
                          {loggedWorkToday(task.id) ? "✅" : "🔧"}
                        </button>
                      )}
                      <button title={t.photoFor + " " + tt(task)}
                        onClick={() => { const closing = taskPanel?.taskId === task.id && taskPanel?.type === "photo"; setTaskPanel(closing ? null : { taskId: task.id, jobId: task.jobId, type: "photo", photoType: "before" }); if (closing) { setPendingPhoto(null); setSavedCount(0); } }}
                        style={{ padding:"7px 9px", borderRadius:9, border:"none", cursor:"pointer", fontSize:15,
                          background: tp === "photo" ? "rgba(249,115,22,.2)" : "rgba(255,255,255,.07)",
                          color: tp === "photo" ? "var(--orange)" : "var(--slate)" }}>📷</button>
                      <button title={t.receiptFor + " " + tt(task)}
                        onClick={() => { setTaskPanel(p => p?.taskId === task.id && p.type === "receipt" ? null : { taskId: task.id, jobId: task.jobId, type: "receipt" }); setTaskRcForm({ store:"",amount:"",note:"",paidBy:"crew",dataUrl:null }); }}
                        style={{ padding:"7px 9px", borderRadius:9, border:"none", cursor:"pointer", fontSize:15,
                          background: tp === "receipt" ? "rgba(245,158,11,.2)" : "rgba(255,255,255,.07)",
                          color: tp === "receipt" ? "var(--accent)" : "var(--slate)" }}>🧾</button>
                      <button className="btn btn-s btn-sm btn-ic" title={t.materials} onClick={() => setMatModal(task.id)}><Icon n="tools" s={14} /></button>
                    </div>
                  </div>

                  {/* ── Task photo panel ── */}
                  {tp === "photo" && (
                    <div style={{ padding:"14px 16px", background:"rgba(8,15,22,.92)", borderBottom:"1px solid rgba(255,255,255,.06)" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                        <div style={{ fontSize:12, color:"var(--orange)", fontWeight:700 }}>
                          📷 {t.photoFor} <span style={{ color:"var(--white)" }}>{tt(task)}</span>
                        </div>
                        <button onClick={() => { setTaskPanel(null); setPendingPhoto(null); setSavedCount(0); }}
                          style={{ background:"none", border:"none", color:"var(--slate)", cursor:"pointer", fontSize:18 }}>✕</button>
                      </div>

                      {/* Saved count badge */}
                      {savedCount > 0 && (
                        <div style={{ marginBottom:8, padding:"4px 10px", background:"rgba(16,185,129,.15)", borderRadius:8, fontSize:12, color:"var(--green)", fontWeight:600 }}>
                          ✓ {savedCount} {lang==="es"?"foto(s) guardada(s)":"photo(s) saved"} — {lang==="es"?"agrega más o cierra":"add more or close"}
                        </div>
                      )}

                      {/* STEP 1: no pending photo — show type picker + camera/library buttons */}
                      {!pendingPhoto && (
                        <>
                          <div style={{ display:"flex", gap:6, marginBottom:12 }}>
                            {TPTYPES.map(pt => (
                              <button key={pt.k} onClick={() => setTaskPanel(p => ({ ...p, photoType: pt.k }))}
                                style={{ flex:1, padding:"7px 8px", borderRadius:8, border:`1px solid ${taskPanel?.photoType===pt.k?pt.c:"rgba(255,255,255,.1)"}`,
                                  background: taskPanel?.photoType===pt.k?`rgba(${pt.k==="before"?"249,115,22":pt.k==="after"?"16,185,129":"239,68,68"},.18)`:"rgba(255,255,255,.05)",
                                  color: taskPanel?.photoType===pt.k?pt.c:"var(--silver)", fontSize:12, fontWeight:700, cursor:"pointer", textAlign:"center" }}>
                                {pt.l}
                              </button>
                            ))}
                          </div>
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                            <button className="btn btn-p" style={{ justifyContent:"center", padding:"14px 10px", fontSize:15 }}
                              disabled={taskPhotoBusy}
                              onClick={() => taskPhotoCamRef.current?.click()}>
                              {taskPhotoBusy ? <span className="spin"/> : <><Icon n="camera" s={18}/><br/><span style={{ fontSize:11, marginTop:4, display:"block" }}>{t.takePhoto}<br/>{lang==="es"?"(Abrir Cámara)":"(Open Camera)"}</span></>}
                            </button>
                            <button className="btn btn-s" style={{ justifyContent:"center", padding:"14px 10px", fontSize:15 }}
                              disabled={taskPhotoBusy}
                              onClick={() => openGallery(captureTaskPhoto)}>
                              <Icon n="photo" s={18}/><br/><span style={{ fontSize:11, marginTop:4, display:"block" }}>{t.library}<br/>{lang==="es"?"(Elegir Archivo)":"(Choose File)"}</span>
                            </button>
                          </div>
                        </>
                      )}

                      {/* STEP 2: photo captured — show preview + description input */}
                      {pendingPhoto && (
                        <>
                          <div style={{ display:"flex", gap:12, marginBottom:12, alignItems:"flex-start" }}>
                            <img src={pendingPhoto.dataUrl} alt="preview"
                              style={{ width:90, height:90, objectFit:"cover", borderRadius:10, border:"2px solid var(--orange)", flexShrink:0 }} />
                            <div style={{ flex:1 }}>
                              <label className="fl" style={{ marginBottom:4 }}>{lang==="es"?"¿Qué muestra esta foto?":"What does this photo show?"}</label>
                              <textarea className="fi" rows={3}
                                value={photoNote} onChange={e => setPhotoNote(e.target.value)}
                                placeholder={lang==="es"?"ej. Grieta en la pared norte, progreso del techo...":"e.g. Crack on north wall, roof progress..."}
                                style={{ padding:"8px 12px", resize:"none" }}
                                autoFocus />
                            </div>
                          </div>
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                            <button className="btn btn-p" disabled={taskPhotoBusy} onClick={() => saveTaskPhoto(false)}
                              style={{ justifyContent:"center", fontSize:13 }}>
                              {taskPhotoBusy ? <span className="spin"/> : <>{lang==="es"?"💾 Guardar + Otra Foto":"💾 Save + Take Another"}</>}
                            </button>
                            <button className="btn btn-g" disabled={taskPhotoBusy} onClick={() => saveTaskPhoto(true)}
                              style={{ justifyContent:"center", fontSize:13 }}>
                              {taskPhotoBusy ? <span className="spin"/> : <>{lang==="es"?"✓ Guardar y Listo":"✓ Save & Done"}</>}
                            </button>
                          </div>
                          <button onClick={() => { setPendingPhoto(null); setPhotoNote(""); }}
                            style={{ marginTop:8, background:"none", border:"none", color:"var(--slate)", cursor:"pointer", fontSize:12, textDecoration:"underline" }}>
                            {lang==="es"?"✕ Descartar foto":"✕ Discard this photo"}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* ── Task photo thumbnails ── */}
                  {(() => {
                    const taskPhotos = photos.filter(p => p.taskId === task.id);
                    if (!taskPhotos.length) return null;
                    return (
                      <div style={{ display:"flex", gap:10, flexWrap:"wrap", padding:"10px 14px", background:"rgba(0,0,0,.18)", borderBottom:"1px solid rgba(255,255,255,.04)" }}>
                        {taskPhotos.map((p, i) => (
                          <div key={i} style={{ display:"flex", flexDirection:"column", width:64, flexShrink:0 }}>
                            <div style={{ position:"relative", width:64, height:64, borderRadius:8, overflow:"hidden",
                              border:`2px solid ${p.type==="before"?"var(--orange)":p.type==="after"?"var(--green)":"var(--red)"}` }}>
                              <div onClick={() => setCrewLightbox(p)} style={{ width:"100%", height:"100%", cursor:"zoom-in" }}>
                                {p.dataUrl
                                  ? <img src={p.dataUrl} alt={p.type} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                                  : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center" }}><Icon n="camera" s={20} c="var(--slate)" /></div>}
                              </div>
                              <div style={{ position:"absolute", bottom:0, left:0, right:0, background:"rgba(0,0,0,.65)", fontSize:8, textAlign:"center", color:"#fff", padding:"1px 0", fontWeight:700, textTransform:"uppercase" }}>
                                {p.type}
                              </div>
                              <button onClick={() => removePhoto(p)}
                                style={{ position:"absolute",top:2,right:2,background:"rgba(239,68,68,.9)",border:"none",borderRadius:3,color:"#fff",cursor:"pointer",fontSize:9,padding:"1px 3px",lineHeight:1,zIndex:2 }}>✕</button>
                            </div>
                            {p.note && <div style={{ fontSize:9, color:"var(--silver)", marginTop:3, lineHeight:1.3, wordBreak:"break-word", maxHeight:28, overflow:"hidden" }}>{p.note}</div>}
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* ── Task receipt panel ── */}
                  {tp === "receipt" && (
                    <div style={{ padding:"12px 16px", background:"rgba(8,15,22,.9)", borderBottom:"1px solid rgba(255,255,255,.06)" }}>
                      <div style={{ fontSize:12, color:"var(--accent)", fontWeight:700, marginBottom:8 }}>
                        🧾 {t.receiptFor} {tt(task)}
                      </div>
                      <div className="grid2" style={{ marginBottom:8 }}>
                        <div><label className="fl">{t.store}</label>
                          <input className="fi" value={taskRcForm.store} onChange={e=>setTaskRcForm(p=>({...p,store:e.target.value}))} placeholder="Home Depot" style={{ padding:"8px 12px" }} /></div>
                        <div><label className="fl">{t.amount} ($)</label>
                          <input className="fi" type="number" value={taskRcForm.amount} onChange={e=>setTaskRcForm(p=>({...p,amount:e.target.value}))} placeholder="0.00" style={{ padding:"8px 12px" }} /></div>
                      </div>
                      <div style={{ marginBottom:8 }}><label className="fl">{t.notes}</label>
                        <input className="fi" value={taskRcForm.note} onChange={e=>setTaskRcForm(p=>({...p,note:e.target.value}))} placeholder={t.whatBought} style={{ padding:"8px 12px" }} /></div>
                      <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap", alignItems:"center" }}>
                        <button className={`btn btn-sm ${taskRcForm.paidBy==="crew"?"btn-a":"btn-s"}`} onClick={()=>setTaskRcForm(p=>({...p,paidBy:"crew"}))}>{t.iPaid}</button>
                        <button className={`btn btn-sm ${taskRcForm.paidBy==="company"?"btn-p":"btn-s"}`} onClick={()=>setTaskRcForm(p=>({...p,paidBy:"company"}))}>{t.companyPaid}</button>
                        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
                          {taskRcForm.dataUrl && <img src={taskRcForm.dataUrl} alt="rcpt" style={{ width:36,height:36,objectFit:"cover",borderRadius:6,border:"2px solid var(--green)" }}/>}
                          <button className="btn btn-s btn-sm" onClick={()=>{taskRcPhotoRef.current?.setAttribute("capture","environment");taskRcPhotoRef.current?.click();}}>
                            <Icon n="camera" s={13}/> {taskRcForm.dataUrl?t.retake:t.photo}
                          </button>
                        </div>
                      </div>
                      {taskRcForm.paidBy==="crew" && <p style={{ fontSize:11,color:"var(--orange)",marginBottom:8 }}>⚠ {t.flaggedReimb}</p>}
                      <div style={{ display:"flex", gap:8 }}>
                        <button className="btn btn-p" style={{ flex:1 }}
                          disabled={!taskRcForm.store||!taskRcForm.amount||taskRcBusy}
                          onClick={submitTaskReceipt}>
                          {taskRcBusy?<span className="spin"/>:<><Icon n="check" s={15}/> {t.submitReceipt}</>}
                        </button>
                        <button onClick={()=>setTaskPanel(null)}
                          style={{ background:"none",border:"none",color:"var(--slate)",cursor:"pointer",fontSize:18,padding:"0 8px" }}>✕</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}</div>

          </div>;
        })}

      {/* ── Job photo description modal ── */}
      {pendingJobPhoto && (
        <div className="modal-bg">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="mt">📷 {lang === "es" ? "¿Qué muestra esta foto?" : "Describe this photo"}</div>
            <div style={{ display:"flex", gap:12, marginBottom:16, alignItems:"flex-start" }}>
              <img src={pendingJobPhoto.dataUrl} alt="preview"
                style={{ width:90, height:90, objectFit:"cover", borderRadius:10, flexShrink:0,
                  border:`2px solid ${pendingJobPhoto.type==="before"?"var(--orange)":pendingJobPhoto.type==="after"?"var(--green)":"var(--red)"}` }} />
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12, color:"var(--silver)", marginBottom:8 }}>
                  {lang==="es"?"Agrega una descripción para que todos entiendan esta foto.":"Add a description so everyone understands what this photo shows."}
                </div>
                <textarea className="fi" rows={4} autoFocus
                  value={jobPhotoNote} onChange={e => setJobPhotoNote(e.target.value)}
                  placeholder={lang==="es"
                    ? "ej. Grieta en la pared norte, nivel de progreso, material dañado..."
                    : "e.g. Crack on north wall, progress level, damaged material..."} />
              </div>
            </div>
            <div className="macts">
              <button className="btn btn-s" onClick={() => saveJobPhoto("")}>
                {lang==="es"?"Guardar sin descripción":"Save without description"}
              </button>
              <button className="btn btn-p" disabled={photoBusy} onClick={() => saveJobPhoto(jobPhotoNote)}>
                {photoBusy ? <span className="spin"/> : <><Icon n="check" s={14}/> {lang==="es"?"Guardar foto":"Save Photo"}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Photo lightbox ── */}
      {crewLightbox && (
        <div className="modal-bg" onClick={() => setCrewLightbox(null)}>
          <div style={{ maxWidth:"95vw", textAlign:"center" }} onClick={e => e.stopPropagation()}>
            <img src={crewLightbox.dataUrl} alt={crewLightbox.type}
              style={{ maxWidth:"100%", maxHeight:"72vh", borderRadius:12, objectFit:"contain",
                border:`3px solid ${crewLightbox.type==="before"?"var(--orange)":crewLightbox.type==="after"?"var(--green)":"var(--red)"}` }} />
            {crewLightbox.note && (
              <div style={{ marginTop:10, padding:"8px 16px", background:"rgba(0,0,0,.6)", borderRadius:8, color:"var(--white)", fontSize:14, maxWidth:400, margin:"10px auto 0" }}>
                {crewLightbox.note}
              </div>
            )}
            <div style={{ marginTop:12, display:"flex", gap:10, justifyContent:"center" }}>
              <span style={{ padding:"3px 12px", borderRadius:20, fontSize:11, fontWeight:700, textTransform:"uppercase",
                background: crewLightbox.type==="before"?"rgba(249,115,22,.25)":crewLightbox.type==="after"?"rgba(16,185,129,.25)":"rgba(239,68,68,.25)",
                color: crewLightbox.type==="before"?"var(--orange)":crewLightbox.type==="after"?"var(--green)":"var(--red)" }}>
                {crewLightbox.type}
              </span>
              <button className="btn btn-s btn-sm" onClick={() => setCrewLightbox(null)}>{t.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {checkoutGate && (
        <LogoutTaskGate tasks={checkoutGate.tasks} jobs={jobs} lang={lang} t={t}
          onComplete={gateComplete} onWorkedOn={gateWorkedOn}
          onDone={() => { const j = checkoutGate.job; setCheckoutGate(null); checkOut(j); }} />
      )}

      {matModal && <div className="modal-bg" onClick={e => e.target === e.currentTarget && setMatModal(null)}>
        <div className="modal"><div className="mt">{t.materials}</div>
          <div className="fg"><label className="fl">{t.whatNeed}</label>
            <textarea className="fi" value={mat} onChange={e => setMat(e.target.value)} placeholder={lang === "es" ? "ej. madera 2x4, tornillos..." : "e.g. 2x4 lumber, screws..."} /></div>
          <div className="macts"><button className="btn btn-s" onClick={() => setMatModal(null)}>{t.cancel}</button>
            <button className="btn btn-a" onClick={() => submitMat(matModal)}><Icon n="tools" s={14} /> {t.submit}</button></div></div></div>}

      {/* ── My material requests ── */}
      {(() => {
        const myMats = (mats || []).filter(m => m.crewId === user.id);
        if (!myMats.length) return null;
        return (
          <div className="card" style={{ marginTop: 20, border: "1px solid rgba(245,158,11,.25)" }}>
            <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 14, letterSpacing: 1, color: "var(--accent)", marginBottom: 10 }}>
              🔧 {lang === "es" ? "Mis solicitudes de materiales" : "My Material Requests"}
            </div>
            {myMats.map(m => {
              const job = jobs.find(j => j.id === m.jobId);
              const task = tasks.find(tk => tk.id === m.taskId);
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 18 }}>{m.fulfilled ? "✅" : "⏳"}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: m.fulfilled ? "var(--green)" : "var(--white)" }}>{m.en}</div>
                    <div style={{ fontSize: 11, color: "var(--slate)" }}>{job?.name}{task ? ` — ${task.title}` : ""}</div>
                  </div>
                  <span className={`tag tag-${m.fulfilled ? "done" : "pending"}`} style={{ fontSize: 10 }}>
                    {m.fulfilled ? (lang === "es" ? "Cumplido" : "Fulfilled") : (lang === "es" ? "Pendiente" : "Pending")}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}


function CrewPhotos(props) {
  const { user, tasks, jobs, photos, setPhotos, t } = props;
  const my = tasks.filter(tk => Array.isArray(tk.assignedTo) ? tk.assignedTo.includes(user.id) : tk.assignedTo === user.id);
  const [task, setTask] = useState(""); const [type, setType] = useState("before"); const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const camRef  = useRef();
  const TYPES = [
    { k: "before",  l: t.before,  c: "var(--orange)" },
    { k: "after",   l: t.after,   c: "var(--green)"  },
    { k: "concern", l: t.concern, c: "var(--red)"    },
  ];
  const typeLabel = k => TYPES.find(x => x.k === k)?.l || k;
  const typeColor = k => ({ before:"var(--orange)", after:"var(--green)", concern:"var(--red)", progress:"var(--sky2)" })[k] || "var(--sky2)";
  const removePhoto = async (photo) => {
    setPhotos(p => p.filter(x => x.id !== photo.id));
    try { await sbDelete("field_photos", photo.id); } catch {}
    if (photo.storagePath) { try { await deleteFromStorage(photo.storagePath); } catch {} }
  };
  const upload = async e => {
    const file = e.target.files[0]; if (!file || !task) return;
    setBusy(true);
    let compressed;
    try { compressed = await compressImage(file); }
    catch { setBusy(false); alert("Could not process image. Try again."); return; }
    const { dataUrl, sizeKB } = compressed;
    const tk = tasks.find(x => x.id === task);
    const id = "p" + Date.now();
    const dbType = type === "concern" ? "progress" : type;
    let storagePath = null;
    try { storagePath = await uploadToStorage(dataUrl, `${user.id}/${id}.jpg`); } catch {}
    const photo = { id, dataUrl, type, taskId: task, jobId: tk?.jobId, crewId: user.id, sizeKB, date: new Date().toISOString() };
    setPhotos(p => [...p, photo]);
    const row = { id, data_url: storagePath ? null : dataUrl, storage_path: storagePath, photo_type: dbType, task_id: task, job_id: tk?.jobId, crew_id: user.id, size_kb: sizeKB };
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
        <input ref={camRef}  type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={upload} />
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={upload} />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-p" disabled={!task || busy}
            onClick={() => camRef.current?.click()}>
            {busy ? <span className="spin" /> : <><Icon n="camera" s={16} /> {t.takePhoto}</>}
          </button>
          <button className="btn btn-s" disabled={!task || busy}
            onClick={() => openGallery(upload)}>
            <Icon n="photo" s={16} /> {t.library}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>{t.photoNote}</p>
      </div>
      {[...new Set(photos.filter(p => p.crewId === user.id).map(p => p.taskId))].map(tid => {
        const tk = tasks.find(x => x.id === tid), j = jobs.find(j => j.id === tk?.jobId), tp = photos.filter(p => p.taskId === tid && p.crewId === user.id);
        return <div key={tid} className="card"><div className="ct" style={{ fontSize: 15 }}>{j?.name} — {tk?.title}</div>
          <div className="pgrid">{tp.map((p, i) => <div key={i} className="pthumb" style={{ position:"relative" }}>
            {p.dataUrl ? <img src={p.dataUrl} alt={p.type} /> : <Icon n="camera" s={28} c="var(--slate)" />}
            <div className="plabel" style={{ color: typeColor(p.type) }}>{typeLabel(p.type)} · {p.sizeKB}kb</div>
            <button onClick={() => removePhoto(p)}
              style={{ position:"absolute",top:3,right:3,background:"rgba(239,68,68,.85)",border:"none",borderRadius:4,color:"#fff",cursor:"pointer",fontSize:10,padding:"2px 4px",lineHeight:1,zIndex:2 }}>✕</button>
          </div>)}</div></div>;
      })}
    </div>
  );
}

function ReceiptShortcutBanner({ lang }) {
  const [open, setOpen] = useState(false);
  const installed = isInStandalone();
  const ios = isIOS();
  const url = window.location.origin + "/?tab=rec";
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  const es = lang === "es";
  if (installed) return null;
  return (
    <>
      <button onClick={() => setOpen(true)}
        style={{ display:"flex", alignItems:"center", gap:8, width:"100%", padding:"10px 14px", background:"rgba(59,130,246,.1)", border:"1px solid rgba(59,130,246,.25)", borderRadius:10, color:"var(--sky2)", fontSize:13, fontWeight:700, cursor:"pointer", marginBottom:14 }}>
        <span style={{ fontSize:18 }}>📲</span>
        {es ? "Agregar acceso rápido a Recibos en tu pantalla" : "Add Receipt shortcut to your home screen"}
        <span style={{ marginLeft:"auto", fontSize:16 }}>›</span>
      </button>
      {open && (
        <div style={{ position:"fixed", inset:0, zIndex:600, background:"rgba(0,0,0,.7)", display:"flex", alignItems:"flex-end" }} onClick={() => setOpen(false)}>
          <div style={{ background:"var(--navy)", borderRadius:"18px 18px 0 0", padding:24, width:"100%", maxWidth:480, margin:"0 auto", boxSizing:"border-box" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily:"'Barlow Condensed'", fontSize:20, fontWeight:800, color:"var(--sky2)", marginBottom:16 }}>
              {es ? "📲 Acceso rápido a Recibos" : "📲 Receipt Home Screen Shortcut"}
            </div>
            {ios ? (<>
              <div style={{ fontSize:13, color:"var(--silver)", marginBottom:12 }}>
                {es ? "Abre este enlace en Safari y añádelo a tu pantalla de inicio:" : "Open this link in Safari and add it to your home screen:"}
              </div>
              <div style={{ background:"rgba(255,255,255,.06)", borderRadius:8, padding:"10px 12px", fontSize:12, fontFamily:"monospace", color:"var(--white)", marginBottom:12, wordBreak:"break-all" }}>{url}</div>
              <button onClick={copy} className="btn btn-p" style={{ width:"100%", justifyContent:"center", marginBottom:12 }}>
                {copied ? (es ? "✓ Copiado" : "✓ Copied!") : (es ? "Copiar enlace" : "Copy Link")}
              </button>
              <div style={{ fontSize:12, color:"var(--slate)", lineHeight:1.6 }}>
                {es
                  ? "1. Pega el enlace en Safari\n2. Toca Compartir (⬆)\n3. Toca «Agregar a pantalla de inicio»\n4. Nómbralo «Recibos GSM» y toca Agregar"
                  : "1. Paste the link in Safari\n2. Tap Share (⬆)\n3. Tap \"Add to Home Screen\"\n4. Name it \"GSM Receipts\" and tap Add"}
                  .split("\n").map((l,i) => <div key={i}>{l}</div>)
                </div>
            </>) : (<>
              <div style={{ fontSize:13, color:"var(--silver)", marginBottom:12 }}>
                {es ? "En Chrome, abre el menú y agrega a pantalla de inicio:" : "In Chrome, open the menu and add to home screen:"}
              </div>
              <div style={{ fontSize:12, color:"var(--slate)", lineHeight:1.8, marginBottom:12 }}>
                {(es
                  ? ["1. Toca el menú de 3 puntos (⋮) en Chrome","2. Toca «Agregar a pantalla de inicio»","3. Nómbralo «Recibos GSM» y toca Agregar","4. Aparecerá un ícono de Recibos en tu pantalla"]
                  : ["1. Tap the 3-dot menu (⋮) in Chrome","2. Tap \"Add to Home Screen\"","3. Name it \"GSM Receipts\" and tap Add","4. A Receipts icon appears on your home screen"]
                ).map((l,i) => <div key={i}>{l}</div>)}
              </div>
              <button onClick={copy} className="btn btn-p" style={{ width:"100%", justifyContent:"center", marginBottom:8 }}>
                {copied ? (es ? "✓ Copiado" : "✓ Copied!") : (es ? "Copiar enlace directo" : "Copy Direct Link")}
              </button>
            </>)}
            <button onClick={() => setOpen(false)} className="btn btn-s" style={{ width:"100%", justifyContent:"center", marginTop:8 }}>
              {es ? "Cerrar" : "Close"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function CrewReceipts(props) {
  const { user, tasks, jobs, receipts, setReceipts, t, lang } = props;
  const my = tasks.filter(t => Array.isArray(t.assignedTo) ? t.assignedTo.includes(user.id) : t.assignedTo === user.id);
  const [task, setTask] = useState(""); const [store, setStore] = useState(""); const [amount, setAmount] = useState(""); const [note, setNote] = useState(""); const [paidBy, setPaidBy] = useState("crew"); const [dataUrl, setDataUrl] = useState(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [dest, setDest] = useState("task"); // "task" | "office" | "auto" | "tools"
  const es = lang === "es";
  const fileRef = useRef();
  const camRef  = useRef();
  const capturePhoto = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { const { dataUrl: url } = await compressImage(file, 1000, 0.6); setDataUrl(url); }
    catch { alert("Could not process image. Try again."); }
    e.target.value = "";
  };
  const submit = async () => {
    const usingTask = dest === "task";
    if ((usingTask && !task) || !store || !amount) return;
    setBusy(true);
    const tk = usingTask ? tasks.find(t => t.id === task) : null;
    const category = usingTask ? null : rcDestCategory(dest);
    const id = "r" + Date.now();
    const today = localDate();
    let storagePath = null;
    if (dataUrl) { try { storagePath = await uploadToStorage(dataUrl, `${user.id}/${id}.jpg`); } catch {} }
    const receipt = { id, dataUrl, taskId: usingTask ? task : null, jobId: tk?.jobId || null, category, crewId: user.id, store, amount, note, paidBy, reimbursementStatus: paidBy === "crew" ? "pending" : "na", createdAt: today };
    setReceipts(p => [...p, receipt]);
    const row = { id, data_url: storagePath ? null : dataUrl, storage_path: storagePath, task_id: usingTask ? task : null, job_id: tk?.jobId || null, category, crew_id: user.id, store, amount: parseFloat(amount) || 0, note, paid_by: paidBy, reimbursement_status: paidBy === "crew" ? "pending" : "na" };
    try { await sbPost("field_receipts", row); } catch { enqueue({ table: "field_receipts", payload: row }); }
    setTask(""); setStore(""); setAmount(""); setNote(""); setPaidBy("crew"); setDataUrl(null); setBusy(false); setDest("task");
    setDone(true); setTimeout(() => setDone(false), 3000);
  };
  return (
    <div><h2 className="h2" style={{ marginBottom: 14 }}>{t.receipts}</h2>
      <ReceiptShortcutBanner lang={lang} />
      {done && <div style={{ padding: "10px 14px", background: "rgba(16,185,129,.15)", border: "1px solid rgba(16,185,129,.3)", borderRadius: 10, marginBottom: 16, color: "var(--green)", fontWeight: 600 }}>✓ {t.receiptSubmitted}</div>}
      <div className="card">
        <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>{t.snapReceipt}</p>
        <div className="fg"><label className="fl">{es ? "Cobrar a" : "Charge to"}</label>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {[["task", es ? "🏗 Trabajo" : "🏗 Job Task"],["tools", es ? "🔧 Herramientas" : "🔧 Tools"],["auto", es ? "🚗 Auto" : "🚗 Auto"],["office", es ? "🏢 Oficina" : "🏢 Office"]].map(([k,label]) => (
              <button key={k} className={`btn btn-sm ${dest===k?"btn-a":"btn-s"}`} onClick={()=>setDest(k)}>{label}</button>
            ))}
          </div>
        </div>
        {dest === "task" && <div className="fg"><label className="fl">{t.task}</label>
          <select className="fi" value={task} onChange={e => setTask(e.target.value)}><option value="">{t.choose}</option>
            {my.map(tk => { const j = jobs.find(j => j.id === tk.jobId); return <option key={tk.id} value={tk.id}>{j?.name} — {tk.title}</option>; })}</select></div>}
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
          <input ref={camRef}  type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={capturePhoto} />
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={capturePhoto} />
          {dataUrl
            ? <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <img src={dataUrl} alt="receipt" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "2px solid var(--green)" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--green)" }}>✓ {t.photoReady}</span>
                  <button className="btn btn-s btn-sm" onClick={() => { setDataUrl(null); openGallery(capturePhoto); }}><Icon n="camera" s={13} /> {t.retake}</button>
                </div>
              </div>
            : <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-s btn-sm" onClick={() => camRef.current?.click()}><Icon n="camera" s={14} /> {t.takePhoto}</button>
                <button className="btn btn-s btn-sm" onClick={() => openGallery(capturePhoto)}><Icon n="photo" s={14} /> {t.library}</button>
              </div>
          }
        </div>
        <button className="btn btn-p btn-full" disabled={(dest === "task" && !task) || !store || !amount || busy} onClick={submit}>
          {busy ? <span className="spin" /> : <><Icon n="check" s={16} /> {t.submitReceipt}</>}
        </button>
        {(!task || !store || !amount) && <p style={{ fontSize: 11, color: "var(--slate)", marginTop: 8, textAlign: "center" }}>{t.requireFields}</p>}
      </div>
      {(() => {
        const mine = receipts.filter(r => r.crewId === user.id);
        const active = mine.filter(r => r.reimbursementStatus !== "paid");
        const archived = mine.filter(r => r.reimbursementStatus === "paid");
        return <>
          <h3 style={{ margin: "18px 0 8px", fontSize: 14, color: "var(--cream4)" }}>📂 {t.activeReceipts} ({active.length})</h3>
          {!active.length && <div className="muted" style={{ padding: "8px 0" }}>{t.noActiveReceipts}</div>}
          {active.map(r => <ReceiptCard key={r.id} r={r} jobs={jobs} tasks={tasks} user={user} t={t} />)}
          <button className="btn btn-s btn-sm" style={{ marginTop: 16, marginBottom: 8 }} onClick={() => setShowArchive(v => !v)}>
            {showArchive ? "📂" : "📁"} {t.archivedReceipts} ({archived.length})
          </button>
          {showArchive && <>
            {!archived.length && <div className="muted" style={{ padding: "8px 0" }}>{t.noArchivedReceipts}</div>}
            {archived.map(r => <ReceiptCard key={r.id} r={r} jobs={jobs} tasks={tasks} user={user} t={t} archived />)}
          </>}
        </>;
      })()}
    </div>
  );
}

function ReceiptCard({ r, jobs, tasks, user, t, archived }) {
        const j = jobs.find(x => x.id === r.jobId);
        const tk = tasks.find(t => t.id === r.taskId);
        const reimb = r.paidBy === "crew" ? (r.reimbursementStatus === "paid" ? "Crew — Reimbursed ✓" : "Crew — Reimbursement Pending") : "Company";
        const extras = [tk ? `Task: ${tk.title}` : "", r.note ? `Note: ${r.note}` : ""].filter(Boolean).join("  ·  ");
        const printRc = () => {
          const w = window.open("", "_blank", "width=850,height=1100");
          w.document.write(`<!DOCTYPE html><html><head><title>Receipt — ${r.store||""}</title><style>@page{size:8.5in 11in;margin:.35in}*{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;height:100%}body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;background:#fff;display:flex;flex-direction:column;height:10.3in;overflow:hidden}.hdr{display:flex;align-items:center;gap:12px;padding-bottom:8px;border-bottom:2px solid #7c3f1e;flex-shrink:0}.logo{width:44px;height:44px;object-fit:contain;border-radius:6px;flex-shrink:0}.co-name{font-size:16px;font-weight:bold;color:#4a2c1a}.co-sub{font-size:9px;color:#888;margin-top:1px}.badge{margin-left:auto;background:#4a2c1a;color:#fff;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:1.5px;padding:4px 10px;border-radius:4px;white-space:nowrap}.info{display:flex;gap:0;border:1px solid #d4b896;border-radius:6px;overflow:hidden;margin:8px 0;flex-shrink:0}.cell{flex:1;padding:7px 10px;background:#fdf8f3;border-right:1px solid #d4b896}.cell:last-child{border-right:none}.cell.wide{flex:2}.cell .lbl{font-size:7px;font-weight:bold;color:#7c3f1e;text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:2px}.cell .val{font-size:11px;font-weight:600;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.amt-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-shrink:0}.amt-box{background:#4a2c1a;color:#fff;padding:6px 18px;border-radius:6px;display:flex;align-items:baseline;gap:6px}.amt-lbl{font-size:8px;text-transform:uppercase;letter-spacing:1px;opacity:.75}.amt-val{font-size:26px;font-weight:bold;line-height:1}.extras{font-size:10px;color:#666;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.photo-wrap{flex:1;min-height:0;overflow:hidden;border-radius:6px;border:1px solid #ddd}.photo-wrap img{width:100%;height:100%;object-fit:cover;display:block}.no-photo{flex:1;display:flex;align-items:center;justify-content:center;color:#aaa;font-style:italic;font-size:13px;border:1px dashed #ddd;border-radius:6px}.foot{flex-shrink:0;margin-top:6px;font-size:7.5px;color:#bbb;text-align:center}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><div class="hdr"><img class="logo" src="https://quiet-seahorse-2ba028.netlify.app/icon-admin.png" alt="GSM"/><div><div class="co-name">G.S. MASTERS, INC.</div><div class="co-sub">255 Grande View Pkwy, Maylene AL 35114 &nbsp;&middot;&nbsp; (205) 620-1698</div></div><div class="badge">Field Receipt</div></div><div class="info"><div class="cell"><span class="lbl">Date</span><span class="val">${r.createdAt}</span></div><div class="cell wide"><span class="lbl">Job</span><span class="val">${j?.name||"—"}</span></div><div class="cell wide"><span class="lbl">Vendor</span><span class="val">${r.store||"—"}</span></div><div class="cell"><span class="lbl">Submitted By</span><span class="val">${user.name}</span></div><div class="cell"><span class="lbl">Paid By</span><span class="val">${reimb}</span></div></div><div class="amt-row"><div class="amt-box"><span class="amt-lbl">Amount</span><span class="amt-val">$${(+r.amount||0).toFixed(2)}</span></div>${extras?`<div class="extras">${extras}</div>`:""}</div>${r.dataUrl?`<div class="photo-wrap"><img src="${r.dataUrl}" alt="Receipt"/></div>`:`<div class="no-photo">No photo attached</div>`}<div class="foot">GS Masters Field App &nbsp;&middot;&nbsp; Printed ${new Date().toLocaleString()} &nbsp;&middot;&nbsp; ID: ${r.id}</div><script>window.onload=function(){window.print();window.onafterprint=function(){window.close();}}</script></body></html>`);
          w.document.close();
        };
        return <div className="card" style={{ display: "flex", gap: 14, alignItems: "center", opacity: archived ? .75 : 1 }}>
          {r.dataUrl && <img src={r.dataUrl} alt="receipt" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover" }} />}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{r.store}</div>
            <div className="muted">{j?.name} · {r.note}</div>
            {r.paidBy === "crew" && <span className={`tag ${r.reimbursementStatus === "paid" ? "tag-done" : "tag-overdue"}`} style={{ marginTop: 4, display: "inline-block" }}>{r.reimbursementStatus === "paid" ? `✓ ${t.paidByCheck}${r.reimbursementDate ? " · " + r.reimbursementDate : ""}` : t.awaitingReimb}</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--accent)" }}>${(+r.amount).toFixed(2)}</div>
            <button onClick={printRc} style={{ background:"none",border:"none",cursor:"pointer",color:"var(--sky2)",fontSize:13,padding:0 }}>🖨 Print</button>
          </div>
        </div>;
}

function CrewLog(props) {
  const { user, tasks, jobs, logs, setLogs, lang, t, settings } = props;
  const my = tasks.filter(t => Array.isArray(t.assignedTo) ? t.assignedTo.includes(user.id) : t.assignedTo === user.id);
  const [task, setTask] = useState(""); const [en, setEn] = useState(""); const [es, setEs] = useState(""); const [weather, setWeather] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const today = localDate();
  const loggedToday = logs.some(l => l.crewId === user.id && l.date === today);
  const submit = async () => {
    if (!en && !es) return; setBusy(true);
    try {
      let e = en, s = es;
      try {
        if (e && !s && settings.gtKey) s = await translateText(e, "es", settings.gtKey);
        if (s && !e && settings.gtKey) e = await translateText(s, "en", settings.gtKey);
      } catch {}
      const tk = tasks.find(t => t.id === task);
      const id = "l" + Date.now();
      const log = { id, en: e, es: s, weather, taskId: task, jobId: tk?.jobId, crewId: user.id, date: today };
      setLogs(p => [...p, log]);
      const row = { id, text_en: e, text_es: s, weather, task_id: task || null, job_id: tk?.jobId || null, crew_id: user.id, log_date: today };
      try { await sbPost("field_logs", row); } catch { enqueue({ table: "field_logs", payload: row }); }
      setEn(""); setEs(""); setWeather(""); setDone(true); setTimeout(() => setDone(false), 3000);
    } finally { setBusy(false); }
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
        const isIssue = (l.en || "").startsWith("🚩");
        return <div key={l.id} className="card"><div className="log">
          <div className="log-en" style={ isIssue ? { color: l.resolved ? "var(--green)" : "var(--red)" } : {} }>{l.en}</div>
          <div className="log-es">{l.es}</div>
          <div className="log-m">{j?.name && `${j.name} · `}{l.weather && `${l.weather} · `}{l.date}{l.resolved ? " · ✓ Resolved" : ""}</div>
          {l.adminReply && <div style={{ marginTop: 5, fontSize: 12, color: "var(--sky2)", background: "rgba(59,130,246,.08)", borderRadius: 6, padding: "4px 8px", borderLeft: "2px solid var(--sky2)" }}><span style={{ fontWeight: 700 }}>Admin:</span> {l.adminReply}</div>}
        </div></div>; })}
    </div>
  );
}
