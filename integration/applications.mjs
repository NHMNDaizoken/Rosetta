// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { before, after, test } from "node:test";
import { promisify } from "node:util";

const base=process.env.PUBLIC_URL ?? "http://127.0.0.1:8080";
const issuer=`${base}/identity/realms/rosetta`;
const prefix=`app-test-${randomBytes(6).toString("hex")}`;
const clientIds=[], users=[];
let adminToken, owner, approver, foreign, stranger, serviceToken, app, etag;
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
async function login(username,password,clientId) {
  const verifier=randomBytes(32).toString("base64url");
  const params=new URLSearchParams({client_id:clientId,response_type:"code",scope:"openid",redirect_uri:"http://127.0.0.1:9876/callback",code_challenge_method:"S256",code_challenge:createHash("sha256").update(verifier).digest("base64url")});
  const page=await fetch(`${issuer}/protocol/openid-connect/auth?${params}`,{redirect:"manual"});
  const cookies=page.headers.getSetCookie().map(v=>v.split(";",1)[0]).join("; ");
  const action=(await page.text()).match(/<form[^>]*action="([^"]+)"/); assert.ok(action);
  const response=await fetch(action[1].replaceAll("&amp;","&"),{method:"POST",redirect:"manual",headers:{Cookie:cookies},body:new URLSearchParams({username,password,credentialId:""})});
  assert.equal(response.status,302,"real human PKCE authentication");
  const code=new URL(response.headers.get("location")).searchParams.get("code"); assert.ok(code);
  const tokens=await fetch(`${issuer}/protocol/openid-connect/token`,{method:"POST",body:new URLSearchParams({grant_type:"authorization_code",client_id:clientId,redirect_uri:"http://127.0.0.1:9876/callback",code,code_verifier:verifier})});
  assert.equal(tokens.status,200); return (await tokens.json()).access_token;
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
    await sql(`DELETE FROM app_private.audit WHERE subject IN (${ids}); DELETE FROM app_private.approvals WHERE app_id IN (SELECT app_id FROM app_private.applications WHERE owner_subject IN (${ids})); DELETE FROM app_private.applications WHERE owner_subject IN (${ids}); DELETE FROM app_private.enrollments WHERE owner_subject IN (${ids}); DELETE FROM app_private.principals WHERE subject IN (${ids});`);
  }
  for(const id of clientIds) assert.equal((await admin(`clients/${id}`,undefined,"DELETE")).status,204);
  for(const id of users) assert.equal((await admin(`users/${id}`,undefined,"DELETE")).status,204);
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

test("application authority, state, approvals and audit persist across database and Core recreation",{timeout:180000},async()=>{
  assert.ok(app,"registration fixture must exist before restart");
  const snapshot={...app};
  await run("compose","restart","database");await run("compose","up","--detach","--no-deps","--force-recreate","data","core");
  let recovered=false; const deadline=Date.now()+90000;
  while(Date.now()<deadline){try{const response=await api(path(),owner);if(response.status===200){assert.deepEqual(await response.json(),snapshot);recovered=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
  assert.ok(recovered,"persistent application survives actual database/Core restart");
  const audit=await sql(`SELECT count(*) FROM app_private.audit WHERE resource_id=${q(app.appId)};`);assert.ok(Number(audit.stdout.trim())>=4);
  assert.equal((await mutate("state",{action:"revoke",reason:"technical"})).status,200);assert.equal(app.state,"revoked");
  assert.equal((await mutate("state",{action:"reactivate",reason:"technical",approvalId:randomUUID()})).status,409);
  assert.equal((await api("/v1/applications",owner,{displayName:app.displayName,oauthClientId:app.oauthClientId,providerOrigin:app.providerOrigin})).status,409);
  await sql(`UPDATE app_private.principals SET enabled=false WHERE subject=${q(owner.id)};`);
  assert.equal((await api(path(),owner)).status,403,"operator revocation is checked live");
});
