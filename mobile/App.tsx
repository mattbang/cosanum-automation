import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { currentTask, initialState, sessionCases, slotAvailable, transition, type TrainingCase } from './src/workflow';

const plum = '#452347';
const coral = '#b94355';
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
  const [state, setState] = useState(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem('cosanum-synthetic-mobile-v1');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.cases) && Array.isArray(parsed.slots)) return parsed as ReturnType<typeof initialState>;
        }
      } catch { /* Reset an invalid local demo state. */ }
    }
    return initialState();
  });
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.localStorage.setItem('cosanum-synthetic-mobile-v1', JSON.stringify(state));
  }, [state]);
  const [selectedId, select] = useState<string | null>(null);
  const [slotId, setSlot] = useState('SLOT-1');
  const [participantId, setParticipant] = useState<string | null>(() => Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('participant') : null);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions(); const wide = width >= 800;
  const selected = state.cases.find(item => item.id === selectedId);
  const participant = state.cases.find(item => item.id === participantId);
  function act(id: string, action: Parameters<typeof transition>[2], slot?: string) {
    try { setState(previous => transition(previous, id, action, slot)); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Aktion fehlgeschlagen'); }
  }
  function openParticipant(entry: TrainingCase) {
    const url = participantUrl(entry.id); if (url) void Linking.openURL(url); else setParticipant(entry.id);
  }
  return <View style={styles.root}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.page}>
    <View style={styles.row}><Text style={styles.brand}>COSANUM · SCHULUNG</Text><Text style={styles.marker}>LOKALE DEMO</Text></View>
    {participant ? <Participant key={participant.id} entry={participant} back={() => setParticipant(null)} submit={() => { act(participant.id, 'acknowledge'); setParticipant(null); }} /> : <>
      <Text style={styles.title}>Schulungen steuern</Text><Text style={styles.note}>Synthetische Fälle · lokale Zustände · keine Google-Verbindung</Text>
      {error ? <Text style={styles.warning}>{error}</Text> : null}
      <View style={wide ? styles.columns : undefined}><View style={wide ? styles.list : undefined}>
        <Text style={styles.section}>Personenfälle</Text>
        {state.cases.map(entry => <Pressable key={entry.id} accessibilityRole="button" onPress={() => { select(entry.id); setError(''); }}><Card>
          <Text style={styles.cardTitle}>{entry.personName} · {entry.mode === 'group' ? 'Gruppe' : 'Einzeln'}</Text>
          <Text style={styles.body}>{entry.topicName}</Text><Text style={styles.meta}>{entry.id} · Stufe {entry.originalLevel} → {entry.targetLevel}</Text>
          <Text style={styles.task}>{currentTask(entry).reason}</Text></Card></Pressable>)}
      </View><View style={wide ? styles.detail : undefined}>
        {selected ? <><Text style={styles.section}>Fall {selected.id}</Text><Card>
          <Text style={styles.cardTitle}>{selected.personName} · {selected.status}</Text>
          <Text style={styles.body}>{selected.topicName} · {selected.mode === 'group' ? 'Gruppentermin' : 'Einzeltermin'}</Text>
          <Text style={styles.meta}>Anfrage {selected.requestId} · Sitzung {selected.sessionId} · Trainer {selected.trainerKey}</Text>
          <Text style={styles.task}>Nächster Schritt: {currentTask(selected).reason}</Text>
          <Text style={styles.meta}>Aufgabenprojektion: canExecute = false. Jede Demoaktion prüft den Zustand erneut.</Text>
        </Card>
        {selected.status === 'planning' ? <Card><Text style={styles.cardTitle}>Termin und Verfügbarkeit</Text>
          <Text style={styles.body}>Verknüpfte Personen: {sessionCases(state, selected).map(item => item.personName).join(', ')}</Text>
          {state.slots.map(slot => <Pressable key={slot.id} accessibilityRole="radio" accessibilityState={{ checked: slotId === slot.id, disabled: !slotAvailable(state, selected, slot.id) }} onPress={() => setSlot(slot.id)} disabled={!slotAvailable(state, selected, slot.id)} style={[styles.slot, slotId === slot.id && styles.selectedSlot]}><Text style={styles.body}>{slot.label}</Text><Text style={styles.meta}>{slotAvailable(state, selected, slot.id) ? 'Frei für Trainer und verknüpfte Personen' : `Belegt: ${slot.busy.join(', ') || 'andere Sitzung'}`}</Text></Pressable>)}
          <Button title="Synthetische Buchung prüfen" disabled={!slotAvailable(state, selected, slotId)} onPress={() => act(selected.id, 'book', slotId)} />
        </Card> : null}
        {selected.status === 'invited' ? <Card><Text style={styles.cardTitle}>Einladung und Beurteilung</Text><Text style={styles.body}>Kalenderereignis: {selected.eventId}. Beurteilungen gelten pro Person.</Text>
          {selected.declined ? <Text style={styles.warning}>Diese Person hat abgesagt. Andere Fälle und das Gruppenereignis bleiben bestehen.</Text> : <><Button title="Bestanden (Trainer-Demo)" onPress={() => act(selected.id, 'pass')} /><Button title="Nicht bestanden" secondary onPress={() => act(selected.id, 'fail')} /><Button title="Absage dieser Person simulieren" secondary onPress={() => act(selected.id, 'decline')} /></>}
        </Card> : null}
        {selected.status === 'assessed' ? <Card><Text style={styles.cardTitle}>Persönliche Bestätigung</Text><Text style={styles.body}>{selected.trainerPassed ? 'Bestanden. Die Person kann ihren Demo-Link öffnen.' : 'Nicht bestanden. Bestätigung gesperrt.'}</Text><Button title="Teilnehmeransicht öffnen" secondary onPress={() => openParticipant(selected)} />{Platform.OS === 'web' ? <Text selectable style={styles.meta}>{participantUrl(selected.id)}</Text> : null}</Card> : null}
        {selected.status === 'acknowledged' ? <Card><Text style={styles.cardTitle}>Individueller Nachweis</Text><Text style={styles.body}>Trainer- und Teilnahmebeleg liegen synthetisch vor.</Text><Button title="Demo-Nachweis erstellen" onPress={() => act(selected.id, 'proof')} /></Card> : null}
        {selected.status === 'proof_ready' ? <Card><Text style={styles.cardTitle}>Archivprüfung</Text><Text style={styles.body}>{selected.proofId} · Version {selected.proofVersion}</Text><Text style={styles.warning}>Nur simulierte Drive- und lokale PDF-Prüfung. Es wird keine Datei erzeugt.</Text><Button title="Synthetische Archivprüfung" onPress={() => act(selected.id, 'archive')} /></Card> : null}
        {selected.status === 'archived_verified' ? <Card><Text style={styles.cardTitle}>Kompetenzstand</Text><Text style={styles.body}>Archivbeleg: {selected.archiveReceipt}. Stufe {selected.originalLevel} → {selected.targetLevel}.</Text><Button title="Demo-Kompetenzstand anwenden" onPress={() => act(selected.id, 'skill')} /></Card> : null}
        {selected.status === 'complete' ? <Card><Text style={styles.cardTitle}>Abgeschlossen</Text><Text style={styles.body}>Dieser synthetische Personenfall ist abgeschlossen.</Text></Card> : null}
        </> : <Card><Text style={styles.cardTitle}>Fall auswählen</Text><Text style={styles.body}>Öffne einen Personenfall für den nächsten Schritt.</Text></Card>}
      </View></View>
    </>}
  </ScrollView></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7f4f8' }, page: { width: '100%', maxWidth: 1120, alignSelf: 'center', padding: 18, paddingTop: 48, paddingBottom: 80 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 },
  brand: { color: plum, fontSize: 15, fontWeight: '800' }, marker: { color: '#fff', backgroundColor: plum, fontWeight: '800', fontSize: 11, padding: 7, borderRadius: 6 },
  title: { color: plum, fontSize: 30, fontWeight: '800', marginBottom: 7 }, section: { color: plum, fontSize: 19, fontWeight: '700', marginTop: 19, marginBottom: 9 },
  columns: { flexDirection: 'row', gap: 18 }, list: { flex: 0.42 }, detail: { flex: 0.58 },
  card: { backgroundColor: '#fff', borderColor: '#e6dce8', borderWidth: 1, borderRadius: 15, padding: 17, marginBottom: 12 },
  cardTitle: { color: '#302536', fontSize: 18, fontWeight: '700' }, body: { color: '#302536', fontSize: 15, lineHeight: 22, marginTop: 7 },
  note: { color: '#635669', fontSize: 14, lineHeight: 21, marginBottom: 16 }, meta: { color: '#635669', fontSize: 12, lineHeight: 18, marginTop: 6 }, task: { color: plum, fontSize: 14, fontWeight: '600', marginTop: 12 },
  button: { backgroundColor: coral, minHeight: 44, paddingHorizontal: 15, paddingVertical: 11, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 13 },
  secondary: { backgroundColor: '#efe4f1' }, buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' }, secondaryText: { color: plum }, disabled: { opacity: 0.48 },
  slot: { borderColor: '#e6dce8', borderWidth: 1, borderRadius: 9, padding: 10, marginTop: 8 }, selectedSlot: { borderColor: coral, borderWidth: 2 },
  warning: { color: '#8b2737', backgroundColor: '#fae9ec', padding: 11, borderRadius: 8, marginTop: 10, lineHeight: 20 },
  label: { color: '#302536', fontWeight: '700', marginTop: 17 }, input: { borderColor: '#a999ae', borderWidth: 1, borderRadius: 9, minHeight: 44, paddingHorizontal: 12, marginTop: 7, backgroundColor: '#fff' },
  checkbox: { width: 25, height: 25, borderWidth: 2, borderColor: plum, borderRadius: 4, textAlign: 'center', color: plum, fontWeight: '800', fontSize: 18 },
});
