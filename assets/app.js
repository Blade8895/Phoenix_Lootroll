(() => {
  'use strict';

  const COOKIE = 'loot_user';
  const COOKIE_DAYS = 5;
  const POLL_MS = 5000;
  const DEFAULT_DEADLINE_HOURS = 24;
  const PHASE_LABEL = { draft: 'Entwurf', open: 'Offen', expired: 'Beendet', closed: 'Abgeschlossen' };
  const TYPE_LABEL = { ore: 'Erz', component: 'Komponente' };
  // Interne Schlüssel main/twink bleiben, angezeigt wird Priorität/Gier.
  const KIND_LABEL = { main: 'Priorität', twink: 'Gier', pass: 'Kein Interesse' };
  // API relativ zum Skript auflösen – funktioniert auch, wenn die Seite ohne "/" am Ende aufgerufen wird.
  const API_URL = new URL('../api.php', document.currentScript.src).href;

  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const nameDialog = document.getElementById('name-dialog');
  const nameInput = document.getElementById('name-input');

  let components = {};
  let componentClasses = ['A', 'B', 'C', 'D'];
  let pollTimer = null;
  let clockSkew = 0; // Serverzeit - Browserzeit (Sekunden)

  // ---------- Helpers ----------

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'class') el.className = value;
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function getUser() {
    const match = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function setUser(name) {
    const maxAge = COOKIE_DAYS * 24 * 60 * 60;
    document.cookie = `${COOKIE}=${encodeURIComponent(name)}; max-age=${maxAge}; path=/; SameSite=Lax`;
  }

  function sameUser(a, b) {
    return a.toLocaleLowerCase() === b.toLocaleLowerCase();
  }

  function toast(message, isError = false) {
    toastEl.textContent = message;
    toastEl.classList.toggle('error', isError);
    toastEl.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => toastEl.classList.remove('show'), isError ? 6000 : 3200);
  }

  async function api(action, { params = {}, body = null } = {}) {
    const url = new URL(API_URL);
    url.search = new URLSearchParams({ action, ...params });
    const opts = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {};
    const res = await fetch(url, { credentials: 'same-origin', ...opts });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const snippet = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
      throw new Error(`Serverfehler (HTTP ${res.status})${snippet ? ': ' + snippet : ''}`);
    }
    if (!res.ok || data.error) {
      if (res.status === 401) askName();
      throw new Error(data.error || `Unbekannter Fehler (HTTP ${res.status}).`);
    }
    if (typeof data.server_time === 'number') clockSkew = data.server_time - Date.now() / 1000;
    return data;
  }

  const now = () => Date.now() / 1000 + clockSkew;

  function formatDate(ts) {
    return new Date(ts * 1000).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  }

  function formatRemaining(seconds) {
    if (seconds <= 0) return 'abgelaufen';
    const d = Math.floor(seconds / 86400);
    const hrs = Math.floor((seconds % 86400) / 3600);
    const min = Math.floor((seconds % 3600) / 60);
    const sec = Math.floor(seconds % 60);
    if (d > 0) return `noch ${d} T ${hrs} Std`;
    if (hrs > 0) return `noch ${hrs} Std ${min} Min`;
    if (min > 0) return `noch ${min} Min ${sec} s`;
    return `noch ${sec} s`;
  }

  /** "2026-09-28T20:00" für <input type="datetime-local"> in lokaler Zeit. */
  function toLocalInput(ts) {
    const d = new Date(ts * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromLocalInput(value) {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }

  function deadlineInput(ts) {
    return h('input', {
      type: 'datetime-local',
      required: true,
      min: toLocalInput(now()),
      value: toLocalInput(ts),
    });
  }

  /** Deadline-Anzeige mit Live-Countdown (wird vom Ticker unten aktualisiert). */
  function deadlineInfo(list) {
    if (!list.deadline) return h('span', { class: 'deadline muted' }, '⏱ keine Deadline');
    const relevant = list.phase === 'open' || list.phase === 'draft';
    return h('span', { class: `deadline${list.phase === 'expired' ? ' expired' : ''}` },
      `⏱ Deadline ${formatDate(list.deadline)}`,
      relevant ? h('span', { class: 'countdown', 'data-deadline': list.deadline }, ` · ${formatRemaining(list.deadline - now())}`) : null,
    );
  }

  setInterval(() => {
    for (const el of document.querySelectorAll('.countdown[data-deadline]')) {
      const remaining = Number(el.dataset.deadline) - now();
      el.textContent = ` · ${formatRemaining(remaining)}`;
      el.classList.toggle('soon', remaining > 0 && remaining < 3600);
    }
  }, 1000);

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function isEditing() {
    const el = document.activeElement;
    return el && app.contains(el) && (el.tagName === 'INPUT' || el.tagName === 'SELECT');
  }

  // ---------- Username ----------

  function askName() {
    nameInput.value = getUser();
    if (!nameDialog.open) nameDialog.showModal();
    nameInput.focus();
  }

  function renderUser() {
    const user = getUser();
    document.getElementById('user-box').hidden = !user;
    document.getElementById('user-name').textContent = user;
  }

  document.getElementById('name-form').addEventListener('submit', (e) => {
    const name = nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 32);
    if (!name) {
      e.preventDefault();
      return;
    }
    setUser(name);
    renderUser();
    route();
  });
  nameDialog.addEventListener('cancel', (e) => { if (!getUser()) e.preventDefault(); });
  document.getElementById('change-user').addEventListener('click', askName);

  // ---------- Overview ----------

  function listCard(l) {
    const doneInfo = l.item_count && l.phase !== 'draft' ? ` · ${l.done_count}/${l.item_count} erledigt` : '';
    return h('a', { class: `card list-card phase-${l.phase}${l.archived ? ' archived' : ''}`, href: `#/list/${l.id}` },
      h('div', { class: 'card-head' },
        h('h3', {}, l.title),
        h('span', { class: `badge badge-${l.archived ? 'archived' : l.phase}` }, l.archived ? 'Archiviert' : PHASE_LABEL[l.phase]),
      ),
      h('p', { class: 'muted small' }, `${l.item_count} Item${l.item_count === 1 ? '' : 's'}${doneInfo} · von ${l.created_by}`),
      h('p', { class: 'small' }, deadlineInfo(l)),
    );
  }

  async function renderOverview() {
    stopPolling();
    const titleInput = h('input', { type: 'text', maxlength: 80, required: true, placeholder: 'z. B. Mining-Run Aaron Halo 27.09.' });
    const deadlineEl = deadlineInput(now() + DEFAULT_DEADLINE_HOURS * 3600);
    const createForm = h('form', {
      class: 'inline-form',
      onsubmit: async (e) => {
        e.preventDefault();
        const deadline = fromLocalInput(deadlineEl.value);
        if (!deadline) { toast('Bitte eine Deadline angeben.', true); return; }
        try {
          const { id } = await api('create_list', { body: { title: titleInput.value, deadline } });
          location.hash = `#/list/${id}`;
        } catch (err) { toast(err.message, true); }
      },
    },
      h('label', { class: 'field grow' }, h('span', {}, 'Titel der Lootliste *'), titleInput),
      h('label', { class: 'field' }, h('span', {}, 'Deadline *'), deadlineEl),
      h('button', { class: 'btn btn-primary', type: 'submit' }, '+ Neue Lootliste'),
    );

    const listWrap = h('div', { class: 'list-grid' }, h('p', { class: 'muted' }, 'Lade …'));
    const archiveWrap = h('div');

    app.replaceChildren(
      h('section', { class: 'hero' },
        h('h1', {}, 'Loot', h('span', { class: 'accent' }, 'roll')),
        h('p', { class: 'muted' }, 'Lootliste anlegen, freigeben – und jeder würfelt bis zur Deadline einmal pro Item. Priorität 0–100, Gier 0–50 oder Kein Interesse. Priorität schlägt Gier.'),
      ),
      h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, 'Neue Lootliste'), createForm),
      h('section', {}, h('h2', { class: 'section-title' }, 'Lootlisten'), listWrap),
      archiveWrap,
    );

    try {
      const { lists } = await api('lists');
      const active = lists.filter((l) => !l.archived);
      const archived = lists.filter((l) => l.archived);
      listWrap.replaceChildren(...(active.length
        ? active.map(listCard)
        : [h('p', { class: 'muted empty' }, 'Keine aktiven Lootlisten vorhanden.')]));
      if (archived.length) {
        archiveWrap.replaceChildren(h('details', { class: 'archive' },
          h('summary', { class: 'section-title' }, `Archiv (${archived.length})`),
          h('div', { class: 'list-grid' }, archived.map(listCard)),
        ));
      }
    } catch (err) {
      listWrap.replaceChildren(h('p', { class: 'error-text' }, err.message));
    }
  }

  // ---------- List detail ----------

  function itemMeta(item) {
    const parts = [];
    if (item.type) parts.push(h('span', { class: `tag tag-${item.type}` }, TYPE_LABEL[item.type]));
    if (item.type === 'ore' && item.quality !== null) parts.push(h('span', { class: 'tag' }, `Qualität ${item.quality}`));
    if (item.type === 'component' && item.component_type) parts.push(h('span', { class: 'tag' }, item.component_type));
    if (item.type === 'component' && item.component_class) parts.push(h('span', { class: 'tag tag-class' }, `Class ${item.component_class}`));
    return parts;
  }

  function buildItemForm(list, rerender) {
    const nameEl = h('input', { type: 'text', maxlength: 100, required: true, placeholder: 'z. B. Quantanium, FR-86 Shield …' });
    const typeEl = h('select', {},
      h('option', { value: '' }, '— kein Typ —'),
      h('option', { value: 'ore' }, 'Erz'),
      h('option', { value: 'component' }, 'Komponente'),
    );
    const qualityEl = h('input', { type: 'number', min: 0, max: 1000, step: 1, placeholder: '0 – 1000' });
    const compEl = h('select', {},
      h('option', { value: '' }, '— Komponenten-Typ wählen —'),
      Object.entries(components).map(([group, types]) =>
        h('optgroup', { label: group }, types.map((t) => h('option', { value: t }, t)))),
    );
    const classEl = h('select', {},
      h('option', { value: '' }, '—'),
      componentClasses.map((c) => h('option', { value: c }, `Class ${c}`)),
    );
    const qualityField = h('label', { class: 'field', hidden: true }, h('span', {}, 'Qualität'), qualityEl);
    const compField = h('label', { class: 'field', hidden: true }, h('span', {}, 'Komponenten-Typ'), compEl);
    const classField = h('label', { class: 'field field-narrow', hidden: true }, h('span', {}, 'Class'), classEl);

    const syncFields = () => {
      qualityField.hidden = typeEl.value !== 'ore';
      compField.hidden = typeEl.value !== 'component';
      classField.hidden = typeEl.value !== 'component';
    };
    typeEl.addEventListener('change', syncFields);

    return h('form', {
      class: 'item-form',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const { list: updated } = await api('add_item', {
            body: {
              list_id: list.id,
              name: nameEl.value,
              type: typeEl.value || null,
              quality: typeEl.value === 'ore' ? qualityEl.value : null,
              component_type: typeEl.value === 'component' ? compEl.value : null,
              component_class: typeEl.value === 'component' ? classEl.value : null,
            },
          });
          rerender(updated, true);
        } catch (err) { toast(err.message, true); }
      },
    },
      h('label', { class: 'field' }, h('span', {}, 'Name *'), nameEl),
      h('label', { class: 'field' }, h('span', {}, 'Typ'), typeEl),
      qualityField,
      compField,
      classField,
      h('button', { class: 'btn btn-primary', type: 'submit' }, '+ Item hinzufügen'),
    );
  }

  function buildDeadlineForm(list, rerender) {
    const input = deadlineInput(list.deadline && list.deadline > now() ? list.deadline : now() + DEFAULT_DEADLINE_HOURS * 3600);
    return h('form', {
      class: 'deadline-form',
      onsubmit: async (e) => {
        e.preventDefault();
        const deadline = fromLocalInput(input.value);
        if (!deadline) { toast('Bitte eine Deadline angeben.', true); return; }
        try {
          rerender((await api('set_deadline', { body: { list_id: list.id, deadline } })).list);
          toast('Deadline gespeichert.');
        } catch (err) { toast(err.message, true); }
      },
    },
      h('label', { class: 'field' }, h('span', {}, list.phase === 'expired' ? 'Deadline verlängern' : 'Deadline ändern'), input),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'submit' }, 'Speichern'),
    );
  }

  function buildItemCard(list, item, user, rerender) {
    const isOwner = sameUser(list.created_by, user);
    const myRoll = item.rolls.find((r) => sameUser(r.username, user));
    const rolls = item.rolls.filter((r) => r.kind !== 'pass');
    const passes = item.rolls.filter((r) => r.kind === 'pass');
    const winners = item.winners.map((w) => w.toLocaleLowerCase());
    const tie = item.winners.length > 1;
    const canRoll = list.phase === 'open' && !list.archived && !item.done;

    const post = async (action, body) => {
      try {
        const { list: updated } = await api(action, { body });
        rerender(updated);
        return updated;
      } catch (err) {
        toast(err.message, true);
        return null;
      }
    };

    const roll = async (kind) => {
      const updated = await post('roll', { item_id: item.id, kind });
      const mine = updated && updated.items.find((i) => i.id === item.id).rolls.find((r) => sameUser(r.username, user));
      if (mine) toast(mine.kind === 'pass' ? `${item.name}: Kein Interesse` : `${item.name}: ${KIND_LABEL[mine.kind]}-Wurf ${mine.value}`);
    };

    const actions = [];
    if (list.phase === 'draft' && isOwner && !list.archived) {
      actions.push(h('button', {
        class: 'btn btn-ghost btn-sm danger',
        type: 'button',
        onclick: () => post('delete_item', { item_id: item.id }),
      }, 'Entfernen'));
    }
    if (canRoll && !myRoll) {
      actions.push(h('div', { class: 'roll-buttons' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => roll('main') }, '🎲 Priorität (0–100)'),
        h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => roll('twink') }, '🎲 Gier (0–50)'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => roll('pass') }, '✖ Kein Interesse'),
      ));
    } else if (myRoll && myRoll.kind === 'pass') {
      actions.push(h('span', { class: 'my-roll my-pass' }, 'Kein Interesse'));
      if (canRoll) {
        actions.push(h('button', {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onclick: () => post('unpass', { item_id: item.id }),
        }, '↺ Doch würfeln'));
      }
    } else if (myRoll) {
      actions.push(h('span', { class: 'my-roll' }, `Dein Wurf: ${myRoll.value} (${KIND_LABEL[myRoll.kind]})`));
    }
    if (isOwner && list.phase !== 'draft' && !list.archived) {
      actions.push(h('button', {
        class: `btn btn-sm ${item.done ? 'btn-ghost' : 'btn-success'}`,
        type: 'button',
        onclick: () => post('toggle_done', { item_id: item.id }),
      }, item.done ? '↺ Rückgängig' : '✔ Erledigt'));
    }

    const rollRows = rolls.map((r) => {
      const isWinner = winners.includes(r.username.toLocaleLowerCase());
      return h('li', { class: `roll${isWinner ? ' winner' : ''}${sameUser(r.username, user) ? ' mine' : ''}` },
        h('span', { class: 'roll-name' }, isWinner ? '👑 ' : '', r.username),
        h('span', { class: `roll-kind kind-${r.kind}` }, KIND_LABEL[r.kind]),
        h('span', { class: 'roll-value' }, r.value),
      );
    });

    let resultLine = null;
    if (list.phase !== 'draft') {
      const final = list.phase !== 'open' || item.done;
      if (!rolls.length) resultLine = h('p', { class: 'muted small' }, 'Keine Würfe.');
      else if (tie) resultLine = h('p', { class: 'tie' }, `⚠ Gleichstand: ${item.winners.join(', ')}`);
      else resultLine = h('p', { class: 'winner-line' }, final ? 'Gewinner: ' : 'Führt: ', h('strong', {}, item.winners[0]));
    }

    return h('article', { class: `card item-card${item.done ? ' done' : ''}` },
      item.done ? h('span', { class: 'done-check', title: 'Erledigt', 'aria-label': 'Erledigt' }, '✔') : null,
      h('div', { class: 'card-head' },
        h('div', { class: 'item-title' },
          h('h3', {}, item.name),
          h('div', { class: 'tags' }, itemMeta(item)),
        ),
        actions.length ? h('div', { class: 'item-actions' }, actions) : null,
      ),
      resultLine,
      rollRows.length ? h('ol', { class: 'rolls' }, rollRows) : null,
      passes.length
        ? h('p', { class: 'passes muted small' }, 'Kein Interesse: ', passes.map((r) => r.username).join(', '))
        : null,
    );
  }

  async function renderList(id) {
    stopPolling();
    const user = getUser();
    app.replaceChildren(h('p', { class: 'muted' }, 'Lade …'));

    let lastJson = '';
    let formEl = null;
    const snapshot = (list) => JSON.stringify({ ...list, server_time: 0 });

    const rerender = (list, resetForm = false) => {
      lastJson = snapshot(list);
      const isOwner = sameUser(list.created_by, user);
      const editable = isOwner && !list.archived;

      if (list.phase === 'draft' && editable && (!formEl || resetForm)) formEl = buildItemForm(list, rerender);

      const call = (action, extra = {}, message = null) => async () => {
        try {
          rerender((await api(action, { body: { list_id: list.id, ...extra } })).list);
          if (message) toast(message);
        } catch (err) { toast(err.message, true); }
      };

      const ownerActions = [];
      if (editable && list.phase === 'draft') {
        ownerActions.push(h('button', {
          class: 'btn btn-primary',
          type: 'button',
          onclick: () => confirm('Liste speichern und zum Würfeln freigeben? Danach sind keine Änderungen an den Items mehr möglich.')
            && call('publish', {}, 'Liste freigegeben – es darf gewürfelt werden!')(),
        }, '✔ Speichern & freigeben'));
      }
      if (editable && (list.phase === 'open' || list.phase === 'expired')) {
        ownerActions.push(h('button', {
          class: 'btn btn-secondary',
          type: 'button',
          onclick: () => confirm('Verteilung endgültig abschließen? Danach sind keine Würfe mehr möglich.') && call('close')(),
        }, '🏁 Verteilung abschließen'));
      }
      if (isOwner) {
        ownerActions.push(h('button', {
          class: 'btn btn-ghost',
          type: 'button',
          onclick: call('archive', { archived: !list.archived }, list.archived ? 'Liste wiederhergestellt.' : 'Liste archiviert.'),
        }, list.archived ? '↺ Wiederherstellen' : '🗄 Archivieren'));
        ownerActions.push(h('button', {
          class: 'btn btn-ghost danger',
          type: 'button',
          onclick: async () => {
            if (!confirm('Lootliste endgültig löschen?')) return;
            try { await api('delete_list', { body: { list_id: list.id } }); location.hash = '#/'; } catch (err) { toast(err.message, true); }
          },
        }, 'Löschen'));
      }

      let hint = null;
      if (list.archived) hint = 'Diese Liste ist archiviert und schreibgeschützt.';
      else if (list.phase === 'draft' && !isOwner) hint = 'Diese Liste wird noch vom Ersteller bearbeitet. Würfeln ist nach der Freigabe möglich.';
      else if (list.phase === 'draft') hint = 'Füge Items hinzu und gib die Liste frei, sobald sie vollständig ist.';
      else if (list.phase === 'open') hint = 'Entscheide dich bis zur Deadline für jedes Item genau einmal: Priorität (0–100), Gier (0–50) oder Kein Interesse. Priorität-Würfe haben Vorrang.';
      else if (list.phase === 'expired') hint = 'Die Deadline ist abgelaufen – es kann nicht mehr gewürfelt werden.';

      const doneCount = list.items.filter((i) => i.done).length;

      app.replaceChildren(...[
        h('a', { class: 'back-link', href: '#/' }, '← Alle Lootlisten'),
        list.archived ? h('div', { class: 'archived-banner' }, '🗄 Archiviert') : null,
        h('section', { class: 'panel list-header' },
          h('div', { class: 'list-header-main' },
            h('div', { class: 'card-head' },
              h('h1', { class: 'list-title' }, list.title),
              h('span', { class: `badge badge-${list.phase}` }, PHASE_LABEL[list.phase]),
            ),
            h('p', { class: 'muted small' },
              `Erstellt von ${list.created_by} · ${formatDate(list.created_at)} · ${list.items.length} Items`,
              list.phase !== 'draft' ? ` · ${doneCount} erledigt` : null),
            h('p', { class: 'small' }, deadlineInfo(list)),
            hint && h('p', { class: 'hint' }, hint),
            editable && (list.phase === 'draft' || list.phase === 'open' || list.phase === 'expired')
              ? buildDeadlineForm(list, rerender) : null,
          ),
          ownerActions.length ? h('div', { class: 'actions' }, ownerActions) : null,
        ),
        formEl && list.phase === 'draft' && editable
          ? h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, 'Item hinzufügen'), formEl)
          : null,
        h('section', { class: 'items' },
          list.items.length
            ? list.items.map((item) => buildItemCard(list, item, user, rerender))
            : h('p', { class: 'muted empty' }, 'Noch keine Items in dieser Liste.'),
        ),
      ].filter(Boolean));
      if (resetForm && formEl) formEl.querySelector('input').focus();
    };

    try {
      rerender((await api('list', { params: { id } })).list);
    } catch (err) {
      app.replaceChildren(h('a', { class: 'back-link', href: '#/' }, '← Alle Lootlisten'), h('p', { class: 'error-text' }, err.message));
      return;
    }

    // Live-Aktualisierung (pausiert, solange jemand etwas eingibt).
    pollTimer = setInterval(async () => {
      if (document.hidden || isEditing()) return;
      try {
        const { list } = await api('list', { params: { id } });
        if (snapshot(list) !== lastJson) rerender(list);
      } catch { /* ignorieren, nächster Versuch folgt */ }
    }, POLL_MS);
  }

  // ---------- Router ----------

  function route() {
    if (!getUser()) {
      askName();
      return;
    }
    const match = location.hash.match(/^#\/list\/(\d+)/);
    if (match) renderList(Number(match[1]));
    else renderOverview();
  }

  window.addEventListener('hashchange', route);

  (async () => {
    renderUser();
    try {
      const data = await api('components');
      components = data.components;
      if (Array.isArray(data.classes)) componentClasses = data.classes;
    } catch (err) { toast(err.message, true); }
    route();
  })();
})();
