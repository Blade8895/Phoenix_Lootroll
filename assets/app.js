(() => {
  'use strict';

  const COOKIE = 'loot_user';
  const COOKIE_DAYS = 5;
  const POLL_MS = 5000;
  const STATUS_LABEL = { draft: 'Entwurf', open: 'Offen', closed: 'Abgeschlossen' };
  const TYPE_LABEL = { ore: 'Erz', component: 'Komponente' };

  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const nameDialog = document.getElementById('name-dialog');
  const nameInput = document.getElementById('name-input');

  let components = {};
  let pollTimer = null;

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
    toast.timer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  async function api(action, { params = {}, body = null } = {}) {
    const query = new URLSearchParams({ action, ...params });
    const opts = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {};
    const res = await fetch('api.php?' + query, { credentials: 'same-origin', ...opts });
    const data = await res.json().catch(() => ({ error: 'Serverfehler.' }));
    if (!res.ok || data.error) {
      if (res.status === 401) askName();
      throw new Error(data.error || 'Unbekannter Fehler.');
    }
    return data;
  }

  function formatDate(ts) {
    return new Date(ts * 1000).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
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

  async function renderOverview() {
    stopPolling();
    const titleInput = h('input', { type: 'text', maxlength: 80, required: true, placeholder: 'z. B. Mining-Run Aaron Halo 27.09.' });
    const createForm = h('form', {
      class: 'inline-form',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const { id } = await api('create_list', { body: { title: titleInput.value } });
          location.hash = `#/list/${id}`;
        } catch (err) { toast(err.message, true); }
      },
    },
      h('label', { class: 'field grow' }, h('span', {}, 'Titel der Lootliste'), titleInput),
      h('button', { class: 'btn btn-primary', type: 'submit' }, '+ Neue Lootliste'),
    );

    const listWrap = h('div', { class: 'list-grid' }, h('p', { class: 'muted' }, 'Lade …'));

    app.replaceChildren(
      h('section', { class: 'hero' },
        h('h1', {}, 'Loot', h('span', { class: 'accent' }, 'roll')),
        h('p', { class: 'muted' }, 'Lootliste anlegen, freigeben – und jeder würfelt einmal pro Item. Main 0–100, Twink 0–50. Main schlägt Twink.'),
      ),
      h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, 'Neue Lootliste'), createForm),
      h('section', {}, h('h2', { class: 'section-title' }, 'Lootlisten'), listWrap),
    );

    try {
      const { lists } = await api('lists');
      if (!lists.length) {
        listWrap.replaceChildren(h('p', { class: 'muted empty' }, 'Noch keine Lootlisten vorhanden.'));
        return;
      }
      listWrap.replaceChildren(...lists.map((l) =>
        h('a', { class: `card list-card status-${l.status}`, href: `#/list/${l.id}` },
          h('div', { class: 'card-head' },
            h('h3', {}, l.title),
            h('span', { class: `badge badge-${l.status}` }, STATUS_LABEL[l.status]),
          ),
          h('p', { class: 'muted small' }, `${l.item_count} Item${l.item_count === 1 ? '' : 's'} · von ${l.created_by} · ${formatDate(l.created_at)}`),
        ),
      ));
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
    const qualityField = h('label', { class: 'field', hidden: true }, h('span', {}, 'Qualität'), qualityEl);
    const compField = h('label', { class: 'field', hidden: true }, h('span', {}, 'Komponenten-Typ'), compEl);

    const syncFields = () => {
      qualityField.hidden = typeEl.value !== 'ore';
      compField.hidden = typeEl.value !== 'component';
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
      h('button', { class: 'btn btn-primary', type: 'submit' }, '+ Item hinzufügen'),
    );
  }

  function buildItemCard(list, item, user, rerender) {
    const isOwner = sameUser(list.created_by, user);
    const myRoll = item.rolls.find((r) => sameUser(r.username, user));
    const winners = item.winners.map((w) => w.toLocaleLowerCase());
    const tie = item.winners.length > 1;

    const roll = async (kind) => {
      try {
        const { list: updated } = await api('roll', { body: { item_id: item.id, kind } });
        rerender(updated);
        const mine = updated.items.find((i) => i.id === item.id).rolls.find((r) => sameUser(r.username, user));
        if (mine) toast(`${item.name}: ${mine.kind === 'main' ? 'Main' : 'Twink'}-Wurf ${mine.value}`);
      } catch (err) { toast(err.message, true); }
    };

    let actions = null;
    if (list.status === 'draft' && isOwner) {
      actions = h('button', {
        class: 'btn btn-ghost btn-sm danger',
        type: 'button',
        onclick: async () => {
          try {
            const { list: updated } = await api('delete_item', { body: { item_id: item.id } });
            rerender(updated);
          } catch (err) { toast(err.message, true); }
        },
      }, 'Entfernen');
    } else if (list.status === 'open' && !myRoll) {
      actions = h('div', { class: 'roll-buttons' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => roll('main') }, '🎲 Main (0–100)'),
        h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => roll('twink') }, '🎲 Twink (0–50)'),
      );
    } else if (myRoll) {
      actions = h('span', { class: 'my-roll' }, `Dein Wurf: ${myRoll.value} (${myRoll.kind === 'main' ? 'Main' : 'Twink'})`);
    }

    const rollRows = item.rolls.map((r) => {
      const isWinner = winners.includes(r.username.toLocaleLowerCase());
      return h('li', { class: `roll${isWinner ? ' winner' : ''}${sameUser(r.username, user) ? ' mine' : ''}` },
        h('span', { class: 'roll-name' }, isWinner ? '👑 ' : '', r.username),
        h('span', { class: `roll-kind kind-${r.kind}` }, r.kind === 'main' ? 'Main' : 'Twink'),
        h('span', { class: 'roll-value' }, r.value),
      );
    });

    let resultLine = null;
    if (list.status !== 'draft') {
      if (!item.rolls.length) resultLine = h('p', { class: 'muted small' }, 'Noch keine Würfe.');
      else if (tie) resultLine = h('p', { class: 'tie' }, `⚠ Gleichstand: ${item.winners.join(', ')}`);
      else resultLine = h('p', { class: 'winner-line' }, list.status === 'closed' ? 'Gewinner: ' : 'Führt: ', h('strong', {}, item.winners[0]));
    }

    return h('article', { class: 'card item-card' },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h3', {}, item.name),
          h('div', { class: 'tags' }, itemMeta(item)),
        ),
        actions,
      ),
      resultLine,
      rollRows.length ? h('ol', { class: 'rolls' }, rollRows) : null,
    );
  }

  async function renderList(id) {
    stopPolling();
    const user = getUser();
    app.replaceChildren(h('p', { class: 'muted' }, 'Lade …'));

    let lastJson = '';
    let formEl = null;

    const rerender = (list, resetForm = false) => {
      lastJson = JSON.stringify(list);
      const isOwner = sameUser(list.created_by, user);

      if (list.status === 'draft' && isOwner && (!formEl || resetForm)) formEl = buildItemForm(list, rerender);

      const ownerActions = [];
      if (isOwner && list.status === 'draft') {
        ownerActions.push(h('button', {
          class: 'btn btn-primary',
          type: 'button',
          onclick: async () => {
            if (!confirm('Liste speichern und zum Würfeln freigeben? Danach sind keine Änderungen an den Items mehr möglich.')) return;
            try { rerender((await api('publish', { body: { list_id: list.id } })).list); toast('Liste freigegeben – es darf gewürfelt werden!'); } catch (err) { toast(err.message, true); }
          },
        }, '✔ Speichern & freigeben'));
      }
      if (isOwner && list.status === 'open') {
        ownerActions.push(h('button', {
          class: 'btn btn-secondary',
          type: 'button',
          onclick: async () => {
            if (!confirm('Verteilung abschließen? Danach sind keine Würfe mehr möglich.')) return;
            try { rerender((await api('close', { body: { list_id: list.id } })).list); } catch (err) { toast(err.message, true); }
          },
        }, '🏁 Verteilung abschließen'));
      }
      if (isOwner) {
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
      if (list.status === 'draft' && !isOwner) hint = 'Diese Liste wird noch vom Ersteller bearbeitet. Würfeln ist nach der Freigabe möglich.';
      if (list.status === 'draft' && isOwner) hint = 'Füge Items hinzu und gib die Liste frei, sobald sie vollständig ist.';
      if (list.status === 'open') hint = 'Du kannst auf jedes Item genau einmal würfeln – Main (0–100) oder Twink (0–50). Main-Würfe haben Vorrang.';

      app.replaceChildren(...[
        h('a', { class: 'back-link', href: '#/' }, '← Alle Lootlisten'),
        h('section', { class: 'panel list-header' },
          h('div', {},
            h('div', { class: 'card-head' },
              h('h1', { class: 'list-title' }, list.title),
              h('span', { class: `badge badge-${list.status}` }, STATUS_LABEL[list.status]),
            ),
            h('p', { class: 'muted small' }, `Erstellt von ${list.created_by} · ${formatDate(list.created_at)} · ${list.items.length} Items`),
            hint && h('p', { class: 'hint' }, hint),
          ),
          ownerActions.length ? h('div', { class: 'actions' }, ownerActions) : null,
        ),
        formEl && list.status === 'draft' && isOwner
          ? h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, 'Item hinzufügen'), formEl)
          : null,
        h('section', { class: 'items' },
          list.items.length
            ? list.items.map((item) => buildItemCard(list, item, user, rerender))
            : h('p', { class: 'muted empty' }, 'Noch keine Items in dieser Liste.'),
        ),
      ].filter(Boolean));
      if (resetForm) formEl.querySelector('input').focus();
    };

    try {
      rerender((await api('list', { params: { id } })).list);
    } catch (err) {
      app.replaceChildren(h('a', { class: 'back-link', href: '#/' }, '← Alle Lootlisten'), h('p', { class: 'error-text' }, err.message));
      return;
    }

    // Live-Aktualisierung (nicht während der Ersteller Items einträgt).
    pollTimer = setInterval(async () => {
      if (document.hidden || (formEl && formEl.contains(document.activeElement))) return;
      try {
        const { list } = await api('list', { params: { id } });
        if (JSON.stringify(list) !== lastJson) rerender(list);
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
    try { components = (await api('components')).components; } catch (err) { toast(err.message, true); }
    route();
  })();
})();
