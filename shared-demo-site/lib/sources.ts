import { DEMO_SKILL_MATRIX, PARTICIPANTS, TOPICS } from './demo';
export const SOURCE_REGISTER = [
 { id:'employees', name:'Mitarbeiterregister', type:'CSV', status:'Synthetische Cloud-Datei', href:'/api/sources/employees', future:'Autoritatives Personalregister / HR-System; stabile Mitarbeiter-ID, Rolle und zugewiesenes Konto.' },
 { id:'catalogue', name:'Schulungskatalog', type:'CSV', status:'Synthetische Cloud-Datei', href:'/api/sources/catalogue', future:'Eigenständiger Google Sheet mit Themen, Versionen, Zielstufen und Materialverweisen.' },
 { id:'matrix', name:'Kompetenzmatrix', type:'CSV', status:'Fiktiver Ausgangsstand', href:'/api/sources/matrix', future:'Eigenständiger Google Sheet; bestätigte Ergebnisse personengenau und konfliktgeprüft zurückschreiben.' },
 { id:'materials', name:'Schulungsunterlagen', type:'Dokumentenordner', status:'Synthetische Vorbereitung', href:'/materials/', future:'Versionierter Drive-Ordner; zugewiesene Teilnehmende erhalten Vorabzugriff.' },
 { id:'cases', name:'Trainingsfälle und Verlauf', type:'D1-Datenbank', status:'Gemeinsamer persistierter Demo-Raum', href:null, future:'Transaktionale Falldatenbank mit dauerhafter Audit-Historie und Quellenreferenzen.' },
 { id:'calendars', name:'Kalender / frei und belegt', type:'Google Calendar', status:'Geplant · Demo zeigt synthetische Fenster', href:null, future:'Nur erforderliche Kalender; frei/belegt prüfen und vor Buchung erneut prüfen.' },
 { id:'requests', name:'Externe Schulungsanfragen', type:'Eingangsschnittstelle', status:'Demo-Anfrage vorhanden · externer Eingang geplant', href:null, future:'CCS / Leitstand: anfragende Person, betroffene Person(en), Thema, Grund und gewünschte Frist.' },
];
export function sourceRows(kind: string): (string|number)[][] | null {
 if(kind === 'employees') return [['employee_id','name','role','account_status','synthetic'],['EMP-001','Matthew','Mitarbeiter 1','Zugewiesen','true'],['EMP-002','Annina','Mitarbeiter 2','Konto folgt','true'],['EMP-003','Marko','Mitarbeiter 3','Konto folgt','true'],['EMP-004','Daniel','Process & Quality','Zugewiesen','true']];
 if(kind === 'catalogue') return [['topic_id','topic','version','duration_minutes','material_folder','synthetic'],...TOPICS.map((topic,i)=>[`TR-${i+1}`,topic,'DEMO-1',60,'/materials/','true'])];
 if(kind === 'matrix') return [['employee_id','topic_id','topic','level','status','synthetic'],...PARTICIPANTS.flatMap((person,i)=>TOPICS.map((topic,j)=>[`EMP-00${i+1}`,`TR-${j+1}`,topic,DEMO_SKILL_MATRIX[person][topic].level,DEMO_SKILL_MATRIX[person][topic].status,'true']))];
 return null;
}
export function sourceCsv(rows:(string|number)[][]) { return '\uFEFF' + rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(';')).join('\r\n'); }
