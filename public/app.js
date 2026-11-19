/* Lead Desk dashboard: lead list, live AI call (Vapi web call), simulated call, live updates via SSE */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  config: {},
  leads: [],
  selectedId: null,
  justChanged: new Set(),
  call: null, // { leadId, mode: 'ai'|'simulated'|'phone', status, startedAt, transcript: [], partial: null, callId, muted }
};
let vapi = null;
let timerHandle = null;

// ---------- data ----------
async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
const lead = (id) => state.leads.find((l) => l.id === id);

function upsert(l) {
  const i = state.leads.findIndex((x) => x.id === l.id);
  const before = i >= 0 ? state.leads[i] : null;
  if (i >= 0) state.leads[i] = l; else state.leads.unshift(l);
  if (before) {
    for (const k of Object.keys(l.qualification || {})) {
      if (JSON.stringify(l.qualification[k]) !== JSON.stringify((before.qualification || {})[k])) {
        state.justChanged.add({ budgetLakhs: 'budgetText', bhk: 'propertyType', timelineMonths: 'timeline' }[k] || k);
      }
    }
    if (!before.siteVisit && l.siteVisit) state.justChanged.add('siteVisit');
  }
}

// ---------- formatting ----------
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}
const pillClass = (s) => ({ 'Site visit booked': 'Site', 'Not interested': 'Not', 'Callback requested': 'Callback' }[s] || s);
const LANG_LABEL = { en: 'EN', hi: 'हिन्दी', kn: 'ಕನ್ನಡ' };
const langBadge = (l) => (l.language && l.language !== 'en' ? `<span class="lang">${LANG_LABEL[l.language]}</span>` : '');
const lakhs = (n) => (n >= 100 ? `₹${(n / 100).toFixed(2).replace(/\.?0+$/, '')} Cr` : `₹${n} L`);

// ---------- rendering ----------
function renderKpis() {
  const L = state.leads;
  $('#kTotal').textContent = L.length;
  $('#kCalled').textContent = L.filter((l) => (l.calls || []).length).length;
  $('#kHot').textContent = L.filter((l) => l.tier === 'Hot').length;
  $('#kVisits').textContent = L.filter((l) => l.siteVisit).length;
  const speeds = L.filter((l) => (l.calls || []).length).map((l) => (new Date(l.calls[0].at) - new Date(l.createdAt)) / 1000).filter((s) => s >= 0);
  if (!speeds.length) { $('#kSpeed').textContent = '–'; return; }
  const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  $('#kSpeed').textContent = avg < 90 ? `${Math.round(avg)} sec` : `${Math.round(avg / 60)} min`;
}

function renderRows() {
  const busy = Boolean(state.call);
  $('#leadRows').innerHTML = state.leads.map((l) => `
    <tr data-id="${l.id}" class="${l.id === state.selectedId ? 'selected' : ''}">
      <td><div class="lead-name">${esc(l.name)}${langBadge(l)}</div><div class="lead-meta">${esc(l.source)} · ${ago(l.createdAt)}</div></td>
      <td class="enq">${esc(l.enquiry)}</td>
      <td><span class="pill ${pillClass(l.status)}">${esc(l.status)}</span></td>
      <td><div class="score"><div class="bar"><span class="fill-${l.tier}" style="width:${l.score || 0}%"></span></div>
          <span class="tier ${l.tier}">${l.tier && l.tier !== '-' ? l.tier : ''}</span></div></td>
      <td><div class="actions">
        <button class="btn sm primary" data-act="ai" data-id="${l.id}" ${busy || !state.config.vapiPublicKey ? 'disabled' : ''} title="${state.config.vapiPublicKey ? 'Live AI voice call in the browser' : 'Add VAPI_PUBLIC_KEY to .env'}">AI call</button>
        <button class="btn sm" data-act="sim" data-id="${l.id}" ${busy ? 'disabled' : ''} title="Scripted demo call (no internet needed)">Simulate</button>
      </div></td>
    </tr>`).join('');
}

function field(key, label, value) {
  const filled = value !== undefined && value !== null && value !== '';
  return `<div class="field ${filled ? 'filled' : ''} ${state.justChanged.has(key) ? 'just' : ''}"><div class="k">${label}</div><div class="v">${filled ? esc(value) : '—'}</div></div>`;
}

function renderDetail() {
  const l = lead(state.selectedId);
  if (!l) { $('#detail').innerHTML = '<div class="empty">Select a lead to view the call and qualification details.</div>'; return; }
  const q = l.qualification || {};
  const c = state.call && state.call.leadId === l.id ? state.call : null;
  const otherBusy = state.call && !c;
  const transcript = c ? c.transcript : (l.transcript || []);

  const budget = q.budgetText || (q.budgetLakhs ? `up to ${lakhs(q.budgetLakhs)}` : '');
  const prop = [q.bhk ? `${q.bhk}BHK` : '', q.propertyType || ''].join(' ').trim();
  const interest = { hot: 'Hot', warm: 'Warm', cold: 'Cold', not_interested: 'Not interested', callback: 'Call back later' }[q.interestLevel] || '';

  let callControls;
  if (c) {
    callControls = `<div class="callbox live">
        <span class="callstate">${c.mode === 'simulated' ? 'Simulated call' : c.mode === 'phone' ? 'Phone call' : 'AI call'} · ${esc(c.status)}</span>
        <span class="timer" id="timer">0:00</span>
        <div class="vol"><span id="vol"></span></div>
        ${c.mode === 'ai' ? `<button class="btn sm" id="btnMute">${c.muted ? 'Unmute' : 'Mute'}</button>` : ''}
        ${c.mode !== 'phone' ? '<button class="btn sm danger" id="btnEnd">End call</button>' : ''}
      </div>`;
  } else {
    callControls = `<div class="callbox">
        <button class="btn primary" data-act="ai" data-id="${l.id}" ${otherBusy || !state.config.vapiPublicKey ? 'disabled' : ''}>Start AI call</button>
        <select class="langpick" id="langPick" title="Language the AI speaks on this call" ${otherBusy ? 'disabled' : ''}>
          <option value="en" ${l.language === 'hi' || l.language === 'kn' ? '' : 'selected'}>English</option>
          <option value="hi" ${l.language === 'hi' ? 'selected' : ''}>हिन्दी</option>
          <option value="kn" ${l.language === 'kn' ? 'selected' : ''}>ಕನ್ನಡ</option>
        </select>
        <button class="btn" data-act="sim" data-id="${l.id}" ${otherBusy ? 'disabled' : ''}>Simulate call</button>
        ${state.config.phoneCallsEnabled ? `<button class="btn" data-act="phone" data-id="${l.id}" ${otherBusy ? 'disabled' : ''}>Call phone</button>` : ''}
        <span class="muted">${state.config.vapiPublicKey ? 'AI call uses your mic as the customer' : 'Add Vapi key for live AI calls'}</span>
      </div>`;
  }

  $('#detail').innerHTML = `
    <div class="d-head">
      <div><div class="d-name">${esc(l.name)}</div>
        <div class="muted">${[l.phone, l.source, `enquired ${ago(l.createdAt)}`].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="muted" style="margin-top:4px">“${esc(l.enquiry)}”</div></div>
      <div style="text-align:right"><span class="pill ${pillClass(l.status)}">${esc(l.status)}</span>
        <div style="margin-top:8px" class="tier ${l.tier}">${l.tier !== '-' ? `${l.tier} · ${l.score}/100` : ''}</div></div>
    </div>
    <div class="d-section">${callControls}</div>
    <div class="d-section">
      <div class="d-title"><span>Conversation</span><span>${transcript.length ? transcript.filter((m) => m.role !== 'tool').length + ' turns' : ''}</span></div>
      <div class="transcript" id="transcript">
        ${transcript.length ? transcript.map((m) => m.role === 'tool'
          ? `<div class="tool">⚙ ${esc(m.text)}</div>`
          : `<div class="msg ${m.role}"><span class="who">${m.role === 'agent' ? 'AI agent' : 'Customer'}</span>${esc(m.text)}</div>`).join('') : '<div class="muted">No call yet.</div>'}
        ${c && c.partial ? `<div class="msg ${c.partial.role} partial">${esc(c.partial.text)}…</div>` : ''}
      </div>
    </div>
    <div class="d-section">
      <div class="d-title"><span>Captured by AI</span></div>
      <div class="grid">
        ${field('budgetText', 'Budget', budget)}
        ${field('location', 'Location', q.location)}
        ${field('propertyType', 'Property', prop)}
        ${field('timeline', 'Timeline', q.timeline)}
        ${field('purpose', 'Purpose', q.purpose)}
        ${field('loanNeeded', 'Home loan', q.loanNeeded === undefined ? '' : q.loanNeeded ? 'Needed' : 'Not needed')}
        ${field('interestLevel', 'Interest', interest)}
        ${field('notes', 'Notes', q.notes)}
      </div>
    </div>
    ${l.siteVisit ? `<div class="d-section"><div class="d-title"><span>Site visit</span></div>
      <div class="visit ${state.justChanged.has('siteVisit') ? 'field just' : ''}"><b>${esc(l.siteVisit.project)}</b>${esc(l.siteVisit.location || '')} · ${esc(l.siteVisit.date)} · ${esc(l.siteVisit.timeSlot)}
      <div class="muted" style="margin-top:4px">WhatsApp confirmation queued to ${esc(l.phone)}</div></div></div>` : ''}
    ${l.summary ? `<div class="d-section"><div class="d-title"><span>Call summary</span></div><div class="summary">${esc(l.summary)}</div></div>` : ''}
    ${l.scoreReasons && l.scoreReasons.length ? `<div class="d-section"><div class="d-title"><span>Why this score</span><span>${l.score}/100</span></div>
      <ul class="reasons">${l.scoreReasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
    ${(l.activity || []).length ? `<div class="d-section"><div class="d-title"><span>Activity</span></div>
      <ul class="activity">${l.activity.slice(0, 8).map((a) => `<li><time>${fmtTime(a.at)}</time><span>${esc(a.text)}</span></li>`).join('')}</ul></div>` : ''}
  `;
  const t = $('#transcript'); if (t) t.scrollTop = t.scrollHeight;
  if (c) tickTimer();
  setTimeout(() => state.justChanged.clear(), 50);
}

function render() { renderKpis(); renderRows(); renderDetail(); }

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function tickTimer() {
  const el = $('#timer');
  if (!el || !state.call || !state.call.startedAt) return;
  const s = Math.floor((Date.now() - state.call.startedAt) / 1000);
  el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- call lifecycle (shared) ----------
function beginCall(leadId, mode) {
  state.call = { leadId, mode, status: 'connecting', startedAt: null, transcript: [], partial: null };
  state.selectedId = leadId;
  clearInterval(timerHandle);
  timerHandle = setInterval(tickTimer, 1000);
  render();
}
function callLive() { if (!state.call) return; state.call.status = 'live'; state.call.startedAt = Date.now(); renderDetail(); }
function addTurn(role, text) { if (!state.call || !text) return; state.call.transcript.push({ role, text }); state.call.partial = null; renderDetail(); }
function addToolChip(text) { if (!state.call) return; state.call.transcript.push({ role: 'tool', text }); renderDetail(); }

async function finishCall(endedReason) {
  const c = state.call;
  if (!c) return;
  state.call = null;
  clearInterval(timerHandle);
  const durationSec = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
  try {
    const l = await api(`/api/leads/${c.leadId}/call-ended`, {
      method: 'POST',
      body: { callId: c.callId, mode: c.mode, durationSec, endedReason, transcript: c.transcript.filter((m) => m.role !== 'tool') },
    });
    if (l && l.id) { l.transcript = c.transcript; upsert(l); }
  } catch (e) { console.error(e); }
  render();
}

// ---------- Vapi live AI call ----------
function getVapi() {
  if (vapi) return vapi;
  vapi = new window.Vapi(state.config.vapiPublicKey);
  vapi.on('call-start', () => { callLive(); toast('AI agent connected — speak as the customer'); });
  vapi.on('call-end', () => finishCall('call-ended'));
  vapi.on('volume-level', (v) => { const el = $('#vol'); if (el) el.style.width = `${Math.min(100, v * 100)}%`; });
  vapi.on('message', (m) => {
    if (!state.call) return;
    if (m.type === 'transcript') {
      const role = m.role === 'user' ? 'customer' : 'agent';
      if (m.transcriptType === 'final') addTurn(role, m.transcript);
      else { state.call.partial = { role, text: m.transcript }; renderDetail(); }
    } else if (m.type === 'tool-calls') {
      (m.toolCallList || []).forEach((tc) => addToolChip(`AI used ${tc.function?.name?.replace(/_/g, ' ')}`));
    }
  });
  vapi.on('error', (e) => {
    console.error('Vapi error', e);
    const msg = e?.error?.message || e?.errorMsg || e?.message || 'see browser console';
    toast(`Voice AI error: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    if (state.call && state.call.status !== 'live') finishCall('failed-to-start');
  });
  return vapi;
}

async function startAiCall(leadId) {
  if (!state.config.vapiPublicKey) return toast('Add VAPI_PUBLIC_KEY to .env, or use Simulate');
  if (!state.config.publicServerUrl) toast('No PUBLIC_SERVER_URL — the AI can talk but cannot save details or book');
  beginCall(leadId, 'ai');
  try {
    const assistant = await api(`/api/leads/${leadId}/assistant`);
    const call = await getVapi().start(assistant);
    if (state.call && call && call.id) state.call.callId = call.id;
  } catch (e) {
    console.error(e);
    toast(`Could not start AI call: ${e.message}`);
    finishCall('failed-to-start');
  }
}

async function startPhoneCall(leadId) {
  const l = lead(leadId);
  const number = prompt('Number to call (E.164 format, e.g. +9198xxxxxxx). Use your own phone for the demo:', l.phone.replace(/\s/g, ''));
  if (!number) return;
  try {
    await api(`/api/leads/${leadId}/phone-call`, { method: 'POST', body: { number } });
    toast('Calling… answer your phone. Results appear here when the call ends.');
  } catch (e) { toast(`Phone call failed: ${e.message}`); }
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (btn) {
    e.stopPropagation();
    const id = btn.dataset.id;
    if (btn.dataset.act === 'ai') startAiCall(id);
    if (btn.dataset.act === 'sim') window.runSimulatedCall(lead(id));
    if (btn.dataset.act === 'phone') startPhoneCall(id);
    return;
  }
  if (e.target.id === 'btnEnd') {
    if (state.call?.mode === 'ai' && vapi) vapi.stop(); else window.stopSimulatedCall();
    return;
  }
  if (e.target.id === 'btnMute' && vapi && state.call) {
    state.call.muted = !state.call.muted; vapi.setMuted(state.call.muted); renderDetail(); return;
  }
  const row = e.target.closest('tr[data-id]');
  if (row) { state.selectedId = row.dataset.id; renderRows(); renderDetail(); }
});

$('#btnNewLead').onclick = () => { $('#modal').hidden = false; $('#leadForm').name.focus(); };
$('#btnCancel').onclick = () => { $('#modal').hidden = true; };
$('#btnReset').onclick = async () => {
  if (state.call) return toast('End the current call first');
  if (!confirm('Reset all demo leads to the starting data?')) return;
  await api('/api/reset', { method: 'POST' });
};
$('#leadForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  await api('/api/leads', { method: 'POST', body: { name: f.name.value, phone: f.phone.value, source: f.source.value, enquiry: f.enquiry.value, language: f.language.value, autoCall: f.autocall.checked } });
  f.reset(); $('#modal').hidden = true;
  // the server announces the lead over /api/events ("new-lead"), which also triggers the auto-call
};

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'langPick' || !state.selectedId) return;
  try { upsert(await api(`/api/leads/${state.selectedId}/language`, { method: 'PATCH', body: { language: e.target.value } })); render(); }
  catch (err) { toast(err.message); }
});

// Speed to lead: call a brand-new lead a few seconds after it arrives
function onNewLead(l, autoCall) {
  upsert(l);
  state.selectedId = state.call ? state.selectedId : l.id;
  render();
  toast(`New lead from ${l.source}: ${l.name}`);
  if (!autoCall || !$('#autoCall').checked) return;
  if (state.call) return toast('Another call is in progress; call this lead when it ends');
  setTimeout(() => {
    if (state.call) return;
    toast(`AI agent calling ${l.name}…`);
    if (state.config.vapiPublicKey) startAiCall(l.id); else window.runSimulatedCall(lead(l.id));
  }, 3000);
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'lead') {
      // keep the live transcript if this lead is on a call
      upsert(msg.lead);
      renderKpis(); renderRows();
      const tr = document.querySelector(`tr[data-id="${msg.lead.id}"]`); if (tr) tr.classList.add('flash');
      if (msg.lead.id === state.selectedId) renderDetail();
    } else if (msg.type === 'new-lead') {
      onNewLead(msg.lead, msg.autoCall);
    } else if (msg.type === 'reset') {
      state.leads = await api('/api/leads'); state.selectedId = null; render(); toast('Demo data reset');
    } else if (msg.type === 'tool' && state.call?.mode === 'phone') {
      toast(`AI used ${msg.name.replace(/_/g, ' ')}`);
    }
  };
}

// ---------- boot ----------
(async function boot() {
  state.config = await api('/api/config');
  $('#firmName').textContent = state.config.firmName;
  const v = $('#chipVapi'), h = $('#chipHook');
  v.textContent = state.config.vapiPublicKey ? 'Voice AI: ready' : 'Voice AI: simulate only';
  v.className = 'chip ' + (state.config.vapiPublicKey ? 'ok' : 'warn');
  h.textContent = state.config.publicServerUrl ? 'Webhook: connected' : 'Webhook: not set';
  h.className = 'chip ' + (state.config.publicServerUrl ? 'ok' : 'warn');
  state.leads = await api('/api/leads');
  render();
  connectEvents();
  setInterval(renderRows, 60000); // refresh "x min ago"
})();

// expose for simulate.js
window.LeadDesk = { state, api, beginCall, callLive, addTurn, addToolChip, finishCall, toast, render, upsert };
