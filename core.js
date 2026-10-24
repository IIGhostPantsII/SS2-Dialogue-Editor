/* SS2 Dialogue Editor - core logic (v2: essential 23-field format + bare 9-field format).
   No DOM in here, so it can be tested in Node. */
(function (root) {
  'use strict';

  var APP_ID = 'stupid-simulator-2-dialogue-editor';

  // The ESSENTIAL export keys, in the game's exact order. "legnth" is misspelled ON PURPOSE.
  var ESSENTIAL = ['speakerName', 'metBefore', 'showAvatar', 'thinking', 'dialogueText', 'textSpeed',
    'noInput', 'delayTextbox', 'legnth', 'skipTextbox',
    'stopSong', 'pauseSong', 'resumeSong', 'soundEffect', 'songChange',
    'prompts',
    'cameraShaking', 'duration', 'magnitude', 'die', 'sceneChange', 'noSound', 'instant'];
  // Kept on every line inside the app, but NOT part of the essential export by default.
  var INTERNAL = ['index', 'customLength', 'characterName'];
  var KNOWN = ESSENTIAL.concat(INTERNAL);
  // The old BARE MINIMUM export: exact keys, exact order.
  var BARE = ['index', 'speakerName', 'characterName', 'metBefore', 'dialogueText', 'textSpeed',
    'delayTextbox', 'legnth', 'customLength'];
  var ESSENTIAL_ONLY = ESSENTIAL.filter(function (k) { return BARE.indexOf(k) < 0; });
  var BARE_PARSE_KEYS = ['speakerName', 'metBefore', 'dialogueText', 'textSpeed', 'delayTextbox', 'legnth'];
  var PROMPT_KEYS = ['name', 'changeScene', 'sceneName', 'noSound', 'dialogue', 'requirements'];

  var BOOL_KEYS = ['metBefore', 'showAvatar', 'thinking', 'noInput', 'delayTextbox', 'skipTextbox',
    'stopSong', 'pauseSong', 'resumeSong', 'cameraShaking', 'die', 'noSound', 'instant'];
  var STR_KEYS = ['speakerName', 'dialogueText', 'soundEffect', 'songChange', 'sceneChange', 'characterName'];
  var NUM_KEYS = ['textSpeed', 'legnth', 'duration', 'magnitude', 'customLength'];

  function defaults() {
    return {
      index: 0, speakerName: '', metBefore: true, showAvatar: false, thinking: false, dialogueText: '',
      textSpeed: 0.05, noInput: false, delayTextbox: false, legnth: 0, skipTextbox: false,
      stopSong: false, pauseSong: false, resumeSong: false, soundEffect: '', songChange: '',
      prompts: [], cameraShaking: false, duration: 0, magnitude: 0, die: false,
      sceneChange: '', noSound: false, instant: false,
      customLength: 0, characterName: ''
    };
  }
  function defaultPrompt() {
    return { name: '', changeScene: false, sceneName: '', noSound: false, dialogue: null, requirements: [] };
  }

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isPlain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* A prompt: the six known keys in order (missing ones get defaults), then any unknown keys untouched.
     "dialogue" and "requirements" are carried through exactly as they came. */
  function normalizePrompt(p) {
    if (!isPlain(p)) return p;
    var d = defaultPrompt(), out = {};
    PROMPT_KEYS.forEach(function (k) {
      var missing = !has(p, k) || p[k] === undefined || (p[k] === null && k !== 'dialogue');
      out[k] = missing ? d[k] : p[k];
    });
    Object.keys(p).forEach(function (k) { if (PROMPT_KEYS.indexOf(k) < 0) out[k] = p[k]; });
    return out;
  }

  /* A line: essential keys in order, then index/customLength/characterName, then unknown extras. */
  function normalizeLine(raw, i) {
    var src = isPlain(raw) ? raw : {};
    var d = defaults(), out = {};
    ESSENTIAL.concat(INTERNAL).forEach(function (k) {
      out[k] = (has(src, k) && src[k] !== null && src[k] !== undefined) ? src[k] : d[k];
    });
    if (Array.isArray(out.prompts)) out.prompts = out.prompts.map(normalizePrompt);
    out.index = i || 0;
    Object.keys(src).forEach(function (k) { if (KNOWN.indexOf(k) < 0) out[k] = src[k]; });
    return out;
  }

  function newLine(speaker, metBefore) {
    var o = { speakerName: speaker || '' };
    if (typeof metBefore === 'boolean') o.metBefore = metBefore;
    return normalizeLine(o, 0);
  }
  /* An event beat: no spoken text, used to trigger music / shake / scene changes. */
  function eventBeat(speaker) {
    return normalizeLine({ speakerName: speaker || '', dialogueText: '', skipTextbox: true }, 0);
  }
  function isEventBeat(l) { return l.dialogueText === ''; }

  /* ---------- export ---------- */

  function exportSettingsDefaults() {
    return { format: 'essential', includeIndex: false, includeCustomLength: false, includeCharacterName: false };
  }

  function exportLine(l, settings, i) {
    var s = settings || exportSettingsDefaults();
    var src = normalizeLine(l, i);
    var out = {};
    if (s.format === 'bare') {
      BARE.forEach(function (k) { out[k] = src[k]; });
      return out;
    }
    ESSENTIAL.forEach(function (k) { out[k] = src[k]; });
    if (s.includeIndex) out.index = src.index;
    if (s.includeCustomLength) out.customLength = src.customLength;
    if (s.includeCharacterName) out.characterName = src.characterName;
    Object.keys(src).forEach(function (k) { if (KNOWN.indexOf(k) < 0) out[k] = src[k]; });
    return out;
  }
  function toExportArray(lines, settings) {
    return lines.map(function (l, i) { return exportLine(l, settings, i); });
  }
  function toJson(lines, settings) { return JSON.stringify(toExportArray(lines, settings), null, 2); }

  /* Full internal data (everything, including customLength, characterName and unknown keys) for the Vault/drafts/backups. */
  function toStorageArray(lines) {
    return lines.map(function (l, i) { return normalizeLine(l, i); });
  }

  /* ---------- pasted text cleanup + parsing ---------- */

  function cleanPaste(text, notices) {
    var t = String(text == null ? '' : text).replace(/^﻿/, '').trim();
    var fence = t.match(/```[A-Za-z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/);
    if (fence) {
      t = fence[1].trim();
      notices.push('Removed the markdown code fence (```).');
    } else if (/^```/.test(t)) {
      t = t.replace(/^```[A-Za-z0-9_-]*[ \t]*\r?\n?/, '').replace(/```\s*$/, '').trim();
      notices.push('Removed the markdown code fence (```).');
    }
    if (t && t[0] !== '[' && t[0] !== '{') {
      var a = t.search(/[\[{]/);
      var closer = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
      if (a >= 0 && closer > a) {
        t = t.slice(a, closer + 1);
        notices.push('Ignored extra text around the JSON.');
      }
    }
    return t;
  }

  function describeType(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'a list';
    return 'a ' + typeof v;
  }

  function lineCol(t, pos) {
    var before = t.slice(0, pos);
    var line = before.split('\n').length;
    var col = pos - (before.lastIndexOf('\n') + 1) + 1;
    return { line: line, col: col };
  }

  function posFromLineCol(t, line, col) {
    var lines = t.split('\n'), pos = 0;
    for (var i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    return pos + Math.max(0, col - 1);
  }

  /* A tiny scanner that spots the most common mistakes and gives a plain-English reason + position. */
  function scanProblem(t) {
    var stack = [], inStr = false, esc = false, strStart = 0, lastSig = null, lastSigPos = -1;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = false; lastSig = '"'; lastSigPos = i; continue; }
        if (c === '\n' || c === '\r') return { pos: i, msg: 'A line break appeared inside a quoted text. Inside a string, a new line has to be written as \\n.' };
        continue;
      }
      if (c === '"') { inStr = true; strStart = i; continue; }
      if (c === "'") return { pos: i, msg: "Found a single quote ('). JSON only allows double quotes (\")." };
      if (c === '“' || c === '”') return { pos: i, msg: 'Found a curly quote (“ ”). JSON needs straight double quotes (").' };
      if (c === '[' || c === '{') {
        if ((lastSig === '}' || lastSig === ']') && stack.length) return { pos: i, msg: 'There seems to be a missing comma between two items.' };
        stack.push({ c: c, i: i }); lastSig = c; lastSigPos = i; continue;
      }
      if (c === ']' || c === '}') {
        if (lastSig === ',') return { pos: lastSigPos, msg: 'There is a comma right before a closing bracket (a trailing comma). Remove it.' };
        var top = stack.pop();
        var want = c === ']' ? '[' : '{';
        if (!top || top.c !== want) return { pos: i, msg: 'Unexpected "' + c + '" - the brackets do not match up.' };
        lastSig = c; lastSigPos = i; continue;
      }
      if (/\s/.test(c)) continue;
      lastSig = c; lastSigPos = i;
    }
    if (inStr) return { pos: strStart, msg: 'A quoted text starts here but never ends (a closing " is missing).' };
    if (stack.length) {
      var open = stack[stack.length - 1];
      return { pos: t.length, msg: 'A closing "' + (open.c === '[' ? ']' : '}') + '" is missing - the text ends too early (was it cut off?).' };
    }
    return null;
  }

  function describeError(t, err) {
    var engineMsg = (err && err.message) ? err.message : 'Unknown error';
    var pos = null, m = /position (\d+)/i.exec(engineMsg);
    if (m) pos = +m[1];
    else {
      m = /line (\d+) column (\d+)/i.exec(engineMsg);
      if (m) pos = posFromLineCol(t, +m[1], +m[2]);
    }
    var scan = scanProblem(t);
    if (pos === null && scan) pos = scan.pos;
    var msg = 'This is not valid JSON yet. ' + (scan ? scan.msg : 'The text could not be read (' + engineMsg + ').');
    var snippet = '', line = null, col = null;
    if (pos !== null) {
      pos = Math.min(Math.max(pos, 0), t.length);
      var lc = lineCol(t, pos); line = lc.line; col = lc.col;
      msg += ' (around line ' + line + ', column ' + col + ')';
      var a = Math.max(0, pos - 40), b = Math.min(t.length, pos + 40);
      snippet = (a > 0 ? '…' : '') + t.slice(a, pos).replace(/\s*\n\s*/g, ' ↵ ') +
        ' ⟪HERE⟫ ' + t.slice(pos, b).replace(/\s*\n\s*/g, ' ↵ ') + (b < t.length ? '…' : '');
    }
    return { error: msg, snippet: snippet, line: line, col: col };
  }

  /* Parse text that should be a JSON list (used by the raw JSON editors). */
  function parseJsonList(text) {
    var t = String(text);
    var v;
    try { v = JSON.parse(t); }
    catch (e) { return { ok: false, error: describeError(t, e).error }; }
    if (!Array.isArray(v)) return { ok: false, error: 'This must be a list, like [ ... ], but it is ' + describeType(v) + '.' };
    return { ok: true, value: v };
  }

  function parseInput(text) {
    var notices = [];
    var t = cleanPaste(text, notices);
    if (!t) return { ok: false, error: 'There is nothing to load yet. Paste your JSON into the box first.' };

    var candidates = [{ s: t, note: null }];
    var fixed = t.replace(/,(\s*[\]}])/g, '$1').replace(/,\s*$/, '');
    if (t[0] === '{') candidates.push({ s: '[' + t + ']', note: 'Found several line objects without an outer list, so I wrapped them in one.' });
    if (fixed !== t) {
      candidates.push({ s: fixed, note: 'Removed trailing comma(s), which JSON does not allow.' });
      if (fixed[0] === '{') candidates.push({ s: '[' + fixed + ']', note: 'Wrapped the line objects in a list and removed trailing comma(s).' });
    }

    var data, parsed = false, firstErr = null;
    for (var i = 0; i < candidates.length; i++) {
      try {
        data = JSON.parse(candidates[i].s);
        parsed = true;
        if (candidates[i].note) notices.push(candidates[i].note);
        break;
      } catch (e) { if (!firstErr) firstErr = e; }
    }
    if (!parsed) {
      var d = describeError(t, firstErr);
      return { ok: false, error: d.error, snippet: d.snippet, line: d.line, col: d.col };
    }

    if (isPlain(data) && data.app === APP_ID && Array.isArray(data.dialogues)) {
      return { ok: true, backup: data, notices: notices };
    }

    var arr;
    if (Array.isArray(data)) {
      arr = data;
    } else if (isPlain(data)) {
      var arrKeys = Object.keys(data).filter(function (k) {
        return Array.isArray(data[k]) && data[k].length && data[k].every(isPlain);
      });
      if (!has(data, 'dialogueText') && arrKeys.length === 1) {
        arr = data[arrKeys[0]];
        notices.push('Used the list found inside "' + arrKeys[0] + '". Exporting gives just the list, as the game expects.');
      } else {
        arr = [data];
        notices.push('Single line detected, so I wrapped it in a list.');
      }
    } else {
      return { ok: false, error: 'That is valid JSON, but it is ' + describeType(data) + ', not a list of dialogue lines.' };
    }

    for (var j = 0; j < arr.length; j++) {
      if (!isPlain(arr[j])) {
        return { ok: false, error: 'Item ' + (j + 1) + ' in the list is not a dialogue line object (it is ' + describeType(arr[j]) + ').' };
      }
    }

    // Which format was it? Any essential-only key (showAvatar, skipTextbox, prompts, ...) means essential.
    var format = arr.length ? 'bare' : 'essential';
    arr.forEach(function (it) {
      ESSENTIAL_ONLY.forEach(function (k) { if (has(it, k)) format = 'essential'; });
    });

    var expected = format === 'essential' ? ESSENTIAL : BARE_PARSE_KEYS;
    var filled = 0, renum = 0;
    arr.forEach(function (it, k) {
      expected.forEach(function (f) { if (!has(it, f) || it[f] === null) filled++; });
      if (has(it, 'index') && it.index !== k) renum++;
    });
    if (filled) notices.push('Filled in ' + filled + ' missing field' + (filled === 1 ? '' : 's') + ' with defaults.');
    if (renum) notices.push('Renumbered "index" on ' + renum + ' line' + (renum === 1 ? '' : 's') + ' so it matches the position.');

    return { ok: true, format: format, lines: arr.map(function (it, k) { return normalizeLine(it, k); }), notices: notices };
  }

  /* ---------- vault backup (the app's own format, NOT the game format) ---------- */

  function makeBackup(vault) {
    return JSON.stringify({
      app: APP_ID, version: 2, exportedAt: new Date().toISOString(),
      dialogues: vault.map(function (d) {
        return { id: d.id, title: d.title, format: d.format === 'essential' ? 'essential' : 'bare', created: d.created, updated: d.updated, lines: toStorageArray(d.lines) };
      })
    }, null, 2);
  }

  function readBackup(obj) {
    var out = [];
    (obj.dialogues || []).forEach(function (d) {
      if (!isPlain(d) || !Array.isArray(d.lines)) return;
      out.push({
        id: String(d.id || uid()),
        title: String(d.title || 'Untitled dialogue'),
        // backups made before the update have no format key; those came from the old 9-field files
        format: d.format === 'essential' ? 'essential' : 'bare',
        created: Number(d.created) || Date.now(),
        updated: Number(d.updated) || Date.now(),
        lines: d.lines.filter(isPlain).map(function (x, i) { return normalizeLine(x, i); })
      });
    });
    return out;
  }

  /* ---------- validation (warnings only, never blocks export) ---------- */

  function lineWarnings(l, opts) {
    var o = opts || {};
    var w = [];
    BOOL_KEYS.forEach(function (k) { if (typeof l[k] !== 'boolean') w.push(k + ' should be true or false.'); });
    STR_KEYS.forEach(function (k) { if (typeof l[k] !== 'string') w.push(k + ' should be text.'); });
    NUM_KEYS.forEach(function (k) { if (!isNum(l[k])) w.push(k + ' should be a number.'); });

    var text = typeof l.dialogueText === 'string' ? l.dialogueText : '';
    if (/\|\s*$/.test(text)) w.push('Text ends with "|". The "|" pause only goes between sentences, never after the final period.');
    if (text.indexOf('~') >= 0) {
      if (!(Number(l.customLength) > 0)) w.push('Text has "~" but customLength is 0.');
      if (o.format !== 'bare' && !o.includeCustomLength) {
        w.push('Text has "~", but customLength is not included in this export, so this pause will be 0 seconds in the game. (Turn on "Also include customLength" when exporting.)');
      }
    }
    if (l.delayTextbox === true && !(Number(l.legnth) > 0)) w.push('Textbox delay is on but legnth is 0.');
    if (l.cameraShaking === true && (!(Number(l.duration) > 0) || !(Number(l.magnitude) > 0))) {
      w.push('Camera shaking is on but duration or magnitude is 0.');
    }
    if (l.stopSong === true && typeof l.songChange === 'string' && l.songChange !== '') {
      w.push('Both "Stop song" and a song change are set. The song change is not used when Stop song is on.');
    }
    if ((l.noSound === true || l.instant === true) && l.sceneChange === '') {
      w.push('No sound / instant is on but there is no scene change.');
    }
    if (typeof l.speakerName === 'string' && l.speakerName.length > 12) {
      w.push('Speaker name is long (' + l.speakerName.length + ' characters) and may not fit the name box.');
    }
    if (has(l, 'length')) w.push('Has a "length" field. The game expects the misspelled key "legnth"; "length" is only carried along as an extra.');

    if (l.prompts !== undefined && !Array.isArray(l.prompts)) {
      w.push('prompts should be a list.');
    } else if (Array.isArray(l.prompts)) {
      l.prompts.forEach(function (p, n) {
        var tag = 'Prompt ' + (n + 1);
        if (!isPlain(p)) { w.push(tag + ' is not an object.'); return; }
        var name = typeof p.name === 'string' ? p.name : '';
        if (name === '') w.push(tag + ' has an empty name.');
        var scene = typeof p.sceneName === 'string' ? p.sceneName : '';
        if (p.changeScene === true && scene === '') w.push(tag + ': changeScene is on but sceneName is empty.');
        if (scene !== '' && p.changeScene !== true) w.push(tag + ': sceneName is filled in but changeScene is off.');
        if (p.requirements !== undefined && !Array.isArray(p.requirements)) w.push(tag + ': requirements should be a list.');
      });
    }
    return w;
  }

  /* [{ i, msg }] for every warning on every line. */
  function warnList(lines, opts) {
    var out = [];
    if (!Array.isArray(lines)) return out;
    lines.forEach(function (l, i) {
      lineWarnings(l, opts).forEach(function (msg) { out.push({ i: i, msg: msg }); });
    });
    return out;
  }

  function validate(lines, opts) {
    if (!Array.isArray(lines)) return ['The dialogue is not a list.'];
    var out = warnList(lines, opts).map(function (x) { return '#' + x.i + ': ' + x.msg; });
    if (!lines.length) out.push('The dialogue is empty, so the export will be an empty list [].');
    return out;
  }

  /* ---------- misc ---------- */

  function segments(text) {
    var out = [], parts = String(text).split(/([\^|~])/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p === '') continue;
      if (p === '^' || p === '|' || p === '~') out.push({ k: p, v: p });
      else out.push({ k: 't', v: p });
    }
    return out;
  }

  function sanitizeFilename(title) {
    var s = String(title || '')
      .replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/^[.\-]+/, '')
      .replace(/-+$/, '')
      .slice(0, 80);
    return s || 'dialogue';
  }

  var Core = {
    APP_ID: APP_ID, ESSENTIAL: ESSENTIAL, INTERNAL: INTERNAL, KNOWN: KNOWN, BARE: BARE,
    ESSENTIAL_ONLY: ESSENTIAL_ONLY, PROMPT_KEYS: PROMPT_KEYS,
    defaults: defaults, defaultPrompt: defaultPrompt, uid: uid,
    normalizeLine: normalizeLine, normalizePrompt: normalizePrompt, newLine: newLine, eventBeat: eventBeat, isEventBeat: isEventBeat,
    exportSettingsDefaults: exportSettingsDefaults, exportLine: exportLine, toExportArray: toExportArray, toJson: toJson,
    toStorageArray: toStorageArray, parseInput: parseInput, parseJsonList: parseJsonList,
    makeBackup: makeBackup, readBackup: readBackup,
    lineWarnings: lineWarnings, warnList: warnList, validate: validate, segments: segments, sanitizeFilename: sanitizeFilename
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
