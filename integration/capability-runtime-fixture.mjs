// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { execFile, spawn } from "node:child_process";
import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { generateTls, removeTlsDirectory } from "./fixtures/tls.mjs";

const run = promisify(execFile);
async function docker(args, env) {
  try { return await run("docker", args, { env: env ?? process.env, timeout: 60000, maxBuffer: 2097152 }); }
  catch (error) { throw new Error(`C4A fixture Docker ${args[0]} failed (${error.code ?? "error"})`); }
}
function start(args, input, readyText) {
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  const ready = new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("C4A fixture startup timed out")), 30000);
    child.stdout.on("data", chunk => { output += chunk; if (output.includes(readyText)) { clearTimeout(timeout); resolve(); } });
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timeout); reject(new Error("C4A fixture process failed")); });
    child.on("exit", () => { clearTimeout(timeout); if (!output.includes(readyText)) reject(new Error("C4A fixture exited before ready")); });
  });
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(input));
  return { child, ready };
}

export async function createRuntimeFixture(options) {
  const suffix = randomUUID(), network = `rosetta-c4a-${suffix}`, provider = `rosetta-provider-${suffix}`, core = `rosetta-invoker-${suffix}`;
  const directory = mkdtempSync(join(tmpdir(), "rosetta-c4a-"));
  const providers = options.providers ?? [options];
  const hostname = new URL(options.origin ?? providers[0].origin).hostname;
  const hostnames = providers.map(item => new URL(item.origin).hostname);
  const tls = generateTls(directory, "provider", hostnames.map(host => `DNS:${host}`).join(","));
  // Readable only as synthetic test material. The production image receives no
  // keys; the Core fixture mounts only the public certificate, never this key.
  chmodSync(directory, 0o755); chmodSync(tls.keyPath, 0o644); chmodSync(tls.certPath, 0o644);
  let coreProcess, address, coreEnv, backendNetworks;
  const providerProcesses = [], providerNames = [], addresses = [];
  const forgedDeployments = [];
  async function close() {
    for (const deployment of forgedDeployments) await engine(`/service/repository/deployments/${deployment}?cascade=true`, undefined, "DELETE").catch(() => {});
    await docker(["rm", "--force", core]).catch(() => {});
    for (const name of providerNames) await docker(["rm", "--force", name]).catch(() => {});
    for (const child of providerProcesses) child.child.stdin.destroy();
    coreProcess?.child.stdin.destroy();
    await docker(["network", "rm", network]).catch(() => {});
    removeTlsDirectory(directory);
  }
  async function inside(program, payload) {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", ["exec", "-i", core, "node", "--input-type=module", "-"], { stdio: ["pipe", "pipe", "pipe"] });
      let output = ""; child.stdout.on("data", chunk => output += chunk); child.stderr.resume();
      child.on("error", () => reject(new Error("C4A fixture request failed")));
      child.on("close", code => { try { if (code !== 0) throw Error(); resolve(JSON.parse(output)); } catch { reject(new Error("C4A fixture request failed")); } });
      child.stdin.on("error", () => {});
      child.stdin.end(`try { const data=${JSON.stringify(payload)}; ${program} } catch { process.exitCode=1; }`);
    });
  }
  async function request(url, identity, body, headers = {}, method = body === undefined ? "GET" : "POST") {
    return inside(`const r=await fetch(data.url,{method:data.method,redirect:'error',headers:data.headers,
      body:data.body===undefined?undefined:data.body,signal:AbortSignal.timeout(15000)});
      const text=await r.text();let body;try{body=JSON.parse(text)}catch{body=null}
      console.log(JSON.stringify({status:r.status,body,headers:Object.fromEntries(['location','etag'].map(k=>[k,r.headers.get(k)]))}));`,
    { url, method, headers: { ...(identity ? { Authorization: `Bearer ${identity.token ?? identity}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
  }
  async function engine(path, body, method = body === undefined ? "GET" : "POST") {
    return inside(`const root=process.env.WORKFLOW_URL.replace(new RegExp('/service/?$'),'');
      const authorization='Basic '+Buffer.from('rosetta-engine:'+process.env.WORKFLOW_ADMIN_PASSWORD).toString('base64');
      let payload=data.body;
      if(data.body?.xml){payload=new FormData();payload.append('file',new Blob([data.body.xml],{type:'application/xml'}),'forged.bpmn20.xml')}
      const r=await fetch(root+data.path,{method:data.method,headers:{Authorization:authorization,...(payload instanceof FormData?{}:{'Content-Type':'application/json'})},
        body:payload===undefined?undefined:payload instanceof FormData?payload:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(5000)});
      const text=await r.text();let body;try{body=JSON.parse(text)}catch{body=null} console.log(JSON.stringify({status:r.status,body}));`, { path, body, method });
  }
  async function launchCore() {
    const envArgs = Object.keys(coreEnv).flatMap(key => ["--env", key]);
    await docker(["create", "-i", "--name", core, "--network", network, "--network-alias", "runtime.c4a.test",
      "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", ...envArgs,
      "--mount", `type=bind,source=${resolve("integration/fixtures")},target=/fixtures,readonly`,
      "--mount", `type=bind,source=${tls.certPath},target=/tls/provider-ca.pem,readonly`,
      "rosetta-core:local", "node", "/fixtures/capability-core.mjs"], { ...process.env, ...coreEnv });
    for (const backendNetwork of backendNetworks) await docker(["network", "connect", backendNetwork, core]);
    coreProcess = start(["start", "--attach", "--interactive", core], { origin: options.origin, address, origins: providers.map(item => item.origin), addresses, composition: options.composition === true }, "runtime-ready");
    await coreProcess.ready;
  }
  try {
    await docker(["network", "create", "--internal", network]);
    for (const [index, item] of providers.entries()) {
      const providerName = `${provider}-${index}`, host = hostnames[index];
      providerNames.push(providerName);
    const providerProcess = start(["run", "--rm", "-i", "--name", providerName, "--network", network, "--network-alias", host,
      "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
      "--mount", `type=bind,source=${resolve("integration/fixtures")},target=/fixtures,readonly`,
      "--mount", `type=bind,source=${directory},target=/tls,readonly`, "rosetta-core:local", "node", "/fixtures/capability-provider.mjs"],
    { coreUrl: "http://runtime.c4a.test:8080", oidcToken: item.token, providerAppId: item.providerAppId,
      capability: item.capability, tenantId: item.tenantId }, "provider-ready");
    providerProcesses.push(providerProcess);
    await providerProcess.ready;
    address = JSON.parse((await docker(["inspect", providerName])).stdout)[0].NetworkSettings.Networks[network].IPAddress;
      addresses.push(address);
    }
    const baselineId = (await docker(["compose", "ps", "-q", "core"])).stdout.trim();
    const baseline = JSON.parse((await docker(["inspect", baselineId])).stdout)[0];
    const forwarded = new Set(["HOST", "PORT", "NODE_ENV", "OIDC_ISSUER", "IDENTITY_URL", "CORE_CLIENT_SECRET", "DATA_URL", "DATA_JWT_SECRET",
      "WORKFLOW_URL", "WORKFLOW_ADMIN_PASSWORD"]);
    coreEnv = Object.fromEntries(baseline.Config.Env.map(pair => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)])
      .filter(([key]) => forwarded.has(key)));
    // Explicit connections avoid Compose's service aliases: the public gateway
    // must continue resolving only its original Core, never this test runtime.
    backendNetworks = Object.keys(baseline.NetworkSettings.Networks).filter(value => !value.endsWith("_edge"));
    await launchCore();
  } catch (error) { await close(); throw error; }
  return {
    api: (path, who, body, headers, method) => request(`http://127.0.0.1:8080${path}`, who, body, headers, method),
    control: action => request(`http://127.0.0.1:8081/${action}`, null),
    providerState: (index = 0) => request(`http://${hostnames[index]}:8081/state`, null),
    mode: (mode, index = 0) => request(`http://${hostnames[index]}:8081/mode`, null, { mode }),
    engine,
    async forgeJob(tenantId = "tenant-b", { businessKey = `forged:${randomUUID()}`, elementId = "invoke" } = {}) {
      const key = `forged_${randomUUID().replaceAll("-", "")}`;
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(elementId)) throw new Error("Invalid technical element");
      const xml = `<?xml version="1.0"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn" targetNamespace="urn:rosetta:test"><process id="${key}" isExecutable="true"><startEvent id="s"/><sequenceFlow id="a" sourceRef="s" targetRef="${elementId}"/><serviceTask id="${elementId}" flowable:type="external-worker" flowable:topic="${options.composition ? "rosetta-c4b-step" : "rosetta-c4a-invoke"}"/><sequenceFlow id="b" sourceRef="${elementId}" targetRef="e"/><endEvent id="e"/></process></definitions>`;
      const deployment = await engine(`/service/repository/deployments?tenantId=${tenantId}`, { xml });
      if (deployment.status !== 201) throw new Error("Could not create forged technical job");
      forgedDeployments.push(deployment.body.id);
      const definitions = await engine(`/service/repository/process-definitions?deploymentId=${deployment.body.id}`);
      const started = await engine("/service/runtime/process-instances", { processDefinitionId: definitions.body.data[0].id, businessKey });
      return started.body.id;
    },
    async restart() {
      const previous = await request("http://127.0.0.1:8081/restart", null);
      const deadline = Date.now() + 5000;
      do {
        try { const next = await request("http://127.0.0.1:8081/pause", null); if (next.body.pid !== previous.body.pid) return; } catch {}
        await new Promise(resolve => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      throw new Error("Core fixture process did not restart");
    },
    close,
  };
}
