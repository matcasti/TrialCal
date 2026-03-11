
/* ══════════════════════════════════════════════════════════════════════════
   STUDY SCHEDULER — Motor principal
   Arquitectura: IndexedDB + Vanilla JS + Notifications API + ICS + EmailJS
   ══════════════════════════════════════════════════════════════════════════ */

/* ─── CONFIG ─────────────────────────────────────────────────────────────── */
const DB_NAME = 'study_scheduler_v1';
const DB_VER  = 1;
const HOURS   = Array.from({length:24}, (_,i) => i);

/* ─── ESTADO GLOBAL ──────────────────────────────────────────────────────── */
let db;
let state = {
  view:         'week',          // day | week | month
  currentDate:  new Date(),
  selectedDate: new Date(),
  miniCalDate:  new Date(),
  calendarView: 'calendar',
  activeResource: null,
  notifSettings: {
    browser_notif: false,
    timeout_notif: true,
    emailjs_notif: false,
    ics_export:    true,
    emailjs_service:  '',
    emailjs_template: '',
    emailjs_pubkey:   ''
  },
  scheduledTimers: [],
  dragVisitId: null
};

/* ─── INDEXEDDB ───────────────────────────────────────────────────────────── */
function initDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      // subjects
      if (!d.objectStoreNames.contains('subjects')) {
        const s = d.createObjectStore('subjects', {keyPath:'subjectId'});
        s.createIndex('status','status',{unique:false});
        s.createIndex('group','group',{unique:false});
      }
      // visits
      if (!d.objectStoreNames.contains('visits')) {
        const v = d.createObjectStore('visits', {keyPath:'visitId'});
        v.createIndex('date','date',{unique:false});
        v.createIndex('subjectId','subjectId',{unique:false});
        v.createIndex('status','status',{unique:false});
        v.createIndex('resourceId','resourceId',{unique:false});
        v.createIndex('dateResource',['date','resourceId'],{unique:false});
      }
      // resources
      if (!d.objectStoreNames.contains('resources')) {
        d.createObjectStore('resources', {keyPath:'resourceId'});
      }
      // notifications_queue
      if (!d.objectStoreNames.contains('notifications_queue')) {
        const n = d.createObjectStore('notifications_queue', {keyPath:'notifId'});
        n.createIndex('status','status',{unique:false});
        n.createIndex('sendAt','sendAt',{unique:false});
      }
      // settings
      if (!d.objectStoreNames.contains('settings')) {
        d.createObjectStore('settings', {keyPath:'key'});
      }
    };
    req.onsuccess = e => { db = e.target.result; res(db); };
    req.onerror   = e => rej(e.target.error);
  });
}

function dbPut(store, obj) {
  return new Promise((res,rej) => {
    const tx = db.transaction(store,'readwrite');
    tx.objectStore(store).put(obj).onsuccess = e => res(e.target.result);
    tx.onerror = e => rej(e.target.error);
  });
}
function dbGet(store, key) {
  return new Promise((res,rej) => {
    const tx = db.transaction(store,'readonly');
    tx.objectStore(store).get(key).onsuccess = e => res(e.target.result);
    tx.onerror = e => rej(e.target.error);
  });
}
function dbDelete(store, key) {
  return new Promise((res,rej) => {
    const tx = db.transaction(store,'readwrite');
    tx.objectStore(store).delete(key).onsuccess = () => res();
    tx.onerror = e => rej(e.target.error);
  });
}
function dbGetAll(store) {
  return new Promise((res,rej) => {
    const tx = db.transaction(store,'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = e => res(e.target.result);
    tx.onerror   = e => rej(e.target.error);
  });
}
function dbGetByIndex(store, indexName, value) {
  return new Promise((res,rej) => {
    const tx = db.transaction(store,'readonly');
    const idx = tx.objectStore(store).index(indexName);
    idx.getAll(value).onsuccess = e => res(e.target.result);
    tx.onerror = e => rej(e.target.error);
  });
}

/* ─── ID GENERATORS ──────────────────────────────────────────────────────── */
function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}
function genAnonId() {
  const n = Math.floor(Math.random()*9000)+1000;
  document.getElementById('subject-anon-id').value = 'SUJ-' + n;
}
function dateKey(d) { // YYYY-MM-DD
  return d.toISOString().slice(0,10);
}
function pad2(n) { return String(n).padStart(2,'0'); }

/* ─── SEED DATA ───────────────────────────────────────────────────────────── */
async function seedDataIfEmpty() {
  const existing = await dbGetAll('resources');
  if (existing.length > 0) return;
  const resources = [
    {resourceId:'res_sala_a', name:'Sala A', type:'room', color:'#22C55E', capacity:1},
    {resourceId:'res_sala_b', name:'Sala B', type:'room', color:'#60A5FA', capacity:1},
    {resourceId:'res_inv_1',  name:'Dr. Martínez', type:'investigator', color:'#A78BFA', capacity:1},
  ];
  for (const r of resources) await dbPut('resources', r);

  const subjects = [
    {subjectId:'SUJ-1001', name:'Ana García', phone:'+56912345678', email:'ana@example.com', group:'Grupo A', status:'enrolled', notes:'Sin contraindicaciones.', createdAt: new Date().toISOString()},
    {subjectId:'SUJ-1002', name:'Luis Torres', phone:'+56923456789', email:'luis@example.com', group:'Grupo B', status:'enrolled', notes:'Alergia a penicilina.', createdAt: new Date().toISOString()},
    {subjectId:'SUJ-1003', name:'María Vega',  phone:'+56934567890', email:'maria@example.com', group:'Grupo A', status:'screening', notes:'', createdAt: new Date().toISOString()},
  ];
  for (const s of subjects) await dbPut('subjects', s);

  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), day = now.getDate();
  const visits = [
    {visitId:'vis_001', subjectId:'SUJ-1001', resourceId:'res_sala_a', date: dateKey(new Date(y,m,day)), timeStart:'09:00', duration:60, status:'confirmed', type:'baseline', investigator:'Dr. Martínez', notes:'', reminders:[48,24,3], createdAt:new Date().toISOString()},
    {visitId:'vis_002', subjectId:'SUJ-1002', resourceId:'res_sala_b', date: dateKey(new Date(y,m,day)), timeStart:'11:00', duration:90, status:'pending', type:'followup', investigator:'', notes:'', reminders:[24,3], createdAt:new Date().toISOString()},
    {visitId:'vis_003', subjectId:'SUJ-1003', resourceId:'res_sala_a', date: dateKey(new Date(y,m,day+2)), timeStart:'10:00', duration:60, status:'pending', type:'screening', investigator:'Dr. Martínez', notes:'Primera visita.', reminders:[48,24,3], createdAt:new Date().toISOString()},
  ];
  for (const v of visits) await dbPut('visits', v);
}

/* ─── SETTINGS ────────────────────────────────────────────────────────────── */
async function loadSettings() {
  const s = await dbGet('settings','notif');
  if (s) Object.assign(state.notifSettings, s.value);
  updateToggleUI();
}
async function saveSetting(key, value) {
  state.notifSettings[key] = value;
  await dbPut('settings', {key:'notif', value: state.notifSettings});
}

function updateToggleUI() {
  const ns = state.notifSettings;
  setToggle('toggle-browser', ns.browser_notif);
  setToggle('toggle-timeout', ns.timeout_notif);
  setToggle('toggle-emailjs', ns.emailjs_notif);
  setToggle('toggle-ics',     ns.ics_export);
  document.getElementById('emailjs-config').style.display = ns.emailjs_notif ? '' : 'none';
  if (ns.emailjs_service)  document.getElementById('emailjs-service').value  = ns.emailjs_service;
  if (ns.emailjs_template) document.getElementById('emailjs-template').value = ns.emailjs_template;
  if (ns.emailjs_pubkey)   document.getElementById('emailjs-pubkey').value   = ns.emailjs_pubkey;
  updateFooterNotif();
}
function setToggle(id, on) {
  const el = document.getElementById(id);
  if (el) { el.classList.toggle('on', on); }
}
async function toggleSetting(key) {
  const newVal = !state.notifSettings[key];
  await saveSetting(key, newVal);
  updateToggleUI();
  if (key === 'browser_notif' && newVal) requestNotifPermission();
}

/* ─── NOTIFICATIONS ────────────────────────────────────────────────────────── */
function updateFooterNotif() {
  const el = document.getElementById('footer-notif-status');
  if (!el) return;
  const hasAny = state.notifSettings.browser_notif || state.notifSettings.timeout_notif || state.notifSettings.emailjs_notif;
  const dot = el.querySelector('.footer-dot');
  dot.style.background = hasAny ? 'var(--green)' : 'var(--txt-3)';
  el.querySelector('.footer-dot').nextSibling.textContent = ' Notif: ' + (
    hasAny ? [
      state.notifSettings.browser_notif ? 'Browser' : '',
      state.notifSettings.timeout_notif ? 'Timer' : '',
      state.notifSettings.emailjs_notif ? 'Email' : '',
    ].filter(Boolean).join('+') : 'Off'
  );
}

function requestNotifPermission() {
  if (!('Notification' in window)) {
    showToast('warn','Sin soporte','El navegador no soporta Notifications API.');
    return;
  }
  Notification.requestPermission().then(perm => {
    const el = document.getElementById('notif-permission-status');
    if (perm === 'granted') {
      el.textContent = '✓ Permiso concedido. Las notificaciones funcionarán mientras la pestaña esté abierta.';
      el.style.color = 'var(--green)';
      saveSetting('browser_notif', true);
      updateToggleUI();
      showToast('success','Permiso concedido','Las notificaciones del navegador están activas.');
    } else {
      el.textContent = '✗ Permiso denegado. Usa export ICS o EmailJS como fallback.';
      el.style.color = 'var(--red)';
    }
  });
}

function scheduleReminders(visit, subject) {
  if (!state.notifSettings.timeout_notif && !state.notifSettings.browser_notif) return;
  const [h,min] = visit.timeStart.split(':').map(Number);
  const visitDt = new Date(visit.date + 'T' + visit.timeStart + ':00');
  const offsets = visit.reminders || [48,24,3];
  for (const hrs of offsets) {
    const triggerAt = new Date(visitDt.getTime() - hrs*3600*1000);
    const ms = triggerAt - Date.now();
    if (ms <= 0) continue;
    const tid = setTimeout(() => fireReminder(visit, subject, hrs), ms);
    state.scheduledTimers.push(tid);
  }
}
function cancelAllTimers() {
  state.scheduledTimers.forEach(clearTimeout);
  state.scheduledTimers = [];
}
function fireReminder(visit, subject, hoursAhead) {
  const msg = buildTemplate(hoursAhead, visit, subject);
  if (state.notifSettings.browser_notif && Notification.permission === 'granted') {
    new Notification('Recordatorio de Visita — ' + hoursAhead + 'h', {
      body: msg.plain,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23F0A500"/></svg>'
    });
  }
  showToast('info','Recordatorio ' + hoursAhead + 'h', subject.name || subject.subjectId + ' — ' + visit.date + ' ' + visit.timeStart);
  if (state.notifSettings.emailjs_notif) sendEmailReminder(visit, subject, msg, hoursAhead);
}

async function reprogramAllReminders() {
  cancelAllTimers();
  const visits = await dbGetAll('visits');
  const now = new Date();
  for (const v of visits) {
    if (v.status === 'cancelled') continue;
    const visitDt = new Date(v.date + 'T' + v.timeStart + ':00');
    if (visitDt < now) continue;
    const subject = await dbGet('subjects', v.subjectId);
    if (subject) scheduleReminders(v, subject);
  }
}

/* ─── EMAIL (EmailJS) ─────────────────────────────────────────────────────── */
function buildTemplate(hoursAhead, visit, subject) {
  const vars = {
    subjectId: subject.subjectId,
    name:      subject.name || subject.subjectId,
    time:      visit.date + ' ' + visit.timeStart,
    place:     visit.resourceId,
    duration:  visit.duration + ' min',
    contact:   subject.phone || subject.email || '—'
  };
  const plain = `Recordatorio ${hoursAhead}h — Visita de Investigación
Sujeto: ${vars.name} (${vars.subjectId})
Fecha/Hora: ${vars.time}
Lugar: ${vars.place}
Duración: ${vars.duration}
Contacto: ${vars.contact}

Por favor confirme su asistencia respondiendo a este mensaje.`;

  const html = `<div style="font-family:Arial,sans-serif;max-width:500px">
<div style="background:#0a0a0b;padding:16px 20px;border-bottom:3px solid #F0A500">
  <span style="color:#F0A500;font-weight:900;font-size:18px;letter-spacing:2px">STUDY SCHED</span>
</div>
<div style="padding:20px;background:#111">
  <p style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px">Recordatorio ${hoursAhead} horas antes</p>
  <h2 style="color:#E6E8F0;margin:8px 0">Visita Programada</h2>
  <table style="width:100%;margin-top:16px">
    <tr><td style="color:#888;font-size:11px;padding:6px 0">SUJETO</td><td style="color:#E6E8F0">${vars.name} <span style="color:#F0A500">(${vars.subjectId})</span></td></tr>
    <tr><td style="color:#888;font-size:11px;padding:6px 0">FECHA/HORA</td><td style="color:#E6E8F0">${vars.time}</td></tr>
    <tr><td style="color:#888;font-size:11px;padding:6px 0">LUGAR</td><td style="color:#E6E8F0">${vars.place}</td></tr>
    <tr><td style="color:#888;font-size:11px;padding:6px 0">DURACIÓN</td><td style="color:#E6E8F0">${vars.duration}</td></tr>
  </table>
  <p style="color:#9294A4;font-size:11px;margin-top:16px">Por favor confirme su asistencia. Contacto: ${vars.contact}</p>
</div></div>`;
  return {plain, html, vars};
}

function saveEmailJSConfig() {
  saveSetting('emailjs_service',  document.getElementById('emailjs-service').value);
  saveSetting('emailjs_template', document.getElementById('emailjs-template').value);
  saveSetting('emailjs_pubkey',   document.getElementById('emailjs-pubkey').value);
  showToast('success','EmailJS','Configuración guardada correctamente.');
}

async function sendEmailReminder(visit, subject, msg, hoursAhead) {
  const {emailjs_service: svc, emailjs_template: tpl, emailjs_pubkey: key} = state.notifSettings;
  if (!svc || !tpl || !key || !subject.email) {
    await queueNotif(visit.visitId, hoursAhead, 'failed', 'Config EmailJS incompleta o sin email.');
    return;
  }
  const notifId = genId('ntf');
  await queueNotif(visit.visitId, hoursAhead, 'retrying', '');
  try {
    if (typeof emailjs === 'undefined') {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
      document.head.appendChild(s);
      await new Promise(r => s.onload = r);
    }
    emailjs.init(key);
    await emailjs.send(svc, tpl, {
      to_email:   subject.email,
      subject_id: msg.vars.subjectId,
      visit_time: msg.vars.time,
      place:      msg.vars.place,
      duration:   msg.vars.duration,
      contact:    msg.vars.contact,
      message:    msg.plain
    });
    await queueNotif(visit.visitId, hoursAhead, 'sent', '');
    showToast('success','Email enviado','Recordatorio enviado a ' + subject.email);
  } catch(err) {
    await queueNotif(visit.visitId, hoursAhead, 'failed', err.message);
    showToast('error','Error email',err.message);
  }
}

async function queueNotif(visitId, hoursAhead, status, error) {
  const existing = await dbGetAll('notifications_queue');
  const match = existing.find(n => n.visitId === visitId && n.hoursAhead === hoursAhead);
  const obj = match || {notifId: genId('ntf'), visitId, hoursAhead, createdAt: new Date().toISOString()};
  obj.status = status;
  obj.error  = error;
  obj.updatedAt = new Date().toISOString();
  await dbPut('notifications_queue', obj);
}

/* ─── ICS GENERATOR ──────────────────────────────────────────────────────── */
function toICSDate(dateStr, timeStr) {
  const dt = new Date(dateStr + 'T' + timeStr + ':00');
  return dt.toISOString().replace(/[-:]/g,'').replace('.000','');
}
function generateICS(visit, subject, resourceName) {
  const dtstart = toICSDate(visit.date, visit.timeStart);
  const endDt = new Date(visit.date + 'T' + visit.timeStart + ':00');
  endDt.setMinutes(endDt.getMinutes() + visit.duration);
  const dtend = endDt.toISOString().replace(/[-:]/g,'').replace('.000','');
  const alarms = (visit.reminders||[48,24,3]).map(h =>
`BEGIN:VALARM
TRIGGER:-PT${h*60}M
ACTION:DISPLAY
DESCRIPTION:Recordatorio ${h}h — Visita ${subject.subjectId}
END:VALARM`).join('\n');
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//StudySched//v1//ES
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:${visit.visitId}@studysched
SUMMARY:Visita ${visit.type||''} — ${subject.subjectId}
DTSTART:${dtstart}
DTEND:${dtend}
LOCATION:${resourceName||visit.resourceId}
DESCRIPTION:Sujeto: ${subject.name||subject.subjectId}\\nInvestigador: ${visit.investigator||'—'}\\nNotas: ${visit.notes||''}
STATUS:${visit.status==='confirmed'?'CONFIRMED':'TENTATIVE'}
${alarms}
END:VEVENT
END:VCALENDAR`;
}
function downloadICS(icsStr, filename) {
  const blob = new Blob([icsStr], {type:'text/calendar'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function exportVisitICS(visitId) {
  const visit   = await dbGet('visits', visitId);
  const subject = await dbGet('subjects', visit.subjectId);
  const res     = await dbGet('resources', visit.resourceId);
  const ics = generateICS(visit, subject, res ? res.name : visit.resourceId);
  downloadICS(ics, 'visita_' + visitId + '.ics');
  showToast('success','ICS generado','Archivo .ics descargado. Ábrelo en tu calendario.');
}
async function exportAllICS() {
  closeExportMenu();
  const visits = await dbGetAll('visits');
  const subjects = await dbGetAll('subjects');
  const resources = await dbGetAll('resources');
  const subMap = Object.fromEntries(subjects.map(s=>[s.subjectId,s]));
  const resMap = Object.fromEntries(resources.map(r=>[r.resourceId,r]));
  let full = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//StudySched//v1//ES\nCALSCALE:GREGORIAN\n';
  for (const v of visits) {
    const s = subMap[v.subjectId];
    const r = resMap[v.resourceId];
    if (!s) continue;
    const single = generateICS(v, s, r ? r.name : v.resourceId);
    full += single.replace('BEGIN:VCALENDAR\n','').replace('VERSION:2.0\n','')
                  .replace('PRODID:-//StudySched//v1//ES\n','')
                  .replace('CALSCALE:GREGORIAN\n','')
                  .replace('\nEND:VCALENDAR','');
  }
  full += '\nEND:VCALENDAR';
  downloadICS(full, 'study_schedule_all.ics');
}

/* ─── CSV EXPORT / IMPORT ─────────────────────────────────────────────────── */
async function exportCSV() {
  closeExportMenu();
  const visits   = await dbGetAll('visits');
  const subjects = await dbGetAll('subjects');
  const resources= await dbGetAll('resources');
  const subMap = Object.fromEntries(subjects.map(s=>[s.subjectId,s]));
  const resMap = Object.fromEntries(resources.map(r=>[r.resourceId,r]));
  const header = ['visitId','subjectId','subjectName','resourceId','resourceName','date','timeStart','duration','status','type','investigator','notes'];
  const rows = visits.map(v => {
    const s = subMap[v.subjectId]||{};
    const r = resMap[v.resourceId]||{};
    return [v.visitId, v.subjectId, s.name||'', v.resourceId, r.name||'', v.date, v.timeStart, v.duration, v.status, v.type||'', v.investigator||'', (v.notes||'').replace(/\n/g,' ')];
  });
  const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'visitas_' + dateKey(new Date()) + '.csv';
  a.click();
}
async function exportSubjectsCSV() {
  closeExportMenu();
  const subjects = await dbGetAll('subjects');
  const header = ['subjectId','name','phone','email','group','status','notes'];
  const rows = subjects.map(s => [s.subjectId, s.name||'', s.phone||'', s.email||'', s.group||'', s.status, (s.notes||'').replace(/\n/g,' ')]);
  const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sujetos_' + dateKey(new Date()) + '.csv';
  a.click();
}
function triggerImportCSV() { closeExportMenu(); document.getElementById('import-csv-input').click(); }
function importCSV(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const lines = e.target.result.split('\n').filter(l=>l.trim());
    if (lines.length < 2) { showToast('error','CSV vacío','No hay filas para importar.'); return; }
    const header = lines[0].split(',').map(h => h.replace(/"/g,'').trim());
    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.replace(/"/g,'').trim());
      const obj = Object.fromEntries(header.map((h,j)=>[h, cols[j]||'']));
      if (obj.visitId) {
        await dbPut('visits', {
          visitId:      obj.visitId,
          subjectId:    obj.subjectId,
          resourceId:   obj.resourceId,
          date:         obj.date,
          timeStart:    obj.timeStart,
          duration:     parseInt(obj.duration)||60,
          status:       obj.status||'pending',
          type:         obj.type||'other',
          investigator: obj.investigator||'',
          notes:        obj.notes||'',
          reminders:    [48,24,3],
          createdAt:    new Date().toISOString()
        });
        count++;
      }
    }
    showToast('success','CSV importado', count + ' visitas importadas.');
    renderAll();
  };
  reader.readAsText(file);
  input.value = '';
}

/* ─── CONFLICT CHECK ──────────────────────────────────────────────────────── */
async function checkConflict(resourceId, date, timeStart, duration, excludeId) {
  const visits = await dbGetByIndex('visits','resourceId',resourceId);
  const [sh,sm] = timeStart.split(':').map(Number);
  const startMin = sh*60+sm;
  const endMin = startMin + parseInt(duration);
  for (const v of visits) {
    if (v.visitId === excludeId) continue;
    if (v.date !== date) continue;
    if (v.status === 'cancelled') continue;
    const [vh,vm] = v.timeStart.split(':').map(Number);
    const vs = vh*60+vm, ve = vs + v.duration;
    if (startMin < ve && endMin > vs) return v;
  }
  return null;
}

/* ─── CALENDAR VIEW ───────────────────────────────────────────────────────── */
function setCalView(v) {
  state.view = v;
  ['day','week','month'].forEach(x => {
    document.getElementById('vbtn-'+x).classList.toggle('active', x===v);
  });
  renderCalendar();
}
function calNav(dir) {
  const d = state.currentDate;
  if (state.view==='day') d.setDate(d.getDate()+dir);
  else if (state.view==='week') d.setDate(d.getDate()+dir*7);
  else { d.setMonth(d.getMonth()+dir); }
  renderCalendar();
}
function calGoToday() {
  state.currentDate = new Date();
  state.selectedDate = new Date();
  renderCalendar();
  renderMiniCal();
}

async function renderCalendar() {
  updateCalTitle();
  const container = document.getElementById('cal-view');
  const visits = await dbGetAll('visits');
  const subjects = await dbGetAll('subjects');
  const resources = await dbGetAll('resources');
  const subMap = Object.fromEntries(subjects.map(s=>[s.subjectId,s]));
  const resMap = Object.fromEntries(resources.map(r=>[r.resourceId,r]));
  if (state.view==='month') renderMonthView(container, visits, subMap, resMap);
  else if (state.view==='week') renderWeekView(container, visits, subMap, resMap);
  else renderDayView(container, visits, subMap, resMap);
  updateStats(visits);
  renderSidebarUpcoming(visits, subMap);
}
function updateCalTitle() {
  const d = state.currentDate;
  const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DAYS_ES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  let t;
  if (state.view==='day') {
    t = `${DAYS_ES[d.getDay()]} ${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
  } else if (state.view==='week') {
    const mon = new Date(d);
    mon.setDate(d.getDate() - (d.getDay()||7) + 1);
    const sun = new Date(mon); sun.setDate(mon.getDate()+6);
    t = `${mon.getDate()} — ${sun.getDate()} ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
  } else {
    t = `${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
  }
  document.getElementById('cal-title').textContent = t;
}

/* MONTH VIEW */
function renderMonthView(container, visits, subMap, resMap) {
  const d = state.currentDate;
  const year = d.getFullYear(), month = d.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month+1, 0);
  let startDow = firstDay.getDay(); if (startDow===0) startDow=7;
  const DAYS_ES = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const visitsByDate = {};
  for (const v of visits) {
    if (!visitsByDate[v.date]) visitsByDate[v.date] = [];
    visitsByDate[v.date].push(v);
  }
  let html = `<div class="month-view">
    <div class="month-header">
      ${DAYS_ES.map(d=>`<div class="month-dow">${d}</div>`).join('')}
    </div>
    <div class="month-grid">`;
  // prev month padding
  for (let i=1; i<startDow; i++) {
    const pd = new Date(year, month, 1-startDow+i);
    html += `<div class="month-cell other-month"><div class="month-cell-num">${pd.getDate()}</div></div>`;
  }
  const todayKey = dateKey(new Date());
  for (let day=1; day<=lastDay.getDate(); day++) {
    const dk = dateKey(new Date(year,month,day));
    const isToday = dk===todayKey;
    const isSel = dk===dateKey(state.selectedDate);
    const dayVisits = visitsByDate[dk] || [];
    const visitsHtml = dayVisits.slice(0,3).map(v => {
      const s = subMap[v.subjectId];
      const lbl = s ? (s.name||s.subjectId).slice(0,14) : v.subjectId;
      return `<div class="month-event ${v.status}" onclick="event.stopPropagation();openVisitDetail('${v.visitId}')">${v.timeStart} ${lbl}</div>`;
    }).join('');
    const more = dayVisits.length > 3 ? `<div class="month-more">+${dayVisits.length-3} más</div>` : '';
    html += `<div class="month-cell${isToday?' today':''}${isSel?' selected':''}"
       onclick="selectDate('${dk}')" ondblclick="newVisitOnDate('${dk}')">
      <div class="month-cell-num">${day}</div>
      ${visitsHtml}${more}
    </div>`;
  }
  // next month padding
  const totalCells = (startDow-1) + lastDay.getDate();
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells%7);
  for (let i=1; i<=remaining; i++) {
    html += `<div class="month-cell other-month"><div class="month-cell-num">${i}</div></div>`;
  }
  html += '</div></div>';
  container.innerHTML = html;
}

/* WEEK VIEW */
function renderWeekView(container, visits, subMap, resMap) {
  const d = state.currentDate;
  const mon = new Date(d);
  mon.setDate(d.getDate() - (d.getDay()||7) + 1);
  const DAYS_ES = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const todayKey = dateKey(new Date());
  let daysHeader = '';
  const weekDates = [];
  for (let i=0; i<7; i++) {
    const day = new Date(mon); day.setDate(mon.getDate()+i);
    weekDates.push(day);
    const isToday = dateKey(day)===todayKey;
    daysHeader += `<div class="week-day-col-header${isToday?' today':''}">
      <div class="week-day-name">${DAYS_ES[i]}</div>
      <div class="week-day-num">${day.getDate()}</div>
    </div>`;
  }
  let timeCol = '';
  for (const h of HOURS) {
    timeCol += `<div class="week-hour-label">${pad2(h)}:00</div>`;
  }
  let gridCols = weekDates.map((day,i) => {
    const dk = dateKey(day);
    const isToday = dk===todayKey;
    const dayVisits = visits.filter(v=>v.date===dk && v.status!=='cancelled');
    let eventsHtml = '';
    for (const v of dayVisits) {
      const [vh,vm] = v.timeStart.split(':').map(Number);
      const top = (vh*60+vm)/60*60;
      const height = Math.max(v.duration/60*60, 20);
      const s = subMap[v.subjectId];
      const lbl = s ? (s.name||s.subjectId) : v.subjectId;
      eventsHtml += `<div class="week-event ${v.status}" style="top:${top}px;height:${height}px"
        onclick="openVisitDetail('${v.visitId}')"
        draggable="true" ondragstart="dragStart(event,'${v.visitId}')"
        title="${lbl} ${v.timeStart} (${v.duration}min)">
        <div class="week-event-title">${lbl}</div>
        <div class="week-event-time">${v.timeStart} · ${v.duration}m</div>
      </div>`;
    }
    const hourRows = HOURS.map(h => `<div class="week-hour-row half" ondragover="event.preventDefault()" ondrop="dropOnSlot(event,'${dk}',${h})"></div>`).join('');
    return `<div class="week-day-grid-col${isToday?' today':''}" onclick="newVisitOnDate('${dk}')">${hourRows}${eventsHtml}</div>`;
  }).join('');
  // current time line
  const now = new Date();
  const currentTopPx = (now.getHours()*60+now.getMinutes())/60*60;
  const todayColIdx = weekDates.findIndex(wd=>dateKey(wd)===todayKey);
  let timeLineHtml = '';
  if (todayColIdx >= 0) {
    timeLineHtml = `<div class="current-time-line" style="top:${currentTopPx}px"></div>`;
  }
  container.innerHTML = `<div class="week-view">
    <div class="week-header">
      <div class="week-time-gutter"></div>
      <div class="week-days-header">${daysHeader}</div>
    </div>
    <div class="week-body">
      <div class="week-time-col">${timeCol}</div>
      <div class="week-grid" style="position:relative">${gridCols}${timeLineHtml}</div>
    </div>
  </div>`;
  // Scroll to current hour
  setTimeout(()=>{
    const body = container.querySelector('.week-body');
    if (body) body.scrollTop = Math.max(0, currentTopPx - 120);
  }, 50);
}

/* DAY VIEW */
function renderDayView(container, visits, subMap, resMap) {
  const dk = dateKey(state.currentDate);
  const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DAYS_ES_L = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const cd = state.currentDate;
  const dayVisits = visits.filter(v=>v.date===dk).sort((a,b)=>a.timeStart.localeCompare(b.timeStart));
  let eventsHtml = '';
  for (const v of dayVisits) {
    const [vh,vm] = v.timeStart.split(':').map(Number);
    const top = (vh*60+vm)/60*60;
    const height = Math.max(v.duration/60*60, 24);
    const s = subMap[v.subjectId];
    const r = resMap[v.resourceId];
    eventsHtml += `<div class="day-event ${v.status}" style="top:${top}px;height:${height}px"
      onclick="openVisitDetail('${v.visitId}')"
      draggable="true" ondragstart="dragStart(event,'${v.visitId}')">
      <div class="day-event-title">${s?s.name||s.subjectId:v.subjectId}</div>
      <div class="day-event-meta">${v.timeStart} — ${v.duration}min · ${r?r.name:v.resourceId}</div>
      <div class="day-event-id">${v.subjectId} · ${v.type||''}</div>
    </div>`;
  }
  const hourRows = HOURS.map(h =>
    `<div class="day-hour-row half" ondragover="event.preventDefault()" ondrop="dropOnSlot(event,'${dk}',${h})"></div>`
  ).join('');
  const now = new Date();
  const topPx = (now.getHours()*60+now.getMinutes())/60*60;
  const isToday = dk===dateKey(now);
  container.innerHTML = `<div class="day-view">
    <div class="day-view-header">
      <div class="day-view-title">${DAYS_ES_L[cd.getDay()]} ${cd.getDate()}</div>
      <div class="day-view-subtitle">${MONTHS_ES[cd.getMonth()]} ${cd.getFullYear()} · ${dayVisits.length} visita(s)</div>
      <button class="btn btn-accent" style="margin-left:auto" onclick="newVisitOnDate('${dk}')">&#43; Visita</button>
    </div>
    <div class="day-body">
      <div class="day-time-col">${HOURS.map(h=>`<div class="day-hour-label">${pad2(h)}:00</div>`).join('')}</div>
      <div class="day-grid-col" onclick="handleDayClick(event,'${dk}')">
        ${hourRows}
        ${eventsHtml}
        ${isToday?`<div class="current-time-line" style="top:${topPx}px"></div>`:''}
      </div>
    </div>
  </div>`;
  setTimeout(()=>{
    const body = container.querySelector('.day-body');
    if (body) body.scrollTop = Math.max(0, topPx - 120);
  }, 50);
}

/* ─── MINI CALENDAR ────────────────────────────────────────────────────────── */
async function renderMiniCal() {
  const d = state.miniCalDate;
  const year = d.getFullYear(), month = d.getMonth();
  const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const DAYS = ['L','M','X','J','V','S','D'];
  const firstDow = new Date(year,month,1).getDay(); const startDow = firstDow===0?7:firstDow;
  const lastDay  = new Date(year,month+1,0).getDate();
  const visits = await dbGetAll('visits');
  const datesWithVisits = new Set(visits.map(v=>v.date));
  const todayKey = dateKey(new Date());
  const selKey = dateKey(state.selectedDate);
  let cells = DAYS.map(d=>`<div class="mini-cal-dow">${d}</div>`).join('');
  for (let i=1; i<startDow; i++) {
    const pd = new Date(year, month, 1-startDow+i);
    cells += `<div class="mini-cal-day other-month">${pd.getDate()}</div>`;
  }
  for (let day=1; day<=lastDay; day++) {
    const dk = dateKey(new Date(year,month,day));
    const cls = [
      'mini-cal-day',
      dk===todayKey ? 'today' : '',
      dk===selKey   ? 'selected' : '',
      datesWithVisits.has(dk) ? 'has-events' : ''
    ].filter(Boolean).join(' ');
    cells += `<div class="${cls}" onclick="selectDate('${dk}')">${day}</div>`;
  }
  const total = (startDow-1)+lastDay;
  const rem = total%7===0 ? 0 : 7-(total%7);
  for (let i=1; i<=rem; i++) cells += `<div class="mini-cal-day other-month">${i}</div>`;
  document.getElementById('mini-cal').innerHTML = `
    <div class="mini-cal-header">
      <div class="mini-cal-title">${MONTHS_ES[month]} ${year}</div>
      <div class="mini-cal-nav">
        <button onclick="miniCalNav(-1)">&#8249;</button>
        <button onclick="miniCalNav(1)">&#8250;</button>
      </div>
    </div>
    <div class="mini-cal-grid">${cells}</div>`;
}
function miniCalNav(dir) {
  state.miniCalDate.setMonth(state.miniCalDate.getMonth()+dir);
  renderMiniCal();
}
function selectDate(dk) {
  state.selectedDate = new Date(dk+'T12:00:00');
  state.currentDate  = new Date(dk+'T12:00:00');
  renderCalendar();
  renderMiniCal();
}

/* ─── DRAG AND DROP ────────────────────────────────────────────────────────── */
function dragStart(e, visitId) { state.dragVisitId = visitId; e.dataTransfer.effectAllowed = 'move'; }
async function dropOnSlot(e, dk, hour) {
  e.preventDefault(); e.stopPropagation();
  if (!state.dragVisitId) return;
  const visit = await dbGet('visits', state.dragVisitId);
  if (!visit) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const mins = Math.round((y / 60 * 60) / 15) * 15;
  const totalMins = hour*60 + mins;
  const h = Math.floor(totalMins/60), m = totalMins%60;
  visit.date = dk;
  visit.timeStart = pad2(h)+':'+pad2(m);
  const conflict = await checkConflict(visit.resourceId, dk, visit.timeStart, visit.duration, visit.visitId);
  if (conflict) { showToast('error','Conflicto','Ese slot ya está ocupado.'); return; }
  await dbPut('visits', visit);
  state.dragVisitId = null;
  renderAll();
  showToast('success','Visita movida','Nueva hora: ' + visit.timeStart + ' — ' + dk);
}

/* ─── STATS ────────────────────────────────────────────────────────────────── */
function updateStats(visits) {
  const todayKey = dateKey(new Date());
  const todayVisits = visits.filter(v=>v.date===todayKey);
  document.getElementById('stat-total').textContent = todayVisits.length;
  document.getElementById('stat-conf').textContent  = todayVisits.filter(v=>v.status==='confirmed').length;
  document.getElementById('stat-pend').textContent  = todayVisits.filter(v=>v.status==='pending').length;
  document.getElementById('stat-ns').textContent    = todayVisits.filter(v=>v.status==='noshow').length;
}
function renderSidebarUpcoming(visits, subMap) {
  const now = new Date();
  const upcoming = visits
    .filter(v => {
      const dt = new Date(v.date+'T'+v.timeStart+':00');
      return dt >= now && v.status !== 'cancelled';
    })
    .sort((a,b) => (a.date+a.timeStart).localeCompare(b.date+b.timeStart))
    .slice(0,5);
  const html = upcoming.map(v => {
    const s = subMap[v.subjectId];
    return `<div class="checkin-item" onclick="openVisitDetail('${v.visitId}')" style="cursor:pointer;gap:6px;padding:6px 8px">
      <div class="checkin-time">${v.timeStart}</div>
      <div class="checkin-name" style="font-size:11px">${s?s.name||s.subjectId:v.subjectId}</div>
      <span class="tag ${v.status==='confirmed'?'green':v.status==='pending'?'yellow':'purple'}" style="font-size:8px">${v.status.slice(0,4)}</span>
    </div>`;
  }).join('');
  document.getElementById('sidebar-upcoming').innerHTML = html || '<div style="font-family:var(--font-mono);font-size:10px;color:var(--txt-3)">Sin próximas visitas</div>';
}

/* ─── RESOURCES ─────────────────────────────────────────────────────────────── */
async function renderResources() {
  const resources = await dbGetAll('resources');
  const html = resources.map(r => `
    <div class="resource-item${state.activeResource===r.resourceId?' active':''}" onclick="toggleResource('${r.resourceId}')">
      <div class="resource-dot" style="background:${r.color}"></div>
      <div class="resource-name">${r.name}</div>
      <button class="btn btn-ghost btn-icon" style="padding:2px 4px;font-size:10px" onclick="event.stopPropagation();editResource('${r.resourceId}')">&#9998;</button>
    </div>`).join('');
  document.getElementById('resource-list').innerHTML = html;
}
function toggleResource(id) {
  state.activeResource = state.activeResource === id ? null : id;
  renderResources();
}
async function openModal_resource(id) {
  const el = document.getElementById('modal-resource');
  document.getElementById('resource-id-field').value = id || '';
  document.getElementById('modal-resource-title').textContent = id ? 'EDITAR RECURSO' : 'NUEVO RECURSO';
  if (id) {
    const r = await dbGet('resources', id);
    document.getElementById('resource-name').value     = r.name;
    document.getElementById('resource-type').value     = r.type;
    document.getElementById('resource-color').value    = r.color;
    document.getElementById('resource-capacity').value = r.capacity;
  } else {
    document.getElementById('resource-name').value     = '';
    document.getElementById('resource-type').value     = 'room';
    document.getElementById('resource-color').value    = '#22C55E';
    document.getElementById('resource-capacity').value = '1';
  }
  openModal('modal-resource');
}
function editResource(id) { openModal_resource(id); }
async function saveResource() {
  const id = document.getElementById('resource-id-field').value;
  const name = document.getElementById('resource-name').value.trim();
  if (!name) { showToast('error','Error','El nombre es obligatorio.'); return; }
  const obj = {
    resourceId: id || genId('res'),
    name,
    type:     document.getElementById('resource-type').value,
    color:    document.getElementById('resource-color').value,
    capacity: parseInt(document.getElementById('resource-capacity').value)||1
  };
  await dbPut('resources', obj);
  closeModal('modal-resource');
  renderResources();
  populateSelects();
  showToast('success','Recurso guardado', obj.name);
}

/* ─── VISIT CRUD ─────────────────────────────────────────────────────────────── */
async function openModal(modalId, visitId) {
  if (modalId === 'modal-visit') {
    await populateSelects();
    document.getElementById('visit-id-field').value = visitId || '';
    document.getElementById('modal-visit-title').textContent = visitId ? 'EDITAR VISITA' : 'NUEVA VISITA';
    document.getElementById('conflict-warning').style.display = 'none';
    if (visitId) {
      const v = await dbGet('visits', visitId);
      document.getElementById('visit-subject-id').value  = v.subjectId;
      document.getElementById('visit-resource-id').value = v.resourceId;
      document.getElementById('visit-date').value        = v.date;
      document.getElementById('visit-time-start').value  = v.timeStart;
      document.getElementById('visit-duration').value    = v.duration;
      document.getElementById('visit-status').value      = v.status;
      document.getElementById('visit-investigator').value= v.investigator||'';
      document.getElementById('visit-type').value        = v.type||'other';
      document.getElementById('visit-notes').value       = v.notes||'';
      document.getElementById('rem-48').checked = (v.reminders||[]).includes(48);
      document.getElementById('rem-24').checked = (v.reminders||[]).includes(24);
      document.getElementById('rem-3').checked  = (v.reminders||[]).includes(3);
    } else {
      document.getElementById('visit-subject-id').value  = '';
      document.getElementById('visit-resource-id').value = '';
      document.getElementById('visit-date').value        = dateKey(state.selectedDate);
      document.getElementById('visit-time-start').value  = '09:00';
      document.getElementById('visit-duration').value    = '60';
      document.getElementById('visit-status').value      = 'pending';
      document.getElementById('visit-investigator').value= '';
      document.getElementById('visit-type').value        = 'baseline';
      document.getElementById('visit-notes').value       = '';
      document.getElementById('rem-48').checked = true;
      document.getElementById('rem-24').checked = true;
      document.getElementById('rem-3').checked  = true;
    }
  } else if (modalId === 'modal-subject') {
    document.getElementById('subject-id-field').value = '';
    document.getElementById('modal-subject-title').textContent = 'NUEVO SUJETO';
    ['subject-anon-id','subject-name','subject-phone','subject-email','subject-group','subject-notes'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('subject-status').value = 'active';
  } else if (modalId === 'modal-notif') {
    renderTemplates();
    updateToggleUI();
  } else if (modalId === 'modal-resource') {
    openModal_resource(null);
    return;
  }
  document.getElementById(modalId).classList.add('open');
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function backdropClose(e, id) { if (e.target === e.currentTarget) closeModal(id); }

async function populateSelects() {
  const subjects  = await dbGetAll('subjects');
  const resources = await dbGetAll('resources');
  const sSel = document.getElementById('visit-subject-id');
  const rSel = document.getElementById('visit-resource-id');
  const curS = sSel.value, curR = rSel.value;
  sSel.innerHTML = '<option value="">— Seleccionar sujeto —</option>' +
    subjects.filter(s=>s.status!=='withdrawn').map(s => `<option value="${s.subjectId}">${s.subjectId}${s.name?' — '+s.name:''}</option>`).join('');
  rSel.innerHTML = '<option value="">— Seleccionar recurso —</option>' +
    resources.map(r => `<option value="${r.resourceId}">${r.name} (${r.type})</option>`).join('');
  if (curS) sSel.value = curS;
  if (curR) rSel.value = curR;
}

async function saveVisit() {
  const id         = document.getElementById('visit-id-field').value;
  const subjectId  = document.getElementById('visit-subject-id').value;
  const resourceId = document.getElementById('visit-resource-id').value;
  const date       = document.getElementById('visit-date').value;
  const timeStart  = document.getElementById('visit-time-start').value;
  const duration   = parseInt(document.getElementById('visit-duration').value);
  const status     = document.getElementById('visit-status').value;
  if (!subjectId || !resourceId || !date || !timeStart) {
    showToast('error','Campos requeridos','Sujeto, recurso, fecha y hora son obligatorios.');
    return;
  }
  const conflict = await checkConflict(resourceId, date, timeStart, duration, id||null);
  const warnEl = document.getElementById('conflict-warning');
  if (conflict) {
    warnEl.style.display = '';
    const cs = await dbGet('subjects', conflict.subjectId);
    warnEl.textContent = '⚠ CONFLICTO: El recurso ya está ocupado por ' + (cs?cs.name||cs.subjectId:conflict.subjectId) + ' a las ' + conflict.timeStart + ' (' + conflict.duration + 'min). Cambia el recurso o la hora.';
    return;
  }
  warnEl.style.display = 'none';
  const reminders = [
    ...(document.getElementById('rem-48').checked?[48]:[]),
    ...(document.getElementById('rem-24').checked?[24]:[]),
    ...(document.getElementById('rem-3').checked?[3]:[]),
  ];
  const visit = {
    visitId:      id || genId('vis'),
    subjectId, resourceId, date, timeStart, duration, status,
    type:         document.getElementById('visit-type').value,
    investigator: document.getElementById('visit-investigator').value,
    notes:        document.getElementById('visit-notes').value,
    reminders,
    createdAt:    id ? (await dbGet('visits',id)||{}).createdAt||new Date().toISOString() : new Date().toISOString(),
    updatedAt:    new Date().toISOString()
  };
  await dbPut('visits', visit);
  closeModal('modal-visit');
  // Schedule reminders
  const subject = await dbGet('subjects', subjectId);
  scheduleReminders(visit, subject);
  // ICS export
  if (state.notifSettings.ics_export && !id) {
    const res = await dbGet('resources', resourceId);
    const ics = generateICS(visit, subject, res ? res.name : resourceId);
    downloadICS(ics, 'visita_' + visit.visitId + '.ics');
  }
  showToast('success', id ? 'Visita actualizada' : 'Visita creada', date + ' ' + timeStart + ' — ' + (subject?subject.name||subject.subjectId:''));
  renderAll();
}

function newVisitOnDate(dk) {
  selectDate(dk);
  openModal('modal-visit', null);
}
function handleDayClick(e, dk) {
  if (e.target.classList.contains('day-hour-row') || e.target.classList.contains('day-grid-col')) {
    newVisitOnDate(dk);
  }
}

/* ─── VISIT DETAIL PANEL ────────────────────────────────────────────────────── */
async function openVisitDetail(visitId) {
  const visit = await dbGet('visits', visitId);
  if (!visit) return;
  const subject  = await dbGet('subjects', visit.subjectId);
  const resource = await dbGet('resources', visit.resourceId);
  const panel = document.getElementById('detail-panel');
  panel.classList.remove('hidden');
  document.getElementById('detail-title').textContent = 'VISITA — ' + visit.type.toUpperCase();
  const statusLabels = {confirmed:'Confirmada',pending:'Pendiente',cancelled:'Cancelada',waitlist:'Lista Espera',noshow:'No-Show'};
  document.getElementById('detail-body').innerHTML = `
    <span class="detail-status ${visit.status}">${statusLabels[visit.status]||visit.status}</span>
    <div class="detail-row"><div class="detail-row-label">Sujeto</div><div class="detail-row-value mono">${visit.subjectId}</div></div>
    ${subject ? `<div class="detail-row"><div class="detail-row-label">Nombre</div><div class="detail-row-value">${subject.name||'—'}</div></div>
    <div class="detail-row"><div class="detail-row-label">Teléfono</div><div class="detail-row-value">${subject.phone||'—'}</div></div>
    <div class="detail-row"><div class="detail-row-label">Email</div><div class="detail-row-value">${subject.email||'—'}</div></div>` : ''}
    <hr class="detail-divider">
    <div class="detail-row"><div class="detail-row-label">Fecha</div><div class="detail-row-value mono">${visit.date}</div></div>
    <div class="detail-row"><div class="detail-row-label">Hora</div><div class="detail-row-value mono">${visit.timeStart} (${visit.duration} min)</div></div>
    <div class="detail-row"><div class="detail-row-label">Recurso</div><div class="detail-row-value">${resource?resource.name:visit.resourceId}</div></div>
    <div class="detail-row"><div class="detail-row-label">Investigador</div><div class="detail-row-value">${visit.investigator||'—'}</div></div>
    <hr class="detail-divider">
    <div class="detail-row"><div class="detail-row-label">Recordatorios</div><div class="detail-row-value">${(visit.reminders||[]).map(h=>`${h}h`).join(', ')||'—'}</div></div>
    ${visit.notes ? `<div class="detail-row"><div class="detail-row-label">Notas</div><div class="detail-row-value">${visit.notes}</div></div>` : ''}
    <div class="detail-row"><div class="detail-row-label">ID Visita</div><div class="detail-row-value mono" style="font-size:10px;color:var(--txt-3)">${visit.visitId}</div></div>
  `;
  const statusActions = {
    pending:  `<button class="btn" style="flex:1" onclick="updateVisitStatus('${visitId}','confirmed')">&#10003; Confirmar</button>
               <button class="btn" onclick="updateVisitStatus('${visitId}','noshow')">No-Show</button>`,
    confirmed:`<button class="btn btn-danger" onclick="updateVisitStatus('${visitId}','cancelled')">Cancelar</button>
               <button class="btn" onclick="updateVisitStatus('${visitId}','noshow')">No-Show</button>`,
    waitlist: `<button class="btn" style="flex:1" onclick="updateVisitStatus('${visitId}','pending')">Promover</button>`,
    noshow:   `<button class="btn" onclick="updateVisitStatus('${visitId}','pending')">Reprogramar</button>`,
    cancelled:``
  };
  document.getElementById('detail-actions').innerHTML = `
    <div style="display:flex;gap:6px">
      ${statusActions[visit.status]||''}
    </div>
    <button class="btn" style="width:100%" onclick="openModal('modal-visit','${visitId}')">&#9998; Editar</button>
    <button class="btn" style="width:100%" onclick="exportVisitICS('${visitId}')">&#8615; Export ICS</button>
    <button class="btn btn-danger" style="width:100%" onclick="deleteVisit('${visitId}')">&#10007; Eliminar</button>
  `;
}
async function updateVisitStatus(visitId, newStatus) {
  const visit = await dbGet('visits', visitId);
  visit.status = newStatus;
  visit.updatedAt = new Date().toISOString();
  if (newStatus === 'noshow') visit.noShowAt = new Date().toISOString();
  await dbPut('visits', visit);
  openVisitDetail(visitId);
  renderAll();
  showToast('success','Estado actualizado', visitId + ' → ' + newStatus);
}
async function deleteVisit(visitId) {
  if (!confirm('¿Eliminar esta visita permanentemente?')) return;
  await dbDelete('visits', visitId);
  closeDetail();
  renderAll();
  showToast('warn','Visita eliminada','');
}
function closeDetail() {
  document.getElementById('detail-panel').classList.add('hidden');
}

/* ─── SUBJECT CRUD ────────────────────────────────────────────────────────────── */
async function openSubjectModal(id) {
  const el = document.getElementById('modal-subject');
  document.getElementById('subject-id-field').value = id || '';
  document.getElementById('modal-subject-title').textContent = id ? 'EDITAR SUJETO' : 'NUEVO SUJETO';
  if (id) {
    const s = await dbGet('subjects', id);
    document.getElementById('subject-anon-id').value  = s.subjectId;
    document.getElementById('subject-name').value     = s.name||'';
    document.getElementById('subject-phone').value    = s.phone||'';
    document.getElementById('subject-email').value    = s.email||'';
    document.getElementById('subject-group').value    = s.group||'';
    document.getElementById('subject-status').value   = s.status;
    document.getElementById('subject-notes').value    = s.notes||'';
  }
  el.classList.add('open');
}
async function saveSubject() {
  const existingId = document.getElementById('subject-id-field').value;
  const anonId = document.getElementById('subject-anon-id').value.trim() || genId('SUJ');
  if (!existingId) {
    const existing = await dbGet('subjects', anonId);
    if (existing) { showToast('error','ID duplicado','Ya existe un sujeto con ese ID.'); return; }
  }
  const obj = {
    subjectId: anonId,
    name:      document.getElementById('subject-name').value.trim(),
    phone:     document.getElementById('subject-phone').value.trim(),
    email:     document.getElementById('subject-email').value.trim(),
    group:     document.getElementById('subject-group').value.trim(),
    status:    document.getElementById('subject-status').value,
    notes:     document.getElementById('subject-notes').value.trim(),
    createdAt: existingId ? (await dbGet('subjects',existingId)||{}).createdAt||new Date().toISOString() : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await dbPut('subjects', obj);
  closeModal('modal-subject');
  showToast('success','Sujeto guardado', obj.subjectId);
  renderAll();
}

/* ─── SUBJECTS TABLE ────────────────────────────────────────────────────────── */
async function renderSubjectsView() {
  const subjects = await dbGetAll('subjects');
  const visits   = await dbGetAll('visits');
  const visitCount = {};
  visits.forEach(v => { visitCount[v.subjectId] = (visitCount[v.subjectId]||0)+1; });
  const statusColors = {active:'blue',screening:'yellow',enrolled:'green',completed:'purple',withdrawn:'red'};
  const html = `<table class="data-table">
    <thead><tr>
      <th>ID Sujeto</th><th>Nombre</th><th>Grupo</th><th>Estado</th><th>Email</th><th>Teléfono</th><th>Visitas</th><th>Acciones</th>
    </tr></thead>
    <tbody>
      ${subjects.length===0 ? `<tr><td colspan="8" style="text-align:center;color:var(--txt-3);padding:32px">Sin sujetos registrados</td></tr>` :
        subjects.map(s=>`<tr onclick="openSubjectModal('${s.subjectId}')">
          <td class="mono">${s.subjectId}</td>
          <td>${s.name||'<span style="color:var(--txt-3)">Anónimo</span>'}</td>
          <td>${s.group||'—'}</td>
          <td><span class="tag ${statusColors[s.status]||'blue'}">${s.status}</span></td>
          <td style="font-size:11px">${s.email||'—'}</td>
          <td style="font-family:var(--font-mono);font-size:11px">${s.phone||'—'}</td>
          <td style="font-family:var(--font-mono);text-align:center">${visitCount[s.subjectId]||0}</td>
          <td onclick="event.stopPropagation()">
            <button class="btn btn-ghost btn-icon" onclick="openSubjectModal('${s.subjectId}')" title="Editar">&#9998;</button>
            <button class="btn btn-ghost btn-icon" style="color:var(--red)" onclick="deleteSubject('${s.subjectId}')" title="Eliminar">&#10007;</button>
          </td>
        </tr>`).join('')
      }
    </tbody>
  </table>`;
  document.getElementById('subjects-table-wrap').innerHTML = html;
}
async function deleteSubject(id) {
  if (!confirm('¿Eliminar sujeto ' + id + '? Se eliminarán también sus visitas.')) return;
  await dbDelete('subjects', id);
  const visits = await dbGetByIndex('visits','subjectId',id);
  for (const v of visits) await dbDelete('visits', v.visitId);
  renderAll();
  showToast('warn','Sujeto eliminado','');
}

/* ─── CHECK-IN VIEW ────────────────────────────────────────────────────────── */
async function renderCheckInView() {
  const dk = dateKey(new Date());
  document.getElementById('checkin-date-label').textContent = dk;
  const visits = await dbGetByIndex('visits','date',dk);
  const subjects = await dbGetAll('subjects');
  const subMap = Object.fromEntries(subjects.map(s=>[s.subjectId,s]));
  const sorted = visits.sort((a,b)=>a.timeStart.localeCompare(b.timeStart));
  const statusLabels = {confirmed:'Confirmada',pending:'Pendiente',cancelled:'Cancelada',waitlist:'Espera',noshow:'No-Show',checkedin:'Check-In ✓'};
  const html = sorted.length===0 ? '<div class="empty-state"><div class="empty-state-icon">&#9744;</div><div class="empty-state-text">Sin visitas hoy</div></div>' :
    `<div class="checkin-list">
      ${sorted.map(v => {
        const s = subMap[v.subjectId];
        return `<div class="checkin-item">
          <div class="checkin-time">${v.timeStart}</div>
          <div class="checkin-name">${s?s.name||s.subjectId:v.subjectId} <span style="font-family:var(--font-mono);font-size:9px;color:var(--txt-3)">${v.subjectId}</span></div>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="tag ${v.status==='confirmed'||v.status==='checkedin'?'green':v.status==='cancelled'?'red':v.status==='noshow'?'red':'yellow'}">${statusLabels[v.status]||v.status}</span>
            ${v.status!=='checkedin'&&v.status!=='cancelled'?`<button class="btn btn-accent" style="padding:3px 8px;font-size:10px" onclick="checkIn('${v.visitId}')">Check-In</button>`:''}
            ${v.status!=='noshow'&&v.status!=='cancelled'?`<button class="btn btn-danger" style="padding:3px 8px;font-size:10px" onclick="updateVisitStatus('${v.visitId}','noshow')">N-S</button>`:''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  document.getElementById('checkin-list-wrap').innerHTML = html;
}
async function checkIn(visitId) {
  const visit = await dbGet('visits', visitId);
  visit.status = 'checkedin';
  visit.checkedInAt = new Date().toISOString();
  await dbPut('visits', visit);
  renderCheckInView();
  showToast('success','Check-In realizado', visitId);
}

/* ─── WAITLIST VIEW ─────────────────────────────────────────────────────────── */
async function renderWaitlistView() {
  const visits = await dbGetByIndex('visits','status','waitlist');
  const subjects = await dbGetAll('subjects');
  const subMap = Object.fromEntries(subjects.map(s=>[s.subjectId,s]));
  const html = visits.length===0 ?
    '<div class="empty-state"><div class="empty-state-icon">&#9725;</div><div class="empty-state-text">Lista de espera vacía</div></div>' :
    `<table class="data-table"><thead><tr><th>Sujeto</th><th>Nombre</th><th>Fecha</th><th>Hora</th><th>Acciones</th></tr></thead><tbody>
      ${visits.map(v=>{
        const s = subMap[v.subjectId];
        return `<tr>
          <td class="mono">${v.subjectId}</td>
          <td>${s?s.name||'—':'—'}</td>
          <td>${v.date}</td><td>${v.timeStart}</td>
          <td><button class="btn" onclick="updateVisitStatus('${v.visitId}','pending')">Promover a Pendiente</button></td>
        </tr>`;
      }).join('')}
    </tbody></table>`;
  document.getElementById('waitlist-table-wrap').innerHTML = html;
}

/* ─── NO-SHOW VIEW ───────────────────────────────────────────────────────────── */
async function renderNoShowView() {
  const visits = await dbGetByIndex('visits','status','noshow');
  const subjects = await dbGetAll('subjects');
  const subMap = Object.fromEntries(subjects.map(s=>[s.subjectId,s]));
  const html = visits.length===0 ?
    '<div class="empty-state"><div class="empty-state-icon">&#9745;</div><div class="empty-state-text">Sin no-shows registrados</div></div>' :
    `<table class="data-table"><thead><tr><th>Sujeto</th><th>Nombre</th><th>Fecha</th><th>Hora</th><th>Tipo</th><th>Acciones</th></tr></thead><tbody>
      ${visits.map(v=>{
        const s = subMap[v.subjectId];
        return `<tr>
          <td class="mono">${v.subjectId}</td>
          <td>${s?s.name||'—':'—'}</td>
          <td>${v.date}</td><td>${v.timeStart}</td>
          <td><span class="tag yellow">${v.type||'—'}</span></td>
          <td>
            <button class="btn" onclick="openModal('modal-visit','${v.visitId}')">Reprogramar</button>
          </td>
        </tr>`;
      }).join('')}
    </tbody></table>`;
  document.getElementById('noshow-table-wrap').innerHTML = html;
}

/* ─── VIEW SWITCHER ──────────────────────────────────────────────────────────── */
function showView(view) {
  ['calendar','subjects','checkin','waitlist','noshow'].forEach(v => {
    const area = v==='calendar' ? document.getElementById('calendar-area') : document.getElementById('view-'+v);
    if (area) area.style.display = v===view ? 'flex' : 'none';
  });
  // sidebar detail panel only in calendar
  document.getElementById('detail-panel').classList.add('hidden');
  ['nav-calendar','nav-subjects','nav-checkin','nav-waitlist','nav-noshow'].forEach(id => {
    document.getElementById(id).classList.remove('active');
  });
  document.getElementById('nav-'+view).classList.add('active');
  state.calendarView = view;
  if (view==='calendar') { renderCalendar(); }
  if (view==='subjects') { renderSubjectsView(); }
  if (view==='checkin')  { renderCheckInView(); }
  if (view==='waitlist') { renderWaitlistView(); }
  if (view==='noshow')   { renderNoShowView(); }
}

/* ─── SEARCH ─────────────────────────────────────────────────────────────────── */
let searchTimeout;
async function handleSearch(q) {
  clearTimeout(searchTimeout);
  if (!q.trim()) return;
  searchTimeout = setTimeout(async () => {
    const subjects = await dbGetAll('subjects');
    const visits   = await dbGetAll('visits');
    const ql = q.toLowerCase();
    const matched = subjects.filter(s =>
      (s.subjectId||'').toLowerCase().includes(ql) ||
      (s.name||'').toLowerCase().includes(ql) ||
      (s.email||'').toLowerCase().includes(ql)
    );
    if (matched.length > 0) {
      showView('subjects');
      // highlight
      showToast('info','Búsqueda',matched.length + ' sujeto(s) encontrado(s) para "'+q+'"');
    }
  }, 300);
}

/* ─── EXPORT MENU ────────────────────────────────────────────────────────────── */
function openExportMenu() {
  const btn = document.querySelector('.topbar-actions .btn[onclick="openExportMenu()"]');
  const menu = document.getElementById('export-menu');
  if (menu.style.display==='none') {
    const rect = btn ? btn.getBoundingClientRect() : {right:100,bottom:52};
    menu.style.top  = (rect ? rect.bottom + 4 : 56) + 'px';
    menu.style.right = (window.innerWidth - (rect ? rect.right : 200)) + 'px';
    menu.style.display = '';
    setTimeout(()=>document.addEventListener('click', closeExportMenuOutside, {once:true}), 50);
  } else {
    menu.style.display = 'none';
  }
}
function closeExportMenu() { document.getElementById('export-menu').style.display='none'; }
function closeExportMenuOutside(e) {
  if (!document.getElementById('export-menu').contains(e.target)) closeExportMenu();
}

/* ─── TABS ─────────────────────────────────────────────────────────────────── */
function switchTab(btn, targetId) {
  const bar = btn.closest('.tab-bar');
  bar.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const parent = bar.nextElementSibling ? bar.parentElement : bar.closest('.modal-body');
  if (parent) parent.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  const target = document.getElementById(targetId);
  if (target) target.classList.add('active');
}

/* ─── TEMPLATES ─────────────────────────────────────────────────────────────── */
function renderTemplates() {
  const t48 = `Estimado/a {subjectId},

Le recordamos que tiene una visita programada en 48 horas:

  Fecha/Hora : {time}
  Lugar      : {place}
  Duración   : {duration}
  Contacto   : {contact}

Por favor confirme su asistencia o comuníquese si necesita reprogramar.

— Equipo de Investigación`;

  const t24 = `Recordatorio 24h — Visita Mañana

Sujeto: {subjectId}
Hora: {time} | Sala: {place} | Duración: {duration}

Recuerde: {contact}

Confirme asistencia respondiendo a este mensaje.`;

  const t3 = `⏰ RECORDATORIO 3 HORAS

Su visita es hoy a las {time} en {place}.
Duración: {duration}. Sujeto: {subjectId}

Contacto: {contact}`;

  document.getElementById('tpl-48h').textContent = t48;
  document.getElementById('tpl-24h').textContent = t24;
  document.getElementById('tpl-3h').textContent  = t3;
}

/* ─── TOAST ──────────────────────────────────────────────────────────────────── */
let toastTimer;
function showToast(type, title, subtitle) {
  const icons = {success:'✓',error:'✗',warn:'⚠',info:'ℹ'};
  const pill = document.getElementById('notif-pill');
  pill.className = 'notif-pill ' + type;
  document.getElementById('notif-icon').textContent    = icons[type]||'ℹ';
  document.getElementById('notif-text').textContent    = title;
  document.getElementById('notif-subtitle').textContent = subtitle||'';
  pill.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>pill.classList.remove('show'), 3500);
}

/* ─── RENDER ALL ─────────────────────────────────────────────────────────────── */
async function renderAll() {
  if (state.calendarView === 'calendar' || state.calendarView === undefined) {
    renderCalendar();
  } else {
    showView(state.calendarView);
  }
  renderMiniCal();
  renderResources();
}

/* ─── INIT ───────────────────────────────────────────────────────────────────── */
async function init() {
  try {
    await initDB();
    await loadSettings();
    await seedDataIfEmpty();
    await populateSelects();
    await renderAll();
    // Initial view setup
    document.getElementById('calendar-area').style.display = 'flex';
    ['subjects','checkin','waitlist','noshow'].forEach(v => {
      document.getElementById('view-'+v).style.display = 'none';
    });
    // Schedule reminders for upcoming visits
    await reprogramAllReminders();
    // Update time line every minute
    setInterval(()=>{ if(state.view!=='month') renderCalendar(); }, 60000);
    // Hide loading
    setTimeout(()=>{
      document.getElementById('loading').style.opacity = '0';
      document.getElementById('loading').style.transition = 'opacity 0.4s';
      document.getElementById('app').style.display = 'flex';
      setTimeout(()=>document.getElementById('loading').style.display='none', 400);
    }, 1200);
  } catch(err) {
    document.getElementById('loading').innerHTML = `<div style="color:var(--red);font-family:var(--font-mono)">Error inicializando DB: ${err.message}</div>`;
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', init);
