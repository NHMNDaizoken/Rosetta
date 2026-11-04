// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Local demo data for the Console trust graph (development stacks only).
//   npm run trust:demo              enroll demo apps, publish capabilities, create grants
//   npm run trust:demo -- token     print a short-lived approver token for the Console
// Everything goes through the real Gateway with the reviewed separation of duties:
// the demo owner registers and proposes, the independent demo approver approves and
// activates. Running it again reuses what already exists.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { APPROVER_PERMISSIONS, OWNER_PERMISSIONS, connectDemoStack, enrollApplication, q, step } from "./lib/demo-stack.mjs";
import { renderEnv } from "./enroll-app.mjs";

export const DEMO_APPS = [
  { name: "daotao", displayName: "Phòng Đào tạo" },
  { name: "thuvien", displayName: "Thư viện" },
  { name: "ktx", displayName: "Ký túc xá" },
  { name: "taichinh", displayName: "Phòng Tài chính" },
];

export const DEMO_CAPABILITIES = [
  { provider: "daotao", name: "student-lookup", title: "Tra cứu sinh viên", description: "Trả về thông tin cơ bản của một sinh viên theo mã số." },
  { provider: "daotao", name: "transcript", title: "Bảng điểm", description: "Trả về bảng điểm tóm tắt của một sinh viên." },
  { provider: "taichinh", name: "tuition-status", title: "Trạng thái học phí", description: "Cho biết sinh viên đã hoàn thành học phí học kỳ hay chưa." },
];

// The final state each grant should reach; days = validity from now.
export const DEMO_GRANTS = [
  { provider: "daotao", capability: "student-lookup", consumer: "thuvien", operations: ["discover", "invoke"], days: 30, target: "active" },
  { provider: "daotao", capability: "student-lookup", consumer: "ktx", operations: ["invoke"], days: 3, target: "active" },
  { provider: "taichinh", capability: "tuition-status", consumer: "daotao", operations: ["discover", "invoke"], days: 60, target: "active" },
  { provider: "daotao", capability: "transcript", consumer: "ktx", operations: ["invoke"], days: 14, target: "pending" },
  { provider: "taichinh", capability: "tuition-status", consumer: "thuvien", operations: ["discover"], days: 20, target: "revoked" },
];

export function parseArgs(argv) {
  const options = { command: "seed", tenant: "tenant-a" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tenant") options.tenant = argv[++i];
    else if (arg === "seed" || arg === "token") options.command = arg;
    else throw new Error(`Unknown argument ${arg}. Use seed or token.`);
  }
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(options.tenant ?? "")) throw new Error("Invalid --tenant");
  return options;
}

export function manifestFor(template, appId, capability) {
  const path = `/capabilities/${capability.name}`;
  return { ...structuredClone(template), capabilityId: `urn:junctura:capability:${appId}:${capability.name}`, providerAppId: appId,
    version: "1.0.0", title: capability.title, description: capability.description,
    invocation: { ...template.invocation, path }, requiredPermissions: [`urn:junctura:permission:${appId}:invoke`] };
}

// A grant "already exists" when the graph shows the same provider, consumer and
// exact capability in its target state, or still live for an active/pending target.
export function existingGrant(edges, grant, ids, capabilityId) {
  const wanted = grant.target === "revoked" ? ["revoked"] : ["active", "pending"];
  return edges.find(e => e.providerAppId === ids[grant.provider] && e.consumerAppId === ids[grant.consumer] &&
    e.capabilityId === capabilityId && e.version === "1.0.0" && wanted.includes(e.state));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const stack = await connectDemoStack({ tenant: options.tenant });
  const { api, must, sql } = stack;
  await stack.ensureManagementClient();

  if (options.command === "token") {
    const approver = await stack.human("approver", APPROVER_PERMISSIONS);
    console.log("Token người duyệt (hết hạn sau vài phút, chỉ dùng cho demo local).");
    console.log("Console → Cài đặt hệ thống: bật LIVE, dán token, rồi mở Chia sẻ năng lực hoặc Bảo mật & Hoạt động.\n");
    console.log(approver.token);
    return;
  }

  step("Demo owner and independent approver");
  const owner = await stack.human("owner", OWNER_PERMISSIONS);
  const approver = await stack.human("approver", APPROVER_PERMISSIONS);

  const ids = {};
  const subjects = {};
  for (const demo of DEMO_APPS) {
    const clientId = `app-${demo.name}`;
    const row = await sql(`SELECT a.app_id||'|'||a.state||'|'||coalesce(e.resource_subject,'') FROM app_private.applications a
      JOIN app_private.enrollments e ON (e.tenant_id,e.issuer,e.oauth_client_id)=(a.tenant_id,a.issuer,a.oauth_client_id)
      WHERE a.tenant_id=${q(options.tenant)} AND a.issuer=${q(stack.issuer)} AND a.oauth_client_id=${q(clientId)};`);
    if (row) {
      const [appId, state, subject] = row.split("|");
      if (state !== "active") throw new Error(`${clientId} exists but is ${state}; reactivate it or use another tenant`);
      ids[demo.name] = appId; subjects[demo.name] = subject;
      step(`${demo.displayName} already enrolled`);
      continue;
    }
    const output = resolve(`.env.app.${demo.name}.local`);
    if (existsSync(output)) throw new Error(`${output} exists but ${clientId} is not registered; remove the stale file first`);
    const { app, clientSecret, subject } = await enrollApplication(stack,
      { clientId, origin: `https://${clientId}.junctura.local`, displayName: demo.displayName }, owner, approver);
    writeFileSync(output, renderEnv({ baseUrl: stack.base, tenant: options.tenant, appId: app.appId, clientId, clientSecret }), { flag: "wx", mode: 0o600 });
    ids[demo.name] = app.appId; subjects[demo.name] = subject;
  }

  const template = JSON.parse(readFileSync(new URL("../docs/contracts/examples/capability-manifest.json", import.meta.url), "utf8"));
  const published = {};
  for (const capability of DEMO_CAPABILITIES) {
    const appId = ids[capability.provider];
    const manifest = manifestFor(template, appId, capability);
    const path = `/v1/capabilities/${encodeURIComponent(manifest.capabilityId)}/versions`;
    let response = await api(`${path}/1.0.0`, owner.token);
    if (response.status === 404) response = await must(await api(path, owner.token, manifest), [201], `Register ${capability.title}`);
    else await must(response, [200], `Read ${capability.title}`);
    let etag = response.headers.get("etag");
    let value = await response.json();
    if (value.state === "draft") {
      step(`Validate, approve and publish ${capability.title}`);
      const validated = await must(await api(`${path}/1.0.0/validate`, owner.token, {}, { "If-Match": etag }), [200], `Validate ${capability.title}`);
      etag = validated.headers.get("etag") ?? etag;
      value = { ...value, ...(await validated.json()) };
      const decision = await must(await api("/v1/approvals", approver.token, { resourceType: "capability-version",
        resourceId: `${manifest.capabilityId}@1.0.0`, resourceDigest: value.digest, resourceRevision: value.revision,
        requesterSubject: owner.id, requesterAppId: appId, decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString() }), [201], "Approve publication");
      const done = await must(await api(`${path}/1.0.0/publish`, owner.token, { approvalId: (await decision.json()).approvalId }, { "If-Match": etag }), [200], `Publish ${capability.title}`);
      value = await done.json();
    } else if (value.state !== "published") {
      throw new Error(`${capability.title} is ${value.state}; use another tenant for a fresh demo`);
    } else step(`${capability.title} already published`);
    published[`${capability.provider}/${capability.name}`] = value;
  }

  const graph = await (await must(await api("/v1/trust/graph", approver.token), [200], "Read trust graph")).json();
  for (const grant of DEMO_GRANTS) {
    const capability = published[`${grant.provider}/${grant.capability}`];
    const label = `${grant.provider} → ${grant.consumer} (${capability.manifest.title}, ${grant.target})`;
    if (existingGrant(graph.edges, grant, ids, capability.capabilityId)) { step(`Grant ${label} already present`); continue; }
    step(`Grant ${label}`);
    const created = await must(await api("/v1/trust/grants", owner.token, {
      providerAppId: ids[grant.provider], consumerAppId: ids[grant.consumer],
      capabilities: [{ capabilityId: capability.capabilityId, version: capability.version, manifestDigest: capability.digest }],
      operations: grant.operations, permissions: capability.manifest.requiredPermissions, subjectIds: [subjects[grant.consumer]],
      expiresAt: new Date(Date.now() + grant.days * 86_400_000).toISOString(), delegationAllowed: false, acceptDelegation: false,
    }), [201], "Propose grant");
    let etag = created.headers.get("etag");
    const proposal = await created.json();
    if (grant.target === "pending") continue;
    const decision = await must(await api("/v1/approvals", approver.token, { resourceType: "grant", resourceId: proposal.grantId,
      resourceDigest: proposal.digest, resourceRevision: proposal.revision, requesterSubject: owner.id, requesterAppId: ids[grant.provider],
      decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString() }), [201], "Approve grant");
    const activated = await must(await api(`/v1/trust/grants/${proposal.grantId}/activate`, approver.token,
      { approvalId: (await decision.json()).approvalId }, { "If-Match": etag }), [200], "Activate grant");
    etag = activated.headers.get("etag");
    if (grant.target === "revoked") {
      await must(await api(`/v1/trust/grants/${proposal.grantId}/revoke`, owner.token, { reason: "Demo: kết thúc hợp tác" }, { "If-Match": etag }), [200], "Revoke grant");
    }
  }

  console.log(`\n✔ Dữ liệu sơ đồ tin cậy đã sẵn sàng cho ${options.tenant}.`);
  console.log("  Lấy token cho Console: npm run trust:demo -- token");
  console.log("  Console → Cài đặt hệ thống: bật LIVE, dán token → Chia sẻ năng lực.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`✖ ${error.message}`); process.exitCode = 1; });
}
