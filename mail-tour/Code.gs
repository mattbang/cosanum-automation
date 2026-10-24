/* Public, synthetic mail tour. Deploy as its own Apps Script project. */
var MAIL_TOUR_BUSY_ = {
  hcm4:[[10,14],[9,13],[11,15],[10,16],[13]],
  pq:[[9,15],[11,14],[10],[13,16],[9,14]],
  lead:[[11,16],[10,14],[9,15],[13],[9,16]],
  ma1:[[9,15],[11,14],[10],[13,16],[9,14]],
  ma2:[[11,16],[10,15],[9,13],[14],[10]],
  ma3:[[13],[9,14],[10,16],[11,15],[9,13]]
};
var MAIL_TOUR_ROLE_ = {
  hcm4:'HCM4', pq:'Process & Quality', lead:'Gruppenleitung',
  ma1:'Mitarbeiter 1', ma2:'Mitarbeiter 2', ma3:'Mitarbeiter 3'
};
var MAIL_TOUR_HOURS_ = [9,10,11,13,14,15,16];
var MAIL_TOUR_LIMIT_ = 5;
var MAIL_TOUR_TTL_ = 1200;

function doGet(e) {
  var token = e && e.parameter && e.parameter.token || '';
  var page = HtmlService.createTemplateFromFile('Index');
  page.token = /^[a-f0-9]{64}$/.test(token) ? token : '';
  return page.evaluate().setTitle('Schulungsdemo · E-Mail-Rundgang');
}

function requestTour(input) {
  try { return requestTourCore_(input, mailTourServices_()); }
  catch (error) { return {ok:false, message:mailTourPublicError_(error)}; }
}

function confirmTour(token) {
  try { return confirmTourCore_(token, mailTourServices_()); }
  catch (error) { return {ok:false, message:mailTourPublicError_(error)}; }
}

function mailTourServices_() {
  return {
    now:function(){ return new Date(); },
    lock:LockService.getScriptLock(),
    properties:PropertiesService.getScriptProperties(),
    cache:CacheService.getScriptCache(),
    quota:function(){ return MailApp.getRemainingDailyQuota(); },
    send:function(message){ MailApp.sendEmail(message); },
    url:function(){ return ScriptApp.getService().getUrl(); },
    uuid:function(){ return Utilities.getUuid().replace(/-/g,''); },
    digest:function(value){
      return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8)
        .map(function(byte){ return ('0'+(byte&255).toString(16)).slice(-2); }).join('');
    }
  };
}

function mailTourPublicError_(error) {
  var message = String(error && error.message || '');
  return /^(Bitte |Dieser |Für |Die |Der |Zu viele |Heute |Versand )/.test(message)
    ? message : 'Der Versand ist gerade nicht verfügbar. Bitte später erneut versuchen.';
}

function mailTourInput_(input, now) {
  if (!input || typeof input !== 'object') throw new Error('Bitte Angaben ergänzen.');
  var email = String(input.email || '').trim();
  if (email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email) || /\.\.|^\.|\.@|@\./.test(email)) {
    throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
  }
  var mode = input.mode;
  var trainer = input.trainer;
  var participants = input.participants;
  if (mode !== 'group' && mode !== 'individual') throw new Error('Bitte den Schulungsmodus wählen.');
  if (!['hcm4','pq','lead'].includes(trainer)) throw new Error('Bitte eine schulende Rolle wählen.');
  if (!Array.isArray(participants) || participants.length < 1 || participants.length > 3 ||
      participants.some(function(value){ return !['ma1','ma2','ma3'].includes(value); }) ||
      new Set(participants).size !== participants.length) throw new Error('Bitte teilnehmende Rollen wählen.');
  if (mode === 'individual' && participants.length !== 1) throw new Error('Für Einzeltraining genau eine Person wählen.');
  if (mode === 'group' && participants.length > 1 && trainer === 'hcm4') throw new Error('Für diese Gruppenschulung Process & Quality oder Gruppenleitung wählen.');
  var day = Number(input.day), hour = Number(input.hour);
  if (!Number.isInteger(day) || day < 0 || day > 4 || !MAIL_TOUR_HOURS_.includes(hour)) throw new Error('Bitte einen Beispieltermin wählen.');
  var people = [trainer].concat(participants);
  if (people.some(function(role){ return MAIL_TOUR_BUSY_[role][day].includes(hour); })) throw new Error('Dieser Beispieltermin ist für eine ausgewählte Rolle belegt.');
  var monday = mailTourNextMonday_(now);
  var date = new Date(monday.getTime()+day*86400000);
  var dateText = Utilities.formatDate(date,'UTC','dd.MM.yyyy');
  return {email:email, mode:mode, trainer:trainer, participants:participants.slice(), day:day, hour:hour, date:dateText};
}

function mailTourNextMonday_(now) {
  var parts = Utilities.formatDate(now,'Europe/Zurich','yyyy-MM-dd').split('-').map(Number);
  var today = new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));
  today.setUTCDate(today.getUTCDate()+7-((today.getUTCDay()+6)%7));
  return today;
}

function mailTourDayKey_(now) { return Utilities.formatDate(now,'Europe/Zurich','yyyyMMdd'); }
function mailTourToken_(services) { return services.uuid()+services.uuid(); }
function mailTourCleanup_(props, today, now) {
  if (props.getProperty('cleanup.day') === today) return;
  var cutoff = mailTourDayKey_(new Date(now.getTime()-30*86400000));
  var all = props.getProperties();
  Object.keys(all).forEach(function(key){
    var day = /^(?:address|total)\.(\d{8})\./.exec(key);
    if (!day) day = /^total\.(\d{8})$/.exec(key);
    if (!day && key.indexOf('receipt.') === 0) {
      try { day = {1:JSON.parse(all[key]).day}; } catch (error) { day = null; }
    }
    if (day && day[1] < cutoff) props.deleteProperty(key);
  });
  props.setProperty('cleanup.day',today);
}

function requestTourCore_(input, services) {
  var now = services.now(), model = mailTourInput_(input,now);
  var count = mailTourMessages_(model).length;
  var url = services.url();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url || '')) throw new Error('Versand ist noch nicht eingerichtet.');
  if (services.quota() < count+1) throw new Error('Heute ist nicht genug E-Mail-Kontingent frei.');
  var token = mailTourToken_(services), hash = services.digest(token);
  var day = mailTourDayKey_(now), addressKey = 'address.'+day+'.'+services.digest(model.email.toLowerCase());
  var totalKey = 'total.'+day, receiptKey = 'receipt.'+hash;
  services.lock.waitLock(10000);
  try {
    var props = services.properties;
    mailTourCleanup_(props,day,now);
    if (props.getProperty(addressKey)) throw new Error('Für diese Adresse wurde heute bereits ein Rundgang angefordert.');
    var total = Number(props.getProperty(totalKey)||0);
    if (total >= MAIL_TOUR_LIMIT_) throw new Error('Zu viele Demo-Anfragen heute. Bitte morgen erneut versuchen.');
    props.setProperty(addressKey,'reserved');
    props.setProperty(totalKey,String(total+1));
    props.setProperty(receiptKey,JSON.stringify({status:'verification_reserved',count:0,day:day}));
    services.cache.put('token.'+hash,JSON.stringify(model),MAIL_TOUR_TTL_);
  } finally { services.lock.releaseLock(); }
  var link = url+'?token='+token;
  try {
    services.send({to:model.email,subject:'[DEMO] E-Mail-Rundgang bestätigen',body:
      'Sie haben einen synthetischen Schulungsrundgang angefordert.\n\n'+
      'Bestätigen Sie Ihre Adresse über diesen Link und drücken Sie dort die Schaltfläche für den Versand:\n'+link+'\n\n'+
      'Der Link gilt 20 Minuten und löst beim bloßen Öffnen keinen Versand aus. Wenn Sie die Anfrage nicht gestellt haben, ignorieren Sie diese Nachricht.\n\n'+
      '[DEMO] Keine echte Schulung, kein echter Kalendereintrag und kein Teilnahmebeleg.'});
    services.properties.setProperty(receiptKey,JSON.stringify({status:'verification_submitted',count:0,day:day}));
    return {ok:true,message:'Bestätigungs-E-Mail angefordert. Prüfen Sie Ihr Postfach und öffnen Sie den Link.'};
  } catch (error) {
    services.properties.setProperty(receiptKey,JSON.stringify({status:'verification_unknown',count:0,day:day}));
    return {ok:false,message:'Versand der Bestätigung unklar. Bitte später prüfen; heute nicht erneut anfordern.'};
  }
}

function confirmTourCore_(token, services) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Dieser Bestätigungslink ist ungültig.');
  var hash = services.digest(token), key = 'receipt.'+hash, model, receipt;
  services.lock.waitLock(10000);
  try {
    var raw = services.cache.get('token.'+hash);
    if (!raw) throw new Error('Dieser Bestätigungslink ist abgelaufen oder bereits benutzt.');
    receipt = JSON.parse(services.properties.getProperty(key)||'null');
    if (!receipt || receipt.status !== 'verification_submitted') throw new Error('Dieser Bestätigungslink kann nicht verwendet werden.');
    model = JSON.parse(raw);
    if (services.quota() < mailTourMessages_(model).length) throw new Error('Heute ist nicht genug E-Mail-Kontingent frei.');
    services.properties.setProperty(key,JSON.stringify({status:'sending_unknown',count:0,day:receipt.day}));
    services.cache.remove('token.'+hash);
  } finally { services.lock.releaseLock(); }
  var messages = mailTourMessages_(model);
  for (var i=0;i<messages.length;i++) {
    try {
      services.send({to:model.email,subject:messages[i].subject,body:messages[i].body});
      services.properties.setProperty(key,JSON.stringify({status:'sending_unknown',count:i+1,day:receipt.day}));
    } catch (error) {
      return {ok:false,message:'Versand nach '+i+' von '+messages.length+' Nachrichten unklar. Der Link bleibt gesperrt; bitte keine erneute Anfrage starten.'};
    }
  }
  services.properties.setProperty(key,JSON.stringify({status:'submitted',count:messages.length,day:receipt.day}));
  return {ok:true,message:messages.length+' Demo-Nachrichten wurden an MailApp übergeben. Die Zustellung im Postfach kann verzögert sein.'};
}

function mailTourMessages_(model) {
  var trainer = MAIL_TOUR_ROLE_[model.trainer];
  var participants = model.participants.map(function(id){return MAIL_TOUR_ROLE_[id];});
  var when = model.date+' · '+('0'+model.hour).slice(-2)+':00–'+('0'+(model.hour+1)).slice(-2)+':00 (Europe/Zurich)';
  var rows = [
    ['Process & Quality','Schulungsbedarf erfasst','Ein Demo-Bedarf für '+participants.join(', ')+' wurde erfasst.'],
    ['CCS','Planungsüberblick','Ein Beispieltermin für '+participants.length+' teilnehmende Person(en) wird geplant.'],
    [trainer,'Schulung übernehmen','Beispieltermin: '+when+'.']
  ];
  participants.forEach(function(role){rows.push([role,'Einladung zur Schulung','Beispieltermin: '+when+'. Es wurde kein Kalendereintrag erstellt.']);});
  rows.push([trainer,'Trainerbericht ausfüllen','Das Demo-Ergebnis wird für jede Person getrennt betrachtet: '+participants.join(', ')+'.']);
  participants.forEach(function(role){rows.push([role,'Teilnahme bestätigen','In dieser Simulation liegt ein bestandener Trainerbericht vor. Dies ist keine echte Teilnahmebestätigung.']);});
  rows.push(['Process & Quality','Nachweise und Ergebnis prüfen','Für jede Person wären Trainerbericht, eigene Bestätigung, beide Archive und Skillstufe zu prüfen. Diese Simulation erzeugt keine Nachweise.']);
  return rows.map(function(row,index){return {
    subject:'[DEMO]['+row[0]+']['+(index+1)+'/'+rows.length+'] '+row[1],
    body:'An: '+row[0]+' (simulierte Rolle)\nSchritt '+(index+1)+' von '+rows.length+'\n\n'+row[2]+
      '\n\n[DEMO] Synthetischer Test. Keine echte Schulung, kein Kalendereintrag und kein Teilnahmebeleg. Bitte antworten Sie nicht mit persönlichen Schulungsdaten.'
  };});
}
