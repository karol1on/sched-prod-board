import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const board = document.querySelector('[data-testid="board"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const list = document.querySelector('[data-testid="incident-list"]');
const newBar = document.querySelector('[data-testid="new-bar"]');

// R5: the viewer's own zone and locale order (en-GB, de-DE, en-NZ put the day first).
const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });

const incidents = new Map(); // id -> incident
const rows = new Map(); // id -> <li>, kept across refreshes so a row never loses its ack state or focus

function el(tag, attrs = {}, text = '') {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.textContent = text;
  return node;
}

function makeRow(i) {
  const li = el('li', { 'data-testid': 'incident-row', 'data-id': i.id });
  const button = el('button', { type: 'button', 'data-testid': 'ack' }, 'Ack');
  button.addEventListener('click', () => onAck(li, i.id, button));
  li.append(el('span', { class: 'id' }, i.id), el('span', { class: 'sev' }), el('span', { class: 'what' }), el('time'), el('span', { class: 'act' }));
  li.lastChild.append(button);
  return li;
}

// Every refresh rewrites a row's fields from the latest answer (the API recomputes openedAt), but never its ack state.
function fillRow(li, i) {
  li.className = `row ${i.severity}`;
  li.querySelector('.sev').textContent = i.severity;
  li.querySelector('.what').textContent = `${i.service} · ${i.region} · ${i.summary}`;
  const time = li.querySelector('time');
  time.dateTime = i.openedAt;
  time.title = i.openedAt;
  time.textContent = timeFormat.format(new Date(i.openedAt));
}

async function onAck(li, id, button) {
  button.disabled = true;
  button.textContent = 'Acking…';
  try {
    await ack(id); // R2: api.js keeps and logs the receipt
    button.replaceWith(el('span', { 'data-testid': 'acked', class: 'acked' }, '✓ Acked'));
  } catch (err) {
    console.error(err);
    button.disabled = false;
    button.textContent = 'Ack failed, retry';
  }
}

// R1 (changed by product): rows on screen never move. New incidents wait in `waiting` behind the "N new" bar.
const waiting = new Set();

function render() {
  for (const [id, li] of rows) fillRow(li, incidents.get(id));
  empty.hidden = rows.size > 0;
  newBar.textContent = waiting.size ? `${waiting.size} new incident${waiting.size > 1 ? 's' : ''} · show` : '';
  newBar.classList.toggle('on', waiting.size > 0); // its slot is always reserved, so this moves nothing
}

// Puts the waiting incidents on screen, newest first, above the rows already shown (those are never re-inserted).
function bringIn() {
  const fresh = [...waiting].map((id) => incidents.get(id)).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const frag = document.createDocumentFragment();
  for (const i of fresh) {
    const li = makeRow(i);
    rows.set(i.id, li);
    frag.append(li);
  }
  list.prepend(frag);
  waiting.clear();
  render();
}
newBar.addEventListener('click', bringIn);

let first = true;
async function refresh() {
  const page = await fetchIncidents();
  for (const i of page.incidents) {
    incidents.set(i.id, i);
    if (!rows.has(i.id)) waiting.add(i.id);
  }
  if (first) bringIn(); // the first answer fills the board directly
  first = false;
  render();
  loader.remove(); // R3: gone once incidents are on screen
  board.removeAttribute('aria-busy');
}

async function loop() {
  try {
    await refresh();
  } catch (err) {
    console.error(err);
    if (loader.isConnected) loader.textContent = 'Could not load incidents. Retrying…';
  }
  setTimeout(loop, REFRESH_MS); // R4: next refresh 2 s after this one ends, never two at once
}

loop();
