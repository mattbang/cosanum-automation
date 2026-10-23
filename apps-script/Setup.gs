/** Idempotent initial setup. PrivateFixture.gs is local and ignored by Git. */
function setupDemo() {
  var fixture = getPrivateFixture_();
  validateFixture_(fixture);
  var folder = findDemoFolder_() || DriveApp.createFolder(DEMO_SCHEMA.folderName);
  var files = folder.getFilesByName(DEMO_SCHEMA.spreadsheetName);
  var matches = [];
  while (files.hasNext()) {
    var file = files.next();
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) matches.push(file);
  }
  if (matches.length > 1) throw new Error('Mehrere Demo-Sheets gefunden; keine Änderung vorgenommen.');
  var spreadsheet;
  if (matches.length) {
    spreadsheet = SpreadsheetApp.openById(matches[0].getId());
    migrateDemoSchemaV1ToV2_(spreadsheet);
    migrateDemoSchemaV2ToV3_(spreadsheet, fixture);
    migrateDemoSchemaV3ToV4_(spreadsheet);
    migrateDemoSchemaV4ToV5_(spreadsheet);
    migrateDemoSchemaV5ToV6_(spreadsheet);
  } else {
    spreadsheet = SpreadsheetApp.create(DEMO_SCHEMA.spreadsheetName);
    DriveApp.getFileById(spreadsheet.getId()).moveTo(folder);
  }
  Object.keys(DEMO_SCHEMA.sheets).forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
    var headers = DEMO_SCHEMA.sheets[name];
    if (sheet.getLastRow() === 0) {
      writeFixtureSheet_(sheet, headers, fixture[name] || []);
    } else {
      var actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
      assertHeaders_(actual, headers, name);
    }
  });
  var defaultSheet = spreadsheet.getSheetByName('Sheet1') || spreadsheet.getSheetByName('Tabelle1');
  if (defaultSheet && Object.keys(DEMO_SCHEMA.sheets).indexOf(defaultSheet.getName()) < 0 && defaultSheet.getLastRow() === 0) {
    spreadsheet.deleteSheet(defaultSheet);
  }
  return { folderId: folder.getId(), spreadsheetId: spreadsheet.getId(), schemaVersion: DEMO_SCHEMA.version };
}

/** An empty RSVP tab is created by setupDemo; existing case and booking rows stay intact. */
function migrateDemoSchemaV5ToV6_(spreadsheet) {
  var rsvps = spreadsheet.getSheetByName('SessionRsvps');
  if (!rsvps || rsvps.getLastRow() === 0) return;
  var headers = DEMO_SCHEMA.sheets.SessionRsvps;
  assertHeaders_(rsvps.getRange(1, 1, 1, headers.length).getValues()[0], headers, 'SessionRsvps');
}

/** Add Calendar receipt columns without replacing or changing existing sessions. */
function migrateDemoSchemaV4ToV5_(spreadsheet) {
  var sessions = spreadsheet.getSheetByName('Sessions');
  if (!sessions || sessions.getLastRow() === 0) return;
  var headers = DEMO_SCHEMA.sheets.Sessions;
  var existing = sessions.getRange(1, 1, 1, headers.length).getValues()[0];
  if (existing[11] === 'calendar_event_id') {
    assertHeaders_(existing, headers, 'Sessions');
    return;
  }
  assertHeaders_(existing.slice(0, 11), headers.slice(0, 11), 'Sessions');
  if (existing.slice(11).some(function (cell) { return cell !== ''; })) throw new Error('Sessions!L:O ist belegt; Migration abgebrochen.');
  sessions.getRange(1, 12, 1, 4).setValues([headers.slice(11)]);
  sessions.getRange(1, 12, 1, 4).setBackground('#1d3854').setFontColor('#ffffff').setFontWeight('bold');
  sessions.autoResizeColumns(12, 4);
}

/** Add the request mode in H; setupDemo creates the two empty phase tabs. */
function migrateDemoSchemaV3ToV4_(spreadsheet) {
  var requests = spreadsheet.getSheetByName('Requests');
  if (!requests || requests.getLastRow() === 0) return;
  var header = requests.getRange(1, 1, 1, 8).getValues()[0];
  if (header[7] === 'mode') return;
  assertHeaders_(header.slice(0, 7), DEMO_SCHEMA.sheets.Requests.slice(0, 7), 'Requests');
  if (header[7] !== '') throw new Error('Requests!H ist belegt; Migration abgebrochen.');
  requests.getRange(1, 8).setValue('mode');
  requests.getRange(1, 8).setBackground('#1d3854').setFontColor('#ffffff').setFontWeight('bold');
  requests.autoResizeColumn(8);
}

function validateFixture_(fixture) {
  if (fixture.Topics.length !== 5 || fixture.People.length !== 4 || fixture.Skills.length !== 20) {
    throw new Error('Private Fixture muss 5 Themen, 4 Personen und 20 Skill-Einträge enthalten.');
  }
  var ids = ['TC_R030', 'TC_R027', 'TC_R033', 'TC_R052', 'TC_R077'];
  if (fixture.Topics.some(function (row, i) { return row[0] !== ids[i]; })) throw new Error('Falsche Themen-IDs.');
  ['Topics', 'People', 'Skills'].forEach(function (name) {
    var width = DEMO_SCHEMA.sheets[name].length;
    var markerIndex = name === 'Topics' ? 9 : name === 'People' ? 3 : 4;
    if (fixture[name].some(function (row) { return row.length !== width || row[markerIndex] !== '[DEMO]'; })) {
      throw new Error('Ungültige Fixture-Zeile in ' + name);
    }
  });
  if (fixture.Topics.some(function (row, i) { return i < 2 ? row[10] !== '' : row[10] !== 1; })) {
    throw new Error('Explizite Zielstufen in der Fixture fehlen.');
  }
  if (fixture.People.some(function (row) { return !/^PER-0[1-5]$/.test(row[4]) || typeof row[5] !== 'string' || !row[5].trim(); })) {
    throw new Error('Persona-Aliasse in der privaten Fixture fehlen.');
  }
}

/** Preserve every existing row and skill correction when upgrading the demo Sheet. */
function migrateDemoSchemaV1ToV2_(spreadsheet) {
  var topics = spreadsheet.getSheetByName('Topics');
  if (!topics || topics.getLastRow() === 0) return;
  var oldHeaders = DEMO_SCHEMA.sheets.Topics.slice(0, 10);
  var header = topics.getRange(1, 1, 1, 11).getValues()[0];
  if (header[10] === 'configured_target_level') return;
  assertHeaders_(header.slice(0, 10), oldHeaders, 'Topics');
  if (header[10] !== '') throw new Error('Topics!K ist belegt; Migration abgebrochen.');
  var values = topics.getRange(2, 1, topics.getLastRow() - 1, 1).getValues();
  var ids = ['TC_R030', 'TC_R027', 'TC_R033', 'TC_R052', 'TC_R077'];
  if (values.length !== 5 || values.some(function (row, i) { return row[0] !== ids[i]; })) {
    throw new Error('Unerwartete Themenzeilen; Migration abgebrochen.');
  }
  topics.getRange(1, 11).setValue('configured_target_level');
  topics.getRange(2, 11, 5, 1).setValues([[''], [''], [1], [1], [1]]);
  topics.getRange(1, 11).setBackground('#1d3854').setFontColor('#ffffff').setFontWeight('bold');
  topics.autoResizeColumn(11);
}

/** Append persona metadata from the ignored fixture; never replace account or skill rows. */
function migrateDemoSchemaV2ToV3_(spreadsheet, fixture) {
  var people = spreadsheet.getSheetByName('People');
  if (!people || people.getLastRow() === 0) return;
  var header = people.getRange(1, 1, 1, 6).getValues()[0];
  if (header[4] === 'persona_id' && header[5] === 'display_alias') return;
  assertHeaders_(header.slice(0, 4), DEMO_SCHEMA.sheets.People.slice(0, 4), 'People');
  if (header[4] !== '' || header[5] !== '') throw new Error('People!E:F ist belegt; Migration abgebrochen.');
  var existing = people.getRange(2, 1, people.getLastRow() - 1, 1).getValues();
  if (existing.length !== 4 || existing.some(function (row, i) { return row[0] !== fixture.People[i][0]; })) {
    throw new Error('Unerwartete Personenzeilen; Alias-Migration abgebrochen.');
  }
  people.getRange(1, 5, 1, 2).setValues([['persona_id', 'display_alias']]);
  people.getRange(2, 5, 4, 2).setValues(fixture.People.map(function (row) { return [row[4], row[5]]; }));
  people.getRange(1, 5, 1, 2).setBackground('#1d3854').setFontColor('#ffffff').setFontWeight('bold');
  people.autoResizeColumns(5, 2);
}

function writeFixtureSheet_(sheet, headers, rows) {
  sheet.clear();
  sheet.getRange(1, 1, rows.length + 1, headers.length).setValues([headers].concat(rows));
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setBackground('#1d3854').setFontColor('#ffffff').setFontWeight('bold');
  sheet.autoResizeColumns(1, headers.length);
}

/** Explicit reset for disposable synthetic data; never called by setupDemo. */
function resetDemoFixture() {
  var fixture = getPrivateFixture_();
  validateFixture_(fixture);
  var spreadsheet = findDemoSpreadsheet_();
  ['Topics', 'People', 'Skills'].forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) throw new Error('Fehlendes Tabellenblatt: ' + name);
    writeFixtureSheet_(sheet, DEMO_SCHEMA.sheets[name], fixture[name]);
  });
  return { spreadsheetId: spreadsheet.getId(), reset: true };
}
