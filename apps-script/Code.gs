function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('Schulungsbedarf [DEMO]');
}

function getCatalogue() {
  var tables = readDemoTables_();
  return catalogueView_(tables.Topics, tables.People);
}
