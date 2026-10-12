// Browser half.
//  - dispatch.field (at the model anchor): while Runtime = Bifrost, an OpenAI
//    model select replaces the core model row. The core payload gets
//    `model: 'opus'` (a valid alias Claude Code maps to ANTHROPIC_DEFAULT_OPUS_MODEL)
//    and our own slice gets `{ model: 'gpt-…' }`.
//  - view: gateway and logs.db status, totals by model, and recent requests.
// Model ids, errors and log rows come from the gateway, so every string goes in
// via textContent / option.text and the DOM is built with createElement.

const RUNTIME = 'bifrost';
const RECENT_POLL_MS = 5000;

const ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c3-6 6-9 9-9s6 3 9 9"/><path d="M6 17c2-4 4-6 6-6s4 2 6 6"/></svg>';

const LIMITATIONS = [
  'claude.ai connectors are disabled.',
  'Claude Code assumes a 200K context and 32K output.',
  'The cost shown is Bifrost\'s.',
  '/model inside the session cannot pick OpenAI models.',
];

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c != null) el.append(c);
  return el;
}

const money = (n) => (typeof n === 'number' && Number.isFinite(n) ? `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}` : '—');
const num = (n) => (typeof n === 'number' ? n.toLocaleString() : '—');
const shortTime = (ts) => {
  const d = new Date(String(ts).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleTimeString();
};

function modelField(reg) {
  let api = null;
  let ui = null;
  let models = [];
  let wanted = null; // a saved schedule's model, applied once the list arrives

  function fill(list, { stale, reachable, error }) {
    models = list;
    const prev = wanted || ui.select.value;
    ui.select.replaceChildren();
    if (!list.length) ui.select.append(h('option', { value: '', text: reachable === false ? 'No models (gateway unreachable)' : 'No OpenAI models listed' }));
    for (const id of list) ui.select.append(h('option', { value: id, text: id }));
    if (prev && list.includes(prev)) ui.select.value = prev;
    else if (prev && !list.length) { ui.select.append(h('option', { value: prev, text: prev })); ui.select.value = prev; }
    wanted = null;
    ui.status.textContent = reachable === false
      ? `Bifrost isn't reachable${error ? ` (${error})` : ''}.${stale && list.length ? ' Showing the last list it returned.' : ''}`
      : '';
    ui.status.hidden = !ui.status.textContent;
  }

  reg.onMessage((msg) => {
    if (msg?.kind === 'models' && ui) fill(Array.isArray(msg.models) ? msg.models.filter((m) => typeof m === 'string') : [], msg);
  });

  function request() {
    ui.status.textContent = 'Loading models…';
    ui.status.hidden = false;
    api.send({ type: 'bifrost-models' });
  }

  return {
    id: 'bifrost-model',
    at: 'model',
    hides: (draft) => (draft?.runtime === RUNTIME ? ['model'] : []),

    mount(el, hostApi) {
      api = hostApi;
      const select = h('select', { id: 'bifrost-model-select', 'aria-label': 'OpenAI model' });
      const status = h('p', { class: 'bifrost-status', hidden: true });
      const notes = h('ul', { class: 'bifrost-limits' }, ...LIMITATIONS.map((t) => h('li', { text: t })));
      const root = h('div', { class: 'bifrost-field' },
        h('label', { for: 'bifrost-model-select', text: 'OpenAI model' }), select, status, notes);
      el.append(root);
      ui = { root, select, status, visible: false };
    },

    // core's .ext-slot is display: contents, which beats [hidden], so hide our
    // own wrapper as well as the host.
    update(el, ctx) {
      if (!ui) return;
      const on = ctx?.draft?.runtime === RUNTIME;
      el.hidden = !on;
      ui.root.hidden = !on;
      if (on && !ui.visible) request();
      ui.visible = on;
    },

    open(el, ctx) {
      if (!ui) return;
      const saved = ctx?.editing ? ctx?.saved?.model : null;
      if (typeof saved === 'string' && saved) {
        wanted = saved;
        if (models.includes(saved)) ui.select.value = saved;
      }
    },

    fields() {
      return ui?.visible ? { model: 'opus' } : {};
    },

    ext() {
      if (!ui?.visible) return undefined;
      return ui.select.value ? { model: ui.select.value } : undefined;
    },
  };
}

function table(head, rows) {
  return h('table', { class: 'bifrost-table' },
    h('thead', {}, h('tr', {}, ...head.map((t) => h('th', { text: t })))),
    h('tbody', {}, ...rows));
}

function view(reg) {
  let api = null;
  let ui = null;
  let recent = null;
  let lastPoll = 0;

  reg.onMessage((msg) => {
    if (msg?.kind !== 'recent' || !ui) return;
    recent = msg;
    drawRecent();
  });

  function drawStatus(b) {
    const parts = [];
    if (!b) parts.push('Waiting for the server…');
    else {
      parts.push(b.reachable === true ? `Gateway reachable at ${b.url}`
        : b.reachable === false ? `Gateway unreachable at ${b.url}${b.gatewayError ? ` (${b.gatewayError})` : ''}`
          : `Checking gateway at ${b.url}…`);
      parts.push(b.logs?.ok ? 'logs.db ok' : `logs.db ${b.logs?.reason === 'missing' ? 'missing' : `unavailable: ${b.logs?.reason || 'unknown'}`}`);
    }
    ui.status.textContent = parts.join(' · ');
    ui.status.classList.toggle('bifrost-bad', !!b && (b.reachable === false || !b.logs?.ok));
  }

  function drawTotals(b) {
    const rows = (b?.totalsByModel || []).map((r) => h('tr', {},
      h('td', { text: `${r.provider}/${r.model}` }), h('td', { text: num(r.requests) }),
      h('td', { text: num(r.prompt) }), h('td', { text: num(r.cached) }), h('td', { text: num(r.completion) }),
      h('td', { text: money(r.usd) })));
    ui.totals.replaceChildren(rows.length
      ? table(['Model', 'Requests', 'Prompt', 'Cached', 'Completion', 'USD'], rows)
      : h('p', { class: 'bifrost-empty', text: 'No requests logged.' }));
  }

  function drawRecent() {
    if (!recent) return;
    if (!recent.ok) {
      ui.recent.replaceChildren(h('p', { class: 'bifrost-empty', text: `Recent requests unavailable: ${recent.reason || 'unknown'}` }));
      return;
    }
    const known = new Set((ui.sessions || []).map((s) => s.sessionId));
    const rows = recent.rows.map((r) => {
      const card = known.has(r.sessionId)
        ? h('button', { class: 'bifrost-card-link', type: 'button', text: ui.names.get(r.sessionId) || r.sessionId.slice(0, 8), onclick: () => api.openSession(r.sessionId) })
        : h('span', { class: 'bifrost-muted', text: 'unattributed' });
      const err = r.error ? String(r.error) : '';
      return h('tr', {},
        h('td', { text: shortTime(r.timestamp), title: String(r.timestamp) }), h('td', {}, card),
        h('td', { text: `${r.provider}/${r.model}` }), h('td', { text: num(r.prompt) }), h('td', { text: num(r.cached) }),
        h('td', { text: num(r.completion) }), h('td', { text: money(r.cost) }), h('td', { text: String(r.status || '') }),
        h('td', { class: 'bifrost-error', text: err.length > 80 ? `${err.slice(0, 80)}…` : err, title: err }));
    });
    ui.recent.replaceChildren(rows.length
      ? table(['Time', 'Card', 'Model', 'Prompt', 'Cached', 'Completion', 'Cost', 'Status', 'Error'], rows)
      : h('p', { class: 'bifrost-empty', text: 'No requests logged.' }));
  }

  return {
    id: 'bifrost',
    label: 'Bifrost',
    icon: ICON,
    mount(el, hostApi) {
      api = hostApi;
      const status = h('p', { class: 'bifrost-status-line' });
      const totals = h('div');
      const recentEl = h('div');
      const root = h('div', { class: 'bifrost-view' },
        h('h2', { text: 'Bifrost' }), status,
        h('h3', { text: 'Totals by model' }), totals,
        h('h3', { text: 'Recent requests' }), recentEl);
      el.append(root);
      ui = { root, status, totals, recent: recentEl, sessions: [], names: new Map() };
      drawStatus(null);
    },
    update(el, _session, graph) {
      if (!ui) return;
      const b = graph?.bifrost;
      ui.sessions = Array.isArray(graph?.sessions) ? graph.sessions : [];
      ui.names = new Map(ui.sessions.map((s) => [s.sessionId, s.name || s.aiTitle || '']).filter(([, n]) => n));
      drawStatus(b);
      drawTotals(b);
      // Poll recent rows only while the view is on screen. The host is
      // display: contents (no offsetParent), so test our own root.
      const shown = ui.root.isConnected && ui.root.offsetParent !== null;
      if (shown && Date.now() - lastPoll > RECENT_POLL_MS) {
        lastPoll = Date.now();
        api.send({ type: 'bifrost-recent', limit: 200 });
      }
      drawRecent();
    },
  };
}

export default {
  register(reg) {
    reg.register('dispatch.field', modelField(reg));
    reg.register('view', view(reg));
  },
};
