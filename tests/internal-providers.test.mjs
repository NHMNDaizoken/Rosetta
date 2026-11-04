// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { X509Certificate } from "node:crypto";
import tls from "node:tls";
import { createProviderNetwork, isPrivateAddress, ProviderNetworkError } from "../src/modules/capability/execution/provider-network.mjs";
import { loadConfig } from "../src/bootstrap/config.mjs";
import { providerNetworkOptions } from "../src/bootstrap/container.mjs";
import { issueCertificate } from "../scripts/lib/x509.mjs";
import { ensurePki, hostFor, parseArgs } from "../scripts/provider-pki.mjs";

const TICKET = "a".repeat(43);
const OPERATION = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://tramyte.provider.internal:8443";
const ca = issueCertificate({ subject: { commonName: "Test provider CA" }, days: 30 });
const internal = (resolve, overrides = {}) => createProviderNetwork({ origins: [], internalOrigins: [ORIGIN], internalCa: ca.cert, resolve, ...overrides });
const code = expected => error => error instanceof ProviderNetworkError && error.code === expected;
const reached = new Error("reached dispatch");

test("private address policy admits only RFC 1918 and unique-local addresses", () => {
  for (const address of ["10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.1.10", "fd12:3456::1", "fc00::1", "::ffff:10.1.2.3"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["127.0.0.1", "::1", "0.0.0.0", "169.254.169.254", "fd00:ec2::254", "100.64.0.1", "172.32.0.1",
    "fe80::1", "8.8.8.8", "2606:4700::1111", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "224.0.0.1", "not-an-ip"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test("internal origins must be exact https .internal origins with the provider CA, listed once", () => {
  for (const origin of ["http://tramyte.provider.internal", "https://tramyte.example.org", "https://10.0.0.5", "https://internal",
    "https://tramyte.provider.internal/path", "https://user@tramyte.provider.internal", "https://TRAMYTE.provider.internal"]) {
    assert.throws(() => createProviderNetwork({ origins: [], internalOrigins: [origin], internalCa: ca.cert }), /invalid internal origin/, origin);
  }
  assert.throws(() => createProviderNetwork({ origins: [], internalOrigins: [ORIGIN] }), /provider CA/);
  assert.throws(() => createProviderNetwork({ origins: [], internalOrigins: [ORIGIN], internalCa: "not a certificate" }), /provider CA/);
  assert.throws(() => createProviderNetwork({ origins: ["https://provider.example"], internalCa: ca.cert }), /only accepted for internal/);
  assert.throws(() => createProviderNetwork({ origins: [], testOrigins: [ORIGIN], testAddresses: ["10.0.0.5"], allowTestNetwork: true,
    internalOrigins: [ORIGIN], internalCa: ca.cert }), /listed twice/);
  assert.ok(internal(async () => []));
});

test("internal providers resolve only to private addresses before any connection", async () => {
  let dispatched = 0;
  const beforeConnect = () => { dispatched++; throw reached; };
  const call = network => network.postJson(ORIGIN, "/capabilities/vaccination", {}, { ticket: TICKET, operationId: OPERATION, beforeConnect });
  await assert.rejects(call(internal(async () => [{ address: "172.18.0.7", family: 4 }])), error => error === reached);
  await assert.rejects(call(internal(async () => [{ address: "fd00:1::7", family: 6 }])), error => error === reached);
  assert.equal(dispatched, 2, "private addresses pass the policy and reach the dispatch guard");
  for (const answers of [[{ address: "8.8.8.8" }], [{ address: "127.0.0.1" }], [{ address: "::1" }], [{ address: "169.254.169.254" }],
    [{ address: "10.0.0.5" }, { address: "8.8.8.8" }], [{ address: "100.64.1.1" }]]) {
    const network = internal(async () => answers);
    await assert.rejects(call(network), error => code("address_not_allowed")(error) || code("private_address_forbidden")(error), JSON.stringify(answers));
  }
  assert.equal(dispatched, 2, "rejected answers never reach dispatch");
  await assert.rejects(internal(async () => []).postJson("https://other.provider.internal:8443", "/x", {}, { ticket: TICKET, operationId: OPERATION }), code("origin_not_allowed"));
});

test("public origins keep the public-only policy next to internal ones", async () => {
  const network = createProviderNetwork({ origins: ["https://provider.example"], internalOrigins: [ORIGIN], internalCa: ca.cert,
    resolve: async () => [{ address: "10.0.0.5", family: 4 }] });
  await assert.rejects(network.postJson("https://provider.example", "/echo", {}, { ticket: TICKET, operationId: OPERATION }), code("private_address_forbidden"));
});

test("configuration requires PROVIDER_CA_FILE for internal origins and reads it once", () => {
  const base = { OIDC_ISSUER: "https://id.example/realms/x", CORE_CLIENT_SECRET: "s", IDENTITY_URL: "http://identity", C4A_ENABLED: "true" };
  assert.throws(() => loadConfig({ ...base, C4A_INTERNAL_PROVIDER_ORIGINS: JSON.stringify([ORIGIN]) }), /PROVIDER_CA_FILE/);
  assert.throws(() => loadConfig({ ...base, C4A_INTERNAL_PROVIDER_ORIGINS: "not json" }), /JSON array/);
  const { execution } = loadConfig({ ...base, C4A_INTERNAL_PROVIDER_ORIGINS: JSON.stringify([ORIGIN]), PROVIDER_CA_FILE: "/run/ca.crt" });
  assert.deepEqual(execution, { providerOrigins: [], internalOrigins: [ORIGIN], providerCaFile: "/run/ca.crt" });
  const reads = [];
  const options = providerNetworkOptions(execution, path => { reads.push(path); return ca.cert; });
  assert.deepEqual(reads, ["/run/ca.crt"]);
  assert.deepEqual(options, { origins: [], internalOrigins: [ORIGIN], internalCa: ca.cert });
  assert.deepEqual(providerNetworkOptions({ providerOrigins: ["https://p.example"], internalOrigins: [] }, () => assert.fail("no read")), { origins: ["https://p.example"] });
});

test("issued certificates chain to the provider CA and fail for other names", async () => {
  const leaf = issueCertificate({ subject: { commonName: "tramyte.provider.internal" }, dnsNames: ["tramyte.provider.internal"], issuer: ca, days: 30 });
  const root = new X509Certificate(ca.cert), server = new X509Certificate(leaf.cert);
  assert.equal(root.ca, true); assert.equal(server.ca, false);
  assert.ok(server.checkIssued(root) && server.verify(root.publicKey));
  assert.equal(server.subjectAltName, "DNS:tramyte.provider.internal");
  assert.throws(() => issueCertificate({ subject: { commonName: "x" }, dnsNames: ["Bad_Name"], issuer: ca, days: 30 }), /DNS names/);
  const listener = tls.createServer({ key: leaf.key, cert: leaf.cert }, socket => socket.end("ok"));
  await new Promise(done => listener.listen(0, "127.0.0.1", done));
  const connect = servername => new Promise((done, fail) => {
    const socket = tls.connect({ host: "127.0.0.1", port: listener.address().port, servername, ca: ca.cert }, () => { socket.end(); done(socket.authorized); });
    socket.on("error", fail);
  });
  try {
    assert.equal(await connect("tramyte.provider.internal"), true);
    await assert.rejects(connect("benhvien.provider.internal"), /altnames|ALTNAME/i);
    const stranger = issueCertificate({ subject: { commonName: "Other CA" }, days: 30 });
    await assert.rejects(new Promise((done, fail) => {
      const socket = tls.connect({ host: "127.0.0.1", port: listener.address().port, servername: "tramyte.provider.internal", ca: stranger.cert }, done);
      socket.on("error", fail);
    }));
  } finally { listener.close(); }
});

test("provider:pki derives .internal hosts and reuses the CA and existing certificates", () => {
  assert.equal(hostFor("tramyte"), "tramyte.provider.internal");
  assert.equal(hostFor("lab.provider.internal"), "lab.provider.internal");
  for (const bad of ["Bad", "a_b", "x.example.org", ""]) assert.throws(() => hostFor(bad), undefined, bad);
  assert.deepEqual(parseArgs(["tramyte", "benhvien", "--port", "9443"]).hosts, ["tramyte.provider.internal", "benhvien.provider.internal"]);
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(["x", "--port", "0"]), /port/);
  const directory = mkdtempSync(join(tmpdir(), "junctura-pki-"));
  try {
    const first = ensurePki({ hosts: ["tramyte.provider.internal"], directory });
    assert.deepEqual(first.issued, ["tramyte.provider.internal"]);
    const caBefore = readFileSync(join(directory, "ca.crt"), "utf8");
    const second = ensurePki({ hosts: ["tramyte.provider.internal", "benhvien.provider.internal"], directory });
    assert.deepEqual(second.issued, ["benhvien.provider.internal"], "existing certificates are kept");
    assert.equal(readFileSync(join(directory, "ca.crt"), "utf8"), caBefore, "the CA is created once");
    const leaf = new X509Certificate(readFileSync(join(directory, "benhvien.provider.internal.crt")));
    assert.ok(leaf.checkIssued(new X509Certificate(caBefore)));
    if (process.platform !== "win32") {
      for (const key of ["ca.key", "tramyte.provider.internal.key"]) assert.equal(statSync(join(directory, key)).mode & 0o077, 0, `${key} is private`);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
