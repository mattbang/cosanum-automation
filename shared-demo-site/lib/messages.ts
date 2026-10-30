import type { DemoCase } from './demo';
const when=(iso:string)=>new Intl.DateTimeFormat('de-CH',{timeZone:'Europe/Zurich',weekday:'long',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
export function invitationMessage(training:DemoCase|null,link:string) {
 const subject=`[DEMO] Cosanum · Matthew · ${training?.topic || 'Trainingsportal'}`;
 const body=['Hallo Matthew,','',training?`Daniel (Process & Quality) lädt dich zur Schulung «${training.topic}» ein. Ziel: Niveau ${training.targetLevel}; Dauer: 60 Minuten.`:'Daniel hat deinen persönlichen Demo-Zugang vorbereitet.','',...(training?['Terminvorschläge (Europe/Zurich):',...training.offers.map((offer,i)=>`${i+1}. ${when(offer)}`),'']:[]),'Öffne deinen persönlichen Link, melde dich mit deinem zugewiesenen Google-Konto an und wähle dort den passenden Termin. Du kannst einen Vorschlag ablehnen und einen anderen annehmen. Bitte antworte über das Portal:',link,'',`Vorbereitung und Schulungsunterlagen: ${new URL('/materials/index.html',link).toString()}`,'','Nach dem Training liest du den Trainerbericht und bestätigst deine Teilnahme im Portal.','Diese Vorführung verwendet synthetische Termine und Trainingsdaten. Es wird kein Google-Kalendertermin gebucht.'].join('\n');
 return {subject,body};
}
