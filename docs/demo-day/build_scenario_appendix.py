#!/usr/bin/env python3
"""Build public-safe communication models from explicit synthetic scenario paths."""
from pathlib import Path
from xml.etree import ElementTree as E
from html import escape
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'shared-demo-site/public/presentation'
B='http://www.omg.org/spec/BPMN/20100524/MODEL'; D='http://www.omg.org/spec/BPMN/20100524/DI'; C='http://www.omg.org/spec/DD/20100524/DC'; I='http://www.omg.org/spec/DD/20100524/DI'
for p,n in [('bpmn',B),('bpmndi',D),('dc',C),('di',I)]: E.register_namespace(p,n)
def sub(p,t,**a): return E.SubElement(p,t,a)
def q(n): return '{'+B+'}'+n
scenarios=[
 ('Erfolgspfad', [('Daniel: Thema / Matthew / Ziel','now'),('Daniel: 1–3 Angebote / Einladung','now'),('Matthew: erstes ablehnen','now'),('Matthew: zweites annehmen','now'),('Daniel: Training starten','now'),('Daniel: bestanden berichten','now'),('Matthew: Teilnahme bestätigen','now'),('System: Demo-Skill / Verlauf','now')]),
 ('Absage vor Trainingsbeginn', [('Daniel: Einladung / Termin','now'),('Daniel: vor Start absagen','now'),('System: abgesagt / kein Skillgewinn','now')]),
 ('Absage während Training', [('Matthew: Termin bestätigen','now'),('Daniel: Training starten','now'),('Daniel: laufendes Training absagen','now'),('System: abgesagt / kein Skillgewinn','now')]),
 ('Alle Vorschläge abgelehnt', [('Matthew: alle Angebote ablehnen','now'),('System: Neuplanung nötig','now'),('Daniel: neue Angebote setzen','now'),('Matthew: erneut Termin wählen','now'),('Verfügbarkeit automatisch suchen','planned')]),
 ('Vorzeitiger Start', [('Matthew: Termin bestätigen','now'),('System: In-App-Erinnerung','now'),('Daniel: vorzeitig starten','now'),('System: Start protokollieren','now')]),
 ('Nicht bestanden / Nachschulung', [('Daniel: nicht bestanden berichten','now'),('Matthew: Teilnahme bestätigen','now'),('System: Stufe halten / Nachschulung nötig','now'),('Daniel: Nachschulung neu anlegen','manual'),('Nachschulung automatisch auslösen','planned')]),
 ('Teilnahmebestätigung fehlt', [('Daniel: Bericht einreichen','now'),('Matthew: noch nicht bestätigt','wait'),('Automatisch erinnern / eskalieren','planned'),('Matthew: später bestätigen','now'),('System: Ergebnisabhängiger Abschluss','now')]),
 ('Anmeldung oder Link scheitert', [('System: Zugang abweisen','now'),('Daniel / Matthew: Konto und Link prüfen','manual'),('Passenden gültigen Rollenlink öffnen','manual'),('Bei Linkverlust: neuen Raum vorbereiten','manual')]),
]
defs=E.Element(q('definitions'),{'id':'Definitions_Demo','targetNamespace':'https://example.invalid/cosanum/demo-day','exporter':'Cosanum synthetic communication model','exporterVersion':'1'})
svg=['<svg xmlns="http://www.w3.org/2000/svg" width="2200" height="1670" viewBox="0 0 2200 1670"><style>text{font-family:Arial,sans-serif;fill:#322333} .title{font-size:28px;font-weight:bold}.sub{font-size:17px}.label{font-size:14px}</style><rect width="2200" height="1670" fill="#faf8fb"/><text x="30" y="40" class="title">Trainingsdemo · Ablauf und Ausnahmewege</text><text x="30" y="72" class="sub">Synthetische D1-Räume · einzelne Szenarien, keine ausführbare Prozesssteuerung · 29.10.2026</text>']
colors={'now':'#eee4f2','manual':'#fff0db','planned':'#ffe2df','wait':'#e3ecf8'}
for si,(name,steps) in enumerate(scenarios):
 pid=f'Process_{si}'; proc=sub(defs,q('process'),id=pid,name=name,isExecutable='false')
 doc=sub(proc,q('documentation'));doc.text='Unabhängiges Kommunikationsszenario. IMPLEMENTIERT bezeichnet Site-Quellcode; GEPLANT ist keine ausgeführte Funktion. Startvoraussetzungen stehen im Runbook. Keine Google-Kalender-, Mail-, Push- oder produktiven Datenzugriffe.'
 nodes=[('startEvent','Start','now')]+[('task',label,status) for label,status in steps]+[('endEvent','Ende','now')]
 diagram=sub(defs,'{'+D+'}BPMNDiagram',id=f'Diagram_{si}',name=name)
 plane=sub(diagram,'{'+D+'}BPMNPlane',id=f'Plane_{si}',bpmnElement=pid)
 y=130+si*190
 svg.append(f'<text x="30" y="{y-15}" class="sub">{si+1}. {escape(name)}</text>')
 for j,(typ,label,status) in enumerate(nodes):
  nid=f'N_{si}_{j}'; node=sub(proc,q(typ),id=nid,name=('[GEPLANT] ' if status=='planned' else '[MANUELL] ' if status=='manual' else '')+label)
  if typ=='task':
   doc=sub(node,q('documentation'));doc.text={'now':'IMPLEMENTIERT in synthetischer Site; aktueller Gerätecheck gesondert.','manual':'MANUELLER WIEDERANLAUF; keine automatische Funktion.','planned':'GEPLANT; nicht in der Site implementiert.','wait':'OFFENER ZUSTAND; keine automatische Frist oder Eskalation.'}[status]
  x=40+j*210; w=170 if typ=='task' else 40; h=70 if typ=='task' else 40
  shape=sub(plane,'{'+D+'}BPMNShape',id='Shape_'+nid,bpmnElement=nid)
  sub(shape,'{'+C+'}Bounds',x=str(x),y='100',width=str(w),height=str(h))
  if typ=='task':
   svg.append(f'<rect x="{x}" y="{y}" width="170" height="85" rx="8" fill="{colors[status]}" stroke="#664c6b" '+('stroke-dasharray="6 4"' if status=='planned' else '')+'/>')
   words=label.split(); lines=[]; line=''
   for word in words:
    if len(line+' '+word)>23: lines.append(line);line=word
    else: line=(line+' '+word).strip()
   lines.append(line)
   for k,l in enumerate(lines): svg.append(f'<text x="{x+10}" y="{y+23+k*17}" class="label">{escape(l)}</text>')
  else:
   svg.append(f'<circle cx="{x+20}" cy="{y+40}" r="18" fill="white" stroke="#664c6b" stroke-width="{3 if typ=="endEvent" else 1.5}"/>')
  if j:
   prev=f'N_{si}_{j-1}'; fid=f'F_{si}_{j}';sub(proc,q('sequenceFlow'),id=fid,sourceRef=prev,targetRef=nid)
   edge=sub(plane,'{'+D+'}BPMNEdge',id='Edge_'+fid,bpmnElement=fid)
   pw=170 if nodes[j-1][0]=='task' else 40
   sub(edge,'{'+I+'}waypoint',x=str(40+(j-1)*210+pw),y='120')
   sub(edge,'{'+I+'}waypoint',x=str(x),y='120')
   svg.append(f'<path d="M {40+(j-1)*210+pw} {y+40} H {x-3}" stroke="#664c6b" fill="none"/><path d="M {x-8} {y+35} L {x-2} {y+40} L {x-8} {y+45}" fill="none" stroke="#664c6b"/>')
diagrams = defs.findall("{"+D+"}BPMNDiagram")
for diagram in diagrams: defs.remove(diagram)
for diagram in diagrams: defs.append(diagram)
E.indent(defs)
E.ElementTree(defs).write(OUT/'scenario-appendix.bpmn',encoding='utf-8',xml_declaration=True)
svg.append('<text x="30" y="1645" class="sub">Legende: Lila = implementiert · Orange = manuell · Blau = offen / warten · Koralle gestrichelt = geplant. Keine Kalenderbuchung, automatische Mail oder Push.</text></svg>')
(OUT/'scenario-appendix.svg').write_text('\n'.join(svg))
# Independent source-flow image, no private source assets.
s=['<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1020" viewBox="0 0 1500 1020"><style>text{font-family:Arial,sans-serif;fill:#322333}.h{font-size:27px;font-weight:bold}.t{font-size:18px}.s{font-size:15px}</style><rect width="1500" height="1020" fill="#faf8fb"/><text x="30" y="45" class="h">Woher kommen die Daten?</text><text x="30" y="78" class="t">Gemeinsame Site: synthetische Daten und D1-Zustand · keine produktiven Originale</text>']
items=[('Mitarbeitende','Matthew / Annina / Marko · synthetisch'),('Katalog und Material','Vier Themen / neue Demo-Lernpakete'),('Kompetenzmatrix','Ausgangswerte + Demo-Fallabschluss'),('Workflow / Audit','Angebote, Bericht, Bestätigung, Verlauf')]
for i,(a,b) in enumerate(items):
 y=130+i*150
 s.append(f'<rect x="30" y="{y}" width="430" height="100" rx="12" fill="#eee4f2" stroke="#664c6b"/><text x="50" y="{y+35}" class="t">{a}</text><text x="50" y="{y+68}" class="s">{b}</text><path d="M 460 {y+50} H 525 V 390 H 580" fill="none" stroke="#664c6b"/>')
s.append('<rect x="580" y="305" width="350" height="190" rx="14" fill="#664c6b"/><text x="610" y="350" class="t" style="fill:white">Gemeinsamer D1-Demo-Raum</text><text x="610" y="389" class="s" style="fill:white">Gespeicherte synthetische Fälle</text><text x="610" y="420" class="s" style="fill:white">Zwei Geräte · Polling etwa 3 s</text><text x="610" y="451" class="s" style="fill:white">Kein produktiver Trainingsnachweis</text><path d="M 930 400 H 1000" stroke="#664c6b"/><rect x="1000" y="320" width="450" height="160" rx="12" fill="#eee4f2" stroke="#664c6b"/><text x="1020" y="358" class="t">Daniel ↔ Matthew</text><text x="1020" y="395" class="s">Rollenlinks + Google-Anmeldung, falls eingerichtet</text><text x="1020" y="427" class="s">Manueller Mailentwurf / In-App-Hinweis</text>')
for i,(a,b) in enumerate([('Google-Kalender','Live-Free/Busy und Buchung fehlen'),('Externe Anfragen','Import und Prüfung geplant'),('Betriebliche Quellen','Personal / Drive / Sheets nicht verbunden')]):
 x=30+i*485
 s.append(f'<rect x="{x}" y="800" width="450" height="100" rx="12" fill="#ffe2df" stroke="#a44339" stroke-dasharray="7 5"/><text x="{x+18}" y="835" class="t">{a}</text><text x="{x+18}" y="870" class="s">{b}</text>')
s.append('<text x="30" y="960" class="t">Legende: Lila = synthetisch implementiert · Koralle gestrichelt = fehlende / geplante Anbindung</text><text x="30" y="995" class="s">Google-Anmeldung belegt keine Kalender-, Mail-, Push-, Drive- oder Sheet-Integration. Stand: 29.10.2026</text></svg>')
(OUT/'source-flow.svg').write_text('\n'.join(s))
print('Generated BPMN and two public SVGs')
