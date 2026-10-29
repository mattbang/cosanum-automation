'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { currentSkillMatrix, LIVE_PARTICIPANT, PARTICIPANTS, TOPICS, type DemoAction, type DemoState } from '../lib/demo';

type GoogleAccounts = { id: { initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void }) => void; renderButton: (target: HTMLElement, options: Record<string, string>) => void } };
declare global { interface Window { google?: { accounts: GoogleAccounts } } }

type Snapshot = { role: 'host' | 'guest'; revision: number; state: DemoState };
const when = (iso: string) => new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const status: Record<string, string> = { invited: 'Einladung offen', confirmed: 'Termin bestätigt', in_progress: 'Training läuft', trainer_reported: 'Teilnahmebestätigung offen', completed: 'Abgeschlossen', cancelled: 'Abgesagt', needs_reschedule: 'Neue Termine nötig' };
const headers = (token: string, credential: string) => ({ Authorization: 'Bearer ' + token, 'X-Google-ID-Token': credential, 'Content-Type': 'application/json' });
function defaultSlots() { const now = new Date(); return [1,2,3].map((n, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 9 + i * 2).toISOString()); }

export default function Home() {
  const room = useRef(''), token = useRef('');
  const signInTarget = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);
  const [credential, setCredential] = useState('');
  const [guestUrl, setGuestUrl] = useState('');
  const [hostUrl, setHostUrl] = useState('');
  const [missingRoomKey, setMissingRoomKey] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState(TOPICS[0]), [participant, setParticipant] = useState(LIVE_PARTICIPANT);
  const [creatorCode, setCreatorCode] = useState('');
  const [level, setLevel] = useState(2), [tab, setTab] = useState<'flow' | 'history'>('flow');
  const slots = useMemo(defaultSlots, []), [selected, setSelected] = useState<string[]>(slots);
  const [report, setReport] = useState('Training durchgeführt; Übungen und Fragen besprochen.');
  const [result, setResult] = useState<'passed' | 'failed'>('passed');
  const refresh = useCallback(async () => {
    if (!room.current || !token.current || clientId === undefined || (clientId && !credential)) return;
    const r = await fetch('/api/rooms/' + encodeURIComponent(room.current), { headers: headers(token.current, credential), cache: 'no-store' });
    const body = await r.json() as Snapshot & { error?: string };
    if (!r.ok) throw new Error(body.error || 'Demo konnte nicht geladen werden.');
    setData(body);
  }, [clientId, credential]);
  useEffect(() => {
    const url = new URL(window.location.href); room.current = url.searchParams.get('room') || '';
    token.current = new URLSearchParams(url.hash.slice(1)).get('token') || '';
    if (url.hash) { url.hash = ''; window.history.replaceState(null, '', url.toString()); }
    if (room.current && !token.current) setMissingRoomKey(true);
    void fetch('/api/auth-config').then(r => r.json()).then(value => setClientId((value as { googleClientId?: string | null }).googleClientId || null)).catch(() => setError('Anmeldekonfiguration nicht verfügbar.'));
  }, []);
  useEffect(() => {
    if (room.current && token.current) void refresh().catch(e => setError(e.message));
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
  useEffect(() => {
    if (!data) return;
    const timer = setInterval(() => { void refresh().catch(() => setNotice('Verbindung unterbrochen; der nächste Abgleich läuft automatisch.')); }, 3000);
    return () => clearInterval(timer);
  }, [data?.revision, refresh]);
  async function createRoom() {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/rooms', { method: 'POST', headers: { 'X-Demo-Code': creatorCode.trim(), 'X-Google-ID-Token': credential } });
      const body = await r.json() as { id?: string; hostToken?: string; guestToken?: string; error?: string };
      if (!r.ok || !body.id || !body.hostToken || !body.guestToken) throw new Error(body.error || 'Demo konnte nicht gestartet werden.');
      room.current = body.id; token.current = body.hostToken; setMissingRoomKey(false);
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
  const matrix = data ? currentSkillMatrix(data.state) : null;
  function startFresh() {
    room.current = ''; token.current = ''; setData(null); setMissingRoomKey(false); setError('');
    const url = new URL(window.location.href); url.search = ''; url.hash = '';
    window.history.replaceState(null, '', url.toString());
  }
  function copyLink(value: string) {
    void navigator.clipboard.writeText(value).then(() => setNotice('Link kopiert.')).catch(() => setError('Kopieren fehlgeschlagen.'));
  }
  return <main className="shell">
    <header className="mast"><div className="brand"><span>C</span><div><strong>Cosanum</strong><small>Training · Live-Demo</small></div></div><b className="pill">SYNTHETISCHE DATEN</b></header>
    <div className="wrap">
      <section className="hero"><small>ZWEI GERÄTE · EIN TRAININGSFALL</small><h1>{data ? (host ? 'Daniels Trainingszentrale' : 'Deine Einladung') : 'Gemeinsame Trainingsdemo'}</h1><p>{data ? (host ? 'Plane eine Einzelschulung und verfolge jeden Schritt live auf beiden Geräten.' : 'Wähle einen Termin und bestätige nach dem Training deine Teilnahme.') : 'Öffne deinen persönlichen Link und melde dich mit dem zugewiesenen Google-Konto an.'}</p></section>
      {missingRoomKey && <section className="card" role="alert"><small className="eyebrow">LINK UNVOLLSTÄNDIG</small><h2>Der persönliche Zugangslink fehlt</h2><p>Dieser Raum-Link enthält keinen Rollenschlüssel. Eine Google-Anmeldung allein öffnet den Fall nicht. Öffne den ursprünglichen Daniel- oder Teilnehmerlink erneut. Wenn er nicht mehr vorliegt, starte eine neue Demo.</p><button className="secondary" onClick={startFresh}>Neue Demo starten</button></section>}
      {error && <p className="alert error" role="alert">{error}</p>}{notice && <p className="alert" role="status">{notice}</p>}
      {clientId && <section className="card signin"><small className="eyebrow">VERIFIZIERTE ANMELDUNG</small><h2>Mit Google anmelden</h2><p>{credential ? 'Google-Konto angemeldet. Der Server prüft die zugewiesene Rolle bei jeder Aktion.' : 'Daniel nutzt das Trainerkonto; die eingeladene Person nutzt ihr eigenes Testkonto.'}</p><div ref={signInTarget} /></section>}
      {!data && !missingRoomKey ? <section className="card"><h2>{room.current ? 'Demo öffnen' : 'Gemeinsame Demo starten'}</h2><p>{room.current ? 'Der Zugangslink wird geprüft. Falls die Rolle nicht erscheint, prüfe das zugewiesene Google-Konto.' : 'Ein neuer synthetischer Fall erhält zwei getrennte Zugangslinks. Speichere beide Links vor dem Schliessen des Tabs.'}</p>{!room.current && <><label className="code-label">Demo-Startcode<input type="password" value={creatorCode} onChange={e => setCreatorCode(e.target.value)} autoComplete="off" placeholder="Startcode eingeben" /></label><button className="primary" onClick={createRoom} disabled={busy || !creatorCode.trim() || clientId === undefined || (!!clientId && !credential)}>Neue Demo starten</button></>}</section> : data ? <>
        <div className="role"><b>{host ? 'Daniel · Process & Quality' : 'Eingeladene Person'}</b><small>● Live-Abgleich alle 3 Sekunden</small></div>
        <nav className="tabs"><button className={tab === 'flow' ? 'active' : ''} onClick={() => setTab('flow')}>Ablauf</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Verlauf & Skillmatrix</button></nav>
        {tab === 'flow' && <>
          {host && (!current || ['completed','cancelled'].includes(current.stage)) && <section className="card"><small className="eyebrow">SCHRITT 1 · PLANUNG</small><h2>Training planen</h2><div className="fields"><label>Thema<select value={topic} onChange={e => setTopic(e.target.value)}>{TOPICS.map(item => <option key={item}>{item}</option>)}</select></label><label>Teilnehmende Person<select value={participant} onChange={e => setParticipant(e.target.value)}>{PARTICIPANTS.map(item => <option key={item} disabled={item !== LIVE_PARTICIPANT}>{item}{item !== LIVE_PARTICIPANT ? ' · Konto folgt' : ''}</option>)}</select></label><label>Zielniveau<select value={level} onChange={e => setLevel(Number(e.target.value))}>{[1,2,3,4].map(n => <option key={n} value={n}>Niveau {n}</option>)}</select></label></div><p>Für die Zwei-Geräte-Demo ist aktuell Matthew zugewiesen. Annina und Marko erscheinen in der synthetischen Skillmatrix; ihre Einladungen werden nach Einrichtung eigener Konten freigeschaltet.</p><h3>Freie Demo-Zeitfenster</h3><p>Synthetische Verfügbarkeit. Wähle ein bis drei Vorschläge.</p><div className="slots">{slots.map((slot,i) => <button key={slot} className={selected.includes(slot) ? 'slot picked' : 'slot'} onClick={() => setSelected(items => items.includes(slot) ? items.filter(x => x !== slot) : items.length < 3 ? [...items,slot] : items)}><small>Vorschlag {i+1}</small><strong>{when(slot)}</strong><small>60 Min · frei</small></button>)}</div><button className="primary" disabled={busy || !selected.length} onClick={() => void act({ type:'invite', topic, participant, offers:selected, targetLevel:level })}>Einladung erstellen</button></section>}
          {!host && !current && <section className="card"><h2>Einladung wird vorbereitet</h2><p>Daniel wählt Thema und Termine. Diese Ansicht aktualisiert sich automatisch.</p></section>}
          {current && <section className="card"><div className="heading"><div><small className="eyebrow">AKTUELLER FALL</small><h2>{current.topic}</h2></div><b className="status">{status[current.stage]}</b></div><p>{current.participant} · Zielniveau {current.targetLevel}</p><div className="steps"><span>1 Einladung</span><span>2 Termin</span><span>3 Training</span><span>4 Nachweis</span></div>
            {current.stage === 'invited' && !host && <><h3>Wähle deinen Termin</h3><p>Du kannst einen Vorschlag ablehnen und einen anderen annehmen.</p>{current.offers.map((offer,i) => <div className="offer" key={offer}><div><small>Vorschlag {i+1}</small><strong>{when(offer)}</strong></div>{current.rejectedOffers.includes(offer) ? <em>Abgelehnt</em> : <div className="actions"><button className="secondary" disabled={busy} onClick={() => void act({type:'reject_offer',offer})}>Passt nicht</button><button className="primary" disabled={busy} onClick={() => void act({type:'accept_offer',offer})}>Annehmen</button></div>}</div>)}</>}
            {current.stage === 'invited' && host && <div className="callout"><strong>Warten auf Terminwahl</strong><p>Die eingeladene Person sieht die Vorschläge auf ihrem Telefon.</p></div>}
            {current.stage === 'needs_reschedule' && <div className="callout"><strong>Alle Vorschläge abgelehnt</strong><p>Daniel kann den Fall absagen und mit neuen Terminen beginnen.</p></div>}
            {current.acceptedOffer && <div className="appointment"><small>BESTÄTIGTER TERMIN</small><strong>{when(current.acceptedOffer)}</strong><span>Auf beiden Geräten sichtbar</span></div>}
            {current.stage === 'confirmed' && <div className="callout"><strong>Erinnerung · Training geplant</strong><p>Dieser Hinweis erscheint im Demoablauf auf beiden Geräten. Daniel kann für die Vorführung sofort beginnen.</p>{host && <button className="primary" disabled={busy} onClick={() => void act({type:'start_early'})}>Training jetzt starten</button>}</div>}
            {current.stage === 'in_progress' && !host && <div className="callout"><strong>Training läuft</strong><p>Daniel erstellt den Trainerbericht. Danach kannst du deine Teilnahme bestätigen.</p></div>}
            {current.stage === 'in_progress' && host && <div className="report"><h3>Trainerbericht</h3><label>Beobachtung<textarea rows={4} maxLength={1000} value={report} onChange={e => setReport(e.target.value)}/></label><label>Ergebnis<select value={result} onChange={e => setResult(e.target.value as 'passed'|'failed')}><option value="passed">Bestanden</option><option value="failed">Nicht bestanden · Nachschulung nötig</option></select></label><button className="primary" disabled={busy || report.trim().length < 5} onClick={() => void act({type:'report',report,result})}>Bericht einreichen</button></div>}
            {current.stage === 'trainer_reported' && <div className="callout"><strong>{host ? 'Teilnahmebestätigung ausstehend' : 'Teilnahme bestätigen'}</strong><p>Daniel hat den Trainerbericht eingereicht. Die teilnehmende Person bestätigt nun ihre Teilnahme.</p>{!host && <button className="primary" disabled={busy} onClick={() => void act({type:'confirm_participation'})}>Meine Teilnahme bestätigen</button>}</div>}
            {current.stage === 'completed' && <div className="complete"><strong>Training abgeschlossen</strong><p>Bericht und Bestätigung sind im Demo-Verlauf gespeichert. {current.result === 'passed' ? 'Die synthetische Skillmatrix wurde aktualisiert.' : 'Eine Nachschulung bleibt offen.'}</p><button className="secondary" onClick={() => setTab('history')}>Verlauf ansehen</button></div>}
            {current.stage === 'cancelled' && <div className="callout"><strong>Training abgesagt</strong></div>}
            {host && ['invited','confirmed','in_progress','needs_reschedule'].includes(current.stage) && <button className="cancel" disabled={busy} onClick={() => void act({type:'cancel'})}>Training absagen</button>}
          </section>}
          {host && guestUrl && <section className="card"><small className="eyebrow">ZWEI GETRENNTE ZUGÄNGE</small><h2>Links für beide Geräte speichern</h2><p>Speichere Daniels Link, bevor du den Tab schliesst. Teile den Teilnehmerlink nur mit Matthew; er enthält einen anderen Rollenschlüssel.</p><div className="actions"><button className="secondary" onClick={() => copyLink(hostUrl)}>Daniels Link kopieren</button><button className="primary" onClick={() => copyLink(guestUrl)}>Matthews Link kopieren</button><a className="secondary" href={'mailto:?subject=' + encodeURIComponent('Cosanum Demo · Trainingseinladung für Matthew') + '&body=' + encodeURIComponent('Öffne deinen Demo-Link auf deinem Telefon:\n\n' + guestUrl)}>E-Mail vorbereiten</a></div><small>Der E-Mail-Knopf öffnet nur einen Entwurf. Die Links werden nach einem Neuladen nicht erneut angezeigt.</small></section>}
          {current && <section className="card timeline"><h2>Aktivität</h2>{[...current.events].reverse().map((e,i) => <div key={i} className="event"><b>●</b><div><strong>{e.label}</strong><small>{e.actor} · {when(e.at)}</small></div></div>)}</section>}
        </>}
        {tab === 'history' && <div className="columns"><section className="card"><small className="eyebrow">NACHWEISE</small><h2>Abgeschlossene Trainings</h2>{history.length ? history.map(item => <div className="history" key={item.id}><strong>{item.topic}</strong><span>{item.participant} · Niveau {item.targetLevel}</span><small>{item.result === 'passed' ? 'Bestanden' : 'Nachschulung nötig'}</small><p>{item.report}</p></div>) : <p>Noch kein abgeschlossenes Training in diesem Demo-Raum.</p>}</section><section className="card"><small className="eyebrow">DEMO-DATEN</small><h2>Skillmatrix</h2><p>Fiktive Ausgangsstände für Matthew, Annina und Marko. Ein erfolgreich bestätigtes Demo-Training aktualisiert nur die betroffene Person. Keine Google Sheet wird verändert.</p>{PARTICIPANTS.map(person => <div className="person-skills" key={person}><h3>{person}</h3><small>{person === LIVE_PARTICIPANT ? 'Zwei-Geräte-Einladung aktiv' : 'Demo-Konto noch offen'}</small>{TOPICS.map(item => <div className="skill" key={item}><span>{item}<small>{matrix?.[person]?.[item]?.status}</small></span><strong>Niveau {matrix?.[person]?.[item]?.level ?? 0}</strong></div>)}</div>)}</section></div>}
      </> : null}
      <footer>Gemeinsamer synthetischer Demoablauf · keine echten Kalender-, Mail-, Push- oder Sheet-Aktionen</footer>
    </div>
  </main>;
}
