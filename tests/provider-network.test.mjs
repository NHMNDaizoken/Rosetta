// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProviderNetwork,
  isForbiddenAddress,
  isMetadataAddress,
  ProviderNetworkError,
} from "../src/modules/capability/execution/provider-network.mjs";

const TICKET = "a".repeat(43);
const OPERATION = "11111111-1111-4111-8111-111111111111";
const testNetwork = (overrides = {}) => createProviderNetwork({
  origins: [], testOrigins: ["https://provider.example:9443"], testAddresses: ["127.0.0.1"],
  allowTestNetwork: true, ...overrides,
});
const timeoutCode = (code) => (error) => error instanceof ProviderNetworkError && error.code === code;

test("address policy denies special, reserved, translation and private ranges", () => {
  for (const address of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "100.100.100.200", "127.0.0.1", "169.254.169.254",
    "172.16.5.4", "192.168.1.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fec0::1",
    "fd00:ec2::254", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254",
    "::ffff:0:7f00:1", "::ffff:0:a9fe:a9fe", "64:ff9b::10.0.0.1", "64:ff9b:1::1", "2002:7f00:1::", "2001:0::1",
    "2001:2::1", "2001:10::1", "2001:20::1", "2001:db8::1", "3fff::1", "5f00::1"]) {
    assert.equal(isForbiddenAddress(address), true, address);
  }
  for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8", "2001:4860:4860::8888"]) {
    assert.equal(isForbiddenAddress(address), false, address);
  }
});

test("metadata aliases are detected in expanded, hex and mapped forms", () => {
  for (const address of ["169.254.169.254", "100.100.100.200", "fd00:ec2::254", "fd00:0ec2:0:0:0:0:0:0254",
    "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:a9fe:a9fe".toUpperCase(),
    "::ffff:0:169.254.169.254", "::ffff:0:a9fe:a9fe", "::a9fe:a9fe"]) {
    assert.equal(isMetadataAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "::ffff:8.8.8.8", "2606:4700::1111", "fd00:ec2::253"]) {
    assert.equal(isMetadataAddress(address), false, address);
  }
});

test("approved origins and provider protocol fields are strict", async () => {
  const local = "https://provider.example:9443";
  const network = testNetwork();
  await assert.rejects(network.postJson("https://other.example", "/echo", {}, { ticket: TICKET, operationId: OPERATION }),
    timeoutCode("origin_not_allowed"));
  for (const path of ["/../secret", "//evil", "/a%2Fb", "/a?x=1", "/a#b", "https://provider.example/echo",
    "/a//b", "/", "/a/", `/${"a".repeat(256)}`]) {
    await assert.rejects(network.postJson(local, path, {}, { ticket: TICKET, operationId: OPERATION }),
      timeoutCode("path_not_allowed"), path);
  }
  await assert.rejects(network.postJson(local, "/a/b", {}, { ticket: "short", operationId: OPERATION }), timeoutCode("invalid_ticket"));
  await assert.rejects(network.postJson(local, "/a/b", {}, { ticket: TICKET, operationId: "not-a-uuid" }), timeoutCode("invalid_operation_id"));
  await assert.rejects(network.postJson(local, "/a/b", {}, { ticket: TICKET }), timeoutCode("invalid_operation_id"));
});

test("request size, timeout bounds and test configuration guards are strict", async () => {
  let resolutions = 0;
  const network = testNetwork({ maxRequestBytes: 32, resolve: async () => { resolutions++; return [{ address: "127.0.0.1", family: 4 }]; } });
  await assert.rejects(network.postJson("https://provider.example:9443", "/echo", { value: "x".repeat(64) },
    { ticket: TICKET, operationId: OPERATION }), timeoutCode("request_too_large"));
  await assert.rejects(network.postJson("https://provider.example:9443", "/echo", {},
    { ticket: TICKET, operationId: OPERATION, timeoutMs: 99 }), timeoutCode("invalid_timeout"));
  assert.equal(resolutions, 0);

  assert.throws(() => createProviderNetwork({ origins: [], testOrigins: ["https://provider.example"], allowTestNetwork: true }), /exact test addresses/);
  assert.throws(() => createProviderNetwork({ origins: [], testOrigins: ["https://provider.example"], testAddresses: ["127.0.0.1"] }), /allowTestNetwork/);
  assert.throws(() => createProviderNetwork({ origins: [], allowTestNetwork: true, testAddresses: ["127.0.0.1"] }), /exact test origins/);
  assert.throws(() => createProviderNetwork({ origins: [], testAddresses: ["127.0.0.1"] }), /exact test origins/);
  assert.throws(() => createProviderNetwork({ origins: ["https://provider.example"], testAddresses: ["127.0.0.1"] }), /test addresses require/);
  assert.throws(() => createProviderNetwork({ origins: ["https://provider.example"], ca: "x" }), /custom CA/);
  assert.throws(() => createProviderNetwork({ origins: [], maxResponseBytes: 65537 }), /65536/);
  assert.throws(() => createProviderNetwork({ origins: [], maxRequestBytes: 65537 }), /65536/);
  assert.throws(() => createProviderNetwork({ origins: ["http://provider.example"] }), /invalid origin/);
  assert.throws(() => createProviderNetwork({ origins: ["https://provider.example/path"] }), /invalid origin/);
  assert.throws(() => createProviderNetwork({ origins: ["https://127.0.0.1"] }), /invalid origin/);
  assert.throws(() => createProviderNetwork({ origins: [], testOrigins: ["https://provider.example"], testAddresses: ["999.1.1.1"], allowTestNetwork: true }), /invalid test address/);
});

test("test-network bypass allows only exact configured fixture addresses", async () => {
  let resolutions = 0;
  const drifting = testNetwork({
    testAddresses: ["127.0.0.1"], resolve: async () => { resolutions++; return [{ address: "127.0.0.2", family: 4 }]; },
  });
  await assert.rejects(drifting.postJson("https://provider.example:9443", "/echo", {}, { ticket: TICKET, operationId: OPERATION }),
    timeoutCode("address_not_allowed"));
  assert.equal(resolutions, 1);

  for (const address of ["169.254.169.254", "fd00:0ec2:0:0:0:0:0:0254", "::ffff:169.254.169.254", "::FFFF:A9FE:A9FE",
    "::ffff:0:a9fe:a9fe", "0:0:0:0:0:ffff:a9fe:a9fe"]) {
    const metadata = testNetwork({
      testAddresses: [address], resolve: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
    });
    await assert.rejects(metadata.postJson("https://provider.example:9443", "/echo", {}, { ticket: TICKET, operationId: OPERATION }),
      timeoutCode("private_address_forbidden"), address);
  }
});

test("production policy rejects mixed answers, rebinding and resolver failures", async () => {
  let resolutions = 0;
  const mixed = createProviderNetwork({
    origins: ["https://provider.example"],
    resolve: async () => { resolutions++; return [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]; },
  });
  await assert.rejects(mixed.postJson("https://provider.example", "/echo", {}, { ticket: TICKET, operationId: OPERATION }),
    timeoutCode("private_address_forbidden"));
  assert.equal(resolutions, 1);

  let rebound = 0;
  const mapped = createProviderNetwork({
    origins: ["https://provider.example"],
    resolve: async () => { rebound++; return [{ address: "::ffff:127.0.0.1", family: 6 }]; },
  });
  await assert.rejects(mapped.postJson("https://provider.example", "/echo", {}, { ticket: TICKET, operationId: OPERATION }),
    timeoutCode("private_address_forbidden"));
  assert.equal(rebound, 1);

  const failing = createProviderNetwork({
    origins: ["https://provider.example"],
    resolve: async () => { throw new Error("sensitive resolver detail"); },
  });
  await assert.rejects(failing.postJson("https://provider.example", "/echo", {}, { ticket: TICKET, operationId: OPERATION }), (error) => {
    assert.equal(error.code, "resolution_failed");
    assert.equal(error.message, "resolution_failed");
    return true;
  });
  for (const answers of [[{}, { address: "8.8.8.8" }], new Array(65).fill({ address: "8.8.8.8" })]) {
    const malformed = createProviderNetwork({ origins: ["https://provider.example"], resolve: async () => answers });
    await assert.rejects(malformed.postJson("https://provider.example", "/echo", {}, { ticket: TICKET, operationId: OPERATION }), timeoutCode("resolution_failed"));
  }
});

test("deadlines cover resolution and never start an expired request", async () => {
  const stalled = testNetwork({ requestTimeoutMs: 150, resolve: () => new Promise(() => {}) });
  await assert.rejects(stalled.postJson("https://provider.example:9443", "/echo", {}, { ticket: TICKET, operationId: OPERATION }),
    timeoutCode("timeout"));

  const slow = testNetwork({
    requestTimeoutMs: 100,
    resolve: async () => { await new Promise((resolve) => setTimeout(resolve, 150)); return [{ address: "127.0.0.1", family: 4 }]; },
  });
  await assert.rejects(slow.postJson("https://provider.example:9443", "/echo", {}, { ticket: TICKET, operationId: OPERATION }),
    timeoutCode("timeout"));

  const blocked = testNetwork({
    requestTimeoutMs: 100,
    resolve: async () => {
      const until = Date.now() + 150;
      while (Date.now() < until) { /* hold the event loop past the deadline */ }
      return [{ address: "127.0.0.1", family: 4 }];
    },
  });
  await assert.rejects(blocked.postJson("https://provider.example:9443", "/echo", {}, { ticket: TICKET, operationId: OPERATION }),
    timeoutCode("timeout"));
});
