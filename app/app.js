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

// R1: newest first, new rows at the top. Existing rows are kept (button state, focus), only moved if needed.
function render(incidents) {
  const sorted = [...incidents].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  const ids = new Set(sorted.map((i) => i.id));
  for (const [id, li] of rows) if (!ids.has(id)) { li.remove(); rows.delete(id); }
  let prev = null;
  for (const i of sorted) {
    let li = rows.get(i.id);
    if (!li) { li = makeRow(i); rows.set(i.id, li); }
    const want = prev ? prev.nextSibling : list.firstChild;
    if (want !== li) list.insertBefore(li, want);
    prev = li;
  }
  empty.hidden = sorted.length > 0;
}

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
