import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');
const format = 'cosanum-local-prototype-v1';
export const INITIAL_CLOCK = '2026-11-09T08:00:00.000Z';
export const RESET_CONFIRMATION = 'RESET SYNTHETIC DATA';
const sourceFiles = ['Schema.gs', 'Catalogue.gs', 'Intake.gs', 'Deadlines.gs', 'Session.gs',
  'Setup.gs', 'IndividualProof.gs', 'SkillUpdate.gs', 'Audit.gs'];
const sources = sourceFiles.map(name => [name, fs.readFileSync(path.join(root, 'apps-script', name), 'utf8')]);
const fixtureText = fs.readFileSync(path.join(root, 'fixtures/synthetic_demo.json'), 'utf8');
const fixtureHash = createHash('sha256').update(fixtureText).digest('hex');
const seed = JSON.parse(fixtureText);
// Synthetic identity normalization is defined in SPEC.md.
seed.People.forEach((row, i) => { row[4] = `PER-${String(i + 1).padStart(2, '0')}`; });
const clone = value => JSON.parse(JSON.stringify(value));

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error('Clock must be a complete UTC ISO timestamp.');
  }
  const stamp = Date.parse(value);
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString() !== normalized) throw new Error('Invalid clock timestamp.');
  return normalized;
}

function rejectLink(file) {
  try { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Local prototype paths must not be symbolic links.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

/** A single-process, synthetic-only store; all workflow decisions stay canonical. */
export function openPrototype({ dataDir } = {}) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('An absolute local prototype dataDir is required.');
  rejectLink(dataDir);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const directory = fs.realpathSync(dataDir);
  const stateFile = path.join(directory, 'prototype-state.json');
  const lockFile = path.join(directory, '.prototype-writer.lock');
  rejectLink(stateFile); rejectLink(lockFile);
  const token = randomUUID();
  let lock;
  try { lock = fs.openSync(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Prototype store already has a writer lock. Stop the other process; after a crash, verify its PID has stopped before removing .prototype-writer.lock.');
    throw error;
  }
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token }));
  fs.closeSync(lock);
  let closed = false, state;
  function assertOpen() { if (closed) throw new Error('Prototype runtime is closed.'); }
  function close() {
    if (closed) return;
    closed = true;
    if (JSON.parse(fs.readFileSync(lockFile, 'utf8')).token !== token) throw new Error('Prototype writer lock changed; not removing another writer lock.');
    fs.unlinkSync(lockFile);
  }

  try {
    class ClockDate extends Date {
      constructor(...args) { super(...(args.length ? args : [state?.clock || INITIAL_CLOCK])); }
      static now() { return Date.parse(state?.clock || INITIAL_CLOCK); }
    }
    const context = vm.createContext({
      Date: ClockDate,
      Utilities: { formatDate(date, zone, pattern) {
        if (zone !== 'Europe/Zurich' || pattern !== 'yyyy-MM-dd') throw new Error('Unsupported local date format.');
        return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
      } },
      getPrivateFixture_: () => clone(seed),
      Session: { getEffectiveUser: () => ({ getEmail: () => seed.People[0][1] }) },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      SpreadsheetApp: { flush() {} },
      demoSheetLink_: () => '',
      readDemoTables_: () => tableObjects(),
      findDemoSpreadsheet_: () => ({ getSheetByName: name => sheet(name) })
    }, { codeGeneration: { strings: false, wasm: false } });
    for (const [filename, source] of sources) vm.runInContext(source, context, { filename, timeout: 1000 });
    const schema = clone(context.DEMO_SCHEMA);
    context.validateFixture_(clone(seed));

    function fresh() {
      return { format, schemaVersion: schema.version, fixtureHash, clock: INITIAL_CLOCK,
        tables: Object.fromEntries(Object.keys(schema.sheets).map(name => [name, clone(seed[name] || [])])) };
    }
    function tableObjects() {
      return Object.fromEntries(Object.entries(schema.sheets).map(([name, headers]) => [name,
        state.tables[name].map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])))]));
    }
    function sheet(name) {
      if (!Object.hasOwn(schema.sheets, name)) return null;
      const width = schema.sheets[name].length;
      function write(row) {
        if (!Array.isArray(row) || row.length !== width) throw new Error(`Invalid local ${name} row width.`);
        state.tables[name].push(clone(row));
      }
      return { getLastRow: () => state.tables[name].length + 1, appendRow: write,
        getRange(row, column, count, columns) {
          if (row !== state.tables[name].length + 2 || column !== 1 || columns !== width) throw new Error('Only complete append operations are supported by the local intake adapter.');
          return { setValues(values) {
            if (!Array.isArray(values) || values.length !== count) throw new Error('Local append row count does not match.');
            values.forEach(write);
          } };
        }
      };
    }
    function validate() {
      if (!state || state.format !== format || state.schemaVersion !== schema.version || state.fixtureHash !== fixtureHash) throw new Error('Local prototype store version or fixture does not match; preserve the store and select a fresh directory.');
      instant(state.clock);
      if (!state.tables || JSON.stringify(Object.keys(state.tables).sort()) !== JSON.stringify(Object.keys(schema.sheets).sort())) throw new Error('Local prototype tables do not match the canonical schema.');
      for (const [name, headers] of Object.entries(schema.sheets)) {
        const rows = state.tables[name];
        if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row) || row.length !== headers.length || row.some(v => !['string', 'number', 'boolean'].includes(typeof v) || typeof v === 'number' && !Number.isFinite(v)))) throw new Error(`Corrupt local ${name} rows.`);
        if (['Topics', 'People', 'Skills'].includes(name)) {
          if (JSON.stringify(rows) !== JSON.stringify(seed[name])) throw new Error('Foundation catalogue/identities/skills must match the synthetic seed. Register changes require the later import adapter.');
        } else if (!['Requests', 'ParticipantCases', 'DeadlineChanges'].includes(name) && rows.length) {
          throw new Error(`The foundation runtime does not support populated ${name}; use the matching later runtime.`);
        }
      }
      const tables = tableObjects();
      const requestIds = new Set(), actionIds = new Set(), caseIds = new Set();
      for (const r of tables.Requests) {
        if (r.demo_marker !== '[DEMO]' || r.status !== 'draft' || r.mode !== '' || typeof r.action_id !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.action_id) ||
            !Number.isInteger(r.target_level) || r.request_id !== `REQ-${r.action_id.toUpperCase()}` || requestIds.has(r.request_id) || actionIds.has(r.action_id)) throw new Error('Corrupt local draft request.');
        instant(r.created_at); requestIds.add(r.request_id); actionIds.add(r.action_id);
        const cases = tables.ParticipantCases.filter(c => c.request_id === r.request_id);
        const selected = context.getIntakePreview_({ topicId: r.topic_id, targetLevel: r.target_level, personKeys: cases.map(c => c.person_key) });
        if (!selected.allAllowed) throw new Error('Stored request no longer passes canonical eligibility.');
        for (const c of cases) {
          const expected = selected.rows.find(p => p.personKey === c.person_key);
          if (c.case_id !== `CASE-${r.action_id.toUpperCase()}-${c.person_key}` || caseIds.has(c.case_id) || c.status !== 'draft' || c.demo_marker !== '[DEMO]' || c.created_at !== r.created_at || c.target_level !== r.target_level || c.current_level !== Number(expected.currentLevel)) throw new Error('Corrupt local person case.');
          caseIds.add(c.case_id);
        }
        context.deadlineScopeBindings_(tables, r.request_id);
        const changes = tables.DeadlineChanges.filter(d => d.request_id === r.request_id);
        if (changes.some(d => d.source !== 'request' || d.case_id !== '' || d.change_id !== r.action_id ||
            d.recorded_at !== r.created_at || d.actor_email !== seed.People[0][1] ||
            JSON.stringify(context.deadlineCaseIds_(d)) !== JSON.stringify(cases.map(c => c.case_id).sort())) || changes.length > 1) throw new Error('Only intact initial request deadlines are supported by the foundation.');
        context.deadlineStream_(tables.DeadlineChanges, r.request_id, '', 'request');
      }
      if (tables.ParticipantCases.some(c => !requestIds.has(c.request_id)) || tables.DeadlineChanges.some(d => !requestIds.has(d.request_id))) throw new Error('Orphan local case or deadline.');
    }
    function persist() {
      rejectLink(stateFile);
      const temporary = `${stateFile}.${token}.tmp`;
      try {
        const fd = fs.openSync(temporary, 'wx', 0o600);
        try { fs.writeFileSync(fd, JSON.stringify(state, null, 2) + '\n'); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
        fs.renameSync(temporary, stateFile);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    function transact(operation) {
      assertOpen();
      const before = clone(state);
      try { const result = operation(); validate(); persist(); return clone(result); }
      catch (error) { state = before; throw error; }
    }
    const grants = [
      { role: 'owner', personKey: 'MATT', label: 'Demo Coordinator' },
      { role: 'trainer', personKey: 'MATT', label: 'Demo Coordinator' },
      { role: 'trainer', personKey: 'MARIE', label: 'Demo Coach' },
      { role: 'participant', personKey: 'WOHNUNG', label: 'Demo Participant A' },
      { role: 'participant', personKey: 'SUMNER', label: 'Demo Participant B' }
    ];
    function actorCheck(actor, owner = false) {
      assertOpen();
      if (!actor || !grants.some(g => g.role === actor.role && g.personKey === actor.personKey) || owner && actor.role !== 'owner') throw new Error('This synthetic identity is not allowed to perform this action.');
    }
    function snapshot(actor) {
      actorCheck(actor);
      const tables = tableObjects();
      // Assignment visibility is defined in SPEC.md.
      const cases = actor.role === 'owner' ? tables.ParticipantCases : actor.role === 'participant'
        ? tables.ParticipantCases.filter(c => c.person_key === actor.personKey) : [];
      const ids = new Set(cases.map(c => c.case_id));
      const requests = tables.Requests.filter(r => cases.some(c => c.request_id === r.request_id));
      const requestIds = new Set(requests.map(r => r.request_id));
      function visibleDeadline(personCase) {
        const view = clone(context.deadlineCaseView_(tables.Requests.find(r => r.request_id === personCase.request_id), personCase,
          context.auditCase_(tables, personCase, new ClockDate()), tables.DeadlineChanges, new ClockDate()));
        for (const source of [view.request, view.policy].filter(Boolean)) {
          source.history.forEach(change => { if (change.caseIds) change.caseIds = change.caseIds.filter(id => ids.has(id)); });
        }
        return view;
      }
      return clone({ clock: state.clock,
        requests: requests.map(r => ({ ...r, requestNo: tables.Requests.indexOf(r) + 1,
          topicName: tables.Topics.find(t => t.topic_id === r.topic_id).display_name })),
        cases: cases.map(c => ({ ...c, deadline: visibleDeadline(c) })),
        deadlines: tables.DeadlineChanges.filter(d => requestIds.has(d.request_id)).map(d => ({ ...d,
          case_scope_json: JSON.stringify(context.deadlineCaseIds_(d).filter(id => ids.has(id))) })) });
    }
    if (fs.existsSync(stateFile)) {
      try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
      catch { throw new Error('Local prototype store is not valid JSON; preserve it and restore a known-good copy.'); }
      validate();
    } else { state = fresh(); validate(); persist(); }
    return Object.freeze({
      identities() { assertOpen(); return clone(grants); },
      catalogue(actor) {
        actorCheck(actor); const result = clone(context.getIntakeData_());
        if (actor.role !== 'owner') result.people = result.people.filter(p => p.key === actor.personKey);
        return result;
      },
      preview(input, actor) { actorCheck(actor, true); return clone(context.getIntakePreview_(clone(input))); },
      saveRequest(input, actor) { actorCheck(actor, true); return transact(() => context.saveDraftRequest_(clone(input))); },
      snapshot,
      setClock(iso, actor) { actorCheck(actor, true); return transact(() => { state.clock = instant(iso); return snapshot(actor); }); },
      reset(confirmation, actor) {
        actorCheck(actor, true);
        if (confirmation !== RESET_CONFIRMATION) throw new Error(`Reset requires exact confirmation: ${RESET_CONFIRMATION}`);
        return transact(() => { state = fresh(); return snapshot(actor); });
      },
      close
    });
  } catch (error) { close(); throw error; }
}
