import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { participantCaseFromLink, participantDemoLink } from './src/deepLink';
import { attentionCases, catalogue, createRequest, currentTask, deadlineLabel, demoStorageKey, demoWeekSlots, eligibility, initialState, learners, matrixEntry, matrixPeople, planningSessions, requestForCase, requestReasonLabels, selectionAvailability, sessionCases, slotAvailable, trainerChoices, transition, upcomingSessions, type DemoState, type RequestReason, type TrainingCase } from './src/workflow';

const plum = '#452347';
const coral = '#b94355';
const attentionChannel = 'demo-attention';
const webStorageKey = demoStorageKey(new Date());
if (Platform.OS !== 'web') Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
type Screen = 'home' | 'matrix' | 'calendar' | 'catalogue' | 'requests' | 'sessions' | 'attention' | 'create' | 'case';
function statusText(entry: TrainingCase) {
  if (entry.declined) return 'Einladung abgelehnt';
  if (entry.status === 'planning') return 'Termin offen';
  if (entry.status === 'invited') return 'eingeladen';
  if (entry.status === 'assessed') return entry.trainerPassed ? 'Bestätigung offen' : 'nicht bestanden';
  return ({ acknowledged: 'bestätigt', proof_ready: 'Archivprüfung offen', archived_verified: 'Kompetenzstand offen', complete: 'abgeschlossen' } as Record<string, string>)[entry.status] || entry.status;
}
function trainerName(key: string) { return key === 'MATT' ? 'Daniel / P&Q' : key === 'MARIE' ? 'HCM4-Trainer:in' : key; }
function Button({ title, onPress, secondary, disabled }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text></Pressable>;
}
function Card({ children }: { children: React.ReactNode }) { return <View style={styles.card}>{children}</View>; }
function MatrixView({ onCreate }: { onCreate: (topicId: string) => void }) {
  const [axis, setAxis] = useState<'topic' | 'person'>('topic');
  const [topicId, setTopic] = useState(catalogue[0].id);
  const [personKey, setPerson] = useState(matrixPeople[0].key);
  const [detail, setDetail] = useState('');
  const rows = axis === 'topic' ? matrixPeople.map(person => ({ personKey: person.key, topicId, title: person.name, role: person.role }))
    : catalogue.map(topic => ({ personKey, topicId: topic.id, title: topic.name, role: matrixPeople.find(person => person.key === personKey)?.role || '' }));
  return <>
    <Text style={styles.note}>Synthetischer Matrixstand. Stufen 0–3 sind Lernendenstufen; Stufe 4 markiert hier eine Trainerqualifikation. „–“ bedeutet nicht vorgesehen; leer bedeutet fehlender Eintrag.</Text>
    <View style={styles.row}>{(['topic', 'person'] as const).map(item => <Pressable key={item} accessibilityRole="radio" accessibilityState={{ checked: axis === item }} onPress={() => { setAxis(item); setDetail(''); }} style={[styles.choice, axis === item && styles.choiceActive]}><Text>{item === 'topic' ? 'Nach Thema' : 'Nach Person'}</Text></Pressable>)}</View>
    <View style={styles.nav}>{axis === 'topic' ? catalogue.map(topic => <Pressable key={topic.id} accessibilityRole="button" onPress={() => { setTopic(topic.id); setDetail(''); }} style={[styles.navItem, topicId === topic.id && styles.navActive]}><Text style={[styles.navText, topicId === topic.id && styles.navActiveText]}>{topic.name}</Text></Pressable>) : matrixPeople.map(person => <Pressable key={person.key} accessibilityRole="button" onPress={() => { setPerson(person.key); setDetail(''); }} style={[styles.navItem, personKey === person.key && styles.navActive]}><Text style={[styles.navText, personKey === person.key && styles.navActiveText]}>{person.name}</Text></Pressable>)}</View>
    <Card><Text style={styles.cardTitle}>{axis === 'topic' ? catalogue.find(topic => topic.id === topicId)?.name : matrixPeople.find(person => person.key === personKey)?.name}</Text>
      {rows.map(row => { const cell = matrixEntry(row.topicId, row.personKey); const key = `${row.topicId}:${row.personKey}`; const topic = catalogue.find(item => item.id === row.topicId)!;
        const target = topic.fixedTarget || (cell.level !== null ? Math.min(cell.level + 1, 3) : 1);
        const training = row.role === 'Mitarbeiter' ? eligibility(row.topicId, row.personKey, target) : null;
        const reason = row.role !== 'Mitarbeiter' ? cell.level === 4 ? 'Für dieses Thema als Trainer qualifiziert' : 'Keine Trainerstufe 4 für dieses Thema'
          : topic.fixedTarget && cell.level !== null && cell.level >= topic.fixedTarget ? `Zielstufe ${topic.fixedTarget} bereits erreicht` : training!.reason;
        return <Pressable key={key} accessibilityRole="button" onPress={() => setDetail(detail === key ? '' : key)} style={styles.matrixRow}>
          <View style={styles.rowTight}><Text style={styles.body}>{row.title}</Text><Text style={styles.matrixLevel}>{cell.label}</Text></View>
          {detail === key ? <><Text style={styles.meta}>Person {row.personKey} · Thema {row.topicId} · {row.role}</Text><Text style={training?.eligible ? styles.meta : styles.warning}>{reason}</Text></> : null}
        </Pressable>;
      })}
    </Card>
    {axis === 'topic' ? <Button title="Bedarf für dieses Thema erfassen" onPress={() => onCreate(topicId)} /> : null}
  </>;
}
function WeekAvailability({ state, personKeys, trainerKey, selectedSlot, onSelect, excludeSessionId, compact }: { state: DemoState; personKeys: string[]; trainerKey: string; selectedSlot?: string; onSelect?: (id: string) => void; excludeSessionId?: string; compact?: boolean }) {
  const slots = demoWeekSlots(state);
  const first = slots[0]?.start.slice(0, 10);
  if (!first) return <Card><Text style={styles.warning}>Keine Demo-Zeitfenster verfügbar.</Text></Card>;
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${first}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat('de-CH', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(date);
    return { key, label, slots: slots.filter(slot => slot.start.startsWith(key)) };
  });
  return <Card><Text style={styles.cardTitle}>Demo-Woche · Europe/Zurich</Text><Text style={styles.note}>Nur Beispiel-Zeitfenster. Frei/belegt stammt aus der lokalen Fixture und simulierten Buchungen, nicht aus Google Calendar.</Text>
    {(compact ? days.filter(day => day.slots.length) : days).map(day => <View key={day.key} style={styles.weekDay}><Text style={styles.weekLabel}>{day.label}</Text>
      {day.slots.length ? day.slots.map(slot => { const check = selectionAvailability(state, personKeys, trainerKey, slot.id, excludeSessionId);
        return <Pressable key={slot.id} accessibilityRole="radio" accessibilityState={{ checked: selectedSlot === slot.id, disabled: !check.available }} disabled={!check.available || !onSelect} onPress={() => onSelect?.(slot.id)} style={[styles.slot, selectedSlot === slot.id && styles.selectedSlot, !check.available && styles.unavailableSlot]}>
          <Text style={styles.body}>{slot.label.split(' · ')[1]}</Text>
          <Text style={styles.meta}>{check.actors.map(actor => `${actor.name}: ${actor.busy ? 'belegt' : 'frei'}`).join(' · ') || check.reason}</Text>
          <Text style={styles.meta}>{check.available ? selectedSlot === slot.id ? 'Ausgewählt' : 'Für alle frei · auswählen' : check.reason}</Text>
        </Pressable>;
      }) : <Text style={styles.meta}>Kein Demo-Zeitfenster</Text>}
    </View>)}
  </Card>;
}
function participantUrl(caseId: string) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  const url = new URL(window.location.href); url.search = `?participant=${encodeURIComponent(caseId)}`; return url.toString();
}
function Participant({ entry, back, submit }: { entry: TrainingCase; back: () => void; submit: () => void }) {
  const [name, setName] = useState(''); const [yes, setYes] = useState(false);
  return <><Button title="Zurück" secondary onPress={back} /><Card><Text style={styles.title}>Teilnahme bestätigen</Text>
    <Text style={styles.body}>{entry.personName} · {entry.topicName} · {entry.id}</Text>
    <Text style={styles.note}>Lokale synthetische Ansicht. Dieser Link bestätigt keine Identität und schreibt nichts in Google.</Text>
    {entry.status !== 'assessed' || !entry.trainerPassed ? <Text style={styles.warning}>Erst nach bestandener Trainerbeurteilung möglich.</Text> : <>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: yes }} onPress={() => setYes(!yes)} style={styles.row}><Text style={styles.checkbox}>{yes ? '✓' : ''}</Text><Text style={styles.body}>Ich bestätige meine Teilnahme.</Text></Pressable>
      <Text style={styles.label}>Name der teilnehmenden Person</Text><TextInput accessibilityLabel="Name der teilnehmenden Person" value={name} onChangeText={setName} style={styles.input} placeholder={entry.personName} />
      <Button title="Bestätigung in der Demo speichern" disabled={!yes || name.trim().toLocaleLowerCase() !== entry.personName.toLocaleLowerCase()} onPress={submit} />
    </>}
  </Card></>;
}

export default function App() {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [state, setState] = useState<DemoState>(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(webStorageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.requests) && Array.isArray(parsed.cases) && Array.isArray(parsed.slots)) return parsed as DemoState;
        }
      } catch { /* Reset an invalid local demo state. */ }
    }
    return initialState();
  });
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.localStorage.setItem(webStorageKey, JSON.stringify(state));
  }, [state]);
  const [screen, setScreen] = useState<Screen>('home');
  const [tourOpen, setTourOpen] = useState(false);
  const [selectedId, select] = useState<string | null>(null);
  const [topicId, setTopic] = useState(catalogue[0].id);
  const [mode, setMode] = useState<'group' | 'single'>('group');
  const [trainerKey, setTrainer] = useState('MATT');
  const [targetLevel, setTargetLevel] = useState(1);
  const [personKeys, setPeople] = useState<string[]>([]);
  const [requesterName, setRequesterName] = useState('');
  const [sourceTeam, setSourceTeam] = useState('');
  const [requestReason, setRequestReason] = useState<RequestReason | ''>('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [slotId, setSlot] = useState('SLOT-1');
  const [calendarPeople, setCalendarPeople] = useState<string[]>(['WOHNUNG', 'SUMNER']);
  const [calendarTrainer, setCalendarTrainer] = useState('MATT');
  const [calendarSlot, setCalendarSlot] = useState('');
  const [participantId, setParticipant] = useState<string | null>(() => Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('participant') : null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let mounted = true;
    const openLink = (url: string) => { const caseId = participantCaseFromLink(url); if (mounted && caseId) setParticipant(caseId); };
    void Linking.getInitialURL().then(url => { if (url) openLink(url); });
    const subscription = Linking.addEventListener('url', event => openLink(event.url));
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [screen, participantId]);
  const [error, setError] = useState('');
  const [reminderStatus, setReminderStatus] = useState('');
  const { width } = useWindowDimensions(); const wide = width >= 800;
  const selected = state.cases.find(item => item.id === selectedId);
  const selectedRequest = selected ? requestForCase(state, selected) : undefined;
  const participant = state.cases.find(item => item.id === participantId);
  const topic = catalogue.find(item => item.id === topicId)!;
  const requests = planningSessions(state);
  const upcoming = upcomingSessions(state);
  const attention = attentionCases(state);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const openAttention = (response: Notifications.NotificationResponse) => {
      if (response.notification.request.content.data?.kind !== 'demo-attention') return;
      setParticipant(null); setScreen('attention');
      setReminderStatus('Lokale Demo-Erinnerung geöffnet.');
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(openAttention);
    void Notifications.getLastNotificationResponseAsync().then(response => { if (response) openAttention(response); }).catch(() => {});
    return () => subscription.remove();
  }, []);
  function act(id: string, action: Parameters<typeof transition>[2], slot?: string) {
    try { setState(transition(state, id, action, slot)); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Aktion fehlgeschlagen'); }
  }
  function openCase(id: string) { const entry = state.cases.find(item => item.id === id); if (entry?.status === 'planning') setSlot(state.slots.find(slot => slotAvailable(state, entry, slot.id))?.id || ''); select(id); setScreen('case'); setError(''); }
  function openTopic(id: string) { setTopic(id); setMode('group'); setTrainer('MATT'); setTargetLevel(1); setPeople([]); setSlot(''); setRequesterName(''); setSourceTeam(''); setRequestReason(''); setDeadlineDate(''); setScreen('create'); setError(''); }
  function saveRequest() {
    try {
      const next = createRequest(state, topicId, personKeys, targetLevel, mode, trainerKey, { requesterName, sourceTeam, reason: requestReason as RequestReason, deadlineDate });
      const entry = next.cases[next.cases.length - personKeys.length];
      setState(next); setSlot(slotAvailable(next, entry, slotId) ? slotId : next.slots.find(slot => slotAvailable(next, entry, slot.id))?.id || ''); select(entry.id); setScreen('case'); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Auftrag konnte nicht erstellt werden'); }
  }
  function openParticipant(entry: TrainingCase) {
    const url = participantUrl(entry.id); if (url) void Linking.openURL(url); else setParticipant(entry.id);
  }
  function resetDemo() { setState(initialState()); setScreen('home'); select(null); setPeople([]); setRequesterName(''); setSourceTeam(''); setRequestReason(''); setDeadlineDate(''); setSlot(''); setCalendarSlot(''); setError(''); }
  async function scheduleAttentionReminder() {
    if (!attention.length) return;
    try {
      if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(attentionChannel, { name: 'Lokale Demo-Hinweise', importance: Notifications.AndroidImportance.DEFAULT });
      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) { setReminderStatus('Benachrichtigungen sind auf diesem Gerät nicht erlaubt.'); return; }
      const pending = await Notifications.getAllScheduledNotificationsAsync();
      for (const item of pending.filter(item => item.content.data?.kind === 'demo-attention')) await Notifications.cancelScheduledNotificationAsync(item.identifier);
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Daniel · Demo-Hinweis', body: `${attention.length} ${attention.length === 1 ? 'Fall braucht' : 'Fälle brauchen'} deine Prüfung. Öffne Hinweise.`, data: { kind: 'demo-attention' } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 30, repeats: false, channelId: attentionChannel },
      });
      setReminderStatus('Eine lokale Demo-Erinnerung ist für etwa 30 Sekunden später geplant.');
    } catch (cause) { setReminderStatus(cause instanceof Error ? cause.message : 'Lokale Erinnerung konnte nicht geplant werden.'); }
  }
  function sessionCard(group: TrainingCase[], kind: 'planning' | 'upcoming') {
    const first = group[0]; const slot = state.slots.find(item => item.id === first.slotId); const request = requestForCase(state, first);
    return <View key={first.sessionId} style={[styles.queueCard, kind === 'planning' ? styles.planningCard : styles.upcomingCard]}>
      <View style={styles.cardTop}><Text style={[styles.badge, kind === 'planning' ? styles.planningBadge : styles.upcomingBadge]}>{kind === 'planning' ? 'TERMIN OFFEN' : 'GEBUCHT'}</Text><Text style={styles.cardKicker}>{first.mode === 'group' ? 'Gruppe' : 'Einzeln'}</Text></View>
      <Text style={styles.cardTitle}>{first.topicName}</Text>
      {kind === 'planning' ? <>
        <Text style={styles.body}>Angefragt von {request?.requesterName || 'Unbekannt'}{request?.sourceTeam ? ` · ${request.sourceTeam}` : ''}</Text>
        <Text style={styles.meta}>{request ? requestReasonLabels[request.reason] : 'Grund offen'} · Abschluss bis {request ? deadlineLabel(request.deadlineDate) : 'offen'}</Text>
        <Text style={styles.meta}>{group.map(item => item.personName).join(', ')}</Text>
      </> : <><Text style={styles.body}>{slot?.label || 'Termin gebucht'}</Text><Text style={styles.meta}>Trainer {trainerName(first.trainerKey)}</Text><Text style={styles.meta}>{group.map(item => `${item.personName}: ${statusText(item)}`).join(' · ')}</Text></>}
      <Button title={kind === 'planning' ? 'Termin planen  →' : 'Sitzung ansehen  →'} secondary onPress={() => openCase(first.id)} />
    </View>;
  }
  function attentionCard(entry: TrainingCase) {
    return <View key={entry.id} style={[styles.queueCard, styles.attentionCard]}><View style={styles.cardTop}><Text style={[styles.badge, styles.attentionBadge]}>JETZT PRÜFEN</Text><Text style={styles.cardKicker}>Personenfall</Text></View>
      <Text style={styles.cardTitle}>{entry.personName} · {entry.topicName}</Text>
      <Text style={styles.task}>{currentTask(entry).reason}</Text>
      <Button title={entry.declined || (entry.status === 'assessed' && !entry.trainerPassed) ? 'Erneut planen  →' : 'Fall prüfen  →'} secondary onPress={() => openCase(entry.id)} />
    </View>;
  }
  const nav: { key: Screen; label: string }[] = [
    { key: 'home', label: 'Übersicht' }, { key: 'matrix', label: 'Matrix' }, { key: 'catalogue', label: 'Material' }, { key: 'calendar', label: 'Kalender' },
  ];
  return <View style={styles.root}><StatusBar style="dark" /><ScrollView ref={scrollRef} contentContainerStyle={styles.page}>
    <View style={styles.row}><Text style={styles.brand}>COSANUM · SCHULUNG</Text><Text style={styles.marker}>{Platform.OS === 'android' ? 'DEMO · BUILD 2' : 'LOKALE DEMO'}</Text></View>
    {participant ? <Participant key={participant.id} entry={participant} back={() => setParticipant(null)} submit={() => { act(participant.id, 'acknowledge'); setParticipant(null); }} /> : <>
      <Text style={styles.title}>{screen === 'home' ? 'Hallo Daniel' : screen === 'matrix' ? 'Kompetenzmatrix' : screen === 'calendar' ? 'Kalenderverfügbarkeit' : screen === 'catalogue' ? 'Trainingsmaterial' : screen === 'requests' ? 'Terminbedarf' : screen === 'sessions' ? 'Geplante Sitzungen' : screen === 'attention' ? 'Deine Hinweise' : screen === 'create' ? 'Schulungsbedarf erfassen' : 'Personenfall'}</Text>
      <Text style={styles.note}>Process & Quality · synthetische Daten · keine Google-Verbindung</Text>
      <View style={styles.nav}>{nav.map(item => <Pressable key={item.key} accessibilityRole="button" onPress={() => { setScreen(item.key); setError(''); }} style={[styles.navItem, screen === item.key && styles.navActive]}><Text style={[styles.navText, screen === item.key && styles.navActiveText]}>{item.label}</Text></Pressable>)}</View>
      {error ? <Text style={styles.warning}>{error}</Text> : null}
      {screen === 'home' ? <>
        <View style={styles.hero}><Text style={styles.heroEyebrow}>DEIN NÄCHSTER SCHRITT</Text><Text style={styles.heroTitle}>{attention.length ? `${attention.length} ${attention.length === 1 ? 'Fall braucht' : 'Fälle brauchen'} deine Prüfung` : requests.length ? `${requests.length} ${requests.length === 1 ? 'Anfrage wartet' : 'Anfragen warten'} auf einen Termin` : 'Alles im Blick'}</Text><Text style={styles.heroBody}>{attention.length ? 'Prüfe den offenen Personenfall und plane bei Bedarf den nächsten Versuch.' : requests.length ? 'Sieh dir den Bedarf an und finde einen gemeinsamen Termin.' : 'Starte mit der Kompetenzmatrix oder erfasse einen neuen Bedarf.'}</Text><Pressable accessibilityRole="button" onPress={() => attention.length ? openCase(attention[0].id) : requests.length ? openCase(requests[0][0].id) : setScreen('matrix')} style={styles.heroButton}><Text style={styles.heroButtonText}>{attention.length ? 'Fall jetzt ansehen' : requests.length ? 'Termin planen' : 'Matrix ansehen'}  →</Text></Pressable></View>
        <View style={styles.queueLinks}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${requests.length} Anfragen ohne Termin ansehen`} onPress={() => setScreen('requests')} style={styles.queueLink}><Text style={styles.queueNumber}>{requests.length}</Text><Text style={styles.queueLinkLabel}>Terminbedarf</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${upcoming.length} geplante Sitzungen ansehen`} onPress={() => setScreen('sessions')} style={styles.queueLink}><Text style={styles.queueNumber}>{upcoming.length}</Text><Text style={styles.queueLinkLabel}>Sitzungen</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${attention.length} Hinweise ansehen`} onPress={() => setScreen('attention')} style={styles.queueLink}><Text style={styles.queueNumber}>{attention.length}</Text><Text style={styles.queueLinkLabel}>Hinweise</Text></Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: tourOpen }} onPress={() => setTourOpen(!tourOpen)} style={styles.tourToggle}><View><Text style={styles.tourEyebrow}>FÜR DIE VORFÜHRUNG</Text><Text style={styles.tourTitle}>Demo in vier Schritten</Text></View><Text style={styles.tourArrow}>{tourOpen ? '⌃' : '⌄'}</Text></Pressable>
        {tourOpen ? <View style={styles.tourSteps}>{([
          { number: '01', title: 'Kompetenz prüfen', detail: 'Matrix nach Thema oder Person öffnen', target: 'matrix' as Screen },
          { number: '02', title: 'Bedarf erfassen', detail: 'Material wählen und Anfrage anlegen', target: 'catalogue' as Screen },
          { number: '03', title: 'Termin planen', detail: 'Verfügbarkeit vergleichen und buchen', target: 'requests' as Screen },
          { number: '04', title: 'Personenfall begleiten', detail: 'Beurteilung, Bestätigung und Nachweis zeigen', target: 'sessions' as Screen },
        ]).map(step => <Pressable key={step.number} accessibilityRole="button" onPress={() => setScreen(step.target)} style={styles.tourStep}><Text style={styles.tourNumber}>{step.number}</Text><View style={styles.sourceText}><Text style={styles.tourStepTitle}>{step.title}</Text><Text style={styles.meta}>{step.detail}</Text></View><Text style={styles.sourceArrow}>›</Text></Pressable>)}</View> : null}
        <Text style={styles.section}>Drei Informationsquellen</Text>
        <View style={wide ? styles.sourceGrid : undefined}>
          <Pressable accessibilityRole="button" onPress={() => setScreen('matrix')} style={[styles.sourceRow, wide && styles.sourceCell]}><View style={styles.sourceText}><Text style={styles.cardTitle}>Kompetenzmatrix</Text><Text style={styles.meta}>5 Themen · 4 Demo-Personen · Stufen</Text></View><Text style={styles.sourceArrow}>›</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setScreen('catalogue')} style={[styles.sourceRow, wide && styles.sourceCell]}><View style={styles.sourceText}><Text style={styles.cardTitle}>Trainingsmaterial</Text><Text style={styles.meta}>5 Module · Bedarf erstellen</Text></View><Text style={styles.sourceArrow}>›</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setScreen('calendar')} style={[styles.sourceRow, wide && styles.sourceCell]}><View style={styles.sourceText}><Text style={styles.cardTitle}>Kalenderverfügbarkeit</Text><Text style={styles.meta}>Demo-Woche · frei/belegt</Text></View><Text style={styles.sourceArrow}>›</Text></Pressable>
        </View>
        <Text style={styles.section}>Anfragen ohne Termin <Text style={styles.sectionCount}>{requests.length}</Text></Text>
        {requests.length ? requests.map(group => sessionCard(group, 'planning')) : <Text style={styles.note}>Alle Anfragen haben einen Termin.</Text>}
        <Text style={styles.section}>Geplante Sitzungen <Text style={styles.sectionCount}>{upcoming.length}</Text></Text>
        {upcoming.length ? upcoming.map(group => sessionCard(group, 'upcoming')) : <Text style={styles.note}>Noch keine kommenden Sitzungen.</Text>}
        <Text style={styles.section}>Braucht Aufmerksamkeit <Text style={styles.sectionCount}>{attention.length}</Text></Text>
        {attention.length ? attention.map(attentionCard) : <Text style={styles.note}>Keine offenen Hinweise.</Text>}
        <Button title="Demo zurücksetzen" secondary onPress={resetDemo} />
      </> : null}
      {screen === 'matrix' ? <MatrixView onCreate={openTopic} /> : null}
      {screen === 'calendar' ? <>
        <Text style={styles.note}>Wähle Personen und Trainer, um ihre gemeinsame freie Zeit in der synthetischen Demo-Woche zu prüfen.</Text>
        <Card><Text style={styles.cardTitle}>Personen und Trainer</Text>
          {learners.map(person => { const picked = calendarPeople.includes(person.key); return <Pressable key={person.key} accessibilityRole="checkbox" accessibilityState={{ checked: picked }} onPress={() => { setCalendarPeople(picked ? calendarPeople.filter(key => key !== person.key) : [...calendarPeople, person.key]); setCalendarSlot(''); }} style={styles.personChoice}><Text style={styles.body}>{picked ? '☑' : '□'} {person.name}</Text></Pressable>; })}
          <View style={styles.row}>{(['MATT', 'MARIE'] as const).map(key => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: calendarTrainer === key }} onPress={() => { setCalendarTrainer(key); setCalendarSlot(''); }} style={[styles.choice, calendarTrainer === key && styles.choiceActive]}><Text>{trainerName(key)}</Text></Pressable>)}</View>
        </Card>
        <WeekAvailability state={state} personKeys={calendarPeople} trainerKey={calendarTrainer} selectedSlot={calendarSlot} onSelect={setCalendarSlot} />
        <Button title="Material für neuen Bedarf wählen" onPress={() => setScreen('catalogue')} />
      </> : null}
      {screen === 'requests' ? <>{requests.length ? requests.map(group => sessionCard(group, 'planning')) : <Text style={styles.note}>Keine Anfrage wartet auf einen Termin.</Text>}</> : null}
      {screen === 'catalogue' ? <>{catalogue.map(item => <Card key={item.id}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.meta}>{item.id} · {item.material} · {item.practiceIndividual ? 'Praxisphase einzeln' : 'Gruppe oder einzeln wählbar'}</Text><Button title="Schulungsbedarf erstellen" onPress={() => openTopic(item.id)} /></Card>)}</> : null}
      {screen === 'sessions' ? <>{upcoming.length ? upcoming.map(group => sessionCard(group, 'upcoming')) : <Text style={styles.note}>Keine kommenden Sitzungen.</Text>}</> : null}
      {screen === 'attention' ? <>{attention.length ? attention.map(attentionCard) : <Text style={styles.note}>Keine offenen Hinweise.</Text>}
        {Platform.OS !== 'web' && attention.length ? <Card><Text style={styles.cardTitle}>Lokale Demo-Erinnerung</Text><Text style={styles.body}>Nur für die aktuell sichtbaren Hinweise auf diesem Gerät. Keine Push-Zustellung und kein Serverabruf.</Text><Button title="In 30 Sekunden erinnern" secondary onPress={() => { void scheduleAttentionReminder(); }} />{reminderStatus ? <Text style={styles.meta}>{reminderStatus}</Text> : null}</Card> : null}
      </> : null}
      {screen === 'create' ? <>
        <Button title="Zurück zum Material" secondary onPress={() => setScreen('catalogue')} />
        <Card><Text style={styles.cardTitle}>{topic.name}</Text><Text style={styles.meta}>{topic.material} · {topic.practiceIndividual ? 'Praxisphase im vollständigen Workflow einzeln' : 'Demo-Material'}</Text>
          <Text style={styles.section}>Anfrage</Text>
          <Text style={styles.label}>Anfragende Person *</Text><TextInput accessibilityLabel="Anfragende Person" style={styles.input} value={requesterName} onChangeText={setRequesterName} placeholder="z. B. Person C" autoCapitalize="words" />
          <Text style={styles.label}>Team / Quelle (optional)</Text><TextInput accessibilityLabel="Team oder Quelle" style={styles.input} value={sourceTeam} onChangeText={setSourceTeam} placeholder="z. B. CCS oder Leitstand" />
          <Text style={styles.label}>Grund der Anfrage *</Text><View style={styles.reasonChoices}>{(Object.keys(requestReasonLabels) as RequestReason[]).map(reason => <Pressable key={reason} accessibilityRole="radio" accessibilityState={{ checked: requestReason === reason }} onPress={() => setRequestReason(reason)} style={[styles.choice, requestReason === reason && styles.choiceActive]}><Text>{requestReasonLabels[reason]}</Text></Pressable>)}</View>
          <Text style={styles.label}>Gewünschter Abschluss bis * (JJJJ-MM-TT)</Text><TextInput accessibilityLabel="Gewünschter Abschluss bis" style={styles.input} value={deadlineDate} onChangeText={setDeadlineDate} placeholder="JJJJ-MM-TT" keyboardType="numbers-and-punctuation" autoCapitalize="none" />
          <Text style={styles.meta}>Die Frist bleibt bei einem Ersatztermin dieselbe. Das Datum gilt für Europe/Zurich.</Text>
          <Text style={styles.section}>Schulungsform</Text><View style={styles.row}>{(['group', 'single'] as const).map(choice => <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ checked: mode === choice }} onPress={() => { setMode(choice); setTrainer('MATT'); setPeople([]); setSlot(''); }} style={[styles.choice, mode === choice && styles.choiceActive]}><Text>{choice === 'group' ? 'Gruppe' : 'Einzeln'}</Text></Pressable>)}</View>
          <Text style={styles.section}>Zielstufe wählen</Text><View style={styles.row}>{(topic.fixedTarget ? [topic.fixedTarget] : [1, 2, 3]).map(level => <Pressable key={level} accessibilityRole="radio" accessibilityState={{ checked: targetLevel === level }} onPress={() => { setTargetLevel(level); setPeople([]); setSlot(''); }} style={[styles.choice, targetLevel === level && styles.choiceActive]}><Text>Stufe {level}</Text></Pressable>)}</View>
          <Text style={styles.section}>Teilnehmende auswählen</Text>
          {learners.map(person => { const result = eligibility(topicId, person.key, targetLevel); const picked = personKeys.includes(person.key);
            return <Pressable key={person.key} accessibilityRole="checkbox" accessibilityState={{ checked: picked, disabled: !result.eligible }} disabled={!result.eligible} onPress={() => { setPeople(picked ? personKeys.filter(key => key !== person.key) : mode === 'single' ? [person.key] : [...personKeys, person.key]); setTrainer('MATT'); setSlot(''); }} style={[styles.personChoice, !result.eligible && styles.disabled]}><Text style={styles.body}>{picked ? '☑' : '□'} {person.name}</Text><Text style={styles.meta}>{result.reason}</Text></Pressable>;
          })}
          <Text style={styles.meta}>Nur gültige nächste Stufen sind wählbar. „–“, leere Werte und Trainerstufe 4 sind ausgeschlossen.</Text>
          {personKeys.length ? <><Text style={styles.section}>Trainer wählen</Text><View style={styles.row}>{trainerChoices(topicId, mode, personKeys.length).map(key => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: trainerKey === key }} onPress={() => { setTrainer(key); setSlot(''); }} style={[styles.choice, trainerKey === key && styles.choiceActive]}><Text>{trainerName(key)}</Text></Pressable>)}</View></> : null}
        </Card>
        <Text style={styles.section}>Gemeinsame Verfügbarkeit</Text>
        <WeekAvailability state={state} personKeys={personKeys} trainerKey={trainerKey} selectedSlot={slotId} onSelect={setSlot} compact />
        <Button title="Anfrage anlegen → Termin bestätigen" disabled={!personKeys.length || !trainerChoices(topicId, mode, personKeys.length).includes(trainerKey)} onPress={saveRequest} />
        {error ? <Text style={styles.warning}>{error}</Text> : null}
      </> : null}
      {screen === 'case' ? selected ? <>
        <Button title="Zurück zur Übersicht" secondary onPress={() => setScreen('home')} />
        <Card><Text style={styles.cardTitle}>{selected.personName} · {selected.topicName}</Text>
          <Text style={styles.meta}>{selected.requestId} · {selected.sessionId} · {selected.id} · Trainer {trainerName(selected.trainerKey)}</Text>
          <Text style={styles.body}>Stufe {selected.originalLevel} → {selected.targetLevel} · {statusText(selected)}</Text>
          <Text style={styles.task}>{currentTask(selected).reason}</Text>
          {selected.previousCaseId ? <Text style={styles.meta}>Neuer Versuch nach {selected.previousCaseId}; früherer Beleg bleibt erhalten.</Text> : null}
          {selected.supersededByCaseId ? <Text style={styles.meta}>Neuer Versuch: {selected.supersededByCaseId}</Text> : null}
        </Card>
        {selectedRequest ? <Card><Text style={styles.cardTitle}>Ursprüngliche Anfrage</Text>
          <Text style={styles.body}>Angefragt von {selectedRequest.requesterName}{selectedRequest.sourceTeam ? ` · ${selectedRequest.sourceTeam}` : ''}</Text>
          <Text style={styles.body}>Grund: {requestReasonLabels[selectedRequest.reason]}</Text>
          <Text style={styles.body}>Gewünschter Abschluss bis {deadlineLabel(selectedRequest.deadlineDate)}</Text>
          <Text style={styles.meta}>{selected.mode === 'group' ? 'Gruppensitzung' : 'Einzelsitzung'} · {selected.requestId}</Text>
        </Card> : null}
        {selected.status === 'planning' ? <><Card><Text style={styles.cardTitle}>Termin und Verfügbarkeit</Text>
          <Text style={styles.body}>Verknüpfte Personen: {sessionCases(state, selected).map(item => item.personName).join(', ')}</Text></Card>
          <WeekAvailability state={state} personKeys={sessionCases(state, selected).map(item => item.personKey)} trainerKey={selected.trainerKey} selectedSlot={slotId} onSelect={setSlot} excludeSessionId={selected.sessionId} compact />
          <Button title="Synthetische Buchung prüfen" disabled={!slotAvailable(state, selected, slotId)} onPress={() => act(selected.id, 'book', slotId)} />
        </> : null}
        {selected.status === 'invited' ? <Card><Text style={styles.cardTitle}>Einladung und Beurteilung</Text><Text style={styles.body}>Kalenderereignis: {selected.eventId}. Beurteilungen gelten pro Person.</Text>
          {selected.declined ? <Text style={styles.warning}>Diese Person hat abgesagt. Andere Fälle und das Gruppenereignis bleiben bestehen.</Text> : <><Button title="Bestanden (Trainer-Demo)" onPress={() => act(selected.id, 'pass')} /><Button title="Nicht bestanden" secondary onPress={() => act(selected.id, 'fail')} /><Button title="Absage dieser Person simulieren" secondary onPress={() => act(selected.id, 'decline')} /></>}
        </Card> : null}
        {!selected.supersededByCaseId && (selected.declined || (selected.status === 'assessed' && !selected.trainerPassed)) ? <Card><Text style={styles.cardTitle}>Ersatz / Nachschulung</Text><Text style={styles.body}>Ein neuer Einzeltermin wird nur für diese Person angelegt. Der vorige Versuch bleibt sichtbar.</Text><Button title="Neuen Einzeltermin planen" onPress={() => { act(selected.id, 'retry'); setScreen('requests'); }} /></Card> : null}
        {selected.status === 'assessed' && selected.trainerPassed ? <Card><Text style={styles.cardTitle}>Persönliche Bestätigung</Text><Text style={styles.body}>Bestanden. Die Person kann ihren Demo-Link öffnen.</Text><Button title="Teilnehmeransicht öffnen" secondary onPress={() => openParticipant(selected)} /><Text selectable style={styles.meta}>Synthetischer Demo-Link ohne Identitätsprüfung: {Platform.OS === 'web' ? participantUrl(selected.id) : participantDemoLink(selected.id)}</Text></Card> : null}
        {selected.status === 'acknowledged' ? <Card><Text style={styles.cardTitle}>Individueller Nachweis</Text><Button title="Demo-Nachweis erstellen" onPress={() => act(selected.id, 'proof')} /></Card> : null}
        {selected.status === 'proof_ready' ? <Card><Text style={styles.cardTitle}>Archivprüfung</Text><Text style={styles.warning}>Nur simulierte Drive- und lokale PDF-Prüfung. Es wird keine Datei erzeugt.</Text><Button title="Synthetische Archivprüfung" onPress={() => act(selected.id, 'archive')} /></Card> : null}
        {selected.status === 'archived_verified' ? <Card><Text style={styles.cardTitle}>Kompetenzstand</Text><Button title="Demo-Kompetenzstand anwenden" onPress={() => act(selected.id, 'skill')} /></Card> : null}
        {selected.status === 'complete' ? <Card><Text style={styles.cardTitle}>Abgeschlossen</Text><Text style={styles.body}>Dieser synthetische Personenfall ist abgeschlossen.</Text></Card> : null}
      </> : <Text style={styles.note}>Fall auswählen.</Text> : null}
    </>}
  </ScrollView></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8f6f8' }, page: { width: '100%', maxWidth: 1120, alignSelf: 'center', padding: 16, paddingTop: 26, paddingBottom: 80 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' },
  brand: { color: plum, fontSize: 14, letterSpacing: 0.8, fontWeight: '800' }, marker: { color: plum, backgroundColor: '#efe4f1', fontWeight: '800', fontSize: 10, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 99 },
  title: { color: plum, fontSize: 27, fontWeight: '800', marginBottom: 4 }, section: { color: plum, fontSize: 18, fontWeight: '700', marginTop: 24, marginBottom: 10 }, sectionCount: { color: coral },
  nav: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16 }, navItem: { backgroundColor: '#fff', borderColor: '#e6dce8', borderWidth: 1, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', borderRadius: 10 }, navActive: { backgroundColor: plum }, navText: { color: plum, fontSize: 12, fontWeight: '700' }, navActiveText: { color: '#fff' },
  hero: { backgroundColor: plum, borderRadius: 20, padding: 21, marginBottom: 12 }, heroEyebrow: { color: '#f6b7c2', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, heroTitle: { color: '#fff', fontSize: 22, fontWeight: '800', lineHeight: 28, marginTop: 8 }, heroBody: { color: '#e9dce9', fontSize: 13, lineHeight: 19, marginTop: 8 }, heroButton: { backgroundColor: '#fff', borderRadius: 10, minHeight: 46, justifyContent: 'center', alignItems: 'center', marginTop: 17, paddingHorizontal: 12 }, heroButtonText: { color: plum, fontWeight: '800', fontSize: 14 },
  queueLinks: { flexDirection: 'row', gap: 8, marginBottom: 12 }, queueLink: { flex: 1, minHeight: 82, backgroundColor: '#fff', borderColor: '#e6dce8', borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', padding: 7 }, queueNumber: { color: plum, fontSize: 24, fontWeight: '800' }, queueLinkLabel: { color: '#635669', fontSize: 11, textAlign: 'center', fontWeight: '700', marginTop: 1 },
  tourToggle: { backgroundColor: '#f1e9f1', borderRadius: 14, paddingHorizontal: 16, minHeight: 62, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, tourEyebrow: { color: coral, fontWeight: '800', fontSize: 9, letterSpacing: 1 }, tourTitle: { color: plum, fontWeight: '800', fontSize: 15, marginTop: 4 }, tourArrow: { color: plum, fontSize: 23, fontWeight: '700' }, tourSteps: { marginTop: 7, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e6dce8', overflow: 'hidden' }, tourStep: { flexDirection: 'row', alignItems: 'center', minHeight: 68, paddingHorizontal: 14, paddingVertical: 9, borderBottomColor: '#f0e9f0', borderBottomWidth: 1, gap: 12 }, tourNumber: { color: coral, fontSize: 15, fontWeight: '800' }, tourStepTitle: { color: plum, fontWeight: '700', fontSize: 14 },
  sourceGrid: { flexDirection: 'row', gap: 10 }, sourceCell: { flex: 1, minWidth: 0 }, sourceRow: { backgroundColor: '#fff', borderColor: '#e6dce8', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 76 }, sourceText: { flex: 1 }, sourceArrow: { color: plum, fontSize: 26, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderColor: '#e6dce8', borderWidth: 1, borderRadius: 15, padding: 17, marginBottom: 12 },
  queueCard: { backgroundColor: '#fff', borderRadius: 16, padding: 17, marginBottom: 11, borderWidth: 1, borderColor: '#e6dce8', borderLeftWidth: 4 }, planningCard: { borderLeftColor: '#c88145' }, upcomingCard: { borderLeftColor: '#5c8296' }, attentionCard: { borderLeftColor: coral, backgroundColor: '#fffafb' }, cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9, gap: 8 }, badge: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5, fontSize: 9, fontWeight: '800', overflow: 'hidden', letterSpacing: 0.5 }, planningBadge: { color: '#875124', backgroundColor: '#fff0dc' }, upcomingBadge: { color: '#365f74', backgroundColor: '#e5f1f6' }, attentionBadge: { color: '#982c40', backgroundColor: '#fce6e9' }, cardKicker: { color: '#7b7080', fontSize: 11, fontWeight: '600' },
  cardTitle: { color: '#302536', fontSize: 18, fontWeight: '700' }, body: { color: '#302536', fontSize: 15, lineHeight: 22, marginTop: 7 },
  note: { color: '#635669', fontSize: 14, lineHeight: 21, marginBottom: 16 }, meta: { color: '#635669', fontSize: 12, lineHeight: 18, marginTop: 6 }, task: { color: plum, fontSize: 14, fontWeight: '600', marginTop: 12 },
  button: { backgroundColor: coral, minHeight: 44, paddingHorizontal: 15, paddingVertical: 11, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 13 },
  secondary: { backgroundColor: '#efe4f1' }, buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' }, secondaryText: { color: plum }, disabled: { opacity: 0.48 },
  slot: { borderColor: '#e6dce8', borderWidth: 1, borderRadius: 9, padding: 10, marginTop: 8 }, selectedSlot: { borderColor: coral, borderWidth: 2 },
  unavailableSlot: { backgroundColor: '#f9f6f9' }, weekDay: { borderTopColor: '#eee7ef', borderTopWidth: 1, paddingVertical: 8 }, weekLabel: { color: plum, fontWeight: '700', fontSize: 14 },
  matrixRow: { borderTopColor: '#eee7ef', borderTopWidth: 1, paddingVertical: 12 }, rowTight: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, matrixLevel: { color: plum, fontWeight: '700', fontSize: 13, textAlign: 'right', flexShrink: 1 },
  choice: { borderColor: '#e6dce8', borderWidth: 1, borderRadius: 9, padding: 10, backgroundColor: '#fff' }, choiceActive: { borderColor: coral, backgroundColor: '#f9e9ec' }, personChoice: { borderColor: '#e6dce8', borderWidth: 1, borderRadius: 9, padding: 10, marginTop: 8 },
  reasonChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  warning: { color: '#8b2737', backgroundColor: '#fae9ec', padding: 11, borderRadius: 8, marginTop: 10, lineHeight: 20 },
  label: { color: '#302536', fontWeight: '700', marginTop: 17 }, input: { borderColor: '#a999ae', borderWidth: 1, borderRadius: 9, minHeight: 44, paddingHorizontal: 12, marginTop: 7, backgroundColor: '#fff' },
  checkbox: { width: 25, height: 25, borderWidth: 2, borderColor: plum, borderRadius: 4, textAlign: 'center', color: plum, fontWeight: '800', fontSize: 18 },
});
