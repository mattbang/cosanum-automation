import { readFileSync } from 'node:fs';
import { projectMaterialCatalogue, readPublishedRegister } from './register.mjs';

export const demoPublishedPath = new URL('demo/published-sheet.json', import.meta.url);
export const demoSources = JSON.parse(readFileSync(new URL('demo/sources.json', import.meta.url), 'utf8'));
export const resolveDemoFile = ref => demoSources.files.includes(ref) ? {} : null;

export function readDemoCatalogue() {
  const snapshot = JSON.parse(readFileSync(demoPublishedPath, 'utf8'));
  const read = readPublishedRegister(snapshot, demoSources.topicIds);
  if (read.errors.length) throw new Error('The synthetic published material register is invalid.');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return projectMaterialCatalogue(read.events, today, resolveDemoFile);
}
