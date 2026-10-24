(function () {
  'use strict';
  // This file is injected before the real Apps Script client. It never contacts Google.
  const people = [
    { key: 'P01', alias: 'Alex (synthetisch)', role: 'Teilnehmende Person' },
    { key: 'P02', alias: 'Sam (synthetisch)', role: 'Teilnehmende Person' },
    { key: 'P03', alias: 'Robin (synthetisch)', role: 'Schulende Person' },
    { key: 'P04', alias: 'Kim (synthetisch)', role: 'Teilnehmende Person' }
  ];
  const topics = [
    { id: 'TC_R030', name: 'Beispielprozess A (synthetisch)', progression: true, configuredTarget: null, theory: true, practice: true, theoryMinutes: 60, practiceMinutes: 180 },
    { id: 'TC_R027', name: 'Beispielprozess B (synthetisch)', progression: true, configuredTarget: null, theory: true, practice: false, theoryMinutes: 60, practiceMinutes: 0 },
    { id: 'TC_R033', name: 'Beispielprozess C (synthetisch)', progression: false, configuredTarget: 2, theory: true, practice: true, theoryMinutes: 60, practiceMinutes: 180 },
    { id: 'TC_R052', name: 'Beispielprozess D (synthetisch)', progression: true, configuredTarget: null, theory: true, practice: true, theoryMinutes: 60, practiceMinutes: 180 },
    { id: 'TC_R077', name: 'Beispielprozess E (synthetisch)', progression: false, configuredTarget: 1, theory: true, practice: false, theoryMinutes: 60, practiceMinutes: 0 }
  ];
  function phase(requestId, phaseName, booked, completed, declined) {
    return { phase: phaseName, sessionId: `${requestId}-${phaseName === 'theory' ? 'T' : 'P'}`,
      rsvp: booked ? declined ? 'declined' : 'accepted' : '',
      attendance: completed ? 'attended' : '', result: completed ? 'passed' : '',
      trainerResponseId: completed ? 'SAMPLE-TRAINER' : '', acknowledgementResponseId: completed ? 'SAMPLE-ACK' : '',
      eventUrl: '', trainerResponseUrl: '', acknowledgementUrl: '' };
  }
  function personCase(requestId, person, state, reasonCode, phaseNames, booked) {
    const completed = state === 'complete';
    return { caseId: `${requestId}-${person.key}`, personKey: person.key, personAlias: person.alias,
      state, reasonCode: reasonCode || '', reason: state === 'open' ? 'Synthetische Absage prüfen.' : state === 'waiting' ? booked ? 'Bestätigung und Nachweis stehen aus.' : 'Termin noch nicht gebucht.' : '',
      nextAction: state === 'open' ? 'Ersatztermin für diese Person prüfen.' : state === 'waiting' ? booked ? 'Belege prüfen.' : 'Freien Termin prüfen.' : 'Keiner',
      previousLevel: 1, targetLevel: 2, phases: phaseNames.map(name => phase(requestId, name, booked, completed, reasonCode === 'declined')),
      proofId: completed ? 'SAMPLE-PROOF' : '', archiveStatus: completed ? 'archived_verified' : '', archiveVerifiedAt: completed ? 'SAMPLE-TIME' : '',
      skillStatus: completed ? 'applied' : '', skillKey: '', docUrl: '', pdfUrl: '', archiveReceiptUrl: '', skillUrl: '' };
  }
  const requests = [
    { requestId: 'SAMPLE-GROUP', topicId: topics[0].id, topicName: topics[0].name, mode: 'group', createdAt: '2026-01-03T10:00:00Z', state: 'complete', plannedSessions: 2, bookedSessions: 2, sheetUrl: '', completionNoticeState: 'sample', cases: [personCase('SAMPLE-GROUP', people[0], 'complete', '', ['theory', 'practice'], true), personCase('SAMPLE-GROUP', people[1], 'complete', '', ['theory', 'practice'], true)] },
    { requestId: 'SAMPLE-INDIVIDUAL', topicId: topics[2].id, topicName: topics[2].name, mode: 'individual', createdAt: '2026-01-02T10:00:00Z', state: 'waiting', plannedSessions: 2, bookedSessions: 0, sheetUrl: '', cases: [personCase('SAMPLE-INDIVIDUAL', people[3], 'waiting', '', ['theory', 'practice'], false)] },
    { requestId: 'SAMPLE-EXCEPTION', topicId: topics[1].id, topicName: topics[1].name, mode: 'group', createdAt: '2026-01-04T10:00:00Z', state: 'open', plannedSessions: 1, bookedSessions: 1, sheetUrl: '', cases: [personCase('SAMPLE-EXCEPTION', people[0], 'open', 'declined', ['theory'], true), personCase('SAMPLE-EXCEPTION', people[1], 'waiting', '', ['theory'], true)] }
  ];
  const plans = Object.fromEntries(requests.map(request => {
    const topic = topics.find(row => row.id === request.topicId);
    const phases = ['theory', ...(topic.practice ? ['practice'] : [])].map((name, index) => ({
      sessionId: `${request.requestId}-${name === 'theory' ? 'T' : 'P'}`, phase: name, order: index + 1,
      mode: request.mode, personKeys: request.cases.map(row => row.personKey), caseIds: request.cases.map(row => row.caseId),
      durationMinutes: name === 'theory' ? 60 : 180, trainerKey: request.mode === 'group' ? 'MATT' : 'P03',
      theorySessionId: name === 'practice' ? `${request.requestId}-T` : '',
      eventId: request.bookedSessions ? `SAMPLE-EVENT-${name}` : '', eventUrl: ''
    }));
    return [request.requestId, { requestId: request.requestId, mode: request.mode, phases }];
  }));
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function notice(message) {
    const host = document.getElementById('offlinePreviewNotice');
    if (host) { host.textContent = message; host.hidden = false; }
  }
  const reads = Object.freeze({
    getIntakeData: () => ({ marker: '[SYNTHETIC OFFLINE]', topics, people }),
    getCatalogue: () => ({ marker: '[SYNTHETIC OFFLINE]', topics, people }),
    getAuditDashboard: () => requests,
    getSavedPhasePlan: id => plans[id] || null,
    getPhasePlanPreview: () => { throw new Error('Offline preview has no planning simulation for new requests.'); },
    getDemoFeedbackForRequest: input => ({ requestId: input.requestId, rows: [] }),
    getTrainerAssessmentQueue: () => [],
    getParticipantAcknowledgementQueue: () => [],
    getAcknowledgementFollowUpQueue: () => [],
    getIndividualProofQueue: () => [],
    getOfflineRsvpPreview: () => ({ rows: requests.flatMap(request => request.cases.flatMap(row => row.phases
      .filter(item => item.rsvp)
      .map(item => ({ caseId: row.caseId, personKey: row.personKey, personAlias: row.personAlias,
        sessionId: item.sessionId, phase: item.phase,
        startUtc: request.requestId === 'SAMPLE-EXCEPTION' ? '2027-01-12T09:00:00Z' : '2026-01-10T09:00:00Z',
        responseStatus: item.rsvp, flag: item.rsvp === 'declined' ? 'declined' : '' })))),
      errors: [], checkedAt: 'synthetic preview' }),
    checkDemoCalendarAccess: () => ({ calendars: [{ key: 'SAMPLE', alias: 'Synthetic calendar', ok: false, error: 'Offline preview' }] }),
    getSlotProposals: () => ({ calendars: [], proposals: [], reason: 'Offline preview cannot read calendars.' }),
    getIntakePreview: input => ({ topicId: input.topicId, topicName: (topics.find(t => t.id === input.topicId) || {}).name || '', targetLevel: input.targetLevel,
      rows: input.personKeys.map(key => ({ personKey: key, personAlias: (people.find(p => p.key === key) || {}).alias || key, currentLevel: '1', targetLevel: input.targetLevel, allowed: false, reason: 'Offline sample only; eligibility must be checked against the real demo matrix.', sheetUrl: '' })), allAllowed: false })
  });
  const run = new Proxy({}, {
    get(_target, name) {
      if (name === 'withSuccessHandler') return callback => chain(callback, null);
      if (name === 'withFailureHandler') return callback => chain(null, callback);
      return undefined;
    }
  });
  function chain(success, failure) {
    return new Proxy({}, { get(_target, name) {
      if (name === 'withSuccessHandler') return callback => chain(callback, failure);
      if (name === 'withFailureHandler') return callback => chain(success, callback);
      return (...args) => queueMicrotask(() => {
        try {
          if (!Object.hasOwn(reads, name)) throw new Error(`Offline read-only preview blocked ${String(name)}. No changes were made.`);
          const result = clone(reads[name](...args));
          if (success) success(result);
        } catch (error) {
          notice(error.message);
          if (failure) failure(error);
        }
      });
    } });
  }
  Object.defineProperty(window, 'google', { value: Object.freeze({ script: Object.freeze({ run }) }), writable: false, configurable: false });
  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (link) { event.preventDefault(); notice('Offline preview blocked link navigation. No external pages or files are opened.'); }
  }, true);
})();
