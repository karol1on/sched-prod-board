import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const board = document.querySelector('[data-testid="board"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const list = document.querySelector('[data-testid="incident-list"]');

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
  const li = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${i.severity}` });
  const time = el('time', { datetime: i.openedAt, title: i.openedAt }, timeFormat.format(new Date(i.openedAt)));
  const button = el('button', { type: 'button', 'data-testid': 'ack' }, 'Ack');
  button.addEventListener('click', () => onAck(li, i.id, button));
  li.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    time,
    el('span', { class: 'act' }),
  );
  li.lastChild.append(button);
  return li;
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

function render() {
  // R1: newest first. Merge by id, so a full page and a since-delta both work.
  const ordered = [...incidents.values()].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  ordered.forEach((i, index) => {
    let li = rows.get(i.id);
    if (!li) rows.set(i.id, (li = makeRow(i)));
    if (list.children[index] !== li) list.insertBefore(li, list.children[index] ?? null);
  });
  empty.hidden = incidents.size > 0;
}

async function refresh() {
  const page = await fetchIncidents();
  for (const i of page.incidents) incidents.set(i.id, i);
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
