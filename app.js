/* SS2 Dialogue Editor - UI (v2). Plain vanilla JS, no libraries. */
(function () {
  'use strict';
  const C = window.Core;
  const APP_VERSION = '2.0';

  const KEYS = {
    draft: 'ss2.draft', vault: 'ss2.vault', vaultV1: 'ss2.vault.v1backup', schema: 'ss2.schema',
    recent: 'ss2.recentSpeakers', songs: 'ss2.recentSongs', sfx: 'ss2.recentSfx',
    paste: 'ss2.paste', tab: 'ss2.tab', backup: 'ss2.lastBackup', tip: 'ss2.tipDismissed',
    exp: 'ss2.export', sec: 'ss2.sections'
  };
  const DEFAULT_SPEAKERS = ['Nile', 'Ronan', 'Coc-Head', 'Patrick', 'Lucian', '???'];
  const FORMAT_LABEL = { essential: 'Essential format', bare: 'Bare minimum format' };

  const SAMPLE_LINES = [
    { speakerName: 'Scout', metBefore: false, dialogueText: '', textSpeed: 0.04, skipTextbox: true, songChange: 'tf2_drip',
      prompts: [{ name: 'leave', changeScene: false, sceneName: '', noSound: false, dialogue: null, requirements: [] }] },
    { speakerName: 'Scout', metBefore: false, dialogueText: '', textSpeed: 0.04, delayTextbox: true, legnth: 1.25, skipTextbox: true,
      songChange: 'tf2_drip', cameraShaking: true, duration: 1.25, magnitude: 8 },
    { speakerName: 'Nile', showAvatar: true, dialogueText: 'Jesus Christ!^ Where did you three come from?', delayTextbox: true, legnth: 2,
      prompts: [{ name: '', changeScene: false, sceneName: '', noSound: false, dialogue: null, requirements: [] }] }
  ];
  const SAMPLE = JSON.stringify(SAMPLE_LINES.map((x, i) => C.exportLine(x, C.exportSettingsDefaults(), i)), null, 2);

  /* ---------- tiny helpers ---------- */
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === false || v === null || v === undefined) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function fmtDate(ms) {
    try { return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (e) { return new Date(ms).toString(); }
  }
  const pretty = (v) => JSON.stringify(v, null, 2);

  /* ---------- export settings (remembered) ---------- */
  function getExportSettings() {
    const s = store.get(KEYS.exp, {}) || {};
    return {
      format: s.format === 'bare' ? 'bare' : 'essential',
      includeIndex: !!s.includeIndex,
      includeCustomLength: !!s.includeCustomLength,
      includeCharacterName: !!s.includeCharacterName
    };
  }
  function setExportSettings(s) { store.set(KEYS.exp, s); }

  /* ---------- state ---------- */
  const state = {
    title: 'Untitled dialogue', lines: [], vaultId: null, dirty: false, format: 'essential',
    open: null, filter: '', notices: [], tab: 'import', warnedStorage: false,
    sec: store.get(KEYS.sec, {}) || {}
  };
  const cardEls = new Map();
  const rawDrafts = new WeakMap(); // invalid raw-JSON drafts: key object -> { text, error }

  function renumber() { state.lines.forEach((l, i) => { l.index = i; }); }
  function idx(l) { return state.lines.indexOf(l); }

  let saveTimer;
  function saveDraft() {
    clearTimeout(saveTimer);
    renumber();
    const ok = store.set(KEYS.draft, {
      title: state.title, vaultId: state.vaultId, dirty: state.dirty, format: state.format,
      lines: C.toStorageArray(state.lines)
    });
    if (!ok && !state.warnedStorage) {
      state.warnedStorage = true;
      toast('Warning: could not autosave (storage is full or blocked). Export a copy!');
    }
  }
  function touch() {
    state.dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 350);
    updateStatus();
  }

  /* ---------- warnings ---------- */
  function draftWarnings(l) {
    const out = [];
    const d = rawDrafts.get(l);
    if (d && d.error) out.push('Raw prompts JSON is invalid, so the export uses the last valid prompts. ' + d.error);
    if (Array.isArray(l.prompts)) {
      l.prompts.forEach((p, n) => {
        const pd = isPlain(p) ? rawDrafts.get(p) : null;
        if (pd && pd.error) out.push('Prompt ' + (n + 1) + ': raw requirements JSON is invalid, so the export uses the last valid requirements. ' + pd.error);
      });
    }
    return out;
  }
  function lineMsgs(l, opts) { return C.lineWarnings(l, opts || getExportSettings()).concat(draftWarnings(l)); }
  function warnListFor(lines, opts) {
    const out = [];
    lines.forEach((l, i) => lineMsgs(l, opts).forEach((msg) => out.push({ i, l, msg })));
    return out;
  }

  function updateStatus() {
    const st = $('#status');
    const n = state.lines.length;
    const w = warnListFor(state.lines).length;
    st.textContent = '';
    st.append(n + ' line' + (n === 1 ? '' : 's') + ' · ');
    if (state.format) st.append(h('span', { class: 'fmtbadge ' + state.format, text: FORMAT_LABEL[state.format] }), ' · ');
    st.append(state.dirty ? '● unsaved to Vault' : '✓ saved in Vault');
    if (w) {
      st.append(' · ', h('button', { type: 'button', class: 'warnbtn', title: 'Jump to the first flagged line', text: '⚠ ' + w, onclick: jumpToFirstFlagged }));
    }
  }

  function jumpToFirstFlagged() {
    const first = warnListFor(state.lines)[0];
    if (!first) return;
    state.filter = ''; $('#search').value = '';
    state.open = first.l;
    renderList();
    const e = cardEls.get(first.l);
    if (e && e.card.scrollIntoView) e.card.scrollIntoView({ block: 'start' });
  }

  /* ---------- sheet / dialogs ---------- */
  let sheetDismiss = null;
  function openSheet(node, onDismiss) {
    sheetDismiss = onDismiss || null;
    $('#sheet-panel').replaceChildren(node);
    $('#sheet').classList.remove('hidden');
    document.body.classList.add('noscroll');
  }
  function closeSheet() {
    sheetDismiss = null;
    $('#sheet').classList.add('hidden');
    document.body.classList.remove('noscroll');
  }
  $('#sheet').addEventListener('click', (e) => {
    if (e.target.id === 'sheet') { const f = sheetDismiss; closeSheet(); if (f) f(); }
  });

  /* A confirm / text-input dialog. If a sheet is already open (e.g. the export sheet) it is put back afterwards. */
  function ask(o) {
    return new Promise((resolve) => {
      const sheetOpen = !$('#sheet').classList.contains('hidden');
      const prevNodes = sheetOpen ? Array.from($('#sheet-panel').childNodes) : null;
      const prevDismiss = sheetDismiss;
      const wantsInput = o.input !== undefined;
      let inp = null;
      const finish = (v) => {
        if (prevNodes) {
          $('#sheet-panel').replaceChildren(...prevNodes);
          sheetDismiss = prevDismiss;
          $('#sheet').classList.remove('hidden');
          document.body.classList.add('noscroll');
        } else closeSheet();
        resolve(v);
      };
      const okBtn = h('button', {
        type: 'button', class: 'btn ' + (o.danger ? 'danger-fill' : 'primary'), text: o.okLabel || 'OK',
        onclick: () => finish(wantsInput ? inp.value : true)
      });
      if (wantsInput) {
        inp = h('input', { type: 'text', value: o.input, autocomplete: 'off', spellcheck: 'false' });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') okBtn.click(); });
      }
      const content = h('div', { class: 'dialog' },
        h('h2', { text: o.title }),
        o.message ? h('p', { class: 'muted', text: o.message }) : null,
        inp,
        h('div', { class: 'btnrow' },
          h('button', { type: 'button', class: 'btn', text: o.cancelLabel || 'Cancel', onclick: () => finish(wantsInput ? null : false) }),
          okBtn));
      openSheet(content, () => {
        // backdrop tap: closeSheet() already ran, so put the previous sheet back if there was one
        if (prevNodes) {
          $('#sheet-panel').replaceChildren(...prevNodes);
          sheetDismiss = prevDismiss;
          $('#sheet').classList.remove('hidden');
          document.body.classList.add('noscroll');
        }
        resolve(wantsInput ? null : false);
      });
      if (inp) { inp.focus(); inp.select(); }
    });
  }

  /* ---------- tabs ---------- */
  const TAB_TITLES = { import: 'Import JSON', editor: 'Editor', vault: 'Vault' };
  function setTab(name) {
    state.tab = name;
    $$('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + name));
    $$('.tabbar button').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#topbar-title').textContent = TAB_TITLES[name];
    store.set(KEYS.tab, name);
    if (name === 'editor') renderEditor();
    if (name === 'vault') renderVault();
    window.scrollTo(0, 0);
  }
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  /* ====================================================================
     IMPORT TAB
     ==================================================================== */
  const pasteBox = $('#paste');
  let pasteTimer;
  pasteBox.addEventListener('input', () => {
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(() => store.set(KEYS.paste, pasteBox.value), 300);
  });

  function showError(res) {
    const box = $('#import-error');
    if (!res) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.textContent = '';
    box.append(h('strong', { text: 'Could not load. ' }), res.error);
    if (res.snippet) box.append(h('pre', { text: res.snippet }));
    box.append(h('div', { class: 'small', text: 'Your pasted text is still in the box. Fix it there and try again.' }));
  }

  $('#btn-paste').addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) { toast('The clipboard is empty.'); return; }
      pasteBox.value = t;
      store.set(KEYS.paste, t);
      showError(null);
    } catch (e) {
      toast('Could not read the clipboard. Long-press the box and tap Paste.');
    }
  });
  $('#btn-sample').addEventListener('click', () => { pasteBox.value = SAMPLE; store.set(KEYS.paste, SAMPLE); showError(null); });
  $('#btn-clear').addEventListener('click', async () => {
    if (pasteBox.value.trim() && !(await ask({ title: 'Clear the box?', message: 'This removes the pasted text from the Import box.', okLabel: 'Clear', danger: true }))) return;
    pasteBox.value = ''; store.set(KEYS.paste, ''); showError(null);
  });
  $('#btn-load').addEventListener('click', loadFromPaste);

  async function loadFromPaste() {
    const res = C.parseInput(pasteBox.value);
    showError(res.ok ? null : res);
    if (!res.ok) return;
    if (res.backup) { await restoreBackup(res.backup); return; }
    if (state.lines.length && state.dirty) {
      const ok = await ask({
        title: 'Replace the editor?', okLabel: 'Replace', danger: true,
        message: 'The editor has changes that are not saved to the Vault. Loading will replace them. (Tip: cancel, then Save to Vault first.)'
      });
      if (!ok) return;
    }
    state.lines = res.lines;
    state.format = res.format;
    state.title = $('#imp-title').value.trim() || 'Untitled dialogue';
    state.vaultId = null; state.dirty = true; state.open = null; state.filter = '';
    state.notices = res.notices || [];
    $('#search').value = '';
    seedRecents(state.lines);
    saveDraft();
    setTab('editor');
    toast('Loaded ' + state.lines.length + ' line' + (state.lines.length === 1 ? '' : 's'));
  }

  /* ====================================================================
     EDITOR TAB
     ==================================================================== */
  const CHIP_CLASS = { '^': 'comma', '|': 'period', '~': 'custom' };
  const CHIP_TITLE = { '^': 'Comma pause', '|': 'Period pause', '~': 'Custom pause (uses customLength)' };

  function chips(text) {
    const frag = document.createDocumentFragment();
    const s = typeof text === 'string' ? text : String(text);
    if (s === '') { frag.append(h('span', { class: 'empty', text: '(empty text)' })); return frag; }
    for (const part of C.segments(s)) {
      if (part.k === 't') frag.append(document.createTextNode(part.v));
      else frag.append(h('span', { class: 'chip ' + CHIP_CLASS[part.k], title: CHIP_TITLE[part.k], text: part.v }));
    }
    return frag;
  }

  function pushRecentTo(key, name, max) {
    if (!name || typeof name !== 'string') return;
    const list = store.get(key, []).filter((n) => n !== name);
    list.unshift(name);
    store.set(key, list.slice(0, max || 10));
  }
  const pushRecent = (name) => pushRecentTo(KEYS.recent, name, 12);
  function seedRecents(lines) {
    lines.forEach((l) => {
      if (l.songChange) pushRecentTo(KEYS.songs, l.songChange, 10);
      if (l.soundEffect) pushRecentTo(KEYS.sfx, l.soundEffect, 10);
    });
  }
  function speakerChoices() {
    const out = [];
    const add = (n) => { if (typeof n === 'string' && n && !out.includes(n)) out.push(n); };
    store.get(KEYS.recent, []).forEach(add);
    state.lines.slice().reverse().forEach((x) => add(x.speakerName));
    DEFAULT_SPEAKERS.forEach(add);
    return out.slice(0, 16);
  }

  function renderBanner() {
    const b = $('#banner');
    b.textContent = '';
    if (!state.notices.length) return;
    b.append(h('div', { class: 'banner' },
      h('ul', null, state.notices.map((n) => h('li', { text: n }))),
      h('button', { type: 'button', class: 'btn small', text: 'OK', onclick: () => { state.notices = []; renderBanner(); } })));
  }

  function renderEditor() {
    const t = $('#title');
    if (document.activeElement !== t) t.value = state.title;
    updateStatus();
    renderBanner();
    renderList();
  }

  function renderList() {
    const list = $('#list');
    list.textContent = '';
    cardEls.clear();
    const q = state.filter.trim().toLowerCase();
    let shown = 0;
    state.lines.forEach((l) => {
      if (q) {
        const names = Array.isArray(l.prompts) ? l.prompts.map((p) => (isPlain(p) ? p.name : '')).join(' ') : '';
        const hay = [l.speakerName, l.dialogueText, l.characterName, l.songChange, l.soundEffect, l.sceneChange, names]
          .map((x) => String(x == null ? '' : x)).join('\n').toLowerCase();
        if (!hay.includes(q)) return;
      }
      list.append(buildCard(l));
      shown++;
    });
    if (!state.lines.length) {
      list.append(h('div', { class: 'empty-state' },
        h('p', { text: 'No lines yet.' }),
        h('p', { class: 'small', text: 'Paste JSON in the Import tab, or add a line below.' })));
    } else if (!shown) {
      list.append(h('div', { class: 'empty-state', text: 'No lines match your search.' }));
    }
  }

  function buildCard(l) {
    const card = h('div', { class: 'card' + (state.open === l ? ' open' : '') });
    const summary = h('div', { class: 'card-summary', role: 'button', tabindex: '0' });
    summary.addEventListener('click', () => toggleOpen(l));
    summary.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOpen(l); } });
    card.append(summary);
    cardEls.set(l, { card, summary, after: null });
    fillSummary(l);
    if (state.open === l) card.append(buildBody(l));
    return card;
  }

  function rebuildCard(l) {
    const old = cardEls.get(l);
    if (!old) return;
    const fresh = buildCard(l);
    old.card.replaceWith(fresh);
  }

  const numTxt = (v) => (typeof v === 'number' ? String(v) : '?');

  function lineBadges(l) {
    const b = [];
    const add = (text, cls) => b.push({ text, cls: cls || '' });
    if (l.skipTextbox === true) add('skip');
    if (l.noInput === true) add('no input');
    if (l.thinking === true) add('thinking');
    if (l.showAvatar === true) add('avatar');
    if (l.delayTextbox === true) add('delay ' + numTxt(l.legnth) + 's');
    if (l.songChange) add('♪ ' + l.songChange, 'audio');
    if (l.soundEffect) add('sfx ' + l.soundEffect, 'audio');
    if (l.stopSong === true) add('stop song', 'audio');
    if (l.pauseSong === true) add('pause song', 'audio');
    if (l.resumeSong === true) add('resume song', 'audio');
    if (l.cameraShaking === true) add('shake' + (l.duration ? ' ' + numTxt(l.duration) + 's' : ''), 'cam');
    if (l.die === true) add('die', 'cam');
    if (l.sceneChange) add('scene → ' + l.sceneChange, 'scene');
    if (Array.isArray(l.prompts) && l.prompts.length) add('prompts (' + l.prompts.length + ')', 'prm');
    if (l.textSpeed !== 0.05) add('speed ' + numTxt(l.textSpeed));
    if (typeof l.dialogueText === 'string' && l.dialogueText.includes('~')) add('~ ' + numTxt(l.customLength) + 's');
    return b;
  }

  function fillSummary(l) {
    const e = cardEls.get(l);
    if (!e) return;
    const event = C.isEventBeat(l);
    const nWarn = lineMsgs(l).length;
    e.card.classList.toggle('blank', event);
    const s = e.summary;
    s.textContent = '';
    const name = String(l.speakerName) || '(no speaker)';
    s.append(h('div', { class: 'card-head' },
      h('span', { class: 'num', text: '#' + l.index }),
      h('span', { class: 'who' + (String(l.speakerName) ? '' : ' dim'), text: name }),
      l.metBefore === false ? h('span', { class: 'badge q', title: 'Shown as ??? in the game', text: '???' }) : null,
      event ? h('span', { class: 'badge ev', text: 'Event beat' }) : null,
      nWarn ? h('span', { class: 'badge w', text: '⚠ ' + nWarn }) : null,
      h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' })));
    if (!event) {
      const t = typeof l.dialogueText === 'string' ? l.dialogueText : String(l.dialogueText);
      s.append(h('div', { class: 'card-text' }, chips(t.length > 110 ? t.slice(0, 110) + '…' : t)));
    } else if (l.characterName) {
      s.append(h('div', { class: 'blank-note', text: 'character: ' + l.characterName }));
    }
    const badges = lineBadges(l);
    if (!event && l.characterName) badges.push({ text: 'character: ' + l.characterName, cls: '' });
    if (badges.length) s.append(h('div', { class: 'badges' }, badges.map((x) => h('span', { class: 'bd ' + x.cls, text: x.text }))));
    if (Array.isArray(l.prompts) && l.prompts.length) {
      s.append(h('div', { class: 'pnames' }, l.prompts.map((p) => {
        const n = isPlain(p) && typeof p.name === 'string' && p.name !== '' ? p.name : '(unnamed)';
        return h('span', { class: 'pn', text: n });
      })));
    }
  }

  function refreshCard(l) {
    fillSummary(l);
    const e = cardEls.get(l);
    if (e && e.after) e.after();
  }
  function changed(l) { touch(); refreshCard(l); }

  function toggleOpen(l) {
    state.open = state.open === l ? null : l;
    renderList();
    const e = cardEls.get(l);
    if (state.open === l && e && e.card.scrollIntoView) e.card.scrollIntoView({ block: 'nearest' });
  }

  function field(label, input, hintEl) {
    return h('label', { class: 'field' }, h('span', { class: 'lbl', text: label }), input, hintEl || null);
  }
  function toggleRow(title, sub, on, onChange) {
    const input = h('input', { type: 'checkbox', checked: on });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'trow' },
      h('span', { class: 'ttext' }, title, sub ? h('small', { text: sub }) : null),
      h('span', { class: 'switch' }, input, h('span', { class: 'slider' })));
  }
  function numInput(obj, key, step, after) {
    const inp = h('input', { type: 'number', inputmode: 'decimal', step: String(step), min: '0', value: String(obj[key]) });
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      if (Number.isFinite(v)) { obj[key] = v; after(); }
    });
    inp.addEventListener('change', () => {
      if (!Number.isFinite(parseFloat(inp.value))) { obj[key] = 0; inp.value = '0'; after(); }
    });
    return inp;
  }
  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight + 2, 110) + 'px';
  }

  /* A raw-JSON list editor with live validation. Invalid text is kept as a draft; the last valid value stays in use. */
  function rawEditor(o) {
    const err = h('div', { class: 'rawerr', role: 'status' });
    const ta = h('textarea', { class: 'mono', rows: '8', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' });
    const showDraftErr = (msg) => { err.textContent = msg ? '⚠ ' + msg : ''; err.classList.toggle('bad', !!msg); };
    const sync = () => {
      const d = rawDrafts.get(o.key);
      if (d) { ta.value = d.text; showDraftErr(d.error); }
      else { ta.value = pretty(o.get()); showDraftErr(''); }
    };
    sync();
    ta.addEventListener('input', () => {
      const r = C.parseJsonList(ta.value);
      if (r.ok) {
        rawDrafts.delete(o.key);
        showDraftErr('');
        o.set(r.value);
      } else {
        rawDrafts.set(o.key, { text: ta.value, error: r.error });
        showDraftErr(r.error);
        o.invalid();
      }
    });
    const fmt = h('button', {
      type: 'button', class: 'btn small', text: 'Format',
      onclick: () => {
        const r = C.parseJsonList(ta.value);
        if (!r.ok) { rawDrafts.set(o.key, { text: ta.value, error: r.error }); showDraftErr(r.error); toast('Cannot format: the JSON is not valid yet.'); return; }
        rawDrafts.delete(o.key);
        ta.value = pretty(r.value);
        showDraftErr('');
        o.set(r.value);
      }
    });
    const node = h('div', { class: 'raw' }, ta, err, h('div', { class: 'btnrow' }, fmt));
    return { node, sync };
  }

  function recentRow(storeKey, l, fieldName, inp, onPick) {
    const row = h('div', { class: 'quickpick' });
    const draw = () => {
      row.textContent = '';
      const list = store.get(storeKey, []);
      row.hidden = !list.length;
      list.forEach((n) => row.append(h('button', {
        type: 'button', class: 'qchip' + (n === l[fieldName] ? ' on' : ''), text: n,
        onclick: () => { l[fieldName] = n; inp.value = n; pushRecentTo(storeKey, n, 10); draw(); changed(l); if (onPick) onPick(); }
      })));
    };
    draw();
    return { row, draw };
  }

  /* ---------- prompts ---------- */
  function promptCard(l, p, i, redraw) {
    const afterStructure = () => { touch(); refreshCard(l); redraw(); };
    const ctrl = h('div', { class: 'pbtns' },
      h('button', { type: 'button', class: 'btn small', text: '↑', title: 'Move up', 'aria-label': 'Move prompt up', disabled: i === 0 ? true : null,
        onclick: () => { const a = l.prompts; [a[i - 1], a[i]] = [a[i], a[i - 1]]; afterStructure(); } }),
      h('button', { type: 'button', class: 'btn small', text: '↓', title: 'Move down', 'aria-label': 'Move prompt down', disabled: i === l.prompts.length - 1 ? true : null,
        onclick: () => { const a = l.prompts; [a[i + 1], a[i]] = [a[i], a[i + 1]]; afterStructure(); } }),
      h('button', { type: 'button', class: 'btn small', text: 'Dup', title: 'Duplicate prompt',
        onclick: () => { l.prompts.splice(i + 1, 0, JSON.parse(JSON.stringify(p))); afterStructure(); } }),
      h('button', { type: 'button', class: 'btn small danger', text: 'Del', title: 'Delete prompt',
        onclick: async () => {
          const label = isPlain(p) && p.name ? '"' + p.name + '"' : 'this prompt';
          if (!(await ask({ title: 'Delete prompt ' + (i + 1) + '?', message: 'Remove ' + label + ' from this line.', okLabel: 'Delete', danger: true }))) return;
          l.prompts.splice(i, 1); afterStructure();
        } }));
    const head = h('div', { class: 'phead' }, h('strong', { text: 'Prompt ' + (i + 1) }), ctrl);

    if (!isPlain(p)) {
      return h('div', { class: 'pcard' }, head, h('p', { class: 'small muted', text: 'This item is not an object, so it can only be edited in the raw JSON below: ' + JSON.stringify(p) }));
    }

    const name = h('input', { type: 'text', value: typeof p.name === 'string' ? p.name : '', autocomplete: 'off', spellcheck: 'false', placeholder: 'e.g. leave' });
    name.addEventListener('input', () => { p.name = name.value; changed(l); });
    const scene = h('input', { type: 'text', value: typeof p.sceneName === 'string' ? p.sceneName : '', autocomplete: 'off', spellcheck: 'false' });
    scene.addEventListener('input', () => { p.sceneName = scene.value; changed(l); });

    const linked = !(p.dialogue === null || p.dialogue === undefined);
    const reqChip = h('span', { class: 'ro' });
    const setReqChip = () => { reqChip.textContent = 'requirements: ' + (Array.isArray(p.requirements) ? p.requirements.length : '?'); };
    setReqChip();
    const extraKeys = Object.keys(p).filter((k) => !C.PROMPT_KEYS.includes(k));

    const req = rawEditor({
      key: p,
      get: () => (p.requirements === undefined ? [] : p.requirements),
      set: (v) => { p.requirements = v; setReqChip(); changed(l); },
      invalid: () => { refreshCard(l); touch(); }
    });

    return h('div', { class: 'pcard' },
      head,
      field('Prompt name', name),
      toggleRow('Change scene', null, p.changeScene === true, (v) => { p.changeScene = v; changed(l); }),
      field('Scene name', scene),
      toggleRow('Prompt: no sound', 'this prompt’s own flag (not the line’s)', p.noSound === true, (v) => { p.noSound = v; changed(l); }),
      h('div', { class: 'ros' },
        h('span', { class: 'ro', title: 'Linked in Unity. Not editable here; kept exactly as imported.', text: 'dialogue: ' + (linked ? 'linked' : 'none') }),
        reqChip),
      h('details', { class: 'adv' }, h('summary', { text: 'Advanced' }),
        h('span', { class: 'lbl', text: 'requirements (raw JSON list)' }),
        req.node,
        extraKeys.length ? h('p', { class: 'small muted', text: 'Extra keys kept untouched: ' + extraKeys.join(', ') }) : null));
  }

  function buildPrompts(l) {
    const count = h('div', { class: 'pcount' });
    const list = h('div');
    const raw = rawEditor({
      key: l,
      get: () => l.prompts,
      set: (v) => { l.prompts = v; touch(); refreshCard(l); draw(true); },
      invalid: () => { refreshCard(l); touch(); }
    });
    const addBtn = h('button', { type: 'button', class: 'btn', text: '+ Add prompt' });
    function draw(fromRaw) {
      const ok = Array.isArray(l.prompts);
      count.textContent = 'Prompts: ' + (ok ? l.prompts.length : '?');
      addBtn.disabled = !ok;
      list.textContent = '';
      if (!ok) {
        list.append(h('p', { class: 'small muted', text: '"prompts" is not a list here. Use the raw JSON editor below to fix it.' }));
      } else {
        l.prompts.forEach((p, i) => list.append(promptCard(l, p, i, () => draw(false))));
      }
      if (!fromRaw) raw.sync();
    }
    addBtn.addEventListener('click', () => {
      if (!Array.isArray(l.prompts)) return;
      l.prompts.push(C.defaultPrompt());
      touch(); refreshCard(l); draw(false);
    });
    draw(false);
    const rawBox = h('details', { class: 'adv' }, h('summary', { text: 'Edit all prompts as raw JSON' }), raw.node);
    rawBox.addEventListener('toggle', () => { if (rawBox.open) raw.sync(); });
    return h('div', null, count, list, h('div', { class: 'btnrow' }, addBtn), rawBox);
  }

  /* ---------- the expanded card ---------- */
  const hasAudio = (l) => !!(l.songChange || l.soundEffect || l.stopSong === true || l.pauseSong === true || l.resumeSong === true);
  const hasMisc = (l) => !!(l.cameraShaking === true || l.die === true || l.sceneChange);

  function buildBody(l) {
    const e = cardEls.get(l);
    const body = h('div', { class: 'card-body' });
    const vis = []; // [element, fn] pairs: element is shown only while fn() is true
    const showIf = (el, fn) => { vis.push([el, fn]); return el; };
    const bool = (key, title, sub) => toggleRow(title, sub, l[key] === true, (v) => { l[key] = v; changed(l); });
    const textField = (key, label, hint, attrs) => {
      const inp = h('input', Object.assign({ type: 'text', value: String(l[key] == null ? '' : l[key]), autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' }, attrs || {}));
      inp.addEventListener('input', () => { l[key] = inp.value; changed(l); });
      const hintEl = hint ? h('span', { class: 'hint', text: hint }) : null;
      return { inp, hintEl, wrap: field(label, inp, hintEl) };
    };
    const section = (name, title, kids, activeFn, defaultOpen) => {
      const open = state.sec[name] !== undefined ? state.sec[name] : defaultOpen;
      const dot = activeFn ? h('span', { class: 'secdot', title: 'Something is set in this section', text: '●' }) : null;
      if (dot) vis.push([dot, activeFn]);
      const sum = h('summary', null, title, dot);
      sum.addEventListener('click', () => setTimeout(() => {
        state.sec[name] = d.open; store.set(KEYS.sec, state.sec);
      }, 0));
      const d = h('details', { class: 'sec', open: open ? true : null }, sum, h('div', { class: 'secbody' }, kids));
      return d;
    };

    /* ----- A) DIALOGUE ----- */
    const spk = h('input', { type: 'text', value: String(l.speakerName), autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'Short name, e.g. Nile' });
    const qp = h('div', { class: 'quickpick' });
    const drawQuick = () => {
      qp.textContent = '';
      speakerChoices().forEach((n) => qp.append(h('button', {
        type: 'button', class: 'qchip' + (n === l.speakerName ? ' on' : ''), text: n,
        onclick: () => { l.speakerName = n; spk.value = n; pushRecent(n); drawQuick(); changed(l); }
      })));
    };
    drawQuick();
    spk.addEventListener('input', () => { l.speakerName = spk.value; changed(l); });
    spk.addEventListener('change', () => { pushRecent(spk.value.trim()); drawQuick(); });

    const ta = h('textarea', { rows: '4', autocapitalize: 'sentences', value: String(l.dialogueText), placeholder: 'What they say. ^ after commas, | after mid-text periods, ~ custom pause. Leave empty for an event beat.' });
    const prev = h('div', { class: 'preview' });
    const drawPrev = () => { prev.textContent = ''; prev.append(chips(l.dialogueText)); };
    drawPrev();
    ta.addEventListener('input', () => { l.dialogueText = ta.value; drawPrev(); autosize(ta); changed(l); });
    const mk = (ch, cls, label) => {
      const b = h('button', { type: 'button', class: 'markbtn ' + cls, title: CHIP_TITLE[ch] }, ch, h('small', { text: label }));
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', () => {
        const s = ta.selectionStart === undefined ? ta.value.length : ta.selectionStart;
        const en = ta.selectionEnd === undefined ? s : ta.selectionEnd;
        if (ta.setRangeText) ta.setRangeText(ch, s, en, 'end');
        else ta.value = ta.value.slice(0, s) + ch + ta.value.slice(en);
        l.dialogueText = ta.value; drawPrev(); changed(l); ta.focus();
      });
      return b;
    };

    const speedHint = h('span', { class: 'hint' });
    const speed = numInput(l, 'textSpeed', 0.01, () => changed(l));
    const customHint = h('span', { class: 'hint', text: 'used by ~ markers' });
    const custom = numInput(l, 'customLength', 0.1, () => changed(l));
    const customWrap = showIf(field('Custom pause ~ (sec)', custom, customHint), () => typeof l.dialogueText === 'string' && l.dialogueText.includes('~'));
    const leg = numInput(l, 'legnth', 0.1, () => changed(l));
    const legWrap = showIf(field('Textbox delay (sec)', leg, h('span', { class: 'hint', text: 'saved as "legnth" in the JSON' })), () => l.delayTextbox === true);

    const dialogue = section('dialogue', 'Dialogue', [
      field('Speaker name (keep it short)', spk), qp,
      bool('metBefore', 'Already met', 'false = shows ??? in the game'),
      bool('showAvatar', 'Show avatar'),
      bool('thinking', 'Thinking'),
      field('Dialogue text', ta),
      h('div', { class: 'markrow' }, h('span', { class: 'lbl', text: 'Insert pause:' }), mk('^', 'comma', 'comma'), mk('|', 'period', 'period'), mk('~', 'custom', 'custom')),
      prev,
      field('Text speed (sec/char)', speed, speedHint),
      customWrap,
      bool('noInput', 'No input'),
      bool('delayTextbox', 'Delay textbox'),
      legWrap,
      bool('skipTextbox', 'Skip textbox')
    ], null, true);
    requestAnimationFrame(() => autosize(ta));

    /* ----- B) AUDIO ----- */
    const sfx = textField('soundEffect', 'Sound effect', 'name of a sound effect to play');
    const sfxRecent = recentRow(KEYS.sfx, l, 'soundEffect', sfx.inp);
    sfx.inp.addEventListener('change', () => { pushRecentTo(KEYS.sfx, sfx.inp.value.trim(), 10); sfxRecent.draw(); });
    const song = textField('songChange', 'Song change', 'name of a song to switch to');
    const songRecent = recentRow(KEYS.songs, l, 'songChange', song.inp);
    song.inp.addEventListener('change', () => { pushRecentTo(KEYS.songs, song.inp.value.trim(), 10); songRecent.draw(); });
    const songRowWrap = h('div', null, songRecent.row);
    showIf(songRowWrap, () => l.stopSong !== true);

    const audio = section('audio', 'Audio', [
      bool('stopSong', 'Stop song'), bool('pauseSong', 'Pause song'), bool('resumeSong', 'Resume song'),
      sfx.wrap, sfxRecent.row, song.wrap, songRowWrap
    ], () => hasAudio(l), hasAudio(l));

    /* ----- C) PROMPTS ----- */
    const prompts = section('prompts', 'Prompts', [buildPrompts(l)],
      () => Array.isArray(l.prompts) && l.prompts.length > 0, Array.isArray(l.prompts) && l.prompts.length > 0);

    /* ----- D) MISC ----- */
    const dur = numInput(l, 'duration', 0.05, () => changed(l));
    const mag = numInput(l, 'magnitude', 0.5, () => changed(l));
    const shakeWrap = showIf(h('div', { class: 'grid2' }, field('Shake length (sec)', dur), field('Shake strength', mag)), () => l.cameraShaking === true);
    const scene = textField('sceneChange', 'Scene change', 'a scene name. If set, the game changes scene');
    const sceneFlags = showIf(h('div', null,
      bool('noSound', 'No sound (scene change)', 'only matters with a scene change'),
      bool('instant', 'Instant (scene change)', 'only matters with a scene change')), () => !!l.sceneChange);
    const misc = section('misc', 'Misc', [
      bool('cameraShaking', 'Camera shaking'), shakeWrap, bool('die', 'Die'), scene.wrap, sceneFlags
    ], () => hasMisc(l), hasMisc(l));

    /* ----- E) ADVANCED ----- */
    const chr = textField('characterName', 'characterName', 'Extra identifier, kept exactly as typed. Not exported unless you tick the option.');
    const extras = Object.keys(l).filter((k) => !C.KNOWN.includes(k));
    const adv = section('advanced', 'Advanced', [
      chr.wrap,
      extras.length ? h('div', null,
        h('span', { class: 'lbl', text: 'Other keys kept untouched (read-only)' }),
        extras.map((k) => h('div', { class: 'xkey' }, h('strong', { text: k + ': ' }), JSON.stringify(l[k])))) : null
    ], null, false);

    body.append(dialogue, audio, prompts, misc, adv);

    const warnBox = h('div', { class: 'warns' });
    body.append(warnBox);

    const i0 = idx(l);
    body.append(h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', text: '↑ Move up', disabled: i0 === 0 ? true : null, onclick: () => moveLine(l, -1) }),
      h('button', { type: 'button', class: 'btn', text: '↓ Move down', disabled: i0 === state.lines.length - 1 ? true : null, onclick: () => moveLine(l, 1) }),
      h('button', { type: 'button', class: 'btn', text: 'Duplicate', onclick: () => duplicateLine(l) }),
      h('button', { type: 'button', class: 'btn', text: '+ Line below', onclick: () => insertAfter(l, C.newLine(l.speakerName, l.metBefore), true) }),
      h('button', { type: 'button', class: 'btn', text: '+ Event beat below', onclick: () => eventMenu(l) }),
      h('button', { type: 'button', class: 'btn danger', text: 'Delete', onclick: () => deleteLine(l) })));

    e.after = () => {
      vis.forEach(([el, fn]) => { el.hidden = !fn(); });
      const v = Number(l.textSpeed);
      speedHint.textContent = !Number.isFinite(v) ? '' : v < 0.05 ? 'faster = panicked / urgent' : v > 0.05 ? 'slower than normal' : 'normal speech';
      const needs = typeof l.dialogueText === 'string' && l.dialogueText.includes('~') && !(Number(l.customLength) > 0);
      customHint.textContent = needs ? '⚠ Text has ~ but this is 0' : 'used by ~ markers';
      customHint.classList.toggle('warn', needs);
      const stop = l.stopSong === true;
      song.inp.disabled = stop;
      song.hintEl.textContent = stop ? 'Not used while "Stop song" is on.' : 'name of a song to switch to';
      warnBox.textContent = '';
      lineMsgs(l).forEach((w) => warnBox.append(h('div', { class: 'w', text: '⚠ ' + w })));
    };
    e.after();
    return body;
  }

  /* ----- line actions ----- */
  function moveLine(l, dir) {
    const i = idx(l), j = i + dir;
    if (i < 0 || j < 0 || j >= state.lines.length) return;
    [state.lines[i], state.lines[j]] = [state.lines[j], state.lines[i]];
    renumber(); touch(); renderEditor();
    const e = cardEls.get(l);
    if (e && e.card.scrollIntoView) e.card.scrollIntoView({ block: 'nearest' });
  }
  function duplicateLine(l) {
    const copy = C.normalizeLine(JSON.parse(JSON.stringify(l)), idx(l) + 1);
    state.lines.splice(idx(l) + 1, 0, copy);
    state.open = copy; renumber(); touch(); renderEditor();
    const e = cardEls.get(copy);
    if (e && e.card.scrollIntoView) e.card.scrollIntoView({ block: 'nearest' });
  }
  function insertAfter(l, nl, focusText) {
    state.lines.splice(idx(l) + 1, 0, nl);
    state.open = nl; renumber(); touch(); renderEditor();
    const e = cardEls.get(nl);
    if (e) {
      if (e.card.scrollIntoView) e.card.scrollIntoView({ block: 'nearest' });
      const t = $('textarea', e.card);
      if (focusText && t) t.focus();
    }
  }
  async function deleteLine(l) {
    const preview = C.isEventBeat(l) ? 'an event beat' : (String(l.speakerName) + ': ' + String(l.dialogueText).slice(0, 60));
    const ok = await ask({ title: 'Delete line #' + l.index + '?', message: preview, okLabel: 'Delete', danger: true });
    if (!ok) return;
    state.lines.splice(idx(l), 1);
    if (state.open === l) state.open = null;
    renumber(); touch(); renderEditor();
  }

  function addToEnd(nl) {
    state.lines.push(nl);
    state.open = nl; state.filter = ''; $('#search').value = '';
    renumber(); touch(); renderEditor();
    const e = cardEls.get(nl);
    if (e && e.card.scrollIntoView) e.card.scrollIntoView({ block: 'nearest' });
  }
  $('#btn-add-line').addEventListener('click', () => {
    const last = state.lines[state.lines.length - 1];
    addToEnd(last ? C.newLine(last.speakerName, last.metBefore) : C.newLine(speakerChoices()[0] || ''));
  });
  $('#btn-add-event').addEventListener('click', () => eventMenu(null));

  /* ----- event beats + presets ----- */
  async function eventMenu(after) {
    const kind = await new Promise((resolve) => {
      const opt = (label, sub, v) => h('button', { type: 'button', class: 'btn', onclick: () => { closeSheet(); resolve(v); } }, label, h('small', { text: sub }));
      openSheet(h('div', null,
        h('h2', { text: 'Add event beat' }),
        h('p', { class: 'muted small', text: 'An event beat has no spoken text. It triggers things in the game: music, camera shake, scene changes.' }),
        h('div', { class: 'stack' },
          opt('Plain event beat', 'speaker copied from above, skip textbox on', 'plain'),
          opt('Music cue', 'asks for the song name', 'music'),
          opt('Camera shake', '1.25 s, strength 8, delay 1.25 s', 'shake'),
          opt('Scene change', 'asks for the scene name', 'scene')),
        h('div', { class: 'btnrow' }, h('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: () => { closeSheet(); resolve(null); } }))),
      () => resolve(null));
    });
    if (!kind) return;

    const above = after || state.lines[state.lines.length - 1] || null;
    const nl = C.eventBeat(above ? above.speakerName : '');
    if (kind === 'music' || kind === 'scene') {
      const name = await ask({
        title: kind === 'music' ? 'Music cue' : 'Scene change', okLabel: 'Add', input: '',
        message: kind === 'music' ? 'Name of the song to switch to:' : 'Name of the scene to change to:'
      });
      if (name === null) return;
      if (!name.trim()) { toast('A name is needed.'); return; }
      if (kind === 'music') { nl.songChange = name.trim(); pushRecentTo(KEYS.songs, nl.songChange, 10); }
      else nl.sceneChange = name.trim();
    } else if (kind === 'shake') {
      nl.cameraShaking = true; nl.duration = 1.25; nl.magnitude = 8; nl.delayTextbox = true; nl.legnth = 1.25;
    }
    if (after) insertAfter(after, nl, false); else addToEnd(nl);
  }

  $('#title').addEventListener('input', (e) => { state.title = e.target.value; touch(); });
  $('#search').addEventListener('input', (e) => { state.filter = e.target.value; renderList(); });
  $('#btn-save').addEventListener('click', saveToVault);
  $('#btn-export').addEventListener('click', () => { renumber(); openExport(state.title, state.lines); });

  /* ====================================================================
     VAULT
     ==================================================================== */
  function getVault() { const v = store.get(KEYS.vault, []); return Array.isArray(v) ? v.filter(isPlain) : []; }

  function saveToVault() {
    renumber();
    const vault = getVault();
    const now = Date.now();
    const lines = C.toStorageArray(state.lines);
    const title = (state.title || '').trim() || 'Untitled dialogue';
    state.title = title; $('#title').value = title;
    let entry = state.vaultId ? vault.find((d) => d.id === state.vaultId) : null;
    if (entry) { entry.title = title; entry.lines = lines; entry.format = state.format; entry.updated = now; }
    else {
      entry = { id: C.uid(), title, format: state.format, lines, created: now, updated: now };
      vault.push(entry);
      state.vaultId = entry.id;
    }
    if (!store.set(KEYS.vault, vault)) { toast('Could not save to the Vault (storage full or blocked). Export a copy instead!'); return; }
    state.dirty = false;
    saveDraft(); updateStatus();
    toast('Saved to Vault');
  }

  async function confirmDiscardIfDirty() {
    if (state.lines.length && state.dirty) {
      return ask({ title: 'Replace the editor?', okLabel: 'Replace', danger: true, message: 'The editor has changes that are not saved to the Vault.' });
    }
    return true;
  }

  async function openFromVault(d) {
    if (state.vaultId !== d.id && !(await confirmDiscardIfDirty())) return;
    state.lines = (Array.isArray(d.lines) ? d.lines : []).map((x, i) => C.normalizeLine(x, i));
    state.title = d.title; state.vaultId = d.id; state.dirty = false;
    state.format = d.format === 'essential' ? 'essential' : 'bare';
    state.open = null; state.filter = ''; state.notices = [];
    $('#search').value = '';
    seedRecents(state.lines);
    saveDraft();
    setTab('editor');
  }

  function vaultCard(d) {
    const lines = Array.isArray(d.lines) ? d.lines : [];
    const firstText = (lines.find((x) => typeof x.dialogueText === 'string' && x.dialogueText) || {}).dialogueText || '';
    const btn = (label, cls, fn) => h('button', { type: 'button', class: 'btn ' + (cls || ''), text: label, onclick: fn });
    return h('div', { class: 'card vcard' },
      h('div', { class: 'vtitle', text: d.title }),
      h('div', { class: 'vmeta', text: lines.length + ' line' + (lines.length === 1 ? '' : 's') + ' · ' + (d.format === 'essential' ? 'Essential' : 'Bare minimum') + ' · edited ' + fmtDate(d.updated) + (state.vaultId === d.id ? ' · open in editor' : '') }),
      firstText ? h('div', { class: 'vsnip', text: firstText.replace(/[\^|~]/g, '') }) : null,
      h('div', { class: 'btnrow wrap' },
        btn('Open', 'primary', () => openFromVault(d)),
        btn('Rename', '', async () => {
          const name = await ask({ title: 'Rename dialogue', input: d.title, okLabel: 'Rename' });
          if (name === null || !name.trim()) return;
          const vault = getVault(); const e = vault.find((x) => x.id === d.id);
          if (e) { e.title = name.trim(); e.updated = Date.now(); store.set(KEYS.vault, vault); }
          if (state.vaultId === d.id) { state.title = name.trim(); }
          renderVault();
        }),
        btn('Duplicate', '', () => {
          const vault = getVault(); const now = Date.now();
          vault.push({ id: C.uid(), title: d.title + ' copy', format: d.format, lines: JSON.parse(JSON.stringify(lines)), created: now, updated: now });
          store.set(KEYS.vault, vault); renderVault(); toast('Duplicated');
        }),
        btn('Export', '', () => openExport(d.title, lines.map((x, i) => C.normalizeLine(x, i)))),
        btn('Delete', 'danger', async () => {
          if (!(await ask({ title: 'Delete "' + d.title + '"?', message: 'This removes it from the Vault. It cannot be undone (unless you have a backup).', okLabel: 'Delete', danger: true }))) return;
          store.set(KEYS.vault, getVault().filter((x) => x.id !== d.id));
          if (state.vaultId === d.id) { state.vaultId = null; state.dirty = true; saveDraft(); }
          renderVault();
        })));
  }

  function renderVault() {
    const list = $('#vault-list');
    list.textContent = '';
    const q = $('#vault-search').value.trim().toLowerCase();
    const vault = getVault().slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const shown = vault.filter((d) => !q || String(d.title).toLowerCase().includes(q));
    shown.forEach((d) => list.append(vaultCard(d)));
    if (!vault.length) list.append(h('div', { class: 'empty-state' }, h('p', { text: 'The Vault is empty.' }), h('p', { class: 'small', text: 'In the Editor, tap "Save to Vault" to keep a dialogue here.' })));
    else if (!shown.length) list.append(h('div', { class: 'empty-state', text: 'No titles match.' }));
    renderVaultInfo(vault.length);
  }

  function renderVaultInfo(count) {
    const standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    const last = store.get(KEYS.backup, 0);
    const info = $('#vault-info');
    info.textContent = '';
    info.append(
      h('strong', { text: standalone ? 'Running as the installed app.' : 'Running in a Safari tab.' }),
      h('p', { class: 'small', text: 'iPhone keeps Safari-tab data and installed-app data in separate places, and iOS can clear website storage. Keep your real work in the installed app and use "Export all" regularly.' }),
      h('p', { class: 'small', text: 'Last backup: ' + (last ? fmtDate(last) : 'never') + (count && (!last || Date.now() - last > 7 * 864e5) ? ' — time for a backup!' : '') }),
      h('p', { class: 'small muted', text: 'App version ' + APP_VERSION }));
  }

  $('#vault-search').addEventListener('input', renderVault);
  $('#btn-new').addEventListener('click', async () => {
    if (!(await confirmDiscardIfDirty())) return;
    state.lines = []; state.title = 'Untitled dialogue'; state.vaultId = null; state.dirty = false; state.format = 'essential';
    state.open = null; state.notices = []; state.filter = ''; $('#search').value = '';
    saveDraft(); setTab('editor');
  });
  $('#btn-export-all').addEventListener('click', () => {
    const vault = getVault();
    if (!vault.length) { toast('The Vault is empty.'); return; }
    const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
    const filename = 'ss2-vault-backup-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
    const json = C.makeBackup(vault);
    const done = () => { store.set(KEYS.backup, Date.now()); if (state.tab === 'vault') renderVaultInfo(vault.length); };
    openSheet(h('div', null,
      h('h2', { text: 'Backup of all dialogues' }),
      h('p', { class: 'muted small', text: 'This backup is for this app’s own "Import backup" feature. It is NOT the game format. Export single dialogues for the game.' }),
      h('div', { class: 'filename', text: filename }),
      exportActions({ filename, getJson: () => json, onDone: done }),
      h('details', null, h('summary', { text: 'Show JSON' }), h('textarea', { class: 'mono', readonly: true, rows: '8', spellcheck: 'false', value: json })),
      h('div', { class: 'btnrow' }, h('button', { type: 'button', class: 'btn', text: 'Close', onclick: closeSheet }))));
  });
  $('#btn-import-backup').addEventListener('click', () => $('#file-backup').click());
  $('#file-backup').addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    try {
      const res = C.parseInput(await f.text());
      if (res.ok && res.backup) await restoreBackup(res.backup);
      else toast('That file is not a backup from this app.');
    } catch (e) { toast('Could not read that file.'); }
  });

  async function restoreBackup(obj) {
    const items = C.readBackup(obj);
    if (!items.length) { toast('That backup has no dialogues in it.'); return; }
    const ok = await ask({
      title: 'Restore backup?', okLabel: 'Restore',
      message: 'This backup has ' + items.length + ' dialogue' + (items.length === 1 ? '' : 's') + '. They are merged into your Vault; nothing is deleted.'
    });
    if (!ok) return;
    const vault = getVault();
    let added = 0, updated = 0, skipped = 0;
    items.forEach((it) => {
      const j = vault.findIndex((v) => v.id === it.id);
      if (j < 0) { vault.push(it); added++; }
      else if (it.updated > (vault[j].updated || 0)) { vault[j] = it; updated++; }
      else skipped++;
    });
    if (!store.set(KEYS.vault, vault)) { toast('Could not save (storage full or blocked).'); return; }
    toast('Restored: ' + added + ' new, ' + updated + ' updated, ' + skipped + ' unchanged');
    setTab('vault');
  }

  /* ====================================================================
     EXPORT
     ==================================================================== */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try {
        const ta = h('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0' });
        ta.value = text;
        document.body.append(ta);
        ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) { return false; }
    }
  }

  function downloadFile(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // Returns true if something was saved/shared, false if the user cancelled.
  async function saveToFiles(filename, text) {
    let file = null;
    try { file = new File([text], filename, { type: 'application/json' }); } catch (e) { file = null; }
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return true; }
      catch (e) {
        if (e && e.name === 'AbortError') return false;
      }
    }
    downloadFile(filename, text);
    toast('Share sheet not available, so I downloaded the file instead.');
    return true;
  }

  /* The three export buttons. getJson() is read at tap time, so it always matches the current settings. */
  function exportActions(o) {
    const run = async (fn) => {
      if (o.confirmFirst && !(await o.confirmFirst())) return;
      await fn();
    };
    const done = () => { if (o.onDone) o.onDone(); };
    return h('div', { class: 'stack' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => run(async () => {
        if (await copyText(o.getJson())) { toast('JSON copied'); done(); } else toast('Copy failed. Open "Show JSON" below and copy by hand.');
      }) }, 'Copy JSON', h('small', { text: 'puts the text on your clipboard' })),
      h('button', { type: 'button', class: 'btn', onclick: () => run(async () => { if (await saveToFiles(o.filename, o.getJson())) done(); }) },
        'Save to Files…', h('small', { text: 'opens the share sheet, then choose "Save to Files"' })),
      h('button', { type: 'button', class: 'btn', onclick: () => run(async () => { downloadFile(o.filename, o.getJson()); done(); }) },
        'Download .json', h('small', { text: 'plain download link fallback' })));
  }

  function openExport(title, lines) {
    const s = getExportSettings();
    const filename = C.sanitizeFilename(title) + '.json';
    let json = '';
    let bareOk = false;
    const jsonTa = h('textarea', { class: 'mono', readonly: true, rows: '8', spellcheck: 'false' });
    const warnHolder = h('div');
    const segBtns = {
      essential: h('button', { type: 'button', class: 'segbtn', 'data-format': 'essential', onclick: () => { s.format = 'essential'; refresh(); } }, 'Essential', h('small', { text: '23 keys' })),
      bare: h('button', { type: 'button', class: 'segbtn', 'data-format': 'bare', onclick: () => { s.format = 'bare'; refresh(); } }, 'Bare minimum', h('small', { text: '9 keys' }))
    };
    const mkChk = (key, label) => {
      const inp = h('input', { type: 'checkbox', 'data-opt': key });
      inp.addEventListener('change', () => { s[key] = inp.checked; refresh(); });
      return { inp, node: h('label', { class: 'chk' }, inp, h('span', { text: label })) };
    };
    const chkIndex = mkChk('includeIndex', 'Also include index');
    const chkCustom = mkChk('includeCustomLength', 'Also include customLength');
    const chkChar = mkChk('includeCharacterName', 'Also include characterName');
    const chkNote = h('p', { class: 'small muted' });

    function refresh() {
      setExportSettings(s);
      json = C.toJson(lines, s);
      jsonTa.value = json;
      Object.keys(segBtns).forEach((k) => segBtns[k].classList.toggle('on', s.format === k));
      [[chkIndex, 'includeIndex'], [chkCustom, 'includeCustomLength'], [chkChar, 'includeCharacterName']].forEach(([c, k]) => {
        c.inp.checked = !!s[k]; c.inp.disabled = s.format === 'bare';
      });
      chkNote.textContent = s.format === 'bare'
        ? 'The bare minimum format always has index, characterName and customLength. These options only apply to Essential.'
        : 'These keys are left out of the game’s essential export by default. They are added after the 23 essential keys.';
      const ws = warnListFor(lines, s).map((x) => '#' + x.i + ': ' + x.msg);
      if (s.format === 'bare') ws.unshift('Bare minimum drops audio, camera, scene and prompt data (and the other new fields).');
      if (!lines.length) ws.push('The dialogue is empty, so the export will be an empty list [].');
      warnHolder.replaceChildren(ws.length
        ? h('div', { class: 'warnbox' }, h('strong', { text: ws.length + ' warning' + (ws.length === 1 ? '' : 's') + ' (export is not blocked)' }), h('ul', null, ws.map((w) => h('li', { text: w }))))
        : h('div', { class: 'okbox', text: '✓ No problems found' }));
    }

    const confirmFirst = async () => {
      if (s.format !== 'bare' || bareOk) return true;
      const ok = await ask({
        title: 'Export as bare minimum?', okLabel: 'Export anyway', danger: true,
        message: 'The bare minimum format has only 9 keys. It DROPS audio, camera shake, scene change, prompts, showAvatar, thinking, noInput, skipTextbox, die and the other new fields.'
      });
      if (ok) bareOk = true;
      return ok;
    };

    const close = () => { closeSheet(); if (state.tab === 'editor') renderEditor(); };
    refresh();
    openSheet(h('div', null,
      h('h2', { text: 'Export for the game' }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Export format' }, segBtns.essential, segBtns.bare),
      h('div', { class: 'chks' }, chkIndex.node, chkCustom.node, chkChar.node, chkNote),
      warnHolder,
      h('div', { class: 'filename', text: filename }),
      exportActions({ filename, getJson: () => json, confirmFirst }),
      h('details', null, h('summary', { text: 'Show JSON' }), jsonTa),
      h('div', { class: 'btnrow' }, h('button', { type: 'button', class: 'btn', text: 'Close', onclick: close }))), close);
  }

  /* ====================================================================
     BOOT + MIGRATION
     ==================================================================== */
  /* Old (v1) Vault entries only had the 9 old fields. Add the new defaults, keep everything else, and keep a one-time safety copy. */
  function migrate() {
    try {
      if (store.get(KEYS.schema, 1) >= 2) return;
      const raw = localStorage.getItem(KEYS.vault);
      if (raw !== null && localStorage.getItem(KEYS.vaultV1) === null) {
        try { localStorage.setItem(KEYS.vaultV1, raw); } catch (e) { /* the safety copy is a bonus */ }
      }
      const vault = getVault().map((d) => Object.assign({}, d, {
        format: d.format === 'essential' ? 'essential' : 'bare',
        lines: (Array.isArray(d.lines) ? d.lines : []).filter(isPlain).map((x, i) => C.normalizeLine(x, i))
      }));
      if (store.set(KEYS.vault, vault)) store.set(KEYS.schema, 2);
    } catch (e) { /* openFromVault normalizes anyway */ }
  }

  function boot() {
    migrate();
    const draft = store.get(KEYS.draft, null);
    if (draft && Array.isArray(draft.lines)) {
      state.lines = draft.lines.filter(isPlain).map((x, i) => C.normalizeLine(x, i));
      state.title = typeof draft.title === 'string' ? draft.title : 'Untitled dialogue';
      state.vaultId = draft.vaultId || null;
      state.dirty = !!draft.dirty;
      state.format = draft.format === 'essential' ? 'essential' : (draft.format === 'bare' ? 'bare' : 'bare');
      if (state.vaultId && !getVault().some((d) => d.id === state.vaultId)) { state.vaultId = null; state.dirty = true; }
    }
    pasteBox.value = store.get(KEYS.paste, '') || '';

    const standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (!standalone && !store.get(KEYS.tip, false)) $('#install-tip').hidden = false;
    $('#install-dismiss').addEventListener('click', () => { $('#install-tip').hidden = true; store.set(KEYS.tip, true); });
    $('#btn-reload').addEventListener('click', () => location.reload());

    let tab = store.get(KEYS.tab, 'import');
    if (!TAB_TITLES[tab]) tab = 'import';
    if (tab === 'editor' && !state.lines.length) tab = 'import';
    setTab(tab);

    window.addEventListener('pagehide', saveDraft);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraft(); });

    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ }
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache is optional */ });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) $('#update-bar').hidden = false;
      });
    }
  }

  boot();
})();
