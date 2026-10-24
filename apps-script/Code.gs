function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('Cosanum Demo Hub [DEMO]');
}

function getCatalogue() {
  var tables = readDemoTables_();
  return catalogueView_(tables.Topics, tables.People);
}
