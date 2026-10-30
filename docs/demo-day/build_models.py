#!/usr/bin/env python3
"""Connected, non-executable BPMN communication model; synthetic Site only."""
from pathlib import Path
from xml.etree import ElementTree as E
from html import escape
import subprocess
ROOT=Path(__file__).resolve().parents[2]; OUT=ROOT/'shared-demo-site/public/presentation'
# Keep scenario appendix and source-flow diagram reproducible.
subprocess.run(['python3',str(Path(__file__).with_name('build_scenario_appendix.py'))],check=True)
B='http://www.omg.org/spec/BPMN/20100524/MODEL'; D='http://www.omg.org/spec/BPMN/20100524/DI'; C='http://www.omg.org/spec/DD/20100524/DC'; I='http://www.omg.org/spec/DD/20100524/DI'
for p,n in [('bpmn',B),('bpmndi',D),('dc',C),('di',I)]: E.register_namespace(p,n)
def q(n): return '{'+B+'}'+n
def sub(p,t,**a): return E.SubElement(p,t,a)
# ID, BPMN type, label, lane, centre y, evidence status. Lane centres are fixed.
nodes=[
 ('start','startEvent','Demo öffnen','app',110,'now'),
 ('access','task','Raumzugang und Google-Anmeldung prüfen, falls eingerichtet','app',300,'now'),
 ('authorized','exclusiveGateway','Zugang gültig?','app',500,'now'),
 ('credentials','task','[MANUELL] Konto, Rolle und gespeicherten Link prüfen','trainee',500,'manual'),
 ('recoverable','exclusiveGateway','Gültiger Link vorhanden?','trainee',700,'now'),
 ('newroom','endEvent','Neuen Raum vorbereiten','trainee',900,'manual'),
 ('request','task','Daniel: Thema, Matthew und Zielniveau 1–3 wählen','daniel',700,'now'),
 ('offers','task','Daniel: 1–3 gemeinsame freie Demo-Fenster wählen','daniel',1000,'now'),
 ('invite','task','Einladung und getrennte Rollenlinks speichern','app',1000,'now'),
 ('invitation_open','exclusiveGateway','Daniel: nächster Schritt?','app',1200,'now'),
 ('response_merge','exclusiveGateway','','trainee',1100,'now'),
 ('confirmation_merge','exclusiveGateway','','trainee',3450,'now'),
 ('cancel_merge','exclusiveGateway','','daniel',1950,'now'),
 ('response','exclusiveGateway','Matthews Antwort?','trainee',1250,'now'),
 ('reject','task','Matthew: Angebot ablehnen','trainee',1450,'now'),
 ('remaining','exclusiveGateway','Weiteres Angebot offen?','app',1450,'now'),
 ('reschedule','task','Daniel: 1–3 Angebote ersetzen; erneute Wahl erforderlich','daniel',1450,'now'),
 ('accept','task','Matthew: offenes Angebot annehmen','trainee',1750,'now'),
 ('confirmed','task','Termin bestätigen; Hinweis in beiden Ansichten','app',1750,'now'),
 ('before','exclusiveGateway','Daniel: vor Start absagen?','daniel',1750,'now'),
 ('cancelbefore','task','Daniel: vor Beginn absagen','daniel',2050,'now'),
 ('cancelendbefore','endEvent','Abgesagt; kein Skillgewinn','app',2050,'now'),
 ('timing','exclusiveGateway','Startzeitpunkt?','app',2350,'now'),
 ('early','task','Daniel: vorzeitigen Demostart wählen','daniel',2350,'now'),
 ('scheduled','task','[MANUELL] Bis Termin warten; kein automatischer Start','app',2650,'manual'),
 ('begin','task','Daniel: Start ausdrücklich auslösen','daniel',2650,'now'),
 ('training','task','Training läuft; Start im Verlauf protokolliert','app',2950,'now'),
 ('during','exclusiveGateway','Daniel: während Training absagen?','daniel',2950,'now'),
 ('cancelduring','task','Daniel: laufenden Fall absagen','daniel',3250,'now'),
 ('cancelendduring','endEvent','Abgesagt; kein Skillgewinn','app',3250,'now'),
 ('report','task','Daniel: Bericht und Ergebnis einreichen','daniel',3550,'now'),
 ('confirm','task','Matthew: Erklärung lesen, Checkbox und Teilnahme bestätigen','trainee',3550,'now'),
 ('received','exclusiveGateway','Bestätigung gespeichert?','app',3550,'now'),
 ('waiting','task','Fall offen halten; auf spätere Antwort warten','app',3850,'wait'),
 ('result','exclusiveGateway','Bericht bestanden?','app',4150,'now'),
 ('failed','task','Daniel: unveränderte Stufe und Nachschulungsbedarf prüfen','daniel',4150,'now'),
 ('retrain','task','[MANUELL] Neuen Nachschulungsfall anlegen','daniel',4450,'manual'),
 ('skill','task','Synthetische Raum-Kompetenz aktualisieren','app',4450,'now'),
 ('history','task','Abschluss und Verlauf zeigen; Historie beim Folgefall','app',4750,'now'),
 ('done','endEvent','Demo-Fall abgeschlossen','app',4970,'now'),
]
centres={'daniel':300,'app':900,'trainee':1500}
geom={}
for nid,typ,label,lane,y,status in nodes:
 w,h=(260,100) if typ=='task' else (60,60) if typ=='exclusiveGateway' else (40,40)
 geom[nid]=(centres[lane]-w/2,y-h/2,w,h)
# Explicit orthogonal routing avoids crossing task bodies. Cross-lane flows use the row corridor.
flows=[]
def f(a,b,label='',via=None): flows.append((a,b,label,via))
f('start','access');f('access','authorized');f('authorized','request','Ja',[(900,600),(300,600)])
f('authorized','credentials','Nein');f('credentials','recoverable');f('recoverable','access','Ja',[(1770,700),(1770,300)])
f('recoverable','newroom','Nein');f('request','offers');f('offers','invite');f('invite','invitation_open');f('invitation_open','response_merge','Antwort abwarten',[(1200,1200),(1200,1100)]);f('response_merge','response');f('invitation_open','cancel_merge','Absagen',[(500,1200),(500,1950)]);f('invitation_open','reschedule','Neue Angebote',[(900,1320),(300,1320)])
f('response','accept','Annehmen',[(1750,1250),(1750,1750)])
f('response','reject','Ablehnen');f('reject','remaining');f('remaining','response_merge','Ja',[(900,1550),(1780,1550),(1780,1100)])
f('remaining','reschedule','Nein: alle abgelehnt');f('reschedule','invite','Annahme zurückgesetzt',[(70,1450),(70,1120),(900,1120)])
f('accept','confirmed');f('confirmed','before');f('before','cancel_merge','Ja');f('cancel_merge','cancelbefore');f('cancelbefore','cancelendbefore')
f('before','timing','Nein',[(70,1750),(70,2220),(900,2220)])
f('timing','early','Vorzeitig');f('early','begin');f('timing','scheduled','Zum Termin');f('scheduled','begin');f('begin','training','',[(300,2820),(900,2820)])
f('training','during');f('during','cancelduring','Ja');f('cancelduring','cancelendduring')
f('during','report','Nein',[(70,2950),(70,3550)])
f('report','confirmation_merge','',[(300,3350),(1500,3350)]);f('confirmation_merge','confirm')
f('confirm','received');f('received','waiting','Noch nicht');f('waiting','confirmation_merge','Spätere Antwort',[(1200,3850),(1200,3450)])
f('received','result','Ja',[(650,3550),(650,4020),(900,4020)])
f('result','skill','Ja');f('skill','history');f('history','done');f('result','failed','Nein');f('failed','retrain')
f('retrain','request','Neuer Zyklus',[(35,4450),(35,700)])
# Additional rescheduling before training, even after one acceptance.
f('before','reschedule','Neue Angebote',[(300,1580)])
def endpoint(nid,point):
 x,y,w,h=geom[nid];cx=x+w/2;cy=y+h/2;px,py=point
 if abs(px-cx)>abs(py-cy): return (x+w if px>cx else x,cy)
 return (cx,y+h if py>cy else y)
def route(a,b,via):
 xa,ya,wa,ha=geom[a];xb,yb,wb,hb=geom[b]; ca=(xa+wa/2,ya+ha/2);cb=(xb+wb/2,yb+hb/2)
 mids=via or []
 if not mids and ca[0]!=cb[0] and ca[1]!=cb[1]: mids=[(ca[0],cb[1])]
 return [endpoint(a,mids[0] if mids else cb)]+mids+[endpoint(b,mids[-1] if mids else ca)]
defs=E.Element(q('definitions'),{'id':'Definitions_WholeTraining','targetNamespace':'https://example.invalid/cosanum/demo-day','exporter':'Cosanum synthetic communication model','exporterVersion':'2'})
proc=sub(defs,q('process'),id='Process_WholeTraining',name='Ein Trainingsfall mit Ausnahmewegen',isExecutable='false')
doc=sub(proc,q('documentation'));doc.text='Nicht ausführbares Kommunikationsmodell der synthetischen Site. Zielniveau Mitarbeiter 1–3. Keine verbundenen Google-Kalender, automatischen Mails, Push oder produktiven Matrixschreibvorgänge. Geplante Erinnerung ist nur Annotation und steuert keinen Tokenfluss.'
lanes=sub(proc,q('laneSet'),id='LaneSet_Responsibilities')
for lane,name in [('daniel','Daniel · Process & Quality'),('app','Anwendung · synthetischer Raum'),('trainee','Matthew · Teilnehmer')]:
 ln=sub(lanes,q('lane'),id='Lane_'+lane,name=name)
 for nid,typ,label,l,y,status in nodes:
  if l==lane: sub(ln,q('flowNodeRef')).text=nid
for nid,typ,label,lane,y,status in nodes:
 el=sub(proc,q(typ),id=nid,name=label)
 sub(el,q('documentation')).text={'now':'IMPLEMENTIERT in lokaler Site-Quelle; Hosting-/Geräteabnahme separat.','manual':'MANUELLER Schritt, keine automatische Funktion.','wait':'OFFENER Zustand; kein automatischer Fristlauf.'}[status]
 for j,(a,b,label2,via) in enumerate(flows):
  if b==nid: sub(el,q('incoming')).text=f'Flow_{j}'
 for j,(a,b,label2,via) in enumerate(flows):
  if a==nid: sub(el,q('outgoing')).text=f'Flow_{j}'
for j,(a,b,label,via) in enumerate(flows): sub(proc,q('sequenceFlow'),id=f'Flow_{j}',sourceRef=a,targetRef=b,name=label)
annotations=[('reminder','[GEPLANT] Automatische Erinnerung / Eskalation bei fehlender Bestätigung. Heute nur In-App-Hinweise.',1320,3800,400,150,'waiting'),('mail','[MANUELL] Mailentwurf öffnen und selbst senden. Kein automatischer Mailversand / Push.',1260,2140,480,140,'confirmed'),('calendar','Synthetisch: gemeinsame freie Fenster der nächsten fünf Arbeitstage. Keine Google-Kalenderbuchung.',50,60,480,160,'offers')]
for aid,text,x,y,w,h,target in annotations:
 an=sub(proc,q('textAnnotation'),id=aid);sub(an,q('text')).text=text
 sub(proc,q('association'),id='Assoc_'+aid,sourceRef=target,targetRef=aid,associationDirection='None')
diagram=sub(defs,'{'+D+'}BPMNDiagram',id='Diagram_WholeTraining',name='Gesamtablauf')
plane=sub(diagram,'{'+D+'}BPMNPlane',id='Plane_WholeTraining',bpmnElement='Process_WholeTraining')
for lane,name in [('daniel','Daniel · Process & Quality'),('app','Anwendung · synthetischer Raum'),('trainee','Matthew · Teilnehmer')]:
 shape=sub(plane,'{'+D+'}BPMNShape',id='Shape_Lane_'+lane,bpmnElement='Lane_'+lane,isHorizontal='false')
 sub(shape,'{'+C+'}Bounds',x=str(centres[lane]-300),y='0',width='600',height='5100')
for nid,typ,label,lane,y,status in nodes:
 sh=sub(plane,'{'+D+'}BPMNShape',id='Shape_'+nid,bpmnElement=nid)
 x,yy,w,h=geom[nid];sub(sh,'{'+C+'}Bounds',x=str(x),y=str(yy),width=str(w),height=str(h))
 if typ!='task':
  lab=sub(sh,'{'+D+'}BPMNLabel');sub(lab,'{'+C+'}Bounds',x=str(x-90),y=str(yy+h+5),width='240',height='45')
for j,(a,b,label,via) in enumerate(flows):
 edge=sub(plane,'{'+D+'}BPMNEdge',id=f'Edge_{j}',bpmnElement=f'Flow_{j}')
 for x,y in route(a,b,via): sub(edge,'{'+I+'}waypoint',x=str(x),y=str(y))
for aid,text,x,y,w,h,target in annotations:
 sh=sub(plane,'{'+D+'}BPMNShape',id='Shape_'+aid,bpmnElement=aid);sub(sh,'{'+C+'}Bounds',x=str(x),y=str(y),width=str(w),height=str(h))
 edge=sub(plane,'{'+D+'}BPMNEdge',id='Edge_Assoc_'+aid,bpmnElement='Assoc_'+aid)
 x1,y1,w1,h1=geom[target]
 association_points=[(x1+w1,y1+h1/2),(x,y+h/2)] if aid!='calendar' else [(x1+w1,y1+h1/2),(550,y1+h1/2),(550,y+h/2),(x+w,y+h/2)]
 for px,py in association_points: sub(edge,'{'+I+'}waypoint',x=str(px),y=str(py))
E.indent(defs);E.ElementTree(defs).write(OUT/'training-demo.bpmn',encoding='utf-8',xml_declaration=True)
# Readable SVG generated from the same geometry and graph, including all branch labels.
svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="5250" viewBox="0 0 1800 5250"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#6a566e"/></marker></defs><style>text{font-family:Arial,sans-serif;fill:#322333}.title{font-size:28px;font-weight:bold}.label{font-size:19px}.edge{font-size:16px;paint-order:stroke;stroke:#faf8fb;stroke-width:6px;stroke-linejoin:round}</style><rect width="1800" height="5250" fill="#faf8fb"/><text x="25" y="38" class="title">Ein Trainingsfall · Entscheidungen und Wiederanlauf</text><text x="25" y="70" class="label">Synthetische Demo · nicht ausführbares Kommunikationsmodell · 29.10.2026</text><g transform="translate(0,110)">']
for lane,name in [('daniel','Daniel · Process &amp; Quality'),('app','Anwendung · synthetischer Raum'),('trainee','Matthew · Teilnehmer')]:
 x=centres[lane]-300;svg.append(f'<rect x="{x}" y="0" width="600" height="5100" fill="none" stroke="#cdbed1"/><text x="{x+120}" y="35" class="label" font-weight="bold">{name}</text>')
for j,(a,b,label,via) in enumerate(flows):
 points=route(a,b,via);d='M '+' L '.join(f'{x},{y}' for x,y in points)
 svg.append(f'<path d="{d}" fill="none" stroke="#6a566e" stroke-width="2" marker-end="url(#arrow)"/>')
 if label:
  # Longest segment gives the label room without covering its endpoint task.
  p0,p1=max(zip(points,points[1:]),key=lambda pair:abs(pair[0][0]-pair[1][0])+abs(pair[0][1]-pair[1][1]))
  horizontal=p0[1]==p1[1];lx=(p0[0]+p1[0])/2+(0 if horizontal else 12);ly=(p0[1]+p1[1])/2-10
  svg.append(f'<text x="{lx}" y="{ly}" class="edge" text-anchor="{ "middle" if horizontal else "end" if lx>1600 else "start" }">{escape(label)}</text>')
def text_lines(text,maxlen):
 lines=[];line=''
 for word in text.split():
  if len(line+' '+word)>maxlen: lines.append(line);line=word
  else: line=(line+' '+word).strip()
 if line:lines.append(line)
 return lines
for nid,typ,label,lane,y,status in nodes:
 x,yy,w,h=geom[nid];fill={'now':'#eee4f2','manual':'#fff0db','wait':'#e3ecf8'}[status]
 if typ=='task': svg.append(f'<rect x="{x}" y="{yy}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="#664c6b" stroke-width="2"/>')
 elif typ=='exclusiveGateway':
  svg.append(f'<path d="M{x+w/2},{yy} L{x+w},{yy+h/2} L{x+w/2},{yy+h} L{x},{yy+h/2} Z" fill="white" stroke="#664c6b" stroke-width="2"/><path d="M{x+22},{yy+22} L{x+38},{yy+38} M{x+38},{yy+22} L{x+22},{yy+38}" stroke="#664c6b" stroke-width="2"/>')
 else: svg.append(f'<circle cx="{x+w/2}" cy="{yy+h/2}" r="20" fill="white" stroke="#664c6b" stroke-width="{4 if typ=="endEvent" else 2}"/>')
 lines=text_lines(label,26 if typ=='task' else 28)
 ty=yy+24 if typ=='task' else yy+h+26
 for k,line in enumerate(lines): svg.append(f'<text x="{x+12 if typ=="task" else x-85}" y="{ty+23*k}" class="label">{escape(line)}</text>')
for aid,text,x,y,w,h,target in annotations:
 color='#ffe2df' if aid=='reminder' else '#fff0db'
 svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{color}" stroke="#a44339" stroke-dasharray="7 5"/>')
 for k,line in enumerate(text_lines(text,40)):svg.append(f'<text x="{x+12}" y="{y+28+23*k}" class="label">{escape(line)}</text>')
svg.append('</g><text x="25" y="5230" class="label">Lila = implementiert · Orange = manuell · Blau = offen · Koralle gestrichelt = geplant. Kein produktiver Datenaustausch.</text></svg>')
(OUT/'process-flow.svg').write_text('\n'.join(svg))
print('Generated unified primary BPMN/SVG and retained scenario appendix')
