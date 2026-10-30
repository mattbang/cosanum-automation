// Standalone test-build links select a local synthetic case; they confer no identity or authority.
export function participantCaseFromLink(url: string): string | null {
  const match = /^cosanum-training-demo:\/\/participant\/(CASE-[A-Z0-9-]+)$/.exec(url);
  return match?.[1] || null;
}

export function participantDemoLink(caseId: string): string {
  if (!/^CASE-[A-Z0-9-]+$/.test(caseId)) throw new Error('Unknown synthetic case ID format');
  return `cosanum-training-demo://participant/${caseId}`;
}
