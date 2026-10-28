import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { attentionCases, catalogue, createRequest, currentTask, eligibility, initialState, learners, planningSessions, sessionCases, slotAvailable, trainerChoices, transition, upcomingSessions, type DemoState, type TrainingCase } from './src/workflow';

const plum = '#452347';
const coral = '#b94355';
type Screen = 'home' | 'catalogue' | 'requests' | 'sessions' | 'attention' | 'create' | 'case';
function statusText(entry: TrainingCase) {
  if (entry.declined) return 'Einladung abgelehnt';
  if (entry.status === 'planning') return 'Termin offen';
  if (entry.status === 'invited') return 'eingeladen';
  if (entry.status === 'assessed') return entry.trainerPassed ? 'Bestätigung offen' : 'nicht bestanden';
  return ({ acknowledged: 'bestätigt', proof_ready: 'Archivprüfung offen', archived_verified: 'Kompetenzstand offen', complete: 'abgeschlossen' } as Record<string, string>)[entry.status] || entry.status;
}
function trainerName(key: string) { return key === 'MATT' ? 'Daniel / P&Q' : key === 'MARIE' ? 'Marie / HCM4' : key; }
function Button({ title, onPress, secondary, disabled }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text></Pressable>;
}
function Card({ children }: { children: React.ReactNode }) { return <View style={styles.card}>{children}</View>; }
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
  const [state, setState] = useState<DemoState>(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem('cosanum-synthetic-mobile-v2');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.cases) && Array.isArray(parsed.slots)) return parsed as DemoState;
        }
      } catch { /* Reset an invalid local demo state. */ }
    }
    return initialState();
  });
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.localStorage.setItem('cosanum-synthetic-mobile-v2', JSON.stringify(state));
  }, [state]);
  const [screen, setScreen] = useState<Screen>('home');
  const [selectedId, select] = useState<string | null>(null);
  const [topicId, setTopic] = useState(catalogue[0].id);
  const [mode, setMode] = useState<'group' | 'single'>('group');
  const [trainerKey, setTrainer] = useState('MATT');
  const [targetLevel, setTargetLevel] = useState(1);
  const [personKeys, setPeople] = useState<string[]>([]);
  const [slotId, setSlot] = useState('SLOT-1');
  const [participantId, setParticipant] = useState<string | null>(() => Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('participant') : null);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions(); const wide = width >= 800;
  const selected = state.cases.find(item => item.id === selectedId);
  const participant = state.cases.find(item => item.id === participantId);
  const topic = catalogue.find(item => item.id === topicId)!;
  const requests = planningSessions(state);
  const upcoming = upcomingSessions(state);
  const attention = attentionCases(state);
  function act(id: string, action: Parameters<typeof transition>[2], slot?: string) {
    try { setState(transition(state, id, action, slot)); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Aktion fehlgeschlagen'); }
  }
  function openCase(id: string) { const entry = state.cases.find(item => item.id === id); if (entry?.status === 'planning') setSlot(state.slots.find(slot => slotAvailable(state, entry, slot.id))?.id || ''); select(id); setScreen('case'); setError(''); }
  function openTopic(id: string) { setTopic(id); setMode('group'); setTrainer('MATT'); setTargetLevel(1); setPeople([]); setScreen('create'); setError(''); }
  function saveRequest() {
    try {
      const next = createRequest(state, topicId, personKeys, targetLevel, mode, trainerKey);
      const entry = next.cases[next.cases.length - personKeys.length];
      setState(next); setSlot(next.slots.find(slot => slotAvailable(next, entry, slot.id))?.id || ''); select(entry.id); setScreen('case'); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Auftrag konnte nicht erstellt werden'); }
  }
  function openParticipant(entry: TrainingCase) {
    const url = participantUrl(entry.id); if (url) void Linking.openURL(url); else setParticipant(entry.id);
  }
  function sessionCard(group: TrainingCase[], kind: 'planning' | 'upcoming') {
    const first = group[0]; const slot = state.slots.find(item => item.id === first.slotId);
    return <Card key={first.sessionId}>
      <Text style={styles.cardTitle}>{first.topicName}</Text>
      <Text style={styles.meta}>{first.requestId} · {first.sessionId} · {first.mode === 'group' ? 'Gruppe' : 'Einzeln'}</Text>
      <Text style={styles.body}>{kind === 'planning' ? 'Termin noch offen' : slot?.label || 'Termin gebucht'} · Trainer {trainerName(first.trainerKey)}</Text>
      <Text style={styles.meta}>{group.map(item => `${item.personName}: ${statusText(item)}`).join(' · ')}</Text>
      <Button title={kind === 'planning' ? 'Termin planen' : 'Sitzung ansehen'} secondary onPress={() => openCase(first.id)} />
    </Card>;
  }
  function attentionCard(entry: TrainingCase) {
    return <Card key={entry.id}><Text style={styles.cardTitle}>{entry.personName} · {entry.topicName}</Text>
      <Text style={styles.task}>{currentTask(entry).reason}</Text><Text style={styles.meta}>{entry.requestId} · {entry.id}</Text>
      <Button title={entry.declined || (entry.status === 'assessed' && !entry.trainerPassed) ? 'Erneut planen' : 'Fall prüfen'} secondary onPress={() => openCase(entry.id)} />
    </Card>;
  }
  const nav: { key: Screen; label: string }[] = [
    { key: 'home', label: 'Übersicht' }, { key: 'requests', label: 'Terminbedarf' }, { key: 'catalogue', label: 'Material' },
    { key: 'sessions', label: 'Sitzungen' }, { key: 'attention', label: 'Hinweise' },
  ];
  return <View style={styles.root}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.page}>
    <View style={styles.row}><Text style={styles.brand}>COSANUM · SCHULUNG</Text><Text style={styles.marker}>LOKALE DEMO</Text></View>
    {participant ? <Participant key={participant.id} entry={participant} back={() => setParticipant(null)} submit={() => { act(participant.id, 'acknowledge'); setParticipant(null); }} /> : <>
      <Text style={styles.title}>{screen === 'home' ? 'Guten Morgen, Daniel' : screen === 'catalogue' ? 'Trainingsmaterial' : screen === 'requests' ? 'Terminbedarf' : screen === 'sessions' ? 'Geplante Sitzungen' : screen === 'attention' ? 'Deine Hinweise' : screen === 'create' ? 'Schulungsbedarf erfassen' : 'Personenfall'}</Text>
      <Text style={styles.note}>Process & Quality · synthetische Daten · keine Google-Verbindung</Text>
      <View style={styles.nav}>{nav.map(item => <Pressable key={item.key} accessibilityRole="button" onPress={() => { setScreen(item.key); setError(''); }} style={[styles.navItem, screen === item.key && styles.navActive]}><Text style={[styles.navText, screen === item.key && styles.navActiveText]}>{item.label}</Text></Pressable>)}</View>
      {error ? <Text style={styles.warning}>{error}</Text> : null}
      {screen === 'home' ? <>
        <Text style={styles.section}>Anfragen ohne Termin · {requests.length}</Text>
        {requests.length ? requests.map(group => sessionCard(group, 'planning')) : <Text style={styles.note}>Alle Anfragen haben einen Termin.</Text>}
        <Text style={styles.section}>Trainingsmaterial · {catalogue.length}</Text>
        <Card><Text style={styles.body}>Wähle ein Material und erstelle daraus einen neuen Schulungsbedarf.</Text>
          {catalogue.map(item => <Button key={item.id} title={item.name} secondary onPress={() => openTopic(item.id)} />)}</Card>
        <Text style={styles.section}>Geplante Sitzungen · {upcoming.length}</Text>
        {upcoming.length ? upcoming.map(group => sessionCard(group, 'upcoming')) : <Text style={styles.note}>Noch keine kommenden Sitzungen.</Text>}
        <Text style={styles.section}>Braucht Aufmerksamkeit · {attention.length}</Text>
        {attention.length ? attention.map(attentionCard) : <Text style={styles.note}>Keine offenen Hinweise.</Text>}
      </> : null}
      {screen === 'requests' ? <>{requests.length ? requests.map(group => sessionCard(group, 'planning')) : <Text style={styles.note}>Keine Anfrage wartet auf einen Termin.</Text>}</> : null}
      {screen === 'catalogue' ? <>{catalogue.map(item => <Card key={item.id}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.meta}>{item.id} · {item.material} · {item.practiceIndividual ? 'Praxisphase einzeln' : 'Gruppe oder einzeln wählbar'}</Text><Button title="Schulungsbedarf erstellen" onPress={() => openTopic(item.id)} /></Card>)}</> : null}
      {screen === 'sessions' ? <>{upcoming.length ? upcoming.map(group => sessionCard(group, 'upcoming')) : <Text style={styles.note}>Keine kommenden Sitzungen.</Text>}</> : null}
      {screen === 'attention' ? <>{attention.length ? attention.map(attentionCard) : <Text style={styles.note}>Keine offenen Hinweise.</Text>}</> : null}
      {screen === 'create' ? <>
        <Button title="Zurück zum Material" secondary onPress={() => setScreen('catalogue')} />
        <Card><Text style={styles.cardTitle}>{topic.name}</Text><Text style={styles.meta}>{topic.material} · {topic.practiceIndividual ? 'Praxisphase im vollständigen Workflow einzeln' : 'Demo-Material'}</Text>
          <Text style={styles.section}>Schulungsform</Text><View style={styles.row}>{(['group', 'single'] as const).map(choice => <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ checked: mode === choice }} onPress={() => { setMode(choice); setTrainer('MATT'); setPeople([]); }} style={[styles.choice, mode === choice && styles.choiceActive]}><Text>{choice === 'group' ? 'Gruppe' : 'Einzeln'}</Text></Pressable>)}</View>
          <Text style={styles.section}>Zielstufe wählen</Text><View style={styles.row}>{(topic.fixedTarget ? [topic.fixedTarget] : [1, 2, 3]).map(level => <Pressable key={level} accessibilityRole="radio" accessibilityState={{ checked: targetLevel === level }} onPress={() => { setTargetLevel(level); setPeople([]); }} style={[styles.choice, targetLevel === level && styles.choiceActive]}><Text>Stufe {level}</Text></Pressable>)}</View>
          <Text style={styles.section}>Teilnehmende auswählen</Text>
          {learners.map(person => { const result = eligibility(topicId, person.key, targetLevel); const picked = personKeys.includes(person.key);
            return <Pressable key={person.key} accessibilityRole="checkbox" accessibilityState={{ checked: picked, disabled: !result.eligible }} disabled={!result.eligible} onPress={() => { setPeople(picked ? personKeys.filter(key => key !== person.key) : mode === 'single' ? [person.key] : [...personKeys, person.key]); setTrainer('MATT'); }} style={[styles.personChoice, !result.eligible && styles.disabled]}><Text style={styles.body}>{picked ? '☑' : '□'} {person.name}</Text><Text style={styles.meta}>{result.reason}</Text></Pressable>;
          })}
          <Text style={styles.meta}>Nur gültige nächste Stufen sind wählbar. „–“, leere Werte und Trainerstufe 4 sind ausgeschlossen.</Text>
          {personKeys.length ? <><Text style={styles.section}>Trainer wählen</Text><View style={styles.row}>{trainerChoices(topicId, mode, personKeys.length).map(key => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: trainerKey === key }} onPress={() => setTrainer(key)} style={[styles.choice, trainerKey === key && styles.choiceActive]}><Text>{key === 'MATT' ? 'Daniel / P&Q' : 'Marie / HCM4'}</Text></Pressable>)}</View></> : null}
          <Button title="Anfrage anlegen und Termin wählen" disabled={!personKeys.length || !trainerChoices(topicId, mode, personKeys.length).includes(trainerKey)} onPress={saveRequest} />
        </Card>
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
        {selected.status === 'planning' ? <Card><Text style={styles.cardTitle}>Termin und Verfügbarkeit</Text>
          <Text style={styles.body}>Verknüpfte Personen: {sessionCases(state, selected).map(item => item.personName).join(', ')}</Text>
          {state.slots.filter(slot => slot.id !== 'SLOT-OLD').map(slot => <Pressable key={slot.id} accessibilityRole="radio" accessibilityState={{ checked: slotId === slot.id, disabled: !slotAvailable(state, selected, slot.id) }} onPress={() => setSlot(slot.id)} disabled={!slotAvailable(state, selected, slot.id)} style={[styles.slot, slotId === slot.id && styles.selectedSlot]}><Text style={styles.body}>{slot.label}</Text><Text style={styles.meta}>{slotAvailable(state, selected, slot.id) ? 'Frei für Trainer und verknüpfte Personen' : `Belegt: ${slot.busy.map(trainerName).join(', ') || 'andere Sitzung'}`}</Text></Pressable>)}
          <Button title="Synthetische Buchung prüfen" disabled={!slotAvailable(state, selected, slotId)} onPress={() => act(selected.id, 'book', slotId)} />
        </Card> : null}
        {selected.status === 'invited' ? <Card><Text style={styles.cardTitle}>Einladung und Beurteilung</Text><Text style={styles.body}>Kalenderereignis: {selected.eventId}. Beurteilungen gelten pro Person.</Text>
          {selected.declined ? <Text style={styles.warning}>Diese Person hat abgesagt. Andere Fälle und das Gruppenereignis bleiben bestehen.</Text> : <><Button title="Bestanden (Trainer-Demo)" onPress={() => act(selected.id, 'pass')} /><Button title="Nicht bestanden" secondary onPress={() => act(selected.id, 'fail')} /><Button title="Absage dieser Person simulieren" secondary onPress={() => act(selected.id, 'decline')} /></>}
        </Card> : null}
        {!selected.supersededByCaseId && (selected.declined || (selected.status === 'assessed' && !selected.trainerPassed)) ? <Card><Text style={styles.cardTitle}>Ersatz / Nachschulung</Text><Text style={styles.body}>Ein neuer Einzeltermin wird nur für diese Person angelegt. Der vorige Versuch bleibt sichtbar.</Text><Button title="Neuen Einzeltermin planen" onPress={() => { act(selected.id, 'retry'); setScreen('requests'); }} /></Card> : null}
        {selected.status === 'assessed' && selected.trainerPassed ? <Card><Text style={styles.cardTitle}>Persönliche Bestätigung</Text><Text style={styles.body}>Bestanden. Die Person kann ihren Demo-Link öffnen.</Text><Button title="Teilnehmeransicht öffnen" secondary onPress={() => openParticipant(selected)} />{Platform.OS === 'web' ? <Text selectable style={styles.meta}>{participantUrl(selected.id)}</Text> : null}</Card> : null}
        {selected.status === 'acknowledged' ? <Card><Text style={styles.cardTitle}>Individueller Nachweis</Text><Button title="Demo-Nachweis erstellen" onPress={() => act(selected.id, 'proof')} /></Card> : null}
        {selected.status === 'proof_ready' ? <Card><Text style={styles.cardTitle}>Archivprüfung</Text><Text style={styles.warning}>Nur simulierte Drive- und lokale PDF-Prüfung. Es wird keine Datei erzeugt.</Text><Button title="Synthetische Archivprüfung" onPress={() => act(selected.id, 'archive')} /></Card> : null}
        {selected.status === 'archived_verified' ? <Card><Text style={styles.cardTitle}>Kompetenzstand</Text><Button title="Demo-Kompetenzstand anwenden" onPress={() => act(selected.id, 'skill')} /></Card> : null}
        {selected.status === 'complete' ? <Card><Text style={styles.cardTitle}>Abgeschlossen</Text><Text style={styles.body}>Dieser synthetische Personenfall ist abgeschlossen.</Text></Card> : null}
      </> : <Text style={styles.note}>Fall auswählen.</Text> : null}
    </>}
  </ScrollView></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7f4f8' }, page: { width: '100%', maxWidth: 1120, alignSelf: 'center', padding: 18, paddingTop: 48, paddingBottom: 80 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  brand: { color: plum, fontSize: 15, fontWeight: '800' }, marker: { color: '#fff', backgroundColor: plum, fontWeight: '800', fontSize: 11, padding: 7, borderRadius: 6 },
  title: { color: plum, fontSize: 30, fontWeight: '800', marginBottom: 7 }, section: { color: plum, fontSize: 19, fontWeight: '700', marginTop: 19, marginBottom: 9 },
  nav: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16 }, navItem: { backgroundColor: '#fff', borderColor: '#e6dce8', borderWidth: 1, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 8 }, navActive: { backgroundColor: plum }, navText: { color: plum, fontSize: 12, fontWeight: '600' }, navActiveText: { color: '#fff' },
  card: { backgroundColor: '#fff', borderColor: '#e6dce8', borderWidth: 1, borderRadius: 15, padding: 17, marginBottom: 12 },
  cardTitle: { color: '#302536', fontSize: 18, fontWeight: '700' }, body: { color: '#302536', fontSize: 15, lineHeight: 22, marginTop: 7 },
  note: { color: '#635669', fontSize: 14, lineHeight: 21, marginBottom: 16 }, meta: { color: '#635669', fontSize: 12, lineHeight: 18, marginTop: 6 }, task: { color: plum, fontSize: 14, fontWeight: '600', marginTop: 12 },
  button: { backgroundColor: coral, minHeight: 44, paddingHorizontal: 15, paddingVertical: 11, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 13 },
  secondary: { backgroundColor: '#efe4f1' }, buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' }, secondaryText: { color: plum }, disabled: { opacity: 0.48 },
  slot: { borderColor: '#e6dce8', borderWidth: 1, borderRadius: 9, padding: 10, marginTop: 8 }, selectedSlot: { borderColor: coral, borderWidth: 2 },
  choice: { borderColor: '#e6dce8', borderWidth: 1, borderRadius: 9, padding: 10, backgroundColor: '#fff' }, choiceActive: { borderColor: coral, backgroundColor: '#f9e9ec' }, personChoice: { borderColor: '#e6dce8', borderWidth: 1, borderRadius: 9, padding: 10, marginTop: 8 },
  warning: { color: '#8b2737', backgroundColor: '#fae9ec', padding: 11, borderRadius: 8, marginTop: 10, lineHeight: 20 },
  label: { color: '#302536', fontWeight: '700', marginTop: 17 }, input: { borderColor: '#a999ae', borderWidth: 1, borderRadius: 9, minHeight: 44, paddingHorizontal: 12, marginTop: 7, backgroundColor: '#fff' },
  checkbox: { width: 25, height: 25, borderWidth: 2, borderColor: plum, borderRadius: 4, textAlign: 'center', color: plum, fontWeight: '800', fontSize: 18 },
});
