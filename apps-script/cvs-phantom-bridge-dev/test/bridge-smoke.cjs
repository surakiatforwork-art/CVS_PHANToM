const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {createHash,createHmac} = require('node:crypto');
const vm = require('node:vm');

const props = new Map([['BRIDGE_SECRET','test-only-secret'],['SPREADSHEET_ID','STAGING_TEST']]);
const cached = new Map();
const sheetRows = [
  ['account','kind','id','sort','active','data','updatedAt'],
  ['ALPHA','sku','a1',1,1,'{}','old'],
  ['BETA','sku','b1',1,1,'{}','old'],
  ['ALPHA','sku','a2',2,1,'{}','old'],
];
const mockSheet = {
  getLastRow() {
    let n = sheetRows.length;
    while(n>1 && sheetRows[n-1].every(v=>v===''||v==null))n--;
    return n;
  },
  getRange(r,c,n,m) {
    const row=r-1,col=c-1;
    return {
      getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>sheetRows[row+i]?.[col+j]??'')),
      setValues(values) {
        values.forEach((v,i)=>{while(sheetRows.length<=row+i)sheetRows.push([]);
          v.forEach((x,j)=>{sheetRows[row+i][col+j]=x;});});
      },
      clearContent() {
        for(let i=0;i<n;i++)for(let j=0;j<m;j++) sheetRows[row+i][col+j]='';
      },
    };
  },
};
const context={
  Date,JSON,Math,Number,String,Object,Array,Error,isFinite,
  PropertiesService:{getScriptProperties:()=>({
    getProperty:k=>props.get(k)||null,
    setProperty:(k,v)=>{props.set(k,v);},
    setProperties:(m)=>Object.entries(m).forEach(([k,v])=>props.set(k,v)),
  })},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  CacheService:{getScriptCache:()=>({
    get:k=>cached.get(k)||null,
    put:(k,v)=>{cached.set(k,v)},
  })},
  Utilities:{
    DigestAlgorithm:{SHA_256:'SHA_256'},
    computeDigest:(_a,v)=>[...createHash('sha256').update(String(v)).digest()],
    computeHmacSha256Signature:(v,key)=>[...createHmac('sha256',key).update(v).digest()],
    base64EncodeWebSafe:v=>Buffer.from(v).toString('base64url'),
    formatDate:()=> '2026-09-30',
  },
  SpreadsheetApp:{openById:()=>({getSheetByName:name=>name==='__REPORT_CONFIG'?mockSheet:null})},
  ContentService:{
    MimeType:{JSON:'JSON',JAVASCRIPT:'JS'},
    createTextOutput:body=>({body,setMimeType(){return this}}),
  },
};
vm.createContext(context);
vm.runInContext(readFileSync(require('node:path').join(__dirname,'../Code.js'),'utf8'),context);

const originalDispatch = context.dispatch_;
let calls=0;
context.dispatch_=(_action,p,id)=>{calls++;return {ok:true,id,route:p.route||''};};
let r=context.runMutation_('updateRoute',{sheet:'A',id:'1',route:'2'},'same-key');
assert.equal(r.ok,true);
r=context.runMutation_('updateRoute',{sheet:'A',id:'1',route:'2'},'same-key');
assert.equal(r.ok,true);
assert.equal(calls,1,'idempotent request must not be repeated');
r=context.runMutation_('updateRoute',{sheet:'A',id:'1',route:'3'},'same-key');
assert.equal(r.error,'IDEMPOTENCY_CONFLICT');
assert.equal(calls,1);
context.dispatch_=()=>{throw new Error('simulated write uncertainty');};
assert.throws(()=>context.runMutation_('updateRoute',{route:'5'},'pending-key'),/uncertainty/);
r=context.runMutation_('updateRoute',{route:'5'},'pending-key');
assert.equal(r.error,'INDETERMINATE_REQUIRES_RECONCILIATION');

const unsigned={action:'health',params:{},requestId:'',ts:Date.now(),nonce:'nonce-1'};
const msg=JSON.stringify(unsigned);
const signature=createHmac('sha256',props.get('BRIDGE_SECRET')).update(msg).digest('base64url');
assert.doesNotThrow(()=>context.verifyEnvelope_({...unsigned,signature}));
assert.throws(()=>context.verifyEnvelope_({...unsigned,signature}),/Replay rejected/);
assert.throws(()=>context.verifyEnvelope_({...unsigned,nonce:'nonce-2',signature:'invalid'}),/Invalid bridge signature/);

context.dispatch_=originalDispatch;
r=context.saveReportConfigBulk_([{account:'ALPHA',kind:'sku',id:'new',sort:1,active:true,data:{label:'test'}}],'bulk-id',1);
assert.equal(r.ok,true);
const active=sheetRows.slice(1).filter(row=>row[0]);
assert.equal(active.filter(row=>row[0]==='BETA').length,1,'other account must survive bulk replace');
assert.equal(active.filter(row=>row[0]==='ALPHA').length,1,'target account should be replaced');
assert.equal(active.find(row=>row[0]==='ALPHA')[2],'new');

let routeValue='old';
context.sheet_=()=>({
  getName:()=> 'DB_GBKK4',
  getRange:()=>({getValue:()=>routeValue,setValue:v=>{routeValue=v}}),
});
context.headerMap_=()=>({list:1,rount:2});
context.rowById_=()=>2;
const oldVersion=context.digestKey_('old');
r=context.setField_('DB_GBKK4','1',['rount'],'new','route',oldVersion);
assert.equal(r.ok,true);
assert.equal(routeValue,'new');
r=context.setField_('DB_GBKK4','1',['rount'],'stale','route',oldVersion);
assert.equal(r.error,'VERSION_CONFLICT');
assert.equal(routeValue,'new','stale update must not overwrite');
console.log('bridge-smoke: ok');
