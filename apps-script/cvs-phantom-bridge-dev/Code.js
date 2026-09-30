const BRIDGE = {
  HEADER_ROW: 1,
  DATA_START_ROW: 2,
  TIMEZONE: 'Asia/Bangkok',
  NONCE_TTL_SEC: 300,
  IDEMPOTENCY_TTL_SEC: 21600,
  REPORT_CONFIG_SHEET: '__REPORT_CONFIG',
  REPORT_CONFIG_HEADERS: ['account','kind','id','sort','active','data','updatedAt'],
};

function doGet() {
  const p = PropertiesService.getScriptProperties();
  return json_({
    ok: true,
    service: 'cvs-phantom-bridge',
    configured: !!(p.getProperty('SPREADSHEET_ID') && p.getProperty('BRIDGE_SECRET')),
  });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    verifyEnvelope_(body);
    const action = str_(body.action);
    const params = body.params || {};
    const requestId = str_(body.requestId);

    if (isMutation_(action)) {
      if (!requestId || requestId.length > 128) throw new Error('Missing or invalid requestId');
      return json_(runMutation_(action, params, requestId));
    }
    return json_(dispatch_(action, params, requestId));
  } catch (err) {
    return json_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function authorizeDevStaging() {
  // Run once in the Apps Script editor to grant spreadsheet and property scopes.
  const info = getSheets_();
  return {ok:info.ok, sheetCount:info.sheets.length};
}

function setupDevConfig(spreadsheetId, bridgeSecret) {
  if (!spreadsheetId || !bridgeSecret) throw new Error('spreadsheetId and bridgeSecret are required');
  PropertiesService.getScriptProperties().setProperties({
    SPREADSHEET_ID: String(spreadsheetId),
    BRIDGE_SECRET: String(bridgeSecret),
  }, false);
  return { ok: true };
}

function rotateBridgeSecret(bridgeSecret) {
  if (!bridgeSecret) throw new Error('bridgeSecret is required');
  PropertiesService.getScriptProperties().setProperty('BRIDGE_SECRET', String(bridgeSecret));
  return { ok: true };
}

function verifyEnvelope_(body) {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('BRIDGE_SECRET');
  if (!secret) throw new Error('Bridge is not configured');

  const ts = Number(body.ts || 0);
  const nonce = str_(body.nonce);
  const signature = str_(body.signature);
  if (!ts || !nonce || !signature) throw new Error('Missing bridge authentication');
  if (Math.abs(Date.now() - ts) > BRIDGE.NONCE_TTL_SEC * 1000) throw new Error('Expired bridge request');

  const nonceKey = 'nonce_' + digestKey_(nonce);
  const cache = CacheService.getScriptCache();
  if (cache.get(nonceKey)) throw new Error('Replay rejected');

  const canonical = canonicalEnvelope_(body);
  const bytes = Utilities.computeHmacSha256Signature(canonical, secret);
  const expected = Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
  if (!constantTimeEqual_(expected, signature)) throw new Error('Invalid bridge signature');

  cache.put(nonceKey, '1', BRIDGE.NONCE_TTL_SEC);
}

function canonicalEnvelope_(body) {
  return JSON.stringify({
    action: str_(body.action),
    params: body.params || {},
    requestId: str_(body.requestId),
    ts: Number(body.ts || 0),
    nonce: str_(body.nonce),
  });
}

function constantTimeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i % Math.max(1,a.length)) || 0) ^ (b.charCodeAt(i % Math.max(1,b.length)) || 0);
  return diff === 0;
}

function dispatch_(action, p, requestId) {
  switch (action) {
    case 'health': return { ok: true, service: 'bridge', now: new Date().toISOString() };
    case 'getSheets': return getSheets_();
    case 'getPlaces': return getPlaces_(p.sheet);
    case 'markVisited': return markVisited_(p.sheet, p.id);
    case 'resetVisitedAll': return resetVisitedAll_(p.sheet);
    case 'saveNoted': return saveNoted_(p.sheet, p.id, p.noted, p.baseVersion);
    case 'updateRoute': return updateRoute_(p.sheet, p.id, p.route, p.baseVersion);
    case 'updateLocation': return updateLocation_(p.sheet, p.id, p.lat, p.lng, p.baseVersion);
    case 'getReportConfig': return getReportConfig_(p.account);
    case 'getReportConfigMeta': return getReportConfigMeta_(p.account);
    case 'saveReportConfigBulk': return saveReportConfigBulk_(p.items || [], requestId, p.baseVersion);
    default: throw new Error('Unknown action: ' + action);
  }
}

function isMutation_(action) {
  return ['markVisited','resetVisitedAll','saveNoted','updateRoute','updateLocation','saveReportConfigBulk'].indexOf(action) !== -1;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false, error: 'LOCK_TIMEOUT' };
  try { return fn(); } finally { lock.releaseLock(); }
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID is not configured');
  return SpreadsheetApp.openById(id);
}

function getSheets_() {
  const ss = getSpreadsheet_();
  const names = ss.getSheets().filter(s => !s.isSheetHidden()).filter(isUsableSheet_).map(s => s.getName());
  return { ok: true, defaultSheet: names[0] || '', sheets: names };
}

function isUsableSheet_(sheet) {
  try {
    const m = headerMap_(sheet);
    return !!(pick_(m,['list','id']) && pick_(m,['name']) && pick_(m,['location','latlng','lat_lng']) && pick_(m,['visited','visit','done']));
  } catch (_) { return false; }
}

function getPlaces_(sheetName) {
  const sheet = sheet_(sheetName);
  const m = headerMap_(sheet);
  const cId = must_(m,['list','id']);
  const cName = must_(m,['name']);
  const cLoc = must_(m,['location','latlng','lat_lng']);
  const cMaps = pick_(m,['google_maps','googlemaps','google map','maps','map']);
  const cVisited = pick_(m,['visited','visit','done']);
  const cLast = pick_(m,['lastvisiteddate','last_visited_date','visited_date','last_visit_date']);
  const cAccount = pick_(m,['account']);
  const cNumber = pick_(m,['number','branch','branch_number','store_no']);
  const cAccountName = pick_(m,['account_name','accountname','store_name','branch_name']);
  const cNoted = pick_(m,['noted']);
  const cRoute = pick_(m,['route','rount','route_no','route_number','routeno','รูท','เส้นทาง']);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < BRIDGE.DATA_START_ROW) return { ok:true, schemaVersion:3, rev:getRev_(sheet.getName()), total:0, visited:0, remaining:0, places:[] };

  const values = sheet.getRange(BRIDGE.DATA_START_ROW,1,lastRow-BRIDGE.DATA_START_ROW+1,lastCol).getValues();
  const places = [];
  let visitedCount = 0;
  values.forEach(row => {
    const id = str_(row[cId-1]);
    const name = str_(row[cName-1]);
    if (!id || !name) return;
    const ll = parseLatLng_(row[cLoc-1]);
    const visited = cVisited ? visited_(row[cVisited-1]) : false;
    if (visited) visitedCount++;
    places.push({
      id, name,
      lat: ll ? ll.lat : null,
      lng: ll ? ll.lng : null,
      mapsUrl: cMaps ? str_(row[cMaps-1]) : '',
      account: cAccount ? str_(row[cAccount-1]) : '',
      number: cNumber ? str_(row[cNumber-1]) : '',
      account_name: cAccountName ? str_(row[cAccountName-1]) : '',
      noted: cNoted ? str_(row[cNoted-1]) : '',
      notedVersion: digestKey_(cNoted ? str_(row[cNoted-1]) : ''),
      route: cRoute ? str_(row[cRoute-1]) : '',
      routeVersion: digestKey_(cRoute ? str_(row[cRoute-1]) : ''),
      locationVersion: digestKey_(str_(row[cLoc-1])),
      visited,
      lastVisitedDate: cLast ? ymd_(row[cLast-1]) : '',
    });
  });
  return { ok:true, schemaVersion:3, rev:getRev_(sheet.getName()), total:places.length, visited:visitedCount, remaining:places.length-visitedCount, places };
}

function markVisited_(sheetName, id) {
  const s = sheet_(sheetName), m = headerMap_(s);
  const row = rowById_(s, must_(m,['list','id']), id);
  const cVisited = must_(m,['visited','visit','done']);
  const cLast = pick_(m,['lastvisiteddate','last_visited_date','visited_date','last_visit_date']);
  s.getRange(row,cVisited).setValue(1);
  if (cLast) s.getRange(row,cLast).setValue(Utilities.formatDate(new Date(), BRIDGE.TIMEZONE, 'yyyy-MM-dd'));
  const rev = bumpRev_(s.getName());
  return { ok:true, rev, id:String(id), visited:true };
}

function resetVisitedAll_(sheetName) {
  const s = sheet_(sheetName), m = headerMap_(s);
  const cVisited = must_(m,['visited','visit','done']);
  const cLast = pick_(m,['lastvisiteddate','last_visited_date','visited_date','last_visit_date']);
  const n = Math.max(0,s.getLastRow()-BRIDGE.DATA_START_ROW+1);
  if (n) {
    s.getRange(BRIDGE.DATA_START_ROW,cVisited,n,1).setValue(0);
    if (cLast) s.getRange(BRIDGE.DATA_START_ROW,cLast,n,1).clearContent();
  }
  return { ok:true, rev:bumpRev_(s.getName()), reset:n };
}

function saveNoted_(sheetName, id, noted, baseVersion) {
  return setField_(sheetName,id,['noted'],String(noted == null ? '' : noted),'noted',baseVersion);
}

function updateRoute_(sheetName, id, route, baseVersion) {
  return setField_(sheetName,id,['route','rount','route_no','route_number','routeno','รูท','เส้นทาง'],str_(route),'route',baseVersion);
}

function updateLocation_(sheetName, id, latRaw, lngRaw, baseVersion) {
  if (latRaw == null || lngRaw == null) throw new Error('Missing coordinates');
  const lat = Number(latRaw), lng = Number(lngRaw);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) throw new Error('Invalid coordinates');
  return setField_(sheetName,id,['location','latlng','lat_lng'],lat + ',' + lng,'location',baseVersion);
}

function setField_(sheetName,id,aliases,value,field,baseVersion) {
  const s = sheet_(sheetName), m = headerMap_(s);
  const row = rowById_(s,must_(m,['list','id']),id);
  const col = must_(m,aliases);
  const oldValue = str_(s.getRange(row,col).getValue());
  const currentVersion = digestKey_(oldValue);
  if (!baseVersion || String(baseVersion) !== currentVersion) {
    return {ok:false,error:'VERSION_CONFLICT',currentVersion,currentValue:oldValue};
  }
  if (oldValue === str_(value)) {
    return {ok:true,rev:getRev_(s.getName()),id:String(id),field,value,version:currentVersion};
  }
  s.getRange(row,col).setValue(value);
  return {ok:true,rev:bumpRev_(s.getName()),id:String(id),field,value,version:digestKey_(str_(value))};
}

function getReportConfigMeta_(account) {
  const props = PropertiesService.getScriptProperties();
  return { ok:true, account:str_(account), version:Number(props.getProperty('REPORT_CONFIG_REV') || 1) };
}

function getReportConfig_(account) {
  const s = reportSheet_();
  const rows = s.getLastRow() > 1 ? s.getRange(2,1,s.getLastRow()-1,BRIDGE.REPORT_CONFIG_HEADERS.length).getValues() : [];
  const wanted = str_(account).toUpperCase();
  const items = rows.filter(r => str_(r[0]).toUpperCase() === wanted).map(r => ({
    account:str_(r[0]), kind:str_(r[1]), id:str_(r[2]), sort:Number(r[3]||0),
    active: visited_(r[4]), data: parseJson_(r[5]), updatedAt:str_(r[6])
  }));
  return { ok:true, account:str_(account), version:Number(PropertiesService.getScriptProperties().getProperty('REPORT_CONFIG_REV') || 1), items };
}

function saveReportConfigBulk_(items, requestId, baseVersion) {
  if (!Array.isArray(items) || !items.length) throw new Error('items must be a nonempty array');
  const currentVersion = Number(PropertiesService.getScriptProperties().getProperty('REPORT_CONFIG_REV') || 1);
  if (Number(baseVersion) !== currentVersion || !baseVersion) {
    return {ok:false,error:'VERSION_CONFLICT',currentVersion};
  }
  const s = reportSheet_();
  const accounts = {};
  const normalized = items.map(x => {
    const account = str_(x.account), kind = str_(x.kind), id = str_(x.id);
    if (!account || !kind || !id) throw new Error('Invalid config item');
    accounts[account.toUpperCase()] = true;
    return [account, kind, id, Number(x.sort||0), x.active === false ? 0 : 1,
      JSON.stringify(x.data == null ? {} : x.data), new Date().toISOString()];
  });
  const lastRow = s.getLastRow();
  const previous = lastRow > 1 ? s.getRange(2,1,lastRow-1,BRIDGE.REPORT_CONFIG_HEADERS.length).getValues() : [];
  const kept = previous.filter(row => !accounts[str_(row[0]).toUpperCase()]);
  const combined = kept.concat(normalized);
  s.getRange(2,1,combined.length,BRIDGE.REPORT_CONFIG_HEADERS.length).setValues(combined);
  if (lastRow-1 > combined.length) {
    s.getRange(2+combined.length,1,lastRow-1-combined.length,BRIDGE.REPORT_CONFIG_HEADERS.length).clearContent();
  }
  const props = PropertiesService.getScriptProperties();
  const rev = Number(props.getProperty('REPORT_CONFIG_REV') || 1) + 1;
  props.setProperty('REPORT_CONFIG_REV',String(rev));
  return { ok:true, count:normalized.length, version:rev, requestId:str_(requestId) };
}

function reportSheet_() {
  const ss = getSpreadsheet_();
  let s = ss.getSheetByName(BRIDGE.REPORT_CONFIG_SHEET);
  if (!s) {
    s = ss.insertSheet(BRIDGE.REPORT_CONFIG_SHEET);
    s.getRange(1,1,1,BRIDGE.REPORT_CONFIG_HEADERS.length).setValues([BRIDGE.REPORT_CONFIG_HEADERS]);
  }
  return s;
}

function sheet_(name) {
  const ss = getSpreadsheet_();
  const s = ss.getSheetByName(str_(name));
  if (!s || s.isSheetHidden() || !isUsableSheet_(s)) throw new Error('Unknown or unusable sheet');
  return s;
}

function headerMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol) return {};
  const vals = sheet.getRange(BRIDGE.HEADER_ROW,1,1,lastCol).getValues()[0];
  const m = {};
  vals.forEach((v,i) => { const k=norm_(v); if (k && !m[k]) m[k]=i+1; });
  return m;
}

function norm_(v) { return str_(v).toLowerCase().replace(/\u200b/g,'').replace(/\s+/g,'_').replace(/[^\wก-๙_]/g,''); }
function pick_(m,a) { for (let i=0;i<a.length;i++){ const k=norm_(a[i]); if(m[k]) return m[k]; } return 0; }
function must_(m,a) { const c=pick_(m,a); if(!c) throw new Error('Missing required column: '+a.join('/')); return c; }

function rowById_(s,idCol,id) {
  const n=Math.max(0,s.getLastRow()-BRIDGE.DATA_START_ROW+1);
  if (!n) throw new Error('Store not found');
  const cell=s.getRange(BRIDGE.DATA_START_ROW,idCol,n,1).createTextFinder(String(id)).matchEntireCell(true).matchCase(false).findNext();
  if (!cell) throw new Error('Store not found');
  return cell.getRow();
}

function getRev_(sheetName) { return Number(PropertiesService.getScriptProperties().getProperty('REV_'+digestKey_(sheetName)) || 1); }
function bumpRev_(sheetName) { const n=getRev_(sheetName)+1; PropertiesService.getScriptProperties().setProperty('REV_'+digestKey_(sheetName),String(n)); return n; }


function digestKey_(v) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(v))).replace(/=+$/g,'').slice(0,32); }
function parseLatLng_(v) { const m=str_(v).match(/-?\d+(?:\.\d+)?/g); if(!m||m.length<2)return null; const lat=Number(m[0]),lng=Number(m[1]); return isFinite(lat)&&isFinite(lng)?{lat,lng}:null; }
function visited_(v) { if(v===true)return true; const s=str_(v).toLowerCase(); return ['1','true','yes','y','done','visited'].indexOf(s)!==-1; }
function ymd_(v) { if(Object.prototype.toString.call(v)==='[object Date]'&&!isNaN(v)) return Utilities.formatDate(v,BRIDGE.TIMEZONE,'yyyy-MM-dd'); const s=str_(v); return s ? s.slice(0,10) : ''; }
function parseJson_(v) { if(v && typeof v==='object')return v; try{return JSON.parse(String(v||'{}'));}catch(_){return{};} }
function str_(v) { return v===null||v===undefined?'':String(v).trim(); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function runMutation_(action, params, requestId) {
  return withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    const key = 'IDEMP_' + digestKey_(requestId);
    const hash = digestKey_(JSON.stringify({action, params}));
    const previous = JSON.parse(props.getProperty(key) || 'null');
    if (previous) {
      if (previous.hash !== hash) return {ok:false,error:'IDEMPOTENCY_CONFLICT'};
      if (previous.status === 'done') return previous.result;
      return {ok:false,error:'INDETERMINATE_REQUIRES_RECONCILIATION'};
    }
    const startedAt = new Date().toISOString();
    props.setProperty(key, JSON.stringify({hash, status:'pending', startedAt}));
    const result = dispatch_(action, params, requestId);
    if (result && typeof result.ok === 'boolean') {
      props.setProperty(key, JSON.stringify({hash, status:'done', startedAt, result}));
    }
    return result;
  });
}
