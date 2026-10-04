(() => {
  'use strict';

  const COOKIE = 'loot_user';
  const COOKIE_DAYS = 365;
  const POLL_MS = 5000;
  const DEFAULT_DEADLINE_HOURS = 24;
  const PHASE_LABEL = { draft: 'Entwurf', open: 'Offen', expired: 'Beendet', closed: 'Abgeschlossen' };
  const TYPE_LABEL = { ore: 'Erz', component: 'Komponente', weapon: 'Schiffswaffe', commodity: 'Commodity', item: 'Item' };
  const KIND_ORDER = ['component', 'weapon', 'commodity', 'item'];
  const ARMOR_TYPES = ['Helm', 'Brustpanzerung', 'Armpanzerung', 'Beinpanzerung', 'Rucksack'];
  const SUGGEST_LIMIT = 60;
  // Interne Schlüssel main/twink bleiben, angezeigt wird Priorität/Gier.
  const KIND_LABEL = { main: 'Priorität', twink: 'Gier', pass: 'Kein Interesse' };

  /** Würfe haben 2 Nachkommastellen (weniger Gleichstände), angezeigt wird nur der ganzzahlige Teil. */
  const rollShort = (value) => String(Math.floor(value));
  const rollFull = (value) => Number(value).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rollValue = (value, cls) => h('span', { class: cls, title: `Wurf: ${rollFull(value)}` }, rollShort(value));
  // API relativ zum Skript auflösen – funktioniert auch, wenn die Seite ohne "/" am Ende aufgerufen wird.
  const API_URL = new URL('../api.php', document.currentScript.src).href;

  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const nameDialog = document.getElementById('name-dialog');
  const nameInput = document.getElementById('name-input');

  // Auswahllisten vom Server (Fallback, falls der Abruf scheitert).
  let options = {
    categories: { 'Power Plant': 'Power Plant', Cooler: 'Kühler', 'Shield Generator': 'Schild', 'Quantum Drive': 'Quantum Drive', Radar: 'Radar' },
    classes: ['Military', 'Civilian', 'Industrial', 'Stealth', 'Competition'],
    grades: ['A', 'B', 'C', 'D'],
    weapon_types: ['Energie', 'Ballistisch', 'Distortion'],
    item_types: ['Sonstiges'],
    armor: ['Leicht', 'Mittel', 'Schwer'],
    max_size: 12,
  };
  const catalogs = {}; // kind -> { promise, items, error }
  let lastKind = 'component';
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

  const fmtNumber = (n) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: 2 });

  function itemMeta(item) {
    const tag = (text, cls = '') => h('span', { class: `tag${cls ? ' ' + cls : ''}` }, text);
    const parts = [];
    if (item.type) parts.push(tag(TYPE_LABEL[item.type] || item.type, `tag-${item.type}`));
    switch (item.type) {
      case 'ore':
        if (item.quality !== null) parts.push(tag(`Qualität ${item.quality}`));
        break;
      case 'component':
        if (item.component_type) parts.push(tag(options.categories[item.component_type] || item.component_type));
        if (item.size !== null) parts.push(tag(`S${item.size}`));
        if (item.item_class) parts.push(tag(item.item_class));
        if (item.component_class) parts.push(tag(`Grade ${item.component_class}`, 'tag-class'));
        break;
      case 'weapon':
        if (item.size !== null) parts.push(tag(`S${item.size}`));
        if (item.subtype) parts.push(tag(item.subtype, 'tag-class'));
        if (item.manufacturer) parts.push(tag(item.manufacturer));
        break;
      case 'commodity':
        if (item.quantity !== null) parts.push(tag(`Menge ${fmtNumber(item.quantity)}`, 'tag-class'));
        if (item.quality !== null) parts.push(tag(`Qualität ${item.quality}`));
        break;
      case 'item':
        if (item.subtype) parts.push(tag(item.subtype, 'tag-class'));
        if (item.armor) parts.push(tag(item.armor));
        if (item.manufacturer) parts.push(tag(item.manufacturer));
        if (item.quantity !== null && item.quantity > 1) parts.push(tag(`× ${fmtNumber(item.quantity)}`));
        break;
    }
    return parts;
  }

  // ---------- Katalog & Vorschlagsliste ----------

  /** Lädt den Katalog einer Art einmal pro Seitenaufruf. */
  function loadCatalog(kind) {
    if (!catalogs[kind]) {
      const entry = { items: [], error: null };
      entry.promise = api('catalog', { params: { kind } })
        .then((data) => { entry.items = data.items || []; entry.error = data.error; })
        .catch((err) => { entry.error = err.message; });
      catalogs[kind] = entry;
    }
    return catalogs[kind];
  }

  const normalize = (text) => text.toLocaleLowerCase('de').normalize('NFD').replace(/[̀-ͯ]/g, '');

  /** Eingabefeld mit Vorschlagsliste, die sich beim Tippen verkleinert. Freie Eingabe bleibt möglich. */
  function combobox({ placeholder, entries, describe, onPick }) {
    const input = h('input', { type: 'text', maxlength: 100, required: true, placeholder, autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false' });
    const listEl = h('ul', { class: 'suggest', role: 'listbox', hidden: true });
    let matches = [];
    let active = -1;

    const close = () => { listEl.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    const highlight = (index) => {
      active = index;
      [...listEl.children].forEach((li, i) => li.classList.toggle('active', i === index));
      if (listEl.children[index]) listEl.children[index].scrollIntoView({ block: 'nearest' });
    };
    const pick = (entry) => {
      input.value = entry.n;
      close();
      onPick(entry);
    };
    const open = () => {
      const tokens = normalize(input.value.trim()).split(/\s+/).filter(Boolean);
      const all = entries();
      matches = all.filter((e) => { const n = normalize(e.n); return tokens.every((t) => n.includes(t)); });
      // Treffer am Wortanfang zuerst
      if (tokens.length) matches.sort((a, b) => normalize(b.n).startsWith(tokens[0]) - normalize(a.n).startsWith(tokens[0]));
      const shown = matches.slice(0, SUGGEST_LIMIT);
      listEl.replaceChildren(...shown.map((e) => h('li', {
        role: 'option',
        onmousedown: (ev) => { ev.preventDefault(); pick(e); },
      }, h('span', { class: 'suggest-name' }, e.n), h('span', { class: 'suggest-meta' }, describe(e)))));
      if (matches.length > shown.length) {
        listEl.append(h('li', { class: 'suggest-more' }, `… ${matches.length - shown.length} weitere – weiter tippen`));
      }
      if (!shown.length) {
        listEl.append(h('li', { class: 'suggest-more' }, all.length ? 'Kein Treffer – freie Eingabe möglich' : 'Kein Katalog – freie Eingabe möglich'));
      }
      listEl.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    };

    input.addEventListener('input', () => {
      open();
      const exact = entries().find((e) => normalize(e.n) === normalize(input.value.trim()));
      if (exact) onPick(exact);
    });
    input.addEventListener('focus', open);
    input.addEventListener('blur', close);
    input.addEventListener('keydown', (e) => {
      const count = Math.min(matches.length, SUGGEST_LIMIT);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (listEl.hidden) open();
        else if (count) highlight((active + 1) % count);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (count) highlight((active - 1 + count) % count);
      } else if (e.key === 'Enter' && !listEl.hidden && active >= 0) {
        e.preventDefault();
        pick(matches[active]);
      } else if (e.key === 'Escape' && !listEl.hidden) {
        e.preventDefault();
        close();
      }
    });

    return { input, el: h('div', { class: 'combo' }, input, listEl), refresh: () => { if (document.activeElement === input) open(); } };
  }

  // ---------- Item-Formular ----------

  const field = (label, control, cls = '') => h('label', { class: `field${cls ? ' ' + cls : ''}` }, h('span', {}, label), control);
  const selectEl = (placeholder, values, labels = {}) => h('select', {},
    h('option', { value: '' }, placeholder),
    values.map((v) => h('option', { value: v }, labels[v] || v)));
  const sizeInput = () => h('input', { type: 'number', min: 0, max: options.max_size, step: 1, placeholder: 'z. B. 2' });
  /** Setzt einen Auto-Wert; unbekannte Werte werden ignoriert. */
  const setValue = (el, value) => {
    if (value === undefined || value === null) { el.value = ''; return; }
    el.value = String(value);
    if (el.tagName === 'SELECT' && el.value !== String(value)) el.value = '';
  };

  /** Felder je Art: liefert { fields, values(), catalog? }. */
  const KIND_FORMS = {
    component() {
      const catEl = selectEl('— Kategorie wählen —', Object.keys(options.categories), options.categories);
      catEl.required = true;
      const classEl = selectEl('—', options.classes);
      const gradeEl = selectEl('—', options.grades);
      const sizeEl = sizeInput();
      const combo = combobox({
        placeholder: 'Name tippen, z. B. FR-86',
        entries: () => loadCatalog('component').items.filter((e) => !catEl.value || e.c === catEl.value),
        describe: (e) => [e.s !== undefined ? `S${e.s}` : null, e.k, e.g ? `Grade ${e.g}` : null, catEl.value ? null : options.categories[e.c]].filter(Boolean).join(' · '),
        onPick: (e) => {
          setValue(catEl, e.c);
          setValue(classEl, e.k);
          setValue(gradeEl, e.g);
          setValue(sizeEl, e.s);
        },
      });
      catEl.addEventListener('change', combo.refresh);
      return {
        catalog: 'component',
        nameInput: combo.input,
        fields: [
          field('Kategorie *', catEl),
          field('Name *', combo.el, 'grow'),
          field('Klasse', classEl),
          field('Grade', gradeEl, 'field-narrow'),
          field('Size', sizeEl, 'field-narrow'),
        ],
        values: () => ({ component_type: catEl.value, item_class: classEl.value, component_class: gradeEl.value, size: sizeEl.value }),
      };
    },

    weapon() {
      const sizeEl = sizeInput();
      const typeEl = selectEl('—', options.weapon_types);
      const manuEl = h('input', { type: 'text', maxlength: 60, placeholder: 'automatisch' });
      const combo = combobox({
        placeholder: 'Waffe tippen, z. B. Attrition',
        entries: () => loadCatalog('weapon').items,
        describe: (e) => [e.s !== undefined ? `S${e.s}` : null, e.t, e.m].filter(Boolean).join(' · '),
        onPick: (e) => {
          setValue(sizeEl, e.s);
          setValue(typeEl, e.t);
          setValue(manuEl, e.m);
        },
      });
      return {
        catalog: 'weapon',
        nameInput: combo.input,
        fields: [
          field('Waffe *', combo.el, 'grow'),
          field('Size', sizeEl, 'field-narrow'),
          field('Typ', typeEl),
          field('Hersteller', manuEl),
        ],
        values: () => ({ size: sizeEl.value, subtype: typeEl.value, manufacturer: manuEl.value }),
      };
    },

    commodity() {
      const nameEl = h('input', { type: 'text', maxlength: 100, required: true, placeholder: 'z. B. Quantanium' });
      const qtyEl = h('input', { type: 'number', min: 0.01, step: 'any', placeholder: 'z. B. 32' });
      const qualityEl = h('input', { type: 'number', min: 0, max: 1000, step: 1, placeholder: '0 – 1000' });
      return {
        nameInput: nameEl,
        fields: [
          field('Name *', nameEl, 'grow'),
          field('Menge', qtyEl, 'field-narrow'),
          field('Qualität', qualityEl, 'field-narrow'),
        ],
        values: () => ({ quantity: qtyEl.value, quality: qualityEl.value }),
      };
    },

    item() {
      const typeEl = selectEl('— Typ —', options.item_types);
      const armorEl = selectEl('—', options.armor);
      const manuEl = h('input', { type: 'text', maxlength: 60, placeholder: 'automatisch' });
      const qtyEl = h('input', { type: 'number', min: 1, step: 1, value: 1 });
      const armorField = field('Rüstungsklasse', armorEl);
      const syncArmor = () => {
        armorField.hidden = !ARMOR_TYPES.includes(typeEl.value);
        if (armorField.hidden) armorEl.value = '';
      };
      typeEl.addEventListener('change', syncArmor);
      syncArmor();
      const combo = combobox({
        placeholder: 'Item tippen, z. B. P4-AR',
        entries: () => loadCatalog('item').items,
        describe: (e) => [e.t, e.a, e.m].filter(Boolean).join(' · '),
        onPick: (e) => {
          setValue(typeEl, e.t);
          syncArmor();
          setValue(armorEl, e.a);
          setValue(manuEl, e.m);
        },
      });
      return {
        catalog: 'item',
        nameInput: combo.input,
        fields: [
          field('Item-Name *', combo.el, 'grow'),
          field('Typ', typeEl),
          armorField,
          field('Hersteller', manuEl),
          field('Anzahl', qtyEl, 'field-narrow'),
        ],
        values: () => ({ subtype: typeEl.value, armor: armorEl.value, manufacturer: manuEl.value, quantity: qtyEl.value }),
      };
    },
  };

  function buildItemForm(list, rerender) {
    const kindEl = h('select', {}, KIND_ORDER.map((k) => h('option', { value: k }, TYPE_LABEL[k])));
    kindEl.value = lastKind;
    const fieldsWrap = h('div', { class: 'item-fields' });
    const statusEl = h('p', { class: 'catalog-status muted small' });
    let current = null;

    const showStatus = (kind) => {
      const cat = loadCatalog(kind);
      statusEl.hidden = false;
      statusEl.classList.remove('error-text');
      statusEl.textContent = 'Katalog wird geladen …';
      cat.promise.then(() => {
        if (kindEl.value !== kind) return;
        if (cat.items.length) {
          statusEl.textContent = `${cat.items.length} Einträge im Katalog – Felder werden bei Auswahl automatisch ausgefüllt.`;
        } else {
          statusEl.textContent = `Katalog nicht verfügbar${cat.error ? ` (${cat.error})` : ''} – freie Eingabe möglich.`;
          statusEl.classList.add('error-text');
        }
      });
    };

    const build = () => {
      lastKind = kindEl.value;
      current = KIND_FORMS[kindEl.value]();
      fieldsWrap.replaceChildren(...current.fields);
      if (current.catalog) showStatus(current.catalog);
      else statusEl.hidden = true;
    };
    kindEl.addEventListener('change', () => { build(); current.nameInput.focus(); });
    build();

    const form = h('form', {
      class: 'item-form',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const { list: updated } = await api('add_item', {
            body: { list_id: list.id, type: kindEl.value, name: current.nameInput.value, ...current.values() },
          });
          rerender(updated, true);
        } catch (err) { toast(err.message, true); }
      },
    },
      h('div', { class: 'item-form-row' },
        field('Art *', kindEl, 'field-kind'),
        fieldsWrap,
      ),
      statusEl,
      h('button', { class: 'btn btn-primary', type: 'submit' }, '+ Item hinzufügen'),
    );
    form.focusName = () => current.nameInput.focus();
    return form;
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
      if (mine) toast(mine.kind === 'pass' ? `${item.name}: Kein Interesse` : `${item.name}: ${KIND_LABEL[mine.kind]}-Wurf ${rollShort(mine.value)}`);
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
      actions.push(h('span', { class: 'my-roll' }, 'Dein Wurf: ', rollValue(myRoll.value, 'roll-exact'), ` (${KIND_LABEL[myRoll.kind]})`));
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
        rollValue(r.value, 'roll-value roll-exact'),
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

  /** Wer hat schon abgestimmt? Zählt jede Entscheidung (auch Kein Interesse); erledigte Items zählen nur, wenn dort entschieden wurde. */
  function participants(list) {
    const open = list.items.filter((i) => !i.done).length;
    const byName = new Map();
    for (const item of list.items) {
      for (const r of item.rolls) {
        const key = r.username.toLocaleLowerCase();
        if (!byName.has(key)) byName.set(key, { name: r.username, decided: 0, openDecided: 0 });
        const p = byName.get(key);
        p.decided++;
        if (!item.done) p.openDecided++;
      }
    }
    return [...byName.values()]
      .map((p) => ({ ...p, complete: p.openDecided >= open }))
      .sort((a, b) => (b.complete - a.complete) || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  }

  function participantsInfo(list, user) {
    const people = participants(list);
    if (!people.length) return h('p', { class: 'participants muted small' }, '👥 Noch niemand hat abgestimmt.');
    return h('div', { class: 'participants' },
      h('span', { class: 'participants-label small' }, `👥 Abgestimmt (${people.length}):`),
      people.map((p) => h('span', {
        class: `participant${p.complete ? ' complete' : ''}${sameUser(p.name, user) ? ' mine' : ''}`,
        title: p.complete ? 'Hat bei allen offenen Items entschieden' : 'Noch nicht bei allen Items entschieden',
      }, p.complete ? '✔ ' : '', p.name, h('span', { class: 'participant-count' }, ` ${p.decided}/${list.items.length}`))),
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
            list.phase !== 'draft' ? participantsInfo(list, user) : null,
            hint && h('p', { class: 'hint' }, hint),
            editable && (list.phase === 'draft' || list.phase === 'open' || list.phase === 'expired')
              ? buildDeadlineForm(list, rerender) : null,
          ),
          ownerActions.length ? h('div', { class: 'actions' }, ownerActions) : null,
        ),
        formEl && list.phase === 'draft' && editable
          ? h('section', { class: 'panel panel-unclipped' }, h('h2', { class: 'panel-title' }, 'Item hinzufügen'), formEl)
          : null,
        h('section', { class: 'items' },
          list.items.length
            ? list.items.map((item) => buildItemCard(list, item, user, rerender))
            : h('p', { class: 'muted empty' }, 'Noch keine Items in dieser Liste.'),
        ),
      ].filter(Boolean));
      if (resetForm && formEl) formEl.focusName();
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
    // Cookie-Laufzeit bei jedem Besuch erneuern.
    if (getUser()) setUser(getUser());
    renderUser();
    try {
      options = { ...options, ...(await api('options')) };
    } catch (err) { toast(err.message, true); }
    route();
  })();
})();
