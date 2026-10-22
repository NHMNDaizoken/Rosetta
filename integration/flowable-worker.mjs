// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Private-engine contract probe only; this is not a production worker.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { test } from "node:test";

test("pinned Flowable external-worker REST supports locking, failure and completion but not tenant-filtered acquire", { timeout: 30000 }, async () => {
  const script = `
    import assert from 'node:assert/strict';
    const root = 'http://workflow:8080/flowable-rest';
    const authorization = 'Basic '+Buffer.from('rosetta-engine:'+process.env.WORKFLOW_ADMIN_PASSWORD).toString('base64');
    async function call(path, body, method='POST') {
      return fetch(root+path,{method,headers:{Authorization:authorization,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
    }
    const topic = 'review-${randomUUID()}';
    const xml = '<?xml version="1.0"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn" targetNamespace="urn:rosetta:review"><process id="'+topic+'" isExecutable="true"><startEvent id="s"/><sequenceFlow id="a" sourceRef="s" targetRef="w"/><serviceTask id="w" flowable:type="external-worker" flowable:topic="'+topic+'"/><sequenceFlow id="b" sourceRef="w" targetRef="e"/><endEvent id="e"/></process></definitions>';
    let deployment;
    try {
      const form=new FormData(); form.append('file',new Blob([xml],{type:'application/xml'}),'review.bpmn20.xml');
      let r=await call('/service/repository/deployments?tenantId=tenant-b',form); assert.equal(r.status,201); deployment=(await r.json()).id;
      r=await call('/service/repository/process-definitions?deploymentId='+deployment,undefined,'GET'); const definition=(await r.json()).data[0]; assert.equal(definition.tenantId,'tenant-b');
      r=await call('/service/runtime/process-instances',{processDefinitionId:definition.id}); assert.equal(r.status,201); const processId=(await r.json()).id;
      const acquire=(workerId)=>call('/external-job-api/acquire/jobs',{topic,workerId,lockDuration:'PT30S',numberOfTasks:1,scopeType:'bpmn',tenantId:'tenant-a'});
      r=await acquire('review-one'); assert.equal(r.status,200); let jobs=await r.json(); assert.equal(jobs.length,1); const id=jobs[0].id;
      assert.equal(jobs[0].tenantId,'tenant-b','tenantId in acquire body is NOT a filter');
      assert.equal((await (await acquire('review-two')).json()).length,0,'lock excludes concurrent acquisition');
      assert.equal((await call('/external-job-api/acquire/jobs/'+id+'/complete',{workerId:'wrong'})).status,403);
      assert.equal((await call('/external-job-api/acquire/jobs/'+id+'/fail',{workerId:'review-one',retries:1,retryTimeout:'PT0S',errorMessage:'technical review'})).status,204);
      r=await call('/service/runtime/process-instances',{processDefinitionId:definition.id}); assert.equal(r.status,201); const second=(await r.json()).id;
      r=await acquire('review-three'); jobs=await r.json(); const next=jobs.find(job=>job.processInstanceId===second); assert.ok(next);
      assert.equal((await call('/external-job-api/acquire/jobs/'+next.id+'/complete',{workerId:'review-three',variables:[]})).status,204);
      let finished=false; const deadline=Date.now()+20000; do { r=await call('/service/history/historic-process-instances/'+second,undefined,'GET'); if((await r.json()).endTime){finished=true;break;} await new Promise(resolve=>setTimeout(resolve,500)); } while(Date.now()<deadline); assert.ok(finished,'completion eventually advances the engine');
      console.log('acquire=200; exclusive lock verified; lock-expiry recovery timing unverified; wrong owner=403; fail/complete=204; tenant filter absent');
    } finally { if(deployment) { let cleanup; for(let n=0;n<5;n++){cleanup=await call('/service/repository/deployments/'+deployment+'?cascade=true',undefined,'DELETE');if(cleanup.status===204)break;await new Promise(resolve=>setTimeout(resolve,500));} assert.equal(cleanup.status,204,await cleanup.text()); } }
  `;
  await new Promise((resolve, reject) => {
    const child=spawn('docker',['compose','exec','-T','core','node','--input-type=module','-'],{stdio:['pipe','pipe','pipe']});
    let output=''; child.stdout.on('data',chunk=>output+=chunk); child.stderr.on('data',chunk=>output+=chunk);
    child.on('error',reject); child.on('close',code=>{ assert.equal(code,0,output); resolve(); }); child.stdin.end(script);
  });
});
