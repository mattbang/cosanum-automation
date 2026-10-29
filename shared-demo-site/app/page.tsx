'use client';
import { roomHeaders as headers } from '../lib/client-headers';
import { invitationMessage } from '../lib/messages';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { demoWeekSchedule } from '../lib/scheduling';
import { SOURCE_REGISTER } from '../lib/sources';
import { MATERIALS } from '../lib/materials';
import { currentSkillMatrix, LIVE_PARTICIPANT, PARTICIPANTS, TOPICS, type DemoAction, type DemoState } from '../lib/demo';

type GoogleAccounts = { id: { initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void }) => void; renderButton: (target: HTMLElement, options: Record<string, string>) => void } };
declare global { interface Window { google?: { accounts: GoogleAccounts } } }

type Snapshot = { participantEmail?: string; role: 'host' | 'guest'; revision: number; state: DemoState };
const when = (iso: string) => new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const dateOnly = (day: string) => new Intl.DateTimeFormat('de-CH', { timeZone:'Europe/Zurich', day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date(day.slice(0,10)+'T12:00:00Z'));
const status: Record<string, string> = { invited: 'Einladung offen', confirmed: 'Termin bestätigt', in_progress: 'Training läuft', trainer_reported: 'Teilnahmebestätigung offen', completed: 'Abgeschlossen', cancelled: 'Abgesagt', needs_reschedule: 'Neue Termine nötig' };


export default function Home() {
  const room = useRef(''), token = useRef('');
  const signInTarget = useRef<HTMLDivElement>(null);
  const [roomId, setRoomId] = useState('');
  const [confirmedCaseId, setConfirmedCaseId] = useState('');
  const [rescheduling, setRescheduling] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [data, setData] = useState<Snapshot | null>(null);
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);
  const [credential, setCredential] = useState('');
  const [guestUrl, setGuestUrl] = useState('');
  const [guestQr, setGuestQr] = useState('');
  const [canShare, setCanShare] = useState(false);
  const [hostUrl, setHostUrl] = useState('');
  const [missingRoomKey, setMissingRoomKey] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState(TOPICS[0]), [participant, setParticipant] = useState(LIVE_PARTICIPANT);
  const [requiresCreatorCode, setRequiresCreatorCode] = useState(true);
  const [creatorCode, setCreatorCode] = useState('');
  const [level, setLevel] = useState(2), [tab, setTab] = useState<'flow' | 'history' | 'materials' | 'people' | 'sources' | 'calendar'>('flow');
  const schedule = useMemo(() => demoWeekSchedule(), []);
  const slots = schedule.offers, [selected, setSelected] = useState<string[]>(slots);
  const [report, setReport] = useState('Training durchgeführt; Übungen und Fragen besprochen.');
  const [result, setResult] = useState<'passed' | 'failed'>('passed');
  const refresh = useCallback(async () => {
    if (!room.current || clientId === undefined || (clientId && !credential)) return;
    const r = await fetch('/api/rooms/' + encodeURIComponent(room.current), { headers: headers(token.current, credential), cache: 'no-store' });
    const body = await r.json() as Snapshot & { error?: string };
    if (!r.ok) { const missingKey = r.status === 401 && body.error === 'Zugangslink fehlt.'; setMissingRoomKey(missingKey); if (r.status === 401 && clientId && !missingKey) { setCredential(''); setNotice('Deine Google-Anmeldung ist abgelaufen oder ungültig. Bitte melde dich unten erneut mit dem zugewiesenen Konto an.'); } const failure = new Error(body.error || 'Demo konnte nicht geladen werden.'); if (r.status === 401 && clientId && !missingKey) failure.name = 'GoogleAuthRequired'; throw failure; }
    setMissingRoomKey(false);
    setData(body);
  }, [clientId, credential]);
  useEffect(() => {
    const url = new URL(window.location.href); room.current = url.searchParams.get('room') || '';
    token.current = new URLSearchParams(url.hash.slice(1)).get('token') || '';
    if (url.hash) { url.hash = ''; window.history.replaceState(null, '', url.toString()); }
    void fetch('/api/auth-config').then(r => r.json()).then(value => { const config = value as { googleClientId?: string | null; requiresCreatorCode?: boolean }; setCanShare(typeof navigator.share === 'function'); setRoomId(room.current); setClientId(config.googleClientId || null); setRequiresCreatorCode(config.requiresCreatorCode !== false); }).catch(() => setError('Anmeldekonfiguration nicht verfügbar.'));
  }, []);
  useEffect(() => {
    if (room.current) void refresh().catch(e => setError(e.message));
  }, [clientId, credential, refresh]);
  useEffect(() => {
    if (!clientId || !signInTarget.current) return;
    let active = true;
    const render = () => {
      if (!active || !window.google || !signInTarget.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: response => {
        if (response.credential) { setCredential(response.credential); setError(''); setNotice('Google-Konto angemeldet.'); }
        else setError('Google hat kein Anmeldetoken geliefert.');
      } });
      signInTarget.current.innerHTML = '';
      window.google.accounts.id.renderButton(signInTarget.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with' });
    };
    if (window.google) render();
    else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.onload = render;
      script.onerror = () => setError('Google-Anmeldung konnte nicht geladen werden.');
      document.head.appendChild(script);
    }
    return () => { active = false; };
  }, [clientId]);
  const hasData = Boolean(data);
  useEffect(() => {
    if (!hasData) return;
    const timer = setInterval(() => { void refresh().catch(e => { if (e instanceof Error && e.name === 'GoogleAuthRequired') return; setNotice('Verbindung unterbrochen; der nächste Abgleich läuft automatisch.'); }); }, 3000);
    return () => clearInterval(timer);
  }, [hasData, refresh]);
  useEffect(() => {
    if (!guestUrl) return;
    let active = true;
    void import('qrcode').then(module => module.default.toDataURL(guestUrl, { width: 320, margin: 3, errorCorrectionLevel: 'M', color: { dark: '#482551', light: '#ffffff' } })).then(value => { if (active) setGuestQr(value); }).catch(() => { if (active) setNotice('QR konnte nicht erstellt werden. Nutze Link kopieren oder Einladung teilen.'); });
    return () => { active = false; };
  }, [guestUrl]);
  async function shareInvitation() {
    if (!guestUrl || !navigator.share) return;
    try { await navigator.share({ title: 'Cosanum Demo · Einladung für Matthew', text: 'Persönlicher Demo-Zugang für Matthew. Bitte mit dem zugewiesenen Google-Konto anmelden.', url: guestUrl }); }
    catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) setError('Teilen nicht möglich. Bitte den Teilnehmerlink kopieren.'); }
  }
  async function createRoom() {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/rooms', { method: 'POST', headers: { 'X-Demo-Code': creatorCode.trim(), 'X-Google-ID-Token': credential } });
      const body = await r.json() as { id?: string; hostToken?: string; guestToken?: string; error?: string };
      if (!r.ok || !body.id || !body.hostToken || !body.guestToken) throw new Error(body.error || 'Demo konnte nicht gestartet werden.');
      room.current = body.id; setRoomId(body.id); token.current = body.hostToken; setMissingRoomKey(false);
      const url = new URL(window.location.href); url.search = '?room=' + encodeURIComponent(body.id); url.hash = '';
      window.history.replaceState(null, '', url.toString());
      setHostUrl(url.toString() + '#token=' + body.hostToken);
      setGuestUrl(url.toString() + '#token=' + body.guestToken);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Start fehlgeschlagen.'); }
    finally { setBusy(false); }
  }
  async function act(action: DemoAction) {
    if (!data) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await fetch('/api/rooms/' + encodeURIComponent(room.current), { method: 'POST', headers: headers(token.current, credential), body: JSON.stringify({ revision: data.revision, action }) });
      const body = await r.json() as Snapshot & { error?: string };
      if (!r.ok) { if (r.status === 409) await refresh(); throw new Error(body.error || 'Aktion abgelehnt.'); }
      setData(body); setNotice('Gespeichert. Das zweite Gerät aktualisiert sich automatisch.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Aktion fehlgeschlagen.'); }
    finally { setBusy(false); }
  }
  const current = data?.state.active;
  const history = data ? [...(current?.stage === 'completed' ? [current] : []), ...data.state.history.filter(item => item.stage === 'completed')] : [];
  const host = data?.role === 'host';
  const linkedRequestIds = new Set([...(current?.request && current.stage !== 'cancelled' ? [current.request.id] : []), ...(data?.state.history.flatMap(item => item.request && item.stage !== 'cancelled' ? [item.request.id] : []) || [])]);
  const pendingRequests = (data?.state.requests || []).filter(request => !linkedRequestIds.has(request.id));
  const selectedRequest = pendingRequests.find(request => request.id === selectedRequestId);
  const openCase = current && !['completed','cancelled'].includes(current.stage) ? current : null;
  const attentionCases = [current, ...(data?.state.history || [])].filter(item => item && (item.stage === 'needs_reschedule' || item.stage === 'trainer_reported' || (item.stage === 'completed' && item.result === 'failed')));
  const invitation = guestUrl ? invitationMessage(current || null, guestUrl) : null;
  const matrix = data ? currentSkillMatrix(data.state) : null;
  const nextAction = !current ? (host ? 'Thema und Person wählen, dann Termine vorschlagen.' : 'Daniel bereitet deine Einladung vor.') : ({ invited: host ? 'Matthew wählt einen Termin auf seinem Gerät.' : 'Prüfe die Vorschläge und bestätige einen passenden Termin.', confirmed: host ? 'Unterlagen besprechen und das Demo-Training starten.' : 'Lies die Unterlagen. Daniel startet das Training.', in_progress: host ? 'Beobachtung und Ergebnis im Trainerbericht festhalten.' : 'Training mit Daniel durchführen; danach den Bericht prüfen.', trainer_reported: host ? 'Matthew prüft den Bericht und bestätigt persönlich.' : 'Prüfe Daniels Bericht und bestätige deine Teilnahme.', completed: 'Der Demo-Fall ist abgeschlossen. Unterlagen und Bericht stehen im Verlauf.', cancelled: host ? 'Bei Bedarf eine neue Einladung erstellen.' : 'Daniel kann eine neue Einladung vorbereiten.', needs_reschedule: host ? 'Neue Termine vorschlagen; Matthew kann erneut wählen.' : 'Daniel muss neue Termine vorbereiten.', draft: 'Einladung vorbereiten.' }[current.stage]);
  function startFresh() {
    room.current = ''; setRoomId(''); token.current = ''; setData(null); setMissingRoomKey(false); setError('');
    const url = new URL(window.location.href); url.search = ''; url.hash = '';
    window.history.replaceState(null, '', url.toString());
  }
  function copyLink(value: string) {
    void navigator.clipboard.writeText(value).then(() => setNotice('Link kopiert.')).catch(() => setError('Kopieren fehlgeschlagen.'));
  }
  return <main className="shell">
    <header className="mast"><div className="brand"><span>C</span><div><strong>Cosanum</strong><small>Training · Demo 0.7</small></div></div><b className="pill">[DEMO] · SYNTHETISCH</b></header>
    <div className="wrap">
      <section className="hero"><small>ZWEI GERÄTE · EIN TRAININGSFALL</small><h1>{data ? (host ? 'Daniels Trainingszentrale' : 'Matthews Trainingsbereich') : 'Gemeinsame Trainingsdemo'}</h1><p>{data ? (host ? 'Plane eine Einzelschulung und verfolge jeden Schritt live auf beiden Geräten.' : 'Wähle einen Termin und bestätige nach dem Training deine Teilnahme.') : 'Öffne deinen persönlichen Link und melde dich mit dem zugewiesenen Google-Konto an.'}</p></section>
      {!data && <nav className="public-links" aria-label="Öffentliche Demo-Unterlagen"><a className="secondary" href="/presentation/index.html">Demoablauf & Quellen ↗</a><a className="secondary" href="/materials/index.html">Schulungsunterlagen ↗</a></nav>}
      {missingRoomKey && <section className="card" role="alert"><small className="eyebrow">LINK UNVOLLSTÄNDIG</small><h2>Der persönliche Zugangslink fehlt</h2><p>Für diesen Browser wurde kein gültiger Rollenzugang gefunden. Öffne den ursprünglichen Daniel- oder Teilnehmerlink erneut. Wenn er nicht mehr vorliegt, starte eine neue Demo.</p><button className="secondary" onClick={startFresh}>Neue Demo starten</button></section>}
      {error && <p className="alert error" role="alert">{error}</p>}{notice && <p className="alert" role="status">{notice}</p>}
      {clientId && <section className="card signin"><small className="eyebrow">VERIFIZIERTE ANMELDUNG</small><h2>Mit Google anmelden</h2><p>{credential ? 'Google-Konto angemeldet. Der Server prüft die zugewiesene Rolle bei jeder Aktion.' : 'Daniel nutzt das Trainerkonto; die eingeladene Person nutzt ihr eigenes Testkonto.'}</p><div ref={signInTarget} /></section>}
      {!data && !missingRoomKey ? <section className="card"><h2>{roomId ? 'Demo öffnen' : 'Gemeinsame Demo starten'}</h2><p>{roomId ? 'Der Zugangslink wird geprüft. Falls die Rolle nicht erscheint, prüfe das zugewiesene Google-Konto.' : 'Ein neuer synthetischer Fall erhält zwei getrennte Zugangslinks. Speichere die Links zum Öffnen auf einem anderen Gerät. Im selben Browser bleibt der zugewiesene Zugang erhalten.'}</p>{!roomId && <>{requiresCreatorCode && <label className="code-label">Demo-Startcode<input type="password" value={creatorCode} onChange={e => setCreatorCode(e.target.value)} autoComplete="off" placeholder="Startcode eingeben" /></label>}<button className="primary" onClick={createRoom} disabled={busy || (requiresCreatorCode && !creatorCode.trim()) || clientId === undefined || (!!clientId && !credential)}>Neue Demo starten</button></>}</section> : data ? <>
        <div className="role"><b>{host ? 'Daniel · Process & Quality' : 'Matthew · Mitarbeiter 1'}</b><small>● Live-Abgleich alle 3 Sekunden</small></div>
        <section className="next-action" aria-live="polite"><small>NÄCHSTER SCHRITT</small><p>{nextAction}</p></section>
        <nav className="tabs" aria-label="Demobereiche"><button className={tab === 'flow' ? 'active' : ''} onClick={() => setTab('flow')}>Ablauf</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Verlauf & Kompetenzmatrix</button><button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}>Kalender</button><button className={tab === 'materials' ? 'active' : ''} onClick={() => setTab('materials')}>Schulungsmaterial</button><button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>Mitarbeitende</button><button className={tab === 'sources' ? 'active' : ''} onClick={() => setTab('sources')}>Datenquellen</button></nav>
        {tab === 'flow' && <>
          {host && <section className="card host-overview"><small className="eyebrow">DANIEL · ÜBERBLICK</small><h2>Anfragen & nächste Schritte</h2><div className="overview-metrics"><div><strong>{pendingRequests.length}</strong><span>Offene Anfragen</span></div><div><strong>{openCase ? 1 : 0}</strong><span>Aktives Training</span></div><div><strong>{attentionCases.length}</strong><span>Benötigen Aufmerksamkeit</span></div></div>{openCase && <article className="overview-active"><small>AKTUELLES TRAINING</small><h3>{openCase.topic}</h3><p>{openCase.participant} · {status[openCase.stage]}{openCase.acceptedOffer ? ' · ' + when(openCase.acceptedOffer) : ''}</p><strong>{nextAction}</strong></article>}{attentionCases.length > 0 && <div className="attention-list">{attentionCases.map(item => item && <p key={item.id}><strong>{item.topic}:</strong> {item.stage === 'trainer_reported' ? 'Matthews persönliche Teilnahmebestätigung steht aus.' : item.stage === 'needs_reschedule' ? 'Alle Vorschläge abgelehnt. Bitte neue Termine anbieten.' : 'Nachschulung nötig. Für einen weiteren Versuch eine neue Einladung planen.'}</p>)}</div>}<h3>Eingegangene Schulungsanfragen</h3><p>Synthetische Anfrage, kein externer Eingang. Die Liste stammt aus dem gespeicherten Demo-Raum.</p>{pendingRequests.length ? pendingRequests.map(request => <article className="request-row" key={request.id}><div><strong>{request.topic}</strong><p>{request.participant} · Zielniveau {request.targetLevel}</p><dl><dt>Angefragt von</dt><dd>{request.requestedBy}</dd><dt>Quelle / Grund</dt><dd>{request.source} · {request.reason}</dd><dt>Gewünschte Frist</dt><dd>{dateOnly(request.deadline)}</dd></dl></div><button className="secondary" disabled={!!openCase || busy} onClick={() => { setTopic(request.topic); setParticipant(request.participant); setLevel(request.targetLevel); setSelectedRequestId(request.id); document.getElementById('training-planner')?.scrollIntoView({ behavior:'smooth', block:'start' }); }}>Planen</button></article>) : <p>Keine offene Anfrage. Du kannst unten ein Training direkt planen.</p>}{openCase && pendingRequests.length > 0 && <small>Bitte den aktiven Fall zuerst abschliessen oder absagen, bevor du eine weitere Anfrage planst.</small>}</section>}
          {host && (!current || ['completed','cancelled'].includes(current.stage)) && <section className="card" id="training-planner"><small className="eyebrow">SCHRITT 1 · PLANUNG</small><h2>Training planen</h2>{selectedRequest && <div className="callout"><strong>Anfrage von {selectedRequest.requestedBy}</strong><p>{selectedRequest.source} · {selectedRequest.reason} · Frist {dateOnly(selectedRequest.deadline)}</p><button className="secondary" onClick={() => setSelectedRequestId('')}>Ohne Anfrage direkt planen</button></div>}<div className="fields"><label>Thema<select value={topic} onChange={e => { setTopic(e.target.value); setSelectedRequestId(''); }}>{TOPICS.map(item => <option key={item}>{item}</option>)}</select></label><label>Teilnehmende Person<select value={participant} onChange={e => { setParticipant(e.target.value); setSelectedRequestId(''); }}>{PARTICIPANTS.map(item => <option key={item} disabled={item !== LIVE_PARTICIPANT}>{item}{item !== LIVE_PARTICIPANT ? ' · Konto folgt' : ''}</option>)}</select></label><label>Zielniveau<select value={level} onChange={e => { setLevel(Number(e.target.value)); setSelectedRequestId(''); }}>{[1,2,3].map(n => <option key={n} value={n}>Niveau {n}</option>)}</select></label></div><p>Für die Zwei-Geräte-Demo ist aktuell Matthew zugewiesen. Annina und Marko erscheinen in der synthetischen Skillmatrix; ihre Einladungen werden nach Einrichtung eigener Konten freigeschaltet.</p><h3>Freie Demo-Zeitfenster</h3><p>Synthetische Verfügbarkeit. Wähle ein bis drei Vorschläge.</p><div className="slots">{[...new Set([...slots, ...selected])].map((slot,i) => <button key={slot} className={selected.includes(slot) ? 'slot picked' : 'slot'} onClick={() => setSelected(items => items.includes(slot) ? items.filter(x => x !== slot) : items.length < 3 ? [...items,slot] : items)}><small>Vorschlag {i+1}</small><strong>{when(slot)}</strong><small>60 Min · frei</small></button>)}</div><button className="primary" disabled={busy || !selected.length} onClick={() => void act({ type:'invite', topic, participant, offers:selected, targetLevel:level, ...(selectedRequest ? {requestId:selectedRequest.id} : {}) })}>Einladung erstellen</button></section>}
          {!host && !current && <section className="card"><h2>Einladung wird vorbereitet</h2><p>Daniel wählt Thema und Termine. Diese Ansicht aktualisiert sich automatisch.</p></section>}
          {current && <section className="card"><div className="heading"><div><small className="eyebrow">AKTUELLER FALL</small><h2>{current.topic}</h2></div><b className="status">{status[current.stage]}</b></div><p>{current.participant} · Zielniveau {current.targetLevel}</p>{current.request && <div className="case-origin"><strong>Anfrage von {current.request.requestedBy}</strong><p>{current.request.source} · {current.request.reason} · gewünschte Frist {dateOnly(current.request.deadline)}</p><small>Synthetische Anfrage, kein externer Eingang</small></div>}<ol className="steps" aria-label="Fortschritt">{['Einladung', 'Termin', 'Training', 'Bestätigung'].map((label, i) => { const step = ['invited','needs_reschedule'].includes(current.stage) ? 0 : current.stage === 'confirmed' ? 1 : current.stage === 'in_progress' ? 2 : 3; return <li key={label} className={current.stage === 'cancelled' ? '' : current.stage === 'completed' || i < step ? 'done' : i === step ? 'current' : ''} aria-current={i === step && !['cancelled','completed'].includes(current.stage) ? 'step' : undefined}><b>{i + 1}</b>{label}</li>; })}</ol>
            {current.stage === 'invited' && !host && <><h3>Wähle deinen Termin</h3><p>Du kannst einen Vorschlag ablehnen und einen anderen annehmen.</p>{current.offers.map((offer,i) => <div className="offer" key={offer}><div><small>Vorschlag {i+1}</small><strong>{when(offer)}</strong></div>{current.rejectedOffers.includes(offer) ? <em>Abgelehnt</em> : <div className="actions"><button className="secondary" disabled={busy} onClick={() => void act({type:'reject_offer',offer})}>Passt nicht</button><button className="primary" disabled={busy} onClick={() => void act({type:'accept_offer',offer})}>Annehmen</button></div>}</div>)}</>}
            {current.stage === 'invited' && host && <div className="callout"><strong>Warten auf Terminwahl</strong><p>Die eingeladene Person sieht die Vorschläge auf ihrem Telefon.</p></div>}
            {current.stage === 'needs_reschedule' && <div className="callout"><strong>Alle Vorschläge abgelehnt</strong><p>Daniel kann neue Termine vorschlagen. Matthew kann danach erneut wählen.</p></div>}
            {current.acceptedOffer && <div className="appointment"><small>BESTÄTIGTER TERMIN</small><strong>{when(current.acceptedOffer)}</strong><span>Auf beiden Geräten sichtbar</span></div>}
            {current.stage === 'confirmed' && <div className="callout"><strong>Erinnerung · Training geplant</strong><p>Dieser Hinweis erscheint im Demoablauf auf beiden Geräten. Der Termin bleibt wie bestätigt sichtbar. Für die Vorführung kann Daniel das Training vorzeitig starten; dies wird im Verlauf protokolliert. Es wird keine Kalenderbuchung geändert.</p>{host && <button className="primary" disabled={busy} onClick={() => void act({type:'start_early'})}>Demo-Training vorzeitig starten</button>}</div>}
            {current.stage === 'in_progress' && !host && <div className="callout"><strong>Training läuft</strong><p>Daniel erstellt den Trainerbericht. Danach kannst du deine Teilnahme bestätigen.</p></div>}
            {current.stage === 'in_progress' && host && <div className="report"><h3>Trainerbericht</h3><label>Beobachtung<textarea rows={4} maxLength={1000} value={report} onChange={e => setReport(e.target.value)}/></label><label>Ergebnis<select value={result} onChange={e => setResult(e.target.value as 'passed'|'failed')}><option value="passed">Bestanden</option><option value="failed">Nicht bestanden · Nachschulung nötig</option></select></label><button className="primary" disabled={busy || report.trim().length < 5} onClick={() => void act({type:'report',report,result})}>Bericht einreichen</button></div>}
            {current.report && <section className="report-readback"><small className="eyebrow">TRAINERBERICHT · DANIEL</small><h3>{current.result === 'passed' ? 'Bestanden' : 'Nachschulung nötig'}</h3><p>{current.report}</p><small>Teilnahme: {current.participantConfirmed ? 'von Matthew bestätigt' : 'Bestätigung noch offen'}</small></section>}
            {current.stage === 'trainer_reported' && <div className="callout"><strong>{host ? 'Teilnahmebestätigung ausstehend' : 'Teilnahme bestätigen'}</strong><p>Daniel hat den Trainerbericht eingereicht. Prüfe den Bericht oben. Erst Matthews persönliche Bestätigung schliesst diesen Demo-Fall ab.</p>{!host && <><label className="confirmation-check"><input type="checkbox" checked={confirmedCaseId === current.id} onChange={e => setConfirmedCaseId(e.target.checked ? current.id : '')}/><span>Ich bestätige meine Teilnahme an diesem Demo-Training und habe Daniels Bericht gelesen. Damit bestätige ich die Teilnahme, nicht die Bewertung.</span></label><button className="primary" disabled={busy || confirmedCaseId !== current.id} onClick={() => void act({type:'confirm_participation'})}>Meine Teilnahme bestätigen</button></>}</div>}
            {current.stage === 'completed' && <div className="complete"><strong>Training abgeschlossen</strong><p>Bericht und Bestätigung sind im Demo-Verlauf gespeichert. {current.result === 'passed' ? 'Die synthetische Skillmatrix wurde aktualisiert.' : 'Das Kompetenzniveau bleibt unverändert; eine Nachschulung bleibt offen. Daniel kann dafür eine neue Einladung erstellen.'}</p><button className="secondary" onClick={() => setTab('history')}>Verlauf ansehen</button></div>}
            {host && ['invited','confirmed','needs_reschedule'].includes(current.stage) && <div className="reschedule"><button className="secondary" onClick={() => setRescheduling(value => !value)}>Neue Termine vorschlagen</button>{rescheduling && <><p>Wähle ein bis drei neue Vorschläge. Die bisherige Terminwahl wird aufgehoben; der Verlauf bleibt erhalten. Matthew muss erneut bestätigen.</p><div className="slots">{[...new Set([...slots, ...selected])].map((slot, i) => <button key={slot} className={selected.includes(slot) ? 'slot picked' : 'slot'} onClick={() => setSelected(items => items.includes(slot) ? items.filter(x => x !== slot) : items.length < 3 ? [...items, slot] : items)}><small>Neuer Vorschlag {i + 1}</small><strong>{when(slot)}</strong><small>60 Min · synthetisch frei</small></button>)}</div><button className="primary" disabled={busy || !selected.length} onClick={() => { void act({type:'reschedule', offers:selected}); setRescheduling(false); }}>Terminvorschläge aktualisieren</button></>}</div>}
            {current.stage === 'cancelled' && <div className="callout"><strong>Training abgesagt</strong><p>Dieser Fall wird nicht weitergeführt. Es entsteht kein Kompetenzzuwachs. Daniel kann oben eine neue Einladung mit neuen Terminen erstellen.</p></div>}
            {host && ['invited','confirmed','in_progress','needs_reschedule'].includes(current.stage) && <details className="cancel-details"><summary>Training absagen</summary><p>Die Absage beendet diesen Demo-Fall für beide Geräte. Für einen neuen Termin erstellt Daniel danach eine neue Einladung.</p><button className="cancel" disabled={busy} onClick={() => void act({type:'cancel'})}>Absage speichern</button></details>}
          </section>}
          {host && guestUrl && <section className="card"><small className="eyebrow">ZWEI GETRENNTE ZUGÄNGE</small><h2>Links für beide Geräte speichern</h2><p>Speichere Daniels Link, bevor du den Tab schliesst. Teile den Teilnehmerlink nur mit Matthew; er enthält einen anderen Rollenschlüssel.</p><div className="actions"><button className="secondary" onClick={() => copyLink(hostUrl)}>Daniels Link kopieren</button><button className="primary" onClick={() => copyLink(guestUrl)}>Matthews Link kopieren</button>{canShare && <button className="secondary" onClick={() => void shareInvitation()}>Einladung teilen</button>}<a className="secondary" href={'mailto:' + encodeURIComponent(data.participantEmail || '') + '?subject=' + encodeURIComponent(invitation?.subject || '') + '&body=' + encodeURIComponent(invitation?.body || '')}>E-Mail vorbereiten</a></div><details className="participant-qr"><summary>Teilnehmer-QR anzeigen</summary><p>Matthew scannt diesen persönlichen Zugang mit seinem Telefon und meldet sich mit dem zugewiesenen Google-Konto an. Teile den QR nur mit Matthew.</p>{guestQr ? <img src={guestQr} width={320} height={320} alt="Persönlicher Teilnehmerzugang für Matthew als lokal erzeugter QR-Code"/> : <p>QR wird auf diesem Gerät erstellt …</p>}<small>Der QR wird lokal erzeugt. Es wird kein externer QR-Dienst aufgerufen.</small></details><details className="email-preview"><summary>E-Mail-Entwurf ansehen</summary><dl><dt>Empfänger</dt><dd>Matthew · {data.participantEmail || "Adresse im Mailprogramm ergänzen"}</dd><dt>Betreff</dt><dd>{invitation?.subject}</dd><dt>Nachricht</dt><dd style={{whiteSpace:"pre-wrap"}}>{invitation?.body.replace(guestUrl, "[persönlicher Teilnehmerlink]")}</dd></dl><p>Der persönliche Link wird ausschliesslich dem manuell geöffneten Entwurf beigefügt. Der Versand erfolgt durch Daniel.</p></details><small>Der E-Mail-Knopf öffnet nur einen Entwurf. Es erfolgt kein automatischer Versand. Die Links werden nach einem Neuladen nicht erneut angezeigt.</small></section>}
          {current && <section className="card"><small className="eyebrow">VORBEREITUNG & NACHSCHLAGEN</small><h2>Unterlagen zu {current.topic}</h2><p>Lies das Kurzmaterial vor dem Termin. Es bleibt nach dem Training im Katalog und Verlauf zugänglich.</p><MaterialLinks topic={current.topic}/></section>}
          {current && <section className="card timeline"><h2>Aktivität</h2>{[...current.events].reverse().map((e,i) => <div key={i} className="event"><b>●</b><div><strong>{e.label}</strong><small>{e.actor} · {when(e.at)}</small></div></div>)}</section>}
        </>}
        {tab === 'history' && <div className="columns"><section className="card"><small className="eyebrow">NACHWEISE</small><h2>Abgeschlossene Trainings</h2>{history.length ? history.map(item => <div className="history" key={item.id}><strong>{item.topic}</strong><span>{item.participant} · Niveau {item.targetLevel}</span><small>{item.result === 'passed' ? 'Bestanden' : 'Nachschulung nötig'}</small><p>{item.report}</p><small>Teilnahme persönlich bestätigt · synthetischer Demo-Nachweis</small><MaterialLinks topic={item.topic}/></div>) : <p>Noch kein abgeschlossenes Training in diesem Demo-Raum.</p>}</section><section className="card"><small className="eyebrow">DEMO-DATEN</small><h2>Kompetenzmatrix</h2><p>Fiktive Ausgangsstände für Matthew, Annina und Marko. Ein erfolgreich bestätigtes Demo-Training aktualisiert nur die betroffene Person. Keine Google Sheet wird verändert.</p>{PARTICIPANTS.map(person => <div className="person-skills" key={person}><h3>{person}</h3><small>{person === LIVE_PARTICIPANT ? 'Zwei-Geräte-Einladung aktiv' : 'Demo-Konto noch offen'}</small>{TOPICS.map(item => <div className="skill" key={item}><span>{item}<small>{matrix?.[person]?.[item]?.status}</small></span><strong>Niveau {matrix?.[person]?.[item]?.level ?? 0}</strong></div>)}</div>)}</section></div>}
        {tab === 'calendar' && <section className="card"><small className="eyebrow">SYNTHETISCHE VERFÜGBARKEIT · EUROPE/ZURICH</small><h2>Gemeinsame Zeitfenster</h2><p>Die nächsten fünf Werktage. Die Belegung ist für die Vorführung erstellt und stammt aus keinem echten Google-Kalender. Ein Vorschlag ist nur möglich, wenn Daniel und Matthew beide frei sind.</p><div className="calendar-legend"><span>○ Frei</span><span>● Belegt</span><span>✓ Gemeinsam frei</span></div><div className="calendar-days">{schedule.days.map(day => <article className="calendar-day" key={day.date}><h3>{day.label}</h3><div className="calendar-row calendar-labels"><span>Zeit</span><span>Daniel</span><span>Matthew</span><span>Vorschlag</span></div>{day.slots.map(slot => { const free = !slot.danielBusy && !slot.matthewBusy; const picked = selected.includes(slot.start); return <div className={free ? 'calendar-row mutually-free' : 'calendar-row'} key={slot.start}><strong>{slot.label}</strong><span className={slot.danielBusy ? 'busy-cell' : 'free-cell'}>{slot.danielBusy ? '● Belegt' : '○ Frei'}</span><span className={slot.matthewBusy ? 'busy-cell' : 'free-cell'}>{slot.matthewBusy ? '● Belegt' : '○ Frei'}</span>{host && free ? <button className={picked ? 'calendar-pick picked' : 'calendar-pick'} aria-pressed={picked} disabled={!picked && selected.length >= 3} onClick={() => setSelected(items => items.includes(slot.start) ? items.filter(value => value !== slot.start) : items.length < 3 ? [...items, slot.start] : items)}>{picked ? '✓ Gewählt' : '+ Wählen'}</button> : <small>{free ? '✓ Gemeinsam frei' : 'Nicht verfügbar'}</small>}</div>; })}</article>)}</div>{host && <div className="callout"><strong>{selected.length} von maximal 3 Vorschlägen gewählt</strong><p>Die Auswahl wird erst beim Erstellen oder Aktualisieren einer Einladung gespeichert.</p><button className="primary" onClick={() => setTab('flow')}>Zur Planung</button></div>}<h3>Vorbereitung vor dem Training</h3><p>Die Lernpakete stehen unabhängig von der Terminwahl bereit.</p><button className="secondary" onClick={() => setTab('materials')}>Schulungsmaterial öffnen</button></section>}
        {tab === 'materials' && <section className="card"><small className="eyebrow">DEMO-SCHULUNGSKATALOG</small><h2>Vorbereiten. Üben. Nachschlagen.</h2><p>Vier kurze Lernpakete für die Vorführung. Alle Beispiele sind synthetisch und ersetzen keine freigegebene Arbeitsanweisung.</p><div className="material-grid">{MATERIALS.map(material => <article className="material" key={material.topic}><small>{material.duration} · Selbststudium</small><h3>{material.topic}</h3><p>{material.objective}</p><MaterialLinks topic={material.topic}/></article>)}</div></section>}
        {tab === 'people' && <section className="card"><small className="eyebrow">SYNTHETISCHES PERSONALVERZEICHNIS</small><h2>Menschen & Rollen</h2><p>Die Zuweisung zur Zwei-Geräte-Demo wird auf dem Server geprüft. Dieses Verzeichnis erteilt keine Berechtigungen.</p><div className="roster"><article><span className="avatar">D</span><h3>Daniel</h3><p>Process & Quality</p><small>Trainer · plant und berichtet</small></article>{PARTICIPANTS.map((person, i) => <article key={person}><span className="avatar">{person[0]}</span><h3>{person.split(' · ')[0]}</h3><p>Mitarbeiter {i + 1}</p><small>{i === 0 ? 'Aktiv zugewiesen · Terminwahl und Bestätigung' : 'Katalogperson · kein Live-Zugang zugewiesen'}</small></article>)}</div></section>}
        {tab === 'sources' && <section className="card"><small className="eyebrow">HERKUNFT & GRENZEN</small><h2>Datenquellen der Vorführung</h2><div className="source-list"><article><h3>Mitarbeitende & Kompetenzmatrix</h3><p>Synthetische Ausgangsdaten für Matthew, Annina und Marko. Nur ein bestandener und persönlich bestätigter Demo-Fall verändert den betroffenen Kompetenzstand dieses Raums.</p></article><article><h3>Schulungskatalog & Unterlagen</h3><p>Vier eigens erstellte Demo-Lernpakete mit Übungen und Vorbereitung. Keine freigegebenen Cosanum-Betriebsunterlagen.</p><button className="secondary" onClick={() => setTab('materials')}>Materialkatalog öffnen</button></article><article><h3>Fallverlauf</h3><p>Terminwahl, Trainerbericht und persönliche Bestätigung werden im gemeinsamen Demo-Raum gespeichert. Die Geräte gleichen diesen Stand alle drei Sekunden ab.</p></article><article><h3>Verbundene Systeme</h3><p>Google prüft die Anmeldung, sofern konfiguriert. Kalenderverfügbarkeit und Schulungsdaten sind synthetisch. E-Mail wird ausschliesslich als manueller Entwurf angeboten; es gibt keinen automatischen Versand, Push oder Google-Drive-/Sheet-Schreibzugriff.</p></article></div><h3>Quellenregister & Downloads</h3><p>Die CSV-Kompetenzmatrix enthält den festen Ausgangsstand. Den aktuellen Stand dieses Raums findest du unter «Verlauf & Kompetenzmatrix».</p><div className="source-register">{SOURCE_REGISTER.map(source => <article key={source.id}><div><strong>{source.name}</strong><small>{source.type} · {source.status}</small><p><b>Später vorgesehen:</b> {source.future}</p></div>{source.href ? <a className="secondary" href={source.href} target="_blank" rel="noreferrer">{source.type === 'CSV' ? 'CSV herunterladen ↗' : 'Unterlagen öffnen ↗'}</a> : <span className="source-state">{source.id === 'cases' ? 'Im Raum sichtbar' : 'Noch nicht verbunden'}</span>}</article>)}</div><a className="secondary" href="/api/sources" target="_blank" rel="noreferrer">Demo-Quelldaten öffnen (JSON)</a></section>}
      </> : null}
      <footer>Gemeinsamer synthetischer Demoablauf · keine echten Kalender-, Mail-, Push- oder Sheet-Aktionen</footer>
    </div>
  </main>;
}

function MaterialLinks({ topic }: { topic: string }) {
  const material = MATERIALS.find(item => item.topic === topic);
  if (!material) return null;
  return <div className="material-links"><a className="secondary" href={material.lesson} target="_blank" rel="noreferrer">Kurzmaterial lesen ↗</a><a className="secondary" href={material.preparation} target="_blank" rel="noreferrer">Vorbereitungsblatt ↗</a></div>;
}
