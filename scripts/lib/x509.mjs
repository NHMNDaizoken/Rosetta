// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Minimal X.509 v3 issuer (ECDSA P-256 / SHA-256) for the local provider CA.
// Node has no certificate generator and OpenSSL is not guaranteed on Windows
// hosts, so the few DER structures a TLS server certificate needs are encoded
// here directly. Development/local deployments only; no CRL, OCSP or renewal.
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";

const OID = {
  commonName: "2.5.4.3",
  organization: "2.5.4.10",
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
  extKeyUsage: "2.5.29.37",
  subjectAltName: "2.5.29.17",
  subjectKeyIdentifier: "2.5.29.14",
  authorityKeyIdentifier: "2.5.29.35",
  serverAuth: "1.3.6.1.5.5.7.3.1",
};

function length(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, ...content) => {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};
const seq = (...items) => tlv(0x30, ...items);
const set = (...items) => tlv(0x31, ...items);
const explicit = (n, ...items) => tlv(0xa0 + n, ...items);
const octets = value => tlv(0x04, value);
const bool = value => tlv(0x01, Buffer.from([value ? 0xff : 0]));
const utf8 = value => tlv(0x0c, Buffer.from(value, "utf8"));
const bits = (value, unused = 0) => tlv(0x03, Buffer.from([unused]), value);

function integer(value) {
  let bytes = Buffer.from(value);
  while (bytes.length > 1 && bytes[0] === 0 && !(bytes[1] & 0x80)) bytes = bytes.subarray(1);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return tlv(0x02, bytes);
}

function oid(dotted) {
  const parts = dotted.split(".").map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk = [part & 0x7f];
    for (let v = part >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(date) {
  const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
  // RFC 5280: UTCTime through 2049, GeneralizedTime afterwards.
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2))) : tlv(0x18, Buffer.from(iso));
}

const name = ({ commonName, organization }) => seq(
  ...(organization ? [set(seq(oid(OID.organization), utf8(organization)))] : []),
  set(seq(oid(OID.commonName), utf8(commonName))),
);
const extension = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));

function keyIdentifier(publicKey) {
  // RFC 5280 method 1: SHA-1 of the subjectPublicKey BIT STRING contents.
  const spki = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha1").update(spki.subarray(spki.length - 65)).digest();
}

export const DNS_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Issues one certificate. With no issuer it is a self-signed CA (pathLen 0);
 * otherwise a TLS server certificate for exactly the given DNS names.
 */
export function issueCertificate({ subject, dnsNames = [], issuer, days, now = new Date() }) {
  if (!subject?.commonName) throw new TypeError("subject.commonName is required");
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw new TypeError("days must be between 1 and 3650");
  const isCa = issuer === undefined;
  if (isCa && dnsNames.length) throw new TypeError("a CA certificate carries no DNS names");
  if (!isCa && (!dnsNames.length || dnsNames.some(dns => typeof dns !== "string" || !DNS_NAME.test(dns)))) {
    throw new TypeError("server certificates need valid lowercase DNS names");
  }
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const signingKey = isCa ? privateKey : issuer.key;
  const issuerName = isCa ? subject : issuer.subject;
  const issuerKeyId = isCa ? keyIdentifier(publicKey) : keyIdentifier(createPublicKey(issuer.key));
  const serial = randomBytes(16); serial[0] &= 0x7f; serial[0] |= 0x01;
  const notBefore = new Date(now.getTime() - 5 * 60_000);
  const notAfter = new Date(now.getTime() + days * 86_400_000);
  const extensions = [
    extension(OID.basicConstraints, true, isCa ? seq(bool(true), integer(Buffer.from([0]))) : seq()),
    // keyCertSign+cRLSign for the CA, digitalSignature for servers.
    extension(OID.keyUsage, true, isCa ? bits(Buffer.from([0x06]), 1) : bits(Buffer.from([0x80]), 7)),
    extension(OID.subjectKeyIdentifier, false, octets(keyIdentifier(publicKey))),
    extension(OID.authorityKeyIdentifier, false, seq(tlv(0x80, issuerKeyId))),
    ...(isCa ? [] : [
      extension(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
      extension(OID.subjectAltName, false, seq(...dnsNames.map(dns => tlv(0x82, Buffer.from(dns, "ascii"))))),
    ]),
  ];
  const algorithm = seq(oid(OID.ecdsaWithSha256));
  const tbs = seq(
    explicit(0, integer(Buffer.from([2]))), integer(serial), algorithm, name(issuerName),
    seq(time(notBefore), time(notAfter)), name(subject),
    publicKey.export({ type: "spki", format: "der" }), explicit(3, seq(...extensions)),
  );
  const signature = sign("sha256", tbs, { key: signingKey, dsaEncoding: "der" });
  const der = seq(tbs, algorithm, bits(signature));
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: "pkcs8", format: "pem" }),
    subject,
  };
}
