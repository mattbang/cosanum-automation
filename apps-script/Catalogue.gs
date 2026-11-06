/** Pure projection: no Google service calls. */
function catalogueView_(topics, people) {
  var expectedIds = ['TC_R030', 'TC_R027', 'TC_R033', 'TC_R052', 'TC_R077'];
  if (topics.length !== expectedIds.length || topics.some(function (topic, i) { return topic.topic_id !== expectedIds[i]; })) {
    throw new Error('Der Demo-Katalog muss genau die fünf festgelegten Themen enthalten.');
  }
  if (people.length !== 4) {
    throw new Error('Der Demo-Katalog muss genau vier Testidentitäten enthalten.');
  }
  return {
    marker: '[DEMO]',
    topics: topics.map(function (topic) {
      return {
        id: String(topic.topic_id),
        name: String(topic.display_name),
        theory: demoFlag_(topic.theory_required),
        practice: demoFlag_(topic.practice_required),
        theoryMinutes: Number(topic.theory_minutes) || 0,
        practiceMinutes: Number(topic.practice_minutes) || 0
      };
    }),
    people: people.map(function (person) {
      return { key: String(person.person_key), alias: String(person.display_alias), role: String(person.demo_role) };
    })
  };
}

function demoFlag_(value) {
  return value === true || String(value).toUpperCase() === 'TRUE' || String(value).toUpperCase() === 'JA';
}

/** Owner view of the existing demo catalogue and attained Sheet levels. */
function ownerResourceView_(tables, spreadsheetUrl) {
  var catalogue = catalogueView_(tables.Topics, tables.People);
  var topics = catalogue.topics.map(function (topic, index) {
    var source = tables.Topics[index];
    return Object.assign({}, topic, {
      sourceMaterial: String(source.source_material || 'Nicht dokumentiert'),
      progression: source.progression_rule === '0→1→2→3',
      configuredTarget: source.progression_rule === '0→1→2→3' ? null : Number(source.configured_target_level)
    });
  });
  var matrix = catalogue.people.map(function (person) {
    return {
      personKey: person.key, personAlias: person.alias, role: person.role,
      levels: topics.map(function (topic) {
        var matches = tables.Skills.filter(function (row) {
          return row.person_key === person.key && row.topic_id === topic.id && row.demo_marker === '[DEMO]';
        });
        if (matches.length !== 1) throw new Error('Demo-Matrixeintrag fehlt oder ist doppelt: ' + person.key + ' / ' + topic.id);
        var raw = matches[0].skill_level;
        var level = raw === '' || raw === null || raw === undefined ? '' : String(raw);
        if (level !== '' && level !== '–' && level !== '-' && (!Number.isInteger(Number(level)) || Number(level) < 0 || Number(level) > 4)) {
          throw new Error('Ungültige Skillstufe in der Demo-Matrix: ' + person.key + ' / ' + topic.id);
        }
        return { topicId: topic.id, level: level };
      })
    };
  });
  return { marker: '[DEMO]', topics: topics, matrix: matrix, sheetUrl: String(spreadsheetUrl || '') };
}
