export const MATERIAL_EDITS_TAB = 'MaterialEdits_v1';
export const MATERIAL_PUBLISHED_TAB = 'MaterialRegister_v1';
export const MATERIAL_FIELDS = ['material_id', 'topic_id', 'title', 'revision', 'material_type', 'language', 'owner', 'status', 'effective_date', 'file_ref'];
export const MATERIAL_PUBLISHED_FIELDS = MATERIAL_FIELDS.concat(['batch_id', 'published_by', 'published_at']);
export const MATERIAL_MAX_ROWS = 1001; // Header plus 1,000 records.
export const MATERIAL_TYPES = ['guide', 'slides', 'checklist', 'video'];
export const MATERIAL_LANGUAGES = ['de', 'en', 'fr', 'it'];
export const MATERIAL_STATUSES = ['draft', 'approved', 'withdrawn'];

export function registerIssue(row, field, message) {
  const column = MATERIAL_PUBLISHED_FIELDS.indexOf(field);
  return { row: row, field: field, cell: column < 0 || !row ? '' : String.fromCharCode(65 + column) + row, message: message };
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isDriveId(value) {
  return /^[A-Za-z0-9_-]{10,128}$/.test(value);
}

export function parseRegisterRows(grid, topicIds, published) {
  const tab = published ? MATERIAL_PUBLISHED_TAB : MATERIAL_EDITS_TAB;
  const fields = published ? MATERIAL_PUBLISHED_FIELDS : MATERIAL_FIELDS;
  const values = grid.values;
  const errors = (grid.errors || []).slice();
  const rows = [];
  if (grid.sheet !== tab || !Array.isArray(values) || !values.length || values.length > MATERIAL_MAX_ROWS) {
    errors.push(registerIssue(0, 'sheet', 'Expected ' + tab + ' with 1 to ' + MATERIAL_MAX_ROWS + ' rows.'));
    return { rows: rows, errors: errors };
  }
  if (!Array.isArray(values[0]) || values[0].length !== fields.length) {
    errors.push(registerIssue(1, 'header', 'Expected exactly ' + fields.length + ' columns.'));
    return { rows: rows, errors: errors };
  }
  fields.forEach(function (field, i) {
    if (values[0][i] !== field) errors.push(registerIssue(1, field, 'Expected header ' + field + '.'));
  });
  if (errors.some(function (error) { return error.row <= 1; })) return { rows: rows, errors: errors };
  values.slice(1).forEach(function (cells, i) {
    const number = i + 2;
    if (!Array.isArray(cells) || cells.length > fields.length) {
      errors.push(registerIssue(number, 'row', 'Unexpected data beyond the register columns.'));
      return;
    }
    if (cells.every(function (value) { return value === null || value === ''; })) return;
    const record = {};
    fields.forEach(function (field, j) {
      const raw = cells[j];
      const value = raw == null ? '' : (typeof raw === 'string' ? raw.trim() : null);
      const optional = ['material_type', 'language', 'owner'].indexOf(field) >= 0;
      if (errors.some(error => error.row === number && error.field === field)) {
        record[field] = value;
        return;
      }
      if (value === null || (!value && !optional) || /^=|[\u0000-\u001f\u007f]/.test(value || '') || value.length > 160) {
        errors.push(registerIssue(number, field, optional ? 'Use plain text or leave blank.' : 'Enter a plain text value.'));
      } else if (published && raw != null && raw !== value) {
        errors.push(registerIssue(number, field, 'Published values must use canonical text.'));
      }
      record[field] = value;
    });
    const rules = {
      material_id: [/^MAT-[A-Z0-9-]{1,30}$/.test(record.material_id), 'Use a stable MAT- identifier in uppercase.'],
      topic_id: [topicIds.indexOf(record.topic_id) >= 0, 'Topic ID is not in the catalogue.'],
      revision: [/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(record.revision || ''), 'Use a text revision such as 02 or r2.'],
      material_type: [!record.material_type || MATERIAL_TYPES.indexOf(record.material_type) >= 0, 'Use ' + MATERIAL_TYPES.join(', ') + ' or leave blank.'],
      language: [!record.language || MATERIAL_LANGUAGES.indexOf(record.language) >= 0, 'Use ' + MATERIAL_LANGUAGES.join(', ') + ' or leave blank.'],
      status: [(published ? ['approved', 'withdrawn'] : MATERIAL_STATUSES).indexOf(record.status) >= 0, published ? 'Only approved and withdrawn rows can be published.' : 'Use draft, approved or withdrawn.'],
      effective_date: [isIsoDate(record.effective_date), 'Use a valid date in YYYY-MM-DD format.'],
      file_ref: [/^demo:[A-Z0-9-]{1,40}$/.test(record.file_ref) || isDriveId(record.file_ref), 'Use a file ID, without a URL.']
    };
    if (published) {
      rules.batch_id = [/^[0-9a-f]{64}$/.test(record.batch_id), 'Expected the reviewed batch ID.'];
      rules.published_at = [/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.published_at) &&
        !isNaN(Date.parse(record.published_at)) && new Date(record.published_at).toISOString() === record.published_at, 'Expected a UTC publication timestamp.'];
    }
    Object.keys(rules).forEach(function (field) {
      if (!rules[field][0] && !errors.some(function (error) { return error.row === number && error.field === field; })) {
        errors.push(registerIssue(number, field, rules[field][1]));
      }
    });
    rows.push({ number: number, record: record });
  });
  return { rows: rows, errors: errors };
}

function sameFields(left, right, fields) {
  return fields.every(function (field) { return left[field] === right[field]; });
}

export function assessMaterialChange(events, record) {
  const prior = events.filter(function (item) { return item.material_id === record.material_id; });
  const sameRevision = prior.filter(function (item) { return item.revision === record.revision; });
  const sameStatus = sameRevision.find(function (item) { return item.status === record.status; });
  if (sameStatus && sameFields(sameStatus, record, MATERIAL_FIELDS)) return { action: 'unchanged' };
  if (record.status === 'draft') return { action: 'draft' };
  if (sameStatus) return { field: 'revision', message: 'This published revision and status are immutable.' };
  if (record.status === 'withdrawn') {
    const original = sameRevision.find(function (item) { return item.status === 'approved'; });
    if (!original) return { field: 'revision', message: 'Withdraw an existing approved revision.' };
    const changed = MATERIAL_FIELDS.find(function (field) {
      return field !== 'status' && field !== 'effective_date' && original[field] !== record[field];
    });
    if (changed) return { field: changed, message: 'A withdrawal must retain the approved revision’s details.' };
    if (record.effective_date < original.effective_date) return { field: 'effective_date', message: 'Withdrawal cannot precede approval.' };
    return { action: 'withdrawal' };
  }
  if (prior.some(function (item) { return item.status === 'approved' && item.effective_date > record.effective_date; })) {
    return { field: 'effective_date', message: 'A new revision cannot precede an already approved revision.' };
  }
  if (prior.some(function (item) { return item.status === 'approved' && item.file_ref === record.file_ref; })) {
    return { field: 'file_ref', message: 'Use a revision-specific file to preserve earlier references.' };
  }
  return { action: prior.length ? 'revision' : 'addition' };
}

export function readPublishedRegister(grid, topicIds) {
  const result = parseRegisterRows(grid, topicIds, true);
  const events = [];
  if (!result.errors.length) {
    result.rows.forEach(function (row) {
      const change = assessMaterialChange(events, row.record);
      if (change.field || change.action === 'unchanged') {
        result.errors.push(registerIssue(row.number, change.field || 'revision', change.message || 'Duplicate published entry.'));
      } else {
        events.push(row.record);
      }
    });
  }
  return { events: result.errors.length ? [] : events, errors: result.errors };
}

export function findMaterialRevision(events, materialId, revision) {
  return events.find(function (item) {
    return item.material_id === materialId && item.revision === revision && item.status === 'approved';
  }) || null;
}

export function projectMaterialCatalogue(events, today, resolveFile) {
  if (!isIsoDate(today)) throw new Error('Expected a valid catalogue date.');
  const approvals = new Map();
  const withdrawals = new Set();
  events.forEach(function (item) {
    if (item.effective_date > today) return;
    if (item.status === 'withdrawn') {
      withdrawals.add(item.material_id + '@' + item.revision);
    } else {
      const previous = approvals.get(item.material_id);
      if (!previous || item.effective_date >= previous.effective_date) approvals.set(item.material_id, item);
    }
  });
  return Array.from(approvals.values()).map(function (item) {
    const withdrawn = withdrawals.has(item.material_id + '@' + item.revision);
    const file = withdrawn ? null : resolveFile(item.file_ref);
    return {
      topicId: item.topic_id, materialId: item.material_id, revision: item.revision, title: item.title,
      state: withdrawn ? 'withdrawn' : file ? 'approved' : 'unavailable',
      url: file ? file.url || '' : ''
    };
  });
}
