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
