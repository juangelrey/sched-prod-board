import { fetchIncidents, ack } from './api.js';
import { SESSION } from './config.js';

const REFRESH_MS = 2000; // R4
const board = document.querySelector('[data-testid="board"]');
const loader = board.querySelector('[data-testid="loader"]');
const empty = board.querySelector('[data-testid="empty"]');
const list = board.querySelector('[data-testid="incident-list"]');
const updated = document.getElementById('updated');

// R5: viewer's locale and time zone. Intl puts day before month where the locale does (en-GB, de, fr, en-NZ…).
const timeFmt = new Intl.DateTimeFormat(undefined, {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
});
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Acks survive refreshes (and reloads): the incident API does not say which incidents are acked.
const ACK_KEY = `acks:${SESSION.slice(-16)}`;
const acked = new Map(JSON.parse(localStorage.getItem(ACK_KEY) || '[]'));
const saveAcks = () => localStorage.setItem(ACK_KEY, JSON.stringify([...acked]));
const rows = new Map(); // id -> <li>, so a refresh updates rows in place instead of replacing them

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function ackedMark(a) {
  return el('span', { 'data-testid': 'acked', class: 'acked', title: a.receipt ? 'receipt kept' : '' },
    `✓ acked ${clockFmt.format(new Date(a.ackedAt))}`);
}

async function onAck(id, button) {
  button.disabled = true;
  button.textContent = 'Acking…';
  try {
    const reply = await ack(id);
    acked.set(id, { ackedAt: reply.ackedAt, receipt: reply.receipt });
    saveAcks();
    button.replaceWith(ackedMark(acked.get(id)));
    rows.get(id)?.classList.add('is-acked');
  } catch (err) {
    console.error(err);
    button.disabled = false;
    button.textContent = 'Ack failed · retry';
  }
}

function makeRow(i) {
  const li = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${i.severity}` });
  const time = el('time', { datetime: i.openedAt, title: i.openedAt }, timeFmt.format(new Date(i.openedAt)));
  li.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    time,
  );
  if (acked.has(i.id)) {
    li.classList.add('is-acked');
    li.append(ackedMark(acked.get(i.id)));
  } else {
    const b = el('button', { type: 'button', 'data-testid': 'ack' }, 'Ack');
    b.addEventListener('click', () => onAck(i.id, b));
    li.append(b);
  }
  return li;
}

// A refresh can change a known incident's fields: update them in place, keep the Ack button / mark.
function updateRow(li, i) {
  li.className = `row ${i.severity}${acked.has(i.id) ? ' is-acked' : ''}`;
  li.querySelector('.sev').textContent = i.severity;
  li.querySelector('.what').textContent = `${i.service} · ${i.region} · ${i.summary}`;
  const time = li.querySelector('time');
  if (time.getAttribute('datetime') !== i.openedAt) {
    time.setAttribute('datetime', i.openedAt);
    time.title = i.openedAt;
    time.textContent = timeFmt.format(new Date(i.openedAt));
  }
}

// Product decision (after SCHED-4511 review): the list holds still while it is on screen. Incidents that
// arrive while on screen wait behind the "N new" bar; a click on the bar brings them in at the top.
// Rows already on screen are never moved or removed by a refresh; only their fields update in place.
const pending = new Map(); // id -> incident, arrived but not shown yet
const newBar = board.querySelector('[data-testid="new-bar"]');

function showPending() {
  const fresh = [...pending.values()].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  pending.clear();
  const frag = document.createDocumentFragment();
  for (const i of fresh) { const li = makeRow(i); rows.set(i.id, li); frag.append(li); }
  list.prepend(frag);
  updateBar();
}

function updateBar() {
  const n = pending.size;
  newBar.textContent = n ? `${n} new incident${n === 1 ? '' : 's'} · show` : '';
  newBar.classList.toggle('is-on', n > 0); // space is reserved either way, so the bar never pushes rows
  newBar.disabled = n === 0;
  empty.hidden = rows.size > 0 || n > 0;
}

function render(incidents) {
  for (const i of incidents) {
    const li = rows.get(i.id);
    if (li) updateRow(li, i);
    else pending.set(i.id, i); // new, or already waiting: keep its latest fields
  }
  // Nothing on screen to hold still (first load, empty board, tab in the background): show them now.
  if (pending.size && (rows.size === 0 || document.hidden)) showPending();
  updateBar();
}

newBar.addEventListener('click', showPending);
document.addEventListener('visibilitychange', () => { if (document.hidden && pending.size) showPending(); });

let loaded = false;
async function tick() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    updated.textContent = `updated ${clockFmt.format(new Date(page.updatedAt || Date.now()))}`;
    if (!loaded) { loaded = true; loader.remove(); } // R3: loader only until the first load
    updated.classList.remove('stale');
  } catch (err) {
    console.error(err);
    if (!loaded) loader.querySelector('.msg').textContent = 'Cannot reach incidents · retrying…';
    else updated.classList.add('stale');
  } finally {
    setTimeout(tick, REFRESH_MS); // R4: every 2 s, never two requests at once
  }
}
tick();
