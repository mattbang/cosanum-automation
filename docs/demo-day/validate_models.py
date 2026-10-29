#!/usr/bin/env python3
from pathlib import Path
import xml.etree.ElementTree as E
ROOT=Path(__file__).resolve().parents[2]; OUT=ROOT/'shared-demo-site/public/presentation'
B='{http://www.omg.org/spec/BPMN/20100524/MODEL}'; D='{http://www.omg.org/spec/BPMN/20100524/DI}'; C='{http://www.omg.org/spec/DD/20100524/DC}'; I='{http://www.omg.org/spec/DD/20100524/DI}'
p=OUT/'training-demo.bpmn'; root=E.parse(p).getroot(); ids=[x.attrib['id'] for x in root.iter() if 'id' in x.attrib]; assert len(ids)==len(set(ids)), 'duplicate IDs'
for el in root.iter():
 for key in ('sourceRef','targetRef','bpmnElement','attachedToRef'):
  if key in el.attrib: assert el.attrib[key] in ids,(key,el.attrib[key])
for proc in root.findall(B+'process'):
 nodes=[x for x in proc if x.tag in (B+'startEvent',B+'endEvent',B+'task',B+'exclusiveGateway')]; flows=proc.findall(B+'sequenceFlow')
 adjacency={n.attrib['id']:[] for n in nodes}
 for flow in flows: adjacency[flow.attrib['sourceRef']].append(flow.attrib['targetRef'])
 visited=set(); pending=[n.attrib['id'] for n in nodes if n.tag==B+'startEvent']
 while pending:
  cur=pending.pop()
  if cur in visited:continue
  visited.add(cur);pending.extend(adjacency[cur])
 assert len(visited)==len(nodes),'unreachable process node'
 # Every reachable state has at least one path to a terminal outcome, including loops.
 terminals={n.attrib['id'] for n in nodes if n.tag==B+'endEvent'}
 for origin in adjacency:
  seen=set();pending=[origin]
  while pending:
   cur=pending.pop()
   if cur in seen:continue
   seen.add(cur);pending.extend(adjacency[cur])
  assert seen & terminals,('no terminal route',origin)
 lane_refs=[n.text for n in proc.iter(B+'flowNodeRef')]
 if lane_refs: assert set(lane_refs)==set(adjacency) and len(lane_refs)==len(adjacency),'lane coverage'
for shape in root.iter(D+'BPMNShape'):
 if shape.attrib['bpmnElement'].startswith('Lane_') or shape.attrib['bpmnElement'] in ('reminder','mail','calendar'): continue
 b=shape.find(C+'Bounds'); assert b is not None
 x,y,w,h=[float(b.attrib[k]) for k in ('x','y','width','height')]
 assert w>0 and h>0 and (x+w/2)%5==0 and (y+h/2)%5==0,'5/5 centre alignment'
for el in root.iter():
 if el.tag in (B+'incoming',B+'outgoing',B+'flowNodeRef'): assert el.text in ids,('text reference',el.text)
node_ids={n.attrib['id'] for proc in root.findall(B+'process') for n in proc if n.tag in (B+'task',B+'exclusiveGateway',B+'startEvent',B+'endEvent')}
boxes={}
for shape in root.iter(D+'BPMNShape'):
 if shape.attrib['bpmnElement'] in node_ids | {'reminder','mail','calendar'}:
  bounds=shape.find(C+'Bounds'); boxes[shape.attrib['bpmnElement']]=tuple(float(bounds.attrib[k]) for k in ('x','y','width','height'))
flow_refs={f.attrib['id']:(f.attrib['sourceRef'],f.attrib['targetRef']) for f in root.iter(B+'sequenceFlow')}
for edge in root.iter(D+'BPMNEdge'):
 points=edge.findall(I+'waypoint'); assert len(points)>=2
 if edge.attrib['bpmnElement'] not in flow_refs:continue
 pts=[(float(p.attrib['x']),float(p.attrib['y'])) for p in points]
 for a,b in zip(pts,pts[1:]):
  assert a[0]==b[0] or a[1]==b[1],('nonorthogonal',edge.attrib['id'])
  for name,(x,y,w,h) in boxes.items():
   if name in flow_refs[edge.attrib['bpmnElement']]:continue
   cross=(a[1]==b[1] and y<a[1]<y+h and max(a[0],b[0])>x and min(a[0],b[0])<x+w) or (a[0]==b[0] and x<a[0]<x+w and max(a[1],b[1])>y and min(a[1],b[1])<y+h)
   assert not cross,('flow crosses unrelated node',edge.attrib['id'],name)
for name in ('process-flow.svg','source-flow.svg','scenario-appendix.svg'):
 svg=E.parse(OUT/name).getroot(); assert svg.tag=='{http://www.w3.org/2000/svg}svg'; assert svg.attrib.get('viewBox')
# Official schemas already present in read-only simulation repository; never copy private inputs.
schema=Path('/Users/Matt/Documents/Programming Projects/Cosanum Simulation/tools/bpmn_schema/BPMN20.xsd')
try:
 from lxml import etree
 etree.XMLSchema(etree.parse(str(schema))).assertValid(etree.parse(str(p)))
 print('PASS: official OMG XSD, unique IDs/references, connected lifecycle, reachability, terminal routes and lane coverage, BPMNDI, 5/5 centres, SVG XML')
except ImportError:
 import subprocess
 subprocess.run(['xmllint','--noout','--schema',str(schema),str(p)],check=True)
 print('PASS: official OMG XSD via xmllint, IDs/references, connected lifecycle, reachability, terminal routes and lane coverage, BPMNDI, 5/5 centres, SVG XML')
