/**
 * Versioned German email copy for the synthetic training prototype.
 * These templates render plain text only. FormDispatch, FollowUp and Audit
 * choose recipients and delivery times; loading this file sends no email.
 * See docs/NOTIFICATION_TEMPLATES.md for the event and delivery contract.
 */
var DEMO_EMAIL_TEMPLATES = Object.freeze({
  version: 3,
  messages: Object.freeze({
    trainer_assessment_request: {
      audience: 'trainer',
      subject: '[DEMO] Beurteilung erfassen: {{topic_name}} · {{request_id}}',
      body: 'Guten Tag {{trainer_name}}\n\n' +
        'Dies ist ein technischer Demo-Test. Es hat keine reale Schulung stattgefunden.\n\n' +
        'Bitte erfassen Sie für {{person_name}} die Anwesenheit und das Ergebnis ' +
        'der Schulung vom {{training_date}}. Verwenden Sie dazu Ihren Link:\n\n' +
        '{{trainer_form_url}}\n\n' +
        'Melden Sie sich mit dem Google-Konto an, das als schulende Person zugewiesen ist. ' +
        'Wenn die Person abwesend war oder noch nicht beurteilt werden kann, wählen Sie den passenden Status und ergänzen Sie den nächsten Schritt.\n\n' +
        'Auftrag: {{request_id}} · Termin: {{session_id}} [DEMO]'
    },
    acknowledgement_request: {
      audience: 'participant',
      subject: '[DEMO] Bitte Teilnahme an „{{topic_name}}“ bestätigen',
      body: 'Guten Tag {{recipient_name}}\n\n' +
        'Dies ist ein technischer Demo-Test. Es hat keine reale Schulung stattgefunden; bitte bestätigen Sie keine tatsächliche Teilnahme.\n\n' +
        'Die schulende Person hat Ihre Teilnahme am Termin vom {{training_date}} erfasst. ' +
        'Bitte bestätigen Sie Ihre Teilnahme über Ihren persönlichen Link:\n\n' +
        '{{acknowledgement_url}}\n\n' +
        'Melden Sie sich mit dem Google-Konto an, das für diese Schulung eingeladen wurde. ' +
        'Wenn Sie nicht teilgenommen haben oder die Angaben nicht stimmen, bestätigen Sie die Teilnahme bitte nicht. ' +
        'Antworten Sie stattdessen auf diese E-Mail.\n\n' +
        'Auftrag: {{request_id}} · Termin: {{session_id}}'
    },
    acknowledgement_reminder_day_2: {
      audience: 'participant',
      subject: '[DEMO] Erinnerung: Teilnahme an „{{topic_name}}“ bestätigen',
      body: 'Guten Tag {{recipient_name}}\n\n' +
        'Dies ist ein technischer Demo-Test. Es hat keine reale Schulung stattgefunden; bitte bestätigen Sie keine tatsächliche Teilnahme.\n\n' +
        'Für die Schulung am {{training_date}} fehlt noch Ihre persönliche Teilnahmebestätigung. ' +
        'Bitte öffnen Sie Ihren Link und prüfen Sie die Angaben:\n\n' +
        '{{acknowledgement_url}}\n\n' +
        'Falls Sie nicht teilgenommen haben oder etwas nicht stimmt, antworten Sie bitte auf diese E-Mail.\n\n' +
        'Auftrag: {{request_id}}'
    },
    acknowledgement_reminder_day_5: {
      audience: 'participant',
      subject: '[DEMO] Zweite Erinnerung: Teilnahmebestätigung für „{{topic_name}}“ offen',
      body: 'Guten Tag {{recipient_name}}\n\n' +
        'Dies ist ein technischer Demo-Test. Es hat keine reale Schulung stattgefunden; bitte bestätigen Sie keine tatsächliche Teilnahme.\n\n' +
        'Ihre Teilnahmebestätigung für die Schulung am {{training_date}} ist weiterhin offen. ' +
        'Bitte reichen Sie sie über Ihren persönlichen Link ein:\n\n' +
        '{{acknowledgement_url}}\n\n' +
        'Ohne Ihre Bestätigung bleibt der Schulungsnachweis offen. ' +
        'Falls Sie nicht bestätigen können, antworten Sie bitte mit dem Grund.\n\n' +
        'Auftrag: {{request_id}}'
    },
    exception_notice: {
      audience: 'administrator',
      subject: '[DEMO] Schulungsauftrag {{request_id}}: Klärung erforderlich',
      body: 'Für „{{topic_name}}“ ist mindestens ein Fall offen. ' +
        'Der Auftrag ist deshalb noch nicht abgeschlossen.\n\n' +
        'Offener Fall: {{person_name}}\n' +
        'Grund: {{exception_reason}}\n' +
        'Nächster Schritt: {{next_action}}\n\n' +
        'Auftrag im Dashboard öffnen:\n{{dashboard_url}}\n\n' +
        'Eine Skillstufe wird für diesen Fall erst aktualisiert, wenn alle erforderlichen Nachweise geprüft sind.'
    },
    completion_notice: {
      audience: 'administrator_and_ccs',
      subject: '[DEMO] Schulungsauftrag {{request_id}} abgeschlossen: {{topic_name}}',
      body: 'Der Schulungsauftrag „{{topic_name}}“ ist abgeschlossen. ' +
        'Für alle {{participant_count}} ausgewählten Personen liegen die Beurteilung, ' +
        'die persönliche Bestätigung und ein geprüfter individueller Nachweis vor. ' +
        'Die vorgesehenen Skillstufen wurden in der Demo-Matrix aktualisiert.\n\n' +
        'Termin: {{training_date}}\n' +
        'Teilnehmende: {{participants_summary}}\n\n' +
        'Abgeschlossenen Auftrag öffnen:\n{{dashboard_url}}'
    }
  })
});

/** Render a template with a flat map of validated display strings. */
function renderDemoEmail_(purpose, fields) {
  var template = DEMO_EMAIL_TEMPLATES.messages[purpose];
  if (!template) throw new Error('Unknown email purpose: ' + purpose);
  if (!fields || typeof fields !== 'object') throw new Error('Email fields are required');

  var placeholders = Object.create(null);
  [template.subject, template.body].forEach(function (part) {
    part.replace(/{{([a-z0-9_]+)}}/g, function (_, key) {
      placeholders[key] = true;
      return '';
    });
  });
  Object.keys(placeholders).forEach(function (key) {
    if (typeof fields[key] !== 'string' || !fields[key].trim()) {
      throw new Error('Missing email field: ' + key);
    }
    if (/[\x00-\x1f\x7f]/.test(fields[key])) {
      throw new Error('Email field must be one line: ' + key);
    }
    if (/_url$/.test(key) && !/^https:\/\/[^\s]+$/i.test(fields[key])) {
      throw new Error('Email link must use HTTPS: ' + key);
    }
  });

  function fill(part) {
    return part.replace(/{{([a-z0-9_]+)}}/g, function (_, key) { return fields[key]; });
  }
  var subject = fill(template.subject);
  if (/[\r\n]/.test(subject)) throw new Error('Email subject must be one line');
  return {
    purpose: purpose,
    templateVersion: DEMO_EMAIL_TEMPLATES.version,
    audience: template.audience,
    subject: subject,
    body: fill(template.body)
  };
}
