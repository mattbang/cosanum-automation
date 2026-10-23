/** Only this file reads the live demo Sheet for the web view. */
function readDemoTables_() {
  var spreadsheet = findDemoSpreadsheet_();
  var tables = {};
  Object.keys(DEMO_SCHEMA.sheets).forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) throw new Error('Fehlendes Tabellenblatt: ' + name);
    var values = sheet.getDataRange().getValues();
    assertHeaders_(values[0], DEMO_SCHEMA.sheets[name], name);
    tables[name] = rowObjects_(values, DEMO_SCHEMA.sheets[name]);
  });
  return tables;
}

function demoSheetLink_(spreadsheet, sheet, row) {
  return spreadsheet.getUrl() + '#gid=' + sheet.getSheetId() + '&range=C' + row;
}

function findDemoFolder_() {
  var folders = DriveApp.getFoldersByName(DEMO_SCHEMA.folderName);
  var root = DriveApp.getRootFolder();
  var matches = [];
  while (folders.hasNext()) {
    var folder = folders.next();
    var parents = folder.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === root.getId()) matches.push(folder);
    }
  }
  if (matches.length > 1) throw new Error('Mehrere Demo-Ordner im Drive-Stamm gefunden.');
  return matches.length ? matches[0] : null;
}

function findDemoSpreadsheet_() {
  var folder = findDemoFolder_();
  if (!folder) throw new Error('Demo-Ordner fehlt. setupDemo() ausführen.');
  var files = folder.getFilesByName(DEMO_SCHEMA.spreadsheetName);
  var matches = [];
  while (files.hasNext()) {
    var file = files.next();
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) matches.push(file);
  }
  if (matches.length !== 1) throw new Error('Erwartet wird genau ein Demo-Sheet im Demo-Ordner.');
  return SpreadsheetApp.openById(matches[0].getId());
}
