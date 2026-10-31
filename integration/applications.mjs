// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { before, after, test } from "node:test";
import { promisify } from "node:util";
import { contractFetch as fetch, verifyContracts } from './contract.mjs';
import { foundationExample } from '../examples/foundation-http.mjs';

const base=process.env.PUBLIC_URL ?? "http://127.0.0.1:8080";
const issuer=`${base}/identity/realms/rosetta`;
const prefix=`app-test-${randomBytes(6).toString("hex")}`;
const clientIds=[], users=[];
let adminToken, owner, approver, foreign, stranger, serviceToken, app, etag;
let resourceA, resourceB, resourceForeign, privateRecord, privateObject, recordShare, objectShare;
let objectBytes=Buffer.from('private resource fixture');
const run=(...args)=>promisify(execFile)("docker",args,{timeout:180000});
const sql=text=>run("compose","exec","-T","database","psql","-U","rosetta_admin","-d","rosetta_data","-v","ON_ERROR_STOP=1","-Atc",text);
const q=value=>`'${String(value).replaceAll("'","''")}'`;
async function operatorToken() {
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    try {
      const response=await fetch(`${base}/identity/realms/master/protocol/openid-connect/token`,{method:"POST",body:new URLSearchParams({grant_type:"password",client_id:"admin-cli",username:"rosetta-admin",password:process.env.KEYCLOAK_ADMIN_PASSWORD}),signal:AbortSignal.timeout(5000)});
      if(response.status===200) return (await response.json()).access_token;
    } catch { /* The real database/Core recreation can leave stale IdP connections. */ }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.fail("Operator authentication did not recover within thirty seconds");
}
async function admin(path,body,method="GET") {
  return fetch(`${base}/identity/admin/realms/rosetta/${path}`,{method,headers:{Authorization:`Bearer ${adminToken}`,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
}
async function login(username,password,clientId,full=false) {
  const verifier=randomBytes(32).toString("base64url");
  const params=new URLSearchParams({client_id:clientId,response_type:"code",scope:"openid",redirect_uri:"http://127.0.0.1:9876/callback",code_challenge_method:"S256",code_challenge:createHash("sha256").update(verifier).digest("base64url")});
  const page=await fetch(`${issuer}/protocol/openid-connect/auth?${params}`,{redirect:"manual"});
  const cookies=page.headers.getSetCookie().map(v=>v.split(";",1)[0]).join("; ");
  const action=(await page.text()).match(/<form[^>]*action="([^"]+)"/); assert.ok(action);
  const response=await fetch(action[1].replaceAll("&amp;","&"),{method:"POST",redirect:"manual",headers:{Cookie:cookies},body:new URLSearchParams({username,password,credentialId:""})});
  assert.equal(response.status,302,"real human PKCE authentication");
  const code=new URL(response.headers.get("location")).searchParams.get("code"); assert.ok(code);
  const tokens=await fetch(`${issuer}/protocol/openid-connect/token`,{method:"POST",body:new URLSearchParams({grant_type:"authorization_code",client_id:clientId,redirect_uri:"http://127.0.0.1:9876/callback",code,code_verifier:verifier})});
  assert.equal(tokens.status,200); const session=await tokens.json();return full?session:session.access_token;
}
async function human(label,tenant,permissions) {
  const clientId=`${prefix}-management-${tenant}`;
  const username=`${prefix}-${label}`, password=randomBytes(32).toString("hex");
  const result=await admin("users",{username,enabled:true,firstName:"Technical",lastName:"Fixture",email:`${username}@example.invalid`,emailVerified:true,attributes:{tenant_id:[tenant]},credentials:[{type:"password",value:password,temporary:false}]},"POST");
  assert.equal(result.status,201); const id=result.headers.get("location").split("/").at(-1); users.push(id);
  const identity=await (await admin(`users/${id}`)).json(); assert.equal(identity.enabled,true); assert.equal(identity.serviceAccountClientId,undefined);
  const groups=await (await admin(`groups?search=${tenant}&exact=true`)).json(); const group=groups.find(g=>g.name===tenant); assert.ok(group);
  assert.equal((await admin(`users/${id}/groups/${group.id}`,undefined,"PUT")).status,204);
  const role=await (await admin("roles/core-reader")).json();
  assert.equal((await admin(`users/${id}/role-mappings/realm`,[role],"POST")).status,204);
  await sql(`INSERT INTO app_private.principals(tenant_id,issuer,subject,management_client,permissions) VALUES(${q(tenant)},${q(issuer)},${q(id)},${q(clientId)},ARRAY[${permissions.map(q).join(",")}]::text[]);`);
  return {id,tenant,token:await login(username,password,clientId)};
}
async function provider(label,subject=owner.id,tenant="tenant-a") {
  const clientId=`${prefix}-${label}`;
  const result=await admin("clients",{clientId,enabled:true,protocol:"openid-connect",publicClient:false,serviceAccountsEnabled:true,standardFlowEnabled:false},"POST");
  assert.equal(result.status,201); clientIds.push(result.headers.get("location").split("/").at(-1));
  const body={displayName:"Technical registration fixture",oauthClientId:clientId,providerOrigin:`https://${clientId}.example.invalid`};
  await sql(`INSERT INTO app_private.enrollments(tenant_id,issuer,oauth_client_id,owner_subject,provider_origin) VALUES(${q(tenant)},${q(issuer)},${q(clientId)},${q(subject)},${q(body.providerOrigin)});`);
  return body;
}
async function api(path,who,body,headers={},method=body===undefined?"GET":"POST") {
  return fetch(base+path,{method,headers:{...(who?{Authorization:`Bearer ${who.token??who}`} : {}),...(body===undefined?{}:{"Content-Type":"application/json"}),...headers},body:body===undefined?undefined:typeof body==="string"?body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
}
const path=()=>`/v1/applications/${app.appId}`;
async function approval(current=app,actor=approver,patch={}) {
  return api("/v1/approvals",actor,{resourceType:"application",resourceId:current.appId,resourceDigest:current.digest,resourceRevision:current.revision,requesterSubject:current.ownerSubject,requesterAppId:current.appId,decision:"approve",expiresAt:new Date(Date.now()+120000).toISOString(),...patch});
}
async function mutate(action,body,actor=approver,match=etag) {
  const r=await api(`${path()}/${action}`,actor,body,match?{"If-Match":match}:{});
  if(r.status===200){app=await r.json();etag=r.headers.get("etag");} return r;
}

async function coreProbe(script) {
  return new Promise((resolve,reject)=>{
    const child=spawn('docker',['compose','exec','-T','core','node','--input-type=module','-'],{stdio:['pipe','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
    child.on('error',reject);child.on('close',code=>code===0?resolve(output.trim()):reject(Error(output)));
    child.stdin.end(script);
  });
}

async function resourceBackend(label,principal=owner,administrator=approver,tenant='tenant-a') {
  const body=await provider(label,principal.id,tenant),client=clientIds.at(-1);
  const template=(await (await admin('clients?clientId=tenant-a')).json())[0];
  const config=await (await admin(`clients/${template.id}`)).json();
  const mappers=structuredClone(config.protocolMappers);
  for(const mapper of mappers) delete mapper.id;
  mappers.find(mapper=>mapper.name==='tenant').config['claim.value']=tenant;
  assert.equal((await admin(`clients/${client}`,{clientId:body.oauthClientId,enabled:true,publicClient:false,serviceAccountsEnabled:true,standardFlowEnabled:false,directAccessGrantsEnabled:false,protocolMappers:mappers},'PUT')).status,204);
  const subject=(await (await admin(`clients/${client}/service-account-user`)).json()).id;
  const group=(await (await admin(`groups?search=${tenant}&exact=true`)).json()).find(g=>g.name===tenant);
  assert.equal((await admin(`users/${subject}/groups/${group.id}`,undefined,'PUT')).status,204);
  const roles=await Promise.all(['core-reader','core-writer'].map(async name=>(await admin(`roles/${name}`)).json()));
  assert.equal((await admin(`users/${subject}/role-mappings/realm`,roles,'POST')).status,204);
  const secret=(await (await admin(`clients/${client}/client-secret`)).json()).value;
  const issued=await fetch(`${issuer}/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({grant_type:'client_credentials',client_id:body.oauthClientId,client_secret:secret})});
  assert.equal(issued.status,200);const token=(await issued.json()).access_token;
  await sql(`UPDATE app_private.enrollments SET resource_subject=${q(subject)} WHERE oauth_client_id=${q(body.oauthClientId)};`);
  const created=await api('/v1/applications',principal,body);assert.equal(created.status,201);
  let value=await created.json();
  assert.equal((await api('/v2/data/private_fixture',token)).status,403,'pending apps have no resource access');
  const decision=await approval(value,administrator);assert.equal(decision.status,201);const approvalId=(await decision.json()).approvalId;
  const activated=await api(`/v1/applications/${value.appId}/approve`,administrator,{approvalId},{'If-Match':created.headers.get('etag')});
  assert.equal(activated.status,200);value=await activated.json();
  return {token,subject,clientId:body.oauthClientId,clientSecret:secret,tenant,app:value,etag:activated.headers.get('etag')};
}
async function resourceState(backend,action) {
  let approvalId;
  if(action==='reactivate') { const r=await approval(backend.app);assert.equal(r.status,201);approvalId=(await r.json()).approvalId; }
  const r=await api(`/v1/applications/${backend.app.appId}/state`,approver,{action,reason:'technical resource test',...(approvalId?{approvalId}:{})},{'If-Match':backend.etag});
  assert.equal(r.status,200);backend.app=await r.json();backend.etag=r.headers.get('etag');
}
const recordPath=()=>`/v2/data/private_fixture/${privateRecord.id}`;
const objectPath=()=>`/v2/objects/${privateObject.id}`;
const binary=(bytes=objectBytes,method='POST')=>({method,headers:{'Content-Type':'application/octet-stream'},body:bytes});
async function objectCall(path,backend,options={}) {
  return fetch(base+path,{...options,headers:{Authorization:`Bearer ${backend.token}`,...options.headers},signal:AbortSignal.timeout(15000)});
}
async function shareResource(kind,id,patch={},actor=resourceA) {
  return api('/v2/resource-shares',actor,{resourceType:kind,resourceId:id,granteeAppId:resourceB.app.appId,action:'read',expiresAt:new Date(Date.now()+600000).toISOString(),...patch});
}

before(async()=>{
  adminToken=await operatorToken();
  // Dedicated operator-managed PKCE clients keep fixture changes local. The
  // pinned Keycloak profile drops undeclared user attributes on admin create.
  const template=(await (await admin("clients?clientId=tenant-a")).json())[0];
  const source=await (await admin(`clients/${template.id}`)).json();
  for(const tenant of ["tenant-a","tenant-b"]){
    const protocolMappers=structuredClone(source.protocolMappers);
    for(const mapper of protocolMappers) delete mapper.id;
    protocolMappers.find(m=>m.name==="tenant").config["claim.value"]=tenant;
    const response=await admin("clients",{clientId:`${prefix}-management-${tenant}`,enabled:true,protocol:"openid-connect",publicClient:true,standardFlowEnabled:true,directAccessGrantsEnabled:false,redirectUris:["http://127.0.0.1:9876/callback"],attributes:{"pkce.code.challenge.method":"S256"},protocolMappers},"POST");
    assert.equal(response.status,201);clientIds.push(response.headers.get("location").split("/").at(-1));
  }
  const permissions=["applications.register","applications.approve","trust.approve"];
  owner=await human("owner","tenant-a",permissions); approver=await human("approver","tenant-a",permissions);
  foreign=await human("foreign","tenant-b",permissions); stranger=await human("stranger","tenant-a",[]);
  const token=await fetch(`${issuer}/protocol/openid-connect/token`,{method:"POST",body:new URLSearchParams({grant_type:"client_credentials",client_id:"tenant-a",client_secret:process.env.TENANT_A_SECRET})});
  serviceToken=(await token.json()).access_token;
});
after(async()=>{
  adminToken=await operatorToken();
  // Remove only this run's uniquely named technical fixtures, never project data.
  if(users.length){
    const ids=users.map(q).join(",");
    const apps=`SELECT app_id FROM app_private.applications WHERE owner_subject IN (${ids})`;
    const objects=await sql(`SELECT coalesce(json_agg(json_build_object('tenant',tenant_id,'owner',owner_app_id,'id',id)),'[]') FROM app_private.resource_objects WHERE owner_app_id IN (${apps});`);
    const paths=JSON.parse(objects.stdout.trim());
    if(paths.length) await coreProbe(`import assert from 'node:assert/strict';
      for(const p of ${JSON.stringify(paths)}) {
        assert.match(p.tenant,/^tenant-[ab]$/);for(const id of [p.owner,p.id]) assert.match(id,/^[0-9a-f-]{36}$/);
        const r=await fetch(process.env.OBJECTS_URL+'/rosetta-app/'+p.tenant+'/'+p.owner+'/'+p.id+'?recursive=true',{method:'DELETE'});
        assert.ok([200,202,204,404].includes(r.status));await r.arrayBuffer();
      }`);
    await sql(`DELETE FROM app_private.audit WHERE subject IN (${ids}) OR subject IN (SELECT resource_subject FROM app_private.enrollments WHERE owner_subject IN (${ids}));
      DELETE FROM app_private.resource_shares WHERE owner_app_id IN (${apps}) OR grantee_app_id IN (${apps});
      DELETE FROM app_private.resource_objects WHERE owner_app_id IN (${apps});DELETE FROM core.app_records WHERE owner_app_id IN (${apps});
      DELETE FROM app_private.approvals WHERE app_id IN (${apps});DELETE FROM app_private.applications WHERE owner_subject IN (${ids});
      DELETE FROM app_private.enrollments WHERE owner_subject IN (${ids});DELETE FROM app_private.principals WHERE subject IN (${ids});`);
  }
  for(const id of clientIds) assert.equal((await admin(`clients/${id}`,undefined,"DELETE")).status,204);
  for(const id of users) assert.equal((await admin(`users/${id}`,undefined,"DELETE")).status,204);
  await verifyContracts('applications');
});

test("registration denies baseline roles and caller-owned authority, including direct Core access",async()=>{
  const body=await provider("primary");
  assert.equal((await api("/v1/applications",undefined,body)).status,401);
  assert.equal((await api("/v1/applications",serviceToken,body)).status,403,"core-writer alone is not administration");
  assert.equal((await api("/v1/applications",stranger,body)).status,403);
  assert.equal((await api("/v1/applications",approver,body)).status,403,"registration permission cannot claim another enrolled owner's client");
  assert.equal((await api("/v1/applications",foreign,body)).status,403);
  for(const patch of [{tenantId:"tenant-b"},{ownerSubject:approver.id},{state:"active"},{permissions:["applications.register"]},{providerOrigin:"https://unapproved.example.invalid"}]) {
    const r=await api("/v1/applications",owner,{...body,...patch}); assert.ok([400,403].includes(r.status));
  }
  assert.equal((await api("/v1/applications",owner,'{"displayName":"a","displayName":"b"}')).status,400);
  const script=`const r=await fetch('http://127.0.0.1:8080/v1/applications',{method:'POST',headers:{Authorization:'Bearer '+${JSON.stringify(serviceToken)},'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(body))}}); console.log(r.status);`;
  const status=await new Promise((resolve,reject)=>{const child=spawn("docker",["compose","exec","-T","core","node","--input-type=module","-"],{stdio:["pipe","pipe","ignore"]});let out="";child.stdout.on("data",chunk=>out+=chunk);child.on("error",reject);child.on("close",code=>code===0?resolve(out.trim()):reject(Error("direct Core probe failed")));child.stdin.end(script);});
  assert.equal(status,"403");
  const created=await api("/v1/applications",owner,body,{"X-Tenant-Id":"tenant-b","X-Owner-Subject":approver.id});
  assert.equal(created.status,201,created.status===201?undefined:await created.text());app=await created.json();etag=created.headers.get("etag");
  assert.equal(app.tenantId,"tenant-a");assert.equal(app.ownerSubject,owner.id);assert.equal(app.state,"pending");assert.equal(app.revision,1);
  assert.equal((await api("/v1/applications",owner,body)).status,409);
  assert.equal((await api(path(),owner)).status,200);assert.equal((await api(path(),approver)).status,200);
  assert.equal((await api(path(),stranger)).status,404);assert.equal((await api(path(),foreign)).status,404);
  assert.equal((await api(`${path()}?tenantId=tenant-b`,owner)).status,400);
});

test("approval binds independent human, tenant, enrollment, digest, revision, expiry and ETag",async()=>{
  assert.equal((await approval(app,owner)).status,403);
  assert.equal((await approval(app,foreign)).status,404);
  assert.equal((await approval(app,approver,{requesterSubject:approver.id})).status,409);
  assert.equal((await approval(app,approver,{resourceDigest:`sha256:${"0".repeat(64)}`})).status,409);
  assert.equal((await approval(app,approver,{expiresAt:new Date(Date.now()-1000).toISOString()})).status,400);
  const decision=await approval();assert.equal(decision.status,201);const approved=await decision.json();
  assert.equal((await api(`/v1/approvals/${approved.approvalId}`,foreign)).status,404);
  assert.equal((await mutate("approve",{approvalId:approved.approvalId},approver,null)).status,428);
  assert.equal((await mutate("approve",{approvalId:approved.approvalId},approver,'"stale"')).status,412);
  await sql(`UPDATE app_private.principals SET enabled=false WHERE subject=${q(owner.id)};`);
  assert.equal((await mutate("approve",{approvalId:approved.approvalId})).status,403);
  await sql(`UPDATE app_private.principals SET enabled=true WHERE subject=${q(owner.id)};`);
  assert.equal((await mutate("approve",{approvalId:approved.approvalId})).status,200);assert.equal(app.state,"active");
  assert.equal((await (await api(`/v1/approvals/${approved.approvalId}`,approver)).json()).state,"consumed");
  assert.equal((await mutate("approve",{approvalId:approved.approvalId})).status,409);
});

test("a failed durable audit rolls the application transition back",async()=>{
  const name=prefix.replaceAll("-","_");
  await sql(`CREATE FUNCTION app_private.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_id='${app.appId}'::uuid THEN RAISE EXCEPTION 'technical audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${name} BEFORE INSERT ON app_private.audit FOR EACH ROW EXECUTE FUNCTION app_private.${name}();`);
  try {
    const revision=app.revision;
    assert.equal((await mutate("state",{action:"suspend",reason:"audit failure fixture"})).status,503);
    const current=await (await api(path(),owner)).json();assert.equal(current.state,"active");assert.equal(current.revision,revision);
  } finally { await sql(`DROP TRIGGER ${name} ON app_private.audit; DROP FUNCTION app_private.${name}();`); }
});

test("lifecycle rejects invalid transitions and stale/expired/revoked approvals",async()=>{
  assert.equal((await mutate("state",{action:"reactivate",reason:"technical",approvalId:randomUUID()})).status,409);
  assert.equal((await mutate("state",{action:"suspend",reason:"technical"},foreign)).status,404);
  assert.equal((await mutate("state",{action:"suspend",reason:"technical"})).status,200);assert.equal(app.state,"suspended");
  assert.equal((await mutate("state",{action:"suspend",reason:"technical"})).status,409);
  const decision=await approval(); const stale=await decision.json();
  await sql(`UPDATE app_private.approvals SET expires_at=now()-interval '1 second' WHERE approval_id=${q(stale.approvalId)};`);
  assert.equal((await mutate("state",{action:"reactivate",reason:"technical",approvalId:stale.approvalId})).status,409);
  const next=await approval();const revoked=await next.json();
  assert.equal((await api(`/v1/approvals/${revoked.approvalId}/revoke`,approver,{reason:"technical"},{"If-Match":next.headers.get("etag")})).status,200);
  assert.equal((await mutate("state",{action:"reactivate",reason:"technical",approvalId:revoked.approvalId})).status,409);
  const fresh=await (await approval()).json();
  const old=etag;
  const results=await Promise.all([1,2].map(()=>api(`${path()}/state`,approver,{action:"reactivate",reason:"technical",approvalId:fresh.approvalId},{"If-Match":old})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,412]);
  const current=await api(path(),owner);app=await current.json();etag=current.headers.get("etag");assert.equal(app.state,"active");
});

test("private SQL roles and forced RLS prevent generic data APIs from administering apps",async()=>{
  const check=await sql("SELECT has_function_privilege('rosetta_api','core.application_command(text,jsonb)','EXECUTE'),has_schema_privilege('rosetta_api','app_private','USAGE');");
  assert.equal(check.stdout.trim(),"f|f");
  await assert.rejects(sql("SET ROLE rosetta_api; SELECT * FROM app_private.principals;"));
  const count=await sql(`SET ROLE rosetta_app_owner; SELECT set_config('request.jwt.claims','{"tenant_id":"tenant-b"}',false); SELECT count(*) FROM app_private.applications WHERE app_id=${q(app.appId)};`);
  assert.equal(count.stdout.trim().split(/\r?\n/).at(-1),"0");
  assert.equal((await api(`/v1/data/applications`,serviceToken,{data:{ownerSubject:owner.id,permissions:["applications.approve"]}})).status,201);
  const fake=await (await api("/v1/data/applications",serviceToken)).json();
  for(const record of fake.items.filter(r=>r.data.ownerSubject===owner.id)) await api(`/v1/data/applications/${record.id}`,serviceToken,undefined,{},"DELETE");
  assert.equal((await api(path(),serviceToken)).status,403);
});

test('registered backends own private records and objects; browser and unenrolled contexts fail closed',async()=>{
  resourceA=await resourceBackend('resource-a');resourceB=await resourceBackend('resource-b');
  const foreignApprover=await human('foreign-approver','tenant-b',['applications.register','applications.approve','trust.approve']);
  resourceForeign=await resourceBackend('resource-foreign',foreign,foreignApprover,'tenant-b');
  assert.equal((await api('/v2/data/private_fixture',undefined)).status,401);
  for(const who of [owner,serviceToken]) assert.equal((await api('/v2/data/private_fixture',who)).status,403);
  assert.equal((await api('/v1/data/private_fixture',owner)).status,403,'human management clients have no legacy writer fallback');
  assert.equal((await api('/v1/objects',resourceA)).status,403,'registered backends cannot fall back to legacy namespaces');
  const browser=await login('local-user',process.env.SSO_USER_PASSWORD,'rosetta-local',true);
  try {
    for(const p of ['/v2/data/private_fixture','/v2/objects','/v1/data/private_fixture','/v1/objects']) {
      assert.equal((await api(p,browser.access_token)).status,403,'even the legacy browser writer fixture cannot access resource APIs');
    }
  } finally {
    const logout=await fetch(`${issuer}/protocol/openid-connect/logout`,{method:'POST',body:new URLSearchParams({client_id:'rosetta-local',refresh_token:browser.refresh_token})});assert.equal(logout.status,204);
  }
  for(const backend of [resourceA,resourceB,resourceForeign]) {
    const created=await api('/v2/data/private_fixture',backend,{data:{fixture:backend.clientId}});assert.equal(created.status,201);
    const record=await created.json();if(backend===resourceA) privateRecord=record;
    assert.equal((await api('/v2/data/private_fixture?limit=1',backend)).status,200);
    const p=`/v2/data/private_fixture/${record.id}`;
    assert.equal((await api(p,backend)).status,200);
    assert.equal((await api(p,backend,{data:{updated:true}},{},'PATCH')).status,200);
    const uploaded=await objectCall('/v2/objects',backend,binary());assert.equal(uploaded.status,201);
    const object=await uploaded.json();if(backend===resourceA) privateObject=object;
    assert.deepEqual(Buffer.from(await (await objectCall(`/v2/objects/${object.id}`,backend)).arrayBuffer()),objectBytes);
  }
  for(const field of ['app_id','appId','tenant_id','tenantId','client_id','owner_app_id','ownerSubject']) {
    assert.equal((await api('/v2/data/private_fixture',resourceB,{data:{},[field]:resourceA.app.appId})).status,400);
  }
});

test('documented backend HTTP example authenticates, stores, shares and executes the technical workflow',async()=>{
  const result=await foundationExample({base,clientId:resourceA.clientId,clientSecret:resourceA.clientSecret,
    granteeAppId:resourceB.app.appId,granteeClientId:resourceB.clientId,granteeClientSecret:resourceB.clientSecret,fetcher:fetch});
  assert.equal(result.deniedBeforeShare,true);
  assert.equal(result.sharedReadAllowed,true);
  try {
    const cli=await promisify(execFile)(process.execPath,['examples/foundation-http.mjs'],{
      env:{...process.env,PUBLIC_URL:base,ROSETTA_APP_CLIENT_ID:resourceA.clientId,
        ROSETTA_APP_CLIENT_SECRET:resourceA.clientSecret,ROSETTA_GRANTEE_APP_ID:resourceB.app.appId,
        ROSETTA_GRANTEE_CLIENT_ID:resourceB.clientId,ROSETTA_GRANTEE_CLIENT_SECRET:resourceB.clientSecret},timeout:30000});
    assert.match(cli.stdout,/HTTP example succeeded/);
    assert.equal((await api(`/v2/data/http_example/${result.recordId}`,resourceB)).status,200);
    assert.equal((await api(`/v2/data/http_example/${result.recordId}`,resourceB,{data:{}},{},'PATCH')).status,404);
  } finally {
    assert.equal((await api(`/v2/resource-shares/${result.shareId}`,resourceA,undefined,{},'DELETE')).status,204);
    assert.equal((await api(`/v2/data/http_example/${result.recordId}`,resourceA,undefined,{},'DELETE')).status,204);
    assert.equal((await objectCall(`/v2/objects/${result.objectId}`,resourceA,{method:'DELETE'})).status,204);
  }
});

test('same-tenant and foreign apps cannot bypass ownership through headers, v1, Core, PostgREST or SQL',async()=>{
  const forged={'X-App-Id':resourceA.app.appId,'X-Tenant-Id':'tenant-a','X-Client-Id':resourceA.clientId,
    app_id:resourceA.app.appId,tenant_id:'tenant-a',client_id:resourceA.clientId,'X-Owner-App-Id':resourceA.app.appId};
  for(const backend of [resourceB,resourceForeign]) {
    assert.equal((await api(recordPath(),backend,undefined,forged)).status,404);
    assert.equal((await api(recordPath(),backend,{data:{stolen:true}},forged,'PATCH')).status,404);
    assert.equal((await api(recordPath(),backend,undefined,forged,'DELETE')).status,404);
    assert.equal((await objectCall(objectPath(),backend,{headers:forged})).status,404);
    assert.equal((await objectCall(objectPath(),backend,{method:'DELETE',headers:forged})).status,404);
    const put=await objectCall(objectPath(),backend,{...binary(Buffer.from('foreign bytes'),'PUT'),headers:{...forged,'Content-Type':'application/octet-stream'}});
    assert.equal(put.status,backend===resourceB?404:201,'foreign-tenant PUT may create only its independent UUID namespace');
  }
  assert.deepEqual(Buffer.from(await (await objectCall(objectPath(),resourceA)).arrayBuffer()),objectBytes);
  assert.equal((await api(recordPath().replace('/v2/','/v1/'),serviceToken)).status,404);
  assert.equal((await api(objectPath().replace('/v2/','/v1/'),serviceToken)).status,404);
  const claim={tenant_id:'tenant-a',iss:issuer,sub:resourceB.subject,client_id:resourceB.clientId,resource_writer:true,app_id:resourceA.app.appId};
  const set=`SET ROLE rosetta_resource_api; SELECT set_config('request.jwt.claims',${q(JSON.stringify(claim))},false);`;
  const hidden=await sql(`${set} SELECT count(*) FROM core.app_records WHERE id=${q(privateRecord.id)};`);
  assert.equal(hidden.stdout.trim().split(/\r?\n/).at(-1),'0');
  await assert.rejects(sql(`${set} UPDATE core.app_records SET owner_app_id=${q(resourceB.app.appId)} WHERE id=${q(privateRecord.id)};`));
  await assert.rejects(sql(`${set} INSERT INTO core.app_records(id,collection,data,owner_app_id) VALUES('${randomUUID()}','private_fixture','{}',${q(resourceA.app.appId)});`));
  const acl=await sql("SELECT has_table_privilege('rosetta_api','core.app_records','SELECT'),has_table_privilege('rosetta_app_api','core.app_records','SELECT'),has_function_privilege('rosetta_api','core.resource_command(text,jsonb)','EXECUTE'),has_schema_privilege('rosetta_resource_api','app_private','USAGE');");
  assert.equal(acl.stdout.trim(),'f|f|f|f');
  const identity={tenantId:'tenant-a',issuer,subject:resourceB.subject,clientId:resourceB.clientId,roles:['core-reader','core-writer'],appId:resourceA.app.appId};
  await coreProbe(`import assert from 'node:assert/strict';import {applicationToken} from '/app/src/modules/applications/applications.mjs';
    const identity=${JSON.stringify(identity)};
    const jwt=applicationToken(identity,process.env.DATA_JWT_SECRET,'rosetta_resource_api');
    let r=await fetch(process.env.DATA_URL+'/app_records?id=eq.${privateRecord.id}',{headers:{Authorization:'Bearer '+jwt}});
    assert.equal(r.status,200);assert.deepEqual(await r.json(),[]);
    r=await fetch(process.env.DATA_URL+'/rpc/resource_command',{method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify({operation:'object_get',payload:{id:'${privateObject.id}'}})});
    assert.equal((await r.json()).status,404);
    identity.subject=${JSON.stringify(owner.id)};
    const human=applicationToken({...identity,clientId:${JSON.stringify(resourceA.clientId)}},process.env.DATA_JWT_SECRET,'rosetta_resource_api');
    r=await fetch(process.env.DATA_URL+'/rpc/resource_command',{method:'POST',headers:{Authorization:'Bearer '+human,'Content-Type':'application/json'},body:JSON.stringify({operation:'context',payload:{}})});
    assert.equal((await r.json()).status,403);
    const readonly=applicationToken({tenantId:'tenant-a',issuer:${JSON.stringify(issuer)},subject:${JSON.stringify(resourceA.subject)},clientId:${JSON.stringify(resourceA.clientId)},roles:['core-reader']},process.env.DATA_JWT_SECRET,'rosetta_resource_api');
    r=await fetch(process.env.DATA_URL+'/rpc/resource_command',{method:'POST',headers:{Authorization:'Bearer '+readonly,'Content-Type':'application/json'},body:JSON.stringify({operation:'object_prepare',payload:{id:'${randomUUID()}'}})});
    assert.equal((await r.json()).status,403);
    r=await fetch(process.env.DATA_URL+'/app_records',{method:'POST',headers:{Authorization:'Bearer '+readonly,'Content-Type':'application/json'},body:JSON.stringify({id:'${randomUUID()}',collection:'private_fixture',data:{}})});
    assert.equal(r.status,403,'SQL writer enforcement does not depend on the HTTP adapter');
    for(const path of ${JSON.stringify([recordPath(),objectPath()])}) {
      r=await fetch('http://127.0.0.1:8080'+path,{headers:{Authorization:'Bearer '+${JSON.stringify(resourceB.token)},'X-App-Id':${JSON.stringify(resourceA.app.appId)}}});assert.equal(r.status,404);
    }`);
});

test('owner-approved read shares authorize exactly one resource and never writes, resharing or cross-tenant access',async()=>{
  for(const patch of [{action:'update'},{action:'delete'},{tenant_id:'tenant-b'},{expiresAt:new Date(Date.now()-1000).toISOString()},{expiresAt:new Date(Date.now()+90000000).toISOString()}]) {
    assert.equal((await shareResource('record',privateRecord.id,patch)).status,400);
  }
  assert.equal((await shareResource('record',privateRecord.id,{granteeAppId:resourceForeign.app.appId})).status,404);
  assert.equal((await shareResource('record',privateRecord.id,{},resourceB)).status,404);
  let r=await shareResource('record',privateRecord.id);assert.equal(r.status,201);recordShare=await r.json();
  r=await shareResource('object',privateObject.id);assert.equal(r.status,201);objectShare=await r.json();
  assert.equal((await api(recordPath(),resourceB)).status,200);
  assert.deepEqual(Buffer.from(await (await objectCall(objectPath(),resourceB)).arrayBuffer()),objectBytes);
  assert.equal((await api(recordPath(),resourceB,{data:{}},{},'PATCH')).status,404);
  assert.equal((await api(recordPath(),resourceB,undefined,{},'DELETE')).status,404);
  assert.equal((await objectCall(objectPath(),resourceB,binary(undefined,'PUT'))).status,404);
  assert.equal((await objectCall(objectPath(),resourceB,{method:'DELETE'})).status,404);
  assert.equal((await shareResource('record',privateRecord.id,{granteeAppId:resourceA.app.appId},resourceB)).status,404);
  assert.equal((await api(`/v2/resource-shares/${recordShare.shareId}`,resourceB,undefined,{},'DELETE')).status,404);
  const extra=await (await api('/v2/data/private_fixture',resourceA,{data:{unshared:true}})).json();
  assert.equal((await api(`/v2/data/private_fixture/${extra.id}`,resourceB)).status,404);
  assert.equal((await api(`/v2/data/private_fixture/${extra.id}`,resourceA,undefined,{},'DELETE')).status,204);
  assert.equal((await api(`/v2/data/private_fixture/${extra.id}`,resourceA)).status,404);
  assert.equal((await api(recordPath(),resourceForeign)).status,404);
  await sql(`UPDATE app_private.resource_shares SET expires_at=now()-interval '1 second' WHERE share_id=${q(recordShare.shareId)};`);
  assert.equal((await api(recordPath(),resourceB)).status,404);
  for(let n=0;n<2;n++) assert.equal((await api(`/v2/resource-shares/${recordShare.shareId}`,resourceA,undefined,{},'DELETE')).status,204);
  r=await shareResource('record',privateRecord.id);assert.equal(r.status,201);recordShare=await r.json();
  objectBytes=Buffer.from('updated private object');
  assert.equal((await objectCall(objectPath(),resourceA,binary(undefined,'PUT'))).status,200);
  assert.deepEqual(Buffer.from(await (await objectCall(objectPath(),resourceB)).arrayBuffer()),objectBytes);
  const audit=await sql(`SELECT count(*) FROM app_private.audit WHERE resource_id=${q(recordShare.shareId)} AND event='resource.share_created';`);
  assert.equal(audit.stdout.trim(),'1');
});

test('private resources, ownership and exact read shares persist through database, Core and object recreation',{timeout:180000},async()=>{
  await run('compose','stop','data');
  try {
    assert.equal((await api('/health')).status,200);
    assert.equal((await api(recordPath(),resourceA)).status,503);
    assert.equal((await objectCall(objectPath(),resourceA)).status,503,'object authorization fails closed without its authority store');
  } finally { await run('compose','start','data'); }
  await run('compose','restart','database');await run('compose','up','--detach','--no-deps','--force-recreate','data','objects','core');
  const deadline=Date.now()+90000;let ready=false;
  while(Date.now()<deadline){try{const r=await api('/ready');if(r.status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
  assert.ok(ready,'dependencies recover');
  assert.equal((await api(recordPath(),resourceA)).status,200);
  assert.equal((await api(recordPath(),resourceB)).status,200);
  assert.deepEqual(Buffer.from(await (await objectCall(objectPath(),resourceB)).arrayBuffer()),objectBytes);
  assert.equal((await api(recordPath(),resourceB,{data:{}},{},'PATCH')).status,404);
  assert.equal((await api(recordPath(),resourceForeign)).status,404);
  assert.equal((await api(`/v2/resource-shares/${objectShare.shareId}`,resourceA,undefined,{},'DELETE')).status,204);
  assert.equal((await objectCall(objectPath(),resourceB)).status,404);
  objectShare=await (await shareResource('object',privateObject.id)).json();
});

test('object tombstones prevent UUID takeover and durable audit failure cannot create a share',async()=>{
  const uploaded=await objectCall('/v2/objects',resourceA,binary());const object=await uploaded.json();
  const p=`/v2/objects/${object.id}`;
  assert.equal((await shareResource('object',object.id)).status,201);
  assert.equal((await objectCall(p,resourceA,{method:'DELETE'})).status,204);
  for(const backend of [resourceA,resourceB]) {
    assert.equal((await objectCall(p,backend)).status,404);
    assert.equal((await objectCall(p,backend,binary(undefined,'PUT'))).status,404);
  }
  const name=prefix.replaceAll('-','_')+'_share';
  await sql(`CREATE FUNCTION app_private.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.subject=${q(resourceA.subject)} AND NEW.event='resource.share_created' THEN RAISE EXCEPTION 'technical share audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${name} BEFORE INSERT ON app_private.audit FOR EACH ROW EXECUTE FUNCTION app_private.${name}();`);
  try {
    const extra=await (await api('/v2/data/private_fixture',resourceA,{data:{audit:true}})).json();
    assert.equal((await shareResource('record',extra.id)).status,503);
    assert.equal((await api(`/v2/data/private_fixture/${extra.id}`,resourceB)).status,404);
  } finally { await sql(`DROP TRIGGER ${name} ON app_private.audit; DROP FUNCTION app_private.${name}();`); }
});

test('live suspension, enrollment removal and terminal revocation block owners and grantees without disabling Keycloak',async()=>{
  await resourceState(resourceA,'suspend');
  assert.equal((await api(recordPath(),resourceA)).status,403);
  assert.equal((await objectCall(objectPath(),resourceA)).status,403);
  assert.equal((await api(recordPath(),resourceB)).status,404);
  assert.equal((await objectCall(objectPath(),resourceB)).status,404);
  assert.equal((await api('/v1/identity',resourceA)).status,200,'app suspension does not disable its OAuth client');
  await resourceState(resourceA,'reactivate');
  assert.equal((await api(recordPath(),resourceB)).status,200);
  await sql(`UPDATE app_private.enrollments SET enabled=false WHERE oauth_client_id=${q(resourceA.clientId)};`);
  assert.equal((await api(recordPath(),resourceA)).status,403);assert.equal((await api(recordPath(),resourceB)).status,404);
  await sql(`UPDATE app_private.enrollments SET enabled=true,resource_subject=NULL WHERE oauth_client_id=${q(resourceA.clientId)};`);
  assert.equal((await api(recordPath(),resourceA)).status,403);
  await sql(`UPDATE app_private.enrollments SET resource_subject=${q(resourceA.subject)} WHERE oauth_client_id=${q(resourceA.clientId)};`);
  await resourceState(resourceB,'suspend');assert.equal((await api(recordPath(),resourceB)).status,403);
  await resourceState(resourceB,'reactivate');assert.equal((await api(recordPath(),resourceB)).status,200);
  await resourceState(resourceB,'revoke');assert.equal((await api(recordPath(),resourceB)).status,403);
  assert.equal((await shareResource('record',privateRecord.id)).status,404);
  await resourceState(resourceA,'revoke');
  assert.equal((await api(recordPath(),resourceA)).status,403);assert.equal((await objectCall(objectPath(),resourceA)).status,403);
  assert.equal((await api('/v1/identity',resourceA)).status,200);
  assert.equal((await api('/v1/data/private_fixture',resourceA)).status,403);
});

test("application authority, state, approvals and audit persist across database and Core recreation",{timeout:180000},async()=>{
  assert.ok(app,"registration fixture must exist before restart");
  const snapshot={...app};
  await run("compose","restart","database");await run("compose","up","--detach","--no-deps","--force-recreate","data","core");
  let recovered=false; const deadline=Date.now()+90000;
  while(Date.now()<deadline){try{const response=await api(path(),owner);if(response.status===200){assert.deepEqual(await response.json(),snapshot);recovered=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
  assert.ok(recovered,"persistent application survives actual database/Core restart");
  const accessDeadline=Date.now()+30000;
  let revokedStatus;
  do {
    revokedStatus=(await api(recordPath(),resourceA)).status;
    if(revokedStatus!==503) break;
    await new Promise(resolve=>setTimeout(resolve,500));
  } while(Date.now()<accessDeadline);
  assert.equal(revokedStatus,403,'revocation must persist once stale provider connections recover');
  assert.equal((await objectCall(objectPath(),resourceB)).status,403);
  const audit=await sql(`SELECT count(*) FROM app_private.audit WHERE resource_id=${q(app.appId)};`);assert.ok(Number(audit.stdout.trim())>=4);
  assert.equal((await mutate("state",{action:"revoke",reason:"technical"})).status,200);assert.equal(app.state,"revoked");
  assert.equal((await mutate("state",{action:"reactivate",reason:"technical",approvalId:randomUUID()})).status,409);
  assert.equal((await api("/v1/applications",owner,{displayName:app.displayName,oauthClientId:app.oauthClientId,providerOrigin:app.providerOrigin})).status,409);
  await sql(`UPDATE app_private.principals SET enabled=false WHERE subject=${q(owner.id)};`);
  assert.equal((await api(path(),owner)).status,403,"operator revocation is checked live");
});
