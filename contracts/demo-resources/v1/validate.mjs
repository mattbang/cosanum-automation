#!/usr/bin/env node
/**
 * Validation script for contracts/demo-resources/v1
 * Checks parse, unique IDs, foreign keys, 12 complete matrix cells,
 * 0..3 baseline levels, 4 material links, synthetic flags, and absence of email keys/addresses.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, '..', '..', '..', 'shared-demo-site', 'public');

function loadJson(relPath) {
  const fullPath = join(__dirname, relPath);
  try {
    const raw = readFileSync(fullPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`FAIL: Failed to read or parse ${relPath}: ${err.message}`);
    process.exit(1);
  }
}

const people = loadJson('people.json');
const topics = loadJson('topics.json');
const skills = loadJson('skills.json');
const materials = loadJson('materials.json');

const errors = [];

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

// 1. Synthetic flag check & No Email keys or addresses check across all datasets
const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
function checkNoEmailAndSynthetic(dataset, name) {
  assert(Array.isArray(dataset), `${name} must be an array`);
  if (!Array.isArray(dataset)) return;

  for (let i = 0; i < dataset.length; i++) {
    const item = dataset[i];
    assert(item.synthetic === true, `${name}[${i}] must have "synthetic: true"`);

    function inspect(obj, path) {
      if (!obj || typeof obj !== 'object') return;
      for (const [key, value] of Object.entries(obj)) {
        const curPath = `${path}.${key}`;
        if (/email|e_mail|mail_address/i.test(key)) {
          errors.push(`Forbidden email key found in ${name}: "${curPath}"`);
        }
        if (typeof value === 'string') {
          if (value.includes('@') || emailRegex.test(value)) {
            errors.push(`Forbidden email address found in ${name}: "${curPath}" = "${value}"`);
          }
        } else if (typeof value === 'object') {
          inspect(value, curPath);
        }
      }
    }
    inspect(item, `${name}[${i}]`);
  }
}

checkNoEmailAndSynthetic(people, 'people.json');
checkNoEmailAndSynthetic(topics, 'topics.json');
checkNoEmailAndSynthetic(skills, 'skills.json');
checkNoEmailAndSynthetic(materials, 'materials.json');

// 2. Unique IDs & structure
// People
const personIds = new Set();
const expectedPeople = new Map([
  ['EMP-001', ['Matthew', 'Mitarbeiter 1']],
  ['EMP-002', ['Annina', 'Mitarbeiter 2']],
  ['EMP-003', ['Marko', 'Mitarbeiter 3']],
  ['EMP-004', ['Daniel', 'Process & Quality']],
]);
for (const p of people) {
  assert(typeof p.employee_id === 'string' && p.employee_id.length > 0, `Invalid employee_id in people.json: ${JSON.stringify(p)}`);
  assert(!personIds.has(p.employee_id), `Duplicate employee_id in people.json: ${p.employee_id}`);
  const expected = expectedPeople.get(p.employee_id);
  assert(Boolean(expected) && p.name === expected[0] && p.role === expected[1], `Unexpected v1 person identity or role: ${p.employee_id}`);
  personIds.add(p.employee_id);
}
assert(personIds.size === 4, `Expected exactly 4 people, found ${personIds.size}`);

// Topics
const topicIds = new Set();
const topicNames = new Map();
for (const t of topics) {
  assert(typeof t.topic_id === 'string' && t.topic_id.length > 0, `Invalid topic_id in topics.json: ${JSON.stringify(t)}`);
  assert(!topicIds.has(t.topic_id), `Duplicate topic_id in topics.json: ${t.topic_id}`);
  topicIds.add(t.topic_id);
  topicNames.set(t.topic_id, t.topic);
  assert(t.duration_minutes === 60, `Topic ${t.topic_id} must have 60-minute synthetic duration`);
  assert(t.version === 'DEMO-1', `Topic ${t.topic_id} must have version DEMO-1`);
}
assert(topicIds.size === 4, `Expected exactly 4 topics, found ${topicIds.size}`);

// Materials
const materialIds = new Set();
const materialTopicIds = new Set();
for (const m of materials) {
  assert(typeof m.material_id === 'string' && m.material_id.length > 0, `Invalid material_id in materials.json: ${JSON.stringify(m)}`);
  assert(!materialIds.has(m.material_id), `Duplicate material_id in materials.json: ${m.material_id}`);
  materialIds.add(m.material_id);

  // Foreign key to topic
  assert(topicIds.has(m.topic_id), `Foreign key error: material ${m.material_id} references unknown topic_id "${m.topic_id}"`);
  assert(m.topic === topicNames.get(m.topic_id), `Material ${m.material_id} topic label differs from ${m.topic_id}`);
  assert(!materialTopicIds.has(m.topic_id), `Duplicate material link for topic_id ${m.topic_id}`);
  materialTopicIds.add(m.topic_id);

  // Reading time vs 60m session
  assert(typeof m.reading_minutes === 'number' && m.reading_minutes > 0, `material ${m.material_id} must have reading_minutes`);
  assert(m.reading_minutes !== 60, `Lesson reading time (${m.reading_minutes}m) must be distinct from 60m session window`);
  for (const key of ['lesson_path', 'preparation_path']) {
    const path = m[key];
    assert(typeof path === 'string' && /^materials\/[a-z0-9-]+\.html$/.test(path), `${key} must be a safe relative materials HTML path: ${path}`);
    if (typeof path === 'string' && /^materials\/[a-z0-9-]+\.html$/.test(path)) {
      assert(existsSync(join(publicDir, path)), `${key} does not exist in the Site public folder: ${path}`);
    }
  }
}
assert(materialIds.size === 4, `Expected exactly 4 materials linked to TR-1..4, found ${materialIds.size}`);
for (const tid of ['TR-1', 'TR-2', 'TR-3', 'TR-4']) {
  assert(materialTopicIds.has(tid), `Missing material link for topic ${tid}`);
}

// 3. Matrix & Foreign Keys
// 12 complete cells: EMP-001..003 x TR-1..4
const skillCells = new Set();
const participantSkillCounts = new Map();

for (const s of skills) {
  // Foreign keys
  assert(personIds.has(s.employee_id), `Foreign key error: skill references unknown employee_id "${s.employee_id}"`);
  assert(topicIds.has(s.topic_id), `Foreign key error: skill references unknown topic_id "${s.topic_id}"`);
  assert(s.topic === topicNames.get(s.topic_id), `Skill ${s.employee_id}:${s.topic_id} topic label differs from its topic_id`);

  // EMP-004 Daniel must have NO skill rows in this baseline
  assert(s.employee_id !== 'EMP-004', 'Daniel (EMP-004) must not have skill rows in this baseline');

  const cellKey = `${s.employee_id}:${s.topic_id}`;
  assert(!skillCells.has(cellKey), `Duplicate skill matrix cell: ${cellKey}`);
  skillCells.add(cellKey);

  // Level range 0..3
  assert(Number.isInteger(s.level) && s.level >= 0 && s.level <= 3, `Skill level must be integer between 0 and 3, got: ${s.level} for ${cellKey}`);
  assert(typeof s.status === 'string' && s.status.length > 0, `Missing status for ${cellKey}`);

  participantSkillCounts.set(s.employee_id, (participantSkillCounts.get(s.employee_id) || 0) + 1);
}

assert(skills.length === 12, `Expected exactly 12 matrix cells, found ${skills.length}`);
for (const pid of ['EMP-001', 'EMP-002', 'EMP-003']) {
  assert(participantSkillCounts.get(pid) === 4, `Participant ${pid} must have exactly 4 topic cells`);
  for (const tid of ['TR-1', 'TR-2', 'TR-3', 'TR-4']) {
    assert(skillCells.has(`${pid}:${tid}`), `Missing cell for ${pid}:${tid}`);
  }
}
assert(!participantSkillCounts.has('EMP-004'), 'EMP-004 Daniel must have 0 skill cells');

if (errors.length > 0) {
  console.error(`Validation failed with ${errors.length} error(s):`);
  for (const err of errors) {
    console.error(` - ${err}`);
  }
  process.exit(1);
}

console.log('✓ Validation successful:');
console.log(`  - people.json: ${people.length} synthetic people (EMP-001..004, no email addresses)`);
console.log(`  - topics.json: ${topics.length} topics (TR-1..4, DEMO-1, 60m session window)`);
console.log(`  - skills.json: ${skills.length} cells (12 participant-topic cells, 0..3 levels, Daniel excluded)`);
console.log(`  - materials.json: ${materials.length} micro-lessons (8/10m reading times, relative paths)`);
console.log('  - All foreign keys, unique IDs, and synthetic flags verified.');
process.exit(0);
