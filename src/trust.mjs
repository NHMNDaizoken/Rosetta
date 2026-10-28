// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { canonicalize } from "./capability-manifest.mjs";
import { HttpError, uuidPattern } from "./http.mjs";

const capabilityId = /^urn:rosetta:capability:([0-9a-f-]{36}):[a-z][a-z0-9-]{0,62}$/;
const exactVersion = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const digest = /^sha256:[0-9a-f]{64}$/;
const cleanString = value => typeof value === "string" && value.isWellFormed() &&
  value.trim().length > 0 && [...value].length <= 255 && !/[\u0000-\u001f\u007f*]/u.test(value);

export function validateGrant(body) {
  const keys = ["providerAppId", "consumerAppId", "capabilities", "operations", "permissions", "subjectIds", "expiresAt", "delegationAllowed", "acceptDelegation"];
  const invalid = () => { throw new HttpError(400, "invalid_direct_grant"); };
  if (!body || typeof body !== "object" || Array.isArray(body) || keys.some(key => !Object.hasOwn(body, key)) || Object.keys(body).some(key => !keys.includes(key))) invalid();
  if (typeof body.providerAppId !== "string" || typeof body.consumerAppId !== "string" ||
    body.providerAppId.length !== 36 || body.consumerAppId.length !== 36 ||
    !uuidPattern.test(body.providerAppId) || !uuidPattern.test(body.consumerAppId) ||
    body.providerAppId === body.consumerAppId || body.delegationAllowed !== false || body.acceptDelegation !== false) invalid();
  for (const [key, max] of [["capabilities", 1], ["operations", 2], ["permissions", 32], ["subjectIds", 100]]) {
    if (!Array.isArray(body[key]) || body[key].length < 1 || body[key].length > max || new Set(body[key].map(value => JSON.stringify(value))).size !== body[key].length) invalid();
  }
  const ref = body.capabilities[0];
  if (!ref || typeof ref !== "object" || Array.isArray(ref) || Object.keys(ref).sort().join(",") !== "capabilityId,manifestDigest,version" ||
    ["capabilityId", "version", "manifestDigest"].some(key => !cleanString(ref[key])) ||
    !capabilityId.test(ref.capabilityId) || !ref.capabilityId.startsWith(`urn:rosetta:capability:${body.providerAppId}:`) ||
    !exactVersion.test(ref.version) || !digest.test(ref.manifestDigest)) invalid();
  if (body.operations.some(value => !["discover", "invoke"].includes(value)) ||
    body.permissions.some(value => !cleanString(value) || !new RegExp(`^urn:rosetta:permission:${body.providerAppId}:[a-z][a-z0-9-]{0,62}$`).test(value)) ||
    body.subjectIds.some(value => !cleanString(value))) invalid();
  if (typeof body.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(body.expiresAt) || !Number.isFinite(Date.parse(body.expiresAt))) invalid();
  const normalized = body.expiresAt.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction ?? "").padEnd(3, "0")}Z`);
  if (new Date(body.expiresAt).toISOString() !== normalized) invalid();
  return body;
}

export function grantDigest(grantId, identity, proposal) {
  return `sha256:${createHash("sha256").update(canonicalize({ grantId, tenantId: identity.tenantId,
    issuer: identity.issuer, createdBy: identity.subject, proposal })).digest("hex")}`;
}
