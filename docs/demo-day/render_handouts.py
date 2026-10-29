#!/usr/bin/env python3
"""Escape-first converter for this package's trusted simple Markdown subset."""
from pathlib import Path
from html import escape
import re
ROOT=Path(__file__).resolve().parents[2]; DOC=ROOT/'docs/demo-day'; OUT=ROOT/'shared-demo-site/public/presentation'
LINKS={'FRICTION_REGISTER_DE.md':'friction.html','SOURCE_REGISTER_DE.md':'sources.html','RUNBOOK_DE.md':'runbook.html','MODEL_NOTES.md':'index.html','NOTIFICATION_CATALOGUE_DE.md':'messages.html'}
def inline(raw):
 # Recognize explicit Markdown tokens while escaping every plain-text fragment.
 pattern=r'(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))'; result=[]
 for part in re.split(pattern,raw):
  if part.startswith('`') and part.endswith('`'):result.append('<code>'+escape(part[1:-1])+'</code>')
  elif part.startswith('**') and part.endswith('**'):result.append('<strong>'+escape(part[2:-2])+'</strong>')
  elif part.startswith('[') and re.fullmatch(r'\[([^\]]+)\]\(([^)]+)\)',part):
   match=re.fullmatch(r'\[([^\]]+)\]\(([^)]+)\)',part);label,url=match.groups();url=LINKS.get(url,url)
   if url.startswith(('javascript:','data:','file:')):result.append(escape(label))
   else:result.append('<a href="'+escape(url,quote=True)+'">'+escape(label)+'</a>')
  else:result.append(escape(part))
 return ''.join(result)
def convert(src):
 lines=src.splitlines();out=[];paragraph=[];table=[];fence=False;code=[]
 def flushpara():
  if paragraph:out.append('<p>'+inline(' '.join(paragraph))+'</p>');paragraph.clear()
 def flushtable():
  if not table:return
  headers=table[0];out.append('<div class="table-scroll"><table><thead><tr>'+''.join('<th scope="col">'+inline(c)+'</th>' for c in headers)+'</tr></thead><tbody>')
  for row in table[2:]:out.append('<tr>'+''.join('<td>'+inline(c)+'</td>' for c in row)+'</tr>')
  out.append('</tbody></table></div>');table.clear()
 for line in lines:
  if line.startswith('```'):
   flushpara();flushtable()
   if fence:out.append('<pre><code>'+escape('\n'.join(code))+'</code></pre>');code=[]
   fence=not fence;continue
  if fence:code.append(line);continue
  if line.startswith('|') and line.rstrip().endswith('|'):
   flushpara();table.append([c.strip() for c in line.strip().strip('|').split('|')]);continue
  flushtable()
  if not line.strip():flushpara();continue
  match=re.match(r'^(#{1,3}) (.+)$',line)
  if match:flushpara();level=len(match[1]);out.append(f'<h{level}>'+inline(match[2])+f'</h{level}>')
  else:paragraph.append(line)
 flushpara();flushtable();return '\n'.join(out)
STYLE='''body{font:18px/1.6 system-ui,-apple-system,sans-serif;color:#38233e;background:#faf8fb;margin:0}main,nav{max-width:1400px;margin:auto;padding:24px}nav{display:flex;gap:20px;flex-wrap:wrap;border-bottom:1px solid #d9cddd}a{color:#70436e}h1{font-size:2rem;line-height:1.25}h2{margin-top:2rem}p{max-width:100ch}table{border-collapse:collapse;width:100%;background:white;font-size:16px;line-height:1.5}th,td{text-align:left;vertical-align:top;padding:14px;border:1px solid #d9cddd}th{background:#eee4f2}tr:nth-child(even){background:#fcfafc}.table-scroll{overflow:auto}code{font-size:.9em;overflow-wrap:anywhere}pre{padding:18px;background:#eee4f2;overflow:auto}.notice{border-left:5px solid #bd695c;padding:16px;background:#fff0db}@media print{nav{display:none}body{font-size:11pt;background:white}main{padding:0}table{font-size:9pt}.table-scroll{overflow:visible}tr{break-inside:avoid}}'''
for source,target in [('RUNBOOK_DE.md','runbook.html'),('FRICTION_REGISTER_DE.md','friction.html'),('SOURCE_REGISTER_DE.md','sources.html'),('NOTIFICATION_CATALOGUE_DE.md','messages.html')]:
 raw=(DOC/source).read_text();title=raw.splitlines()[0].lstrip('# ')
 html='<!doctype html>\n<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'</title><style>'+STYLE+'</style></head><body><nav aria-label="Präsentationsunterlagen"><a href="index.html">Übersicht</a><a href="runbook.html">Vorführplan</a><a href="friction.html">Reibungspunkte</a><a href="sources.html">Quellen</a><a href="messages.html">Nachrichten</a><a href="process-flow.svg">Gesamtprozess</a></nav><main>'+convert(raw)+'</main></body></html>\n'
 (OUT/target).write_text(html)
print('Rendered four escaped, dependency-free HTML handouts')
