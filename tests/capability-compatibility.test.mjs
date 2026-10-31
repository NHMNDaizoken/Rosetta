// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LIMITS,
  parseStrictJson,
  resolveCompatibility,
  validateValue,
} from "../src/modules/capability/compatibility/compatibility.mjs";

const fixture = (name) =>
  parseStrictJson(readFileSync(new URL(`../docs/contracts/examples/${name}`, import.meta.url), "utf8"));

const stringSchema = (maxLength, minLength) => ({
  type: "string",
  ...(minLength === undefined ? {} : { minLength }),
  maxLength,
});
const objectSchema = (properties, required, additionalProperties = false) => ({
  type: "object",
  properties,
  required,
  additionalProperties,
});

function assertIndeterminate(producer, consumer, reason) {
  const result = resolveCompatibility(producer, consumer);
  assert.equal(result.status, "indeterminate", JSON.stringify(result));
  if (reason) assert.equal(result.reason, reason, JSON.stringify(result));
  return result;
}

test("resolver matches every accepted compatibility vector and every witness is checked", () => {
  const cases = fixture("compatibility-cases.json");
  assert.ok(cases.length > 0);
  for (const vector of cases) {
    const result = resolveCompatibility(vector.producer, vector.consumer);
    const expected = vector.expected === "rejected-profile" ? "indeterminate" : vector.expected;
    assert.equal(result.status, expected, vector.id);
    if (result.status === "incompatible") {
      assert.equal(validateValue(vector.producer, result.witness), true, `${vector.id}: producer witness`);
      assert.equal(validateValue(vector.consumer, result.witness), false, `${vector.id}: consumer witness`);
    }
    if (vector.witness !== undefined) {
      assert.equal(validateValue(vector.producer, vector.witness), true, `${vector.id}: fixture producer witness`);
      assert.equal(validateValue(vector.consumer, vector.witness), false, `${vector.id}: fixture consumer witness`);
    }
    if (result.status !== "incompatible") assert.equal(result.witness, undefined, vector.id);
  }
});

test("resolver is deterministic", () => {
  const cases = fixture("compatibility-cases.json");
  for (const vector of cases) {
    assert.deepEqual(
      resolveCompatibility(vector.producer, vector.consumer),
      resolveCompatibility(vector.producer, vector.consumer),
      vector.id
    );
  }
});

test("composition fixture edges are structurally compatible", () => {
  const first = fixture("capability-manifest.json");
  const second = fixture("capability-manifest-second.json");
  const composition = fixture("composition.json");
  assert.equal(resolveCompatibility(composition.inputSchema, first.inputSchema).status, "compatible");
  assert.equal(resolveCompatibility(first.outputSchema, second.inputSchema).status, "compatible");
  assert.equal(resolveCompatibility(second.outputSchema, composition.outputSchema).status, "compatible");
});

test("strict JSON parsing rejects duplicate keys, invalid Unicode and nonfinite numbers", () => {
  assert.deepEqual(parseStrictJson('{"a":[1,true,null,"x"]}'), { a: [1, true, null, "x"] });
  assert.throws(() => parseStrictJson('{"a":1,"a":2}'), /duplicate_key/);
  assert.throws(() => parseStrictJson('{"a":{"b":1,"b":2}}'), /duplicate_key/);
  assert.throws(() => parseStrictJson('{"a":1,"\\u0061":2}'), /duplicate_key/);
  assert.throws(() => parseStrictJson('{"a":"\ud800"}'), /invalid_unicode/);
  assert.throws(() => parseStrictJson('{"a":1e999}'), /nonfinite_number/);
  assert.throws(() => parseStrictJson("not json"), /invalid_json/);
  assert.throws(() => parseStrictJson(42), /invalid_unicode/);
  assert.throws(() => parseStrictJson(`${"[".repeat(257)}0${"]".repeat(257)}`), /document_too_deep/);
});

test("numeric direction is conservative and witnesses are concrete", () => {
  const contained = resolveCompatibility(
    { type: "number", minimum: 0, maximum: 5 },
    { type: "integer", minimum: 0, maximum: 5 }
  );
  assert.equal(contained.status, "incompatible");
  assert.equal(validateValue({ type: "number", minimum: 0, maximum: 5 }, contained.witness), true);
  assert.equal(validateValue({ type: "integer", minimum: 0, maximum: 5 }, contained.witness), false);

  assertIndeterminate(
    { type: "number", minimum: 0, maximum: 0 },
    { type: "integer", minimum: 0, maximum: 0 },
    "numeric_precision"
  );
  assert.equal(resolveCompatibility(
    { type: "number", minimum: 0, maximum: 0 },
    { type: "integer", minimum: 1, maximum: 2 }
  ).status, "incompatible");
  assert.equal(resolveCompatibility(
    { type: "integer", minimum: 0, maximum: 5 },
    { type: "number", minimum: 0, maximum: 10 }
  ).status, "compatible");
  assert.equal(resolveCompatibility(
    { type: "integer", minimum: 0, maximum: 10 },
    { type: "number", minimum: 0, maximum: 5 }
  ).status, "incompatible");
  assert.equal(resolveCompatibility(
    { type: "number", minimum: 0, maximum: 10 },
    { type: "number", minimum: 0, maximum: 5 }
  ).status, "incompatible");
  assert.equal(resolveCompatibility(
    { type: "number", minimum: 0, maximum: 5 },
    { type: "number", minimum: 0, maximum: 10 }
  ).status, "compatible");
  assert.equal(resolveCompatibility(
    { type: "number", minimum: 0.5, maximum: 1.5 },
    { type: "number", minimum: 0.5, maximum: 1.5 }
  ).status, "compatible");
});

test("string and array intervals are directional and witness-valid", () => {
  const tooShort = resolveCompatibility(stringSchema(10, 5), stringSchema(20, 6));
  assert.equal(tooShort.status, "incompatible");
  assert.equal(tooShort.witness.length, 5);
  assert.equal(resolveCompatibility(stringSchema(10, 6), stringSchema(20, 5)).status, "compatible");

  const tooFew = resolveCompatibility(
    { type: "array", items: stringSchema(1), minItems: 0, maxItems: 2 },
    { type: "array", items: stringSchema(1), minItems: 1, maxItems: 2 }
  );
  assert.equal(tooFew.status, "incompatible");
  assert.equal(validateValue({ type: "array", items: stringSchema(1), minItems: 0, maxItems: 2 }, tooFew.witness), true);
  assert.equal(validateValue({ type: "array", items: stringSchema(1), minItems: 1, maxItems: 2 }, tooFew.witness), false);

  const itemMismatch = resolveCompatibility(
    { type: "array", items: { type: "integer", minimum: 0, maximum: 1 }, maxItems: 2 },
    { type: "array", items: stringSchema(2), maxItems: 2 }
  );
  assert.equal(itemMismatch.status, "incompatible");
  assert.equal(validateValue({ type: "array", items: { type: "integer", minimum: 0, maximum: 1 }, maxItems: 2 }, itemMismatch.witness), true);
  assert.equal(validateValue({ type: "array", items: stringSchema(2), maxItems: 2 }, itemMismatch.witness), false);

  assert.equal(resolveCompatibility(
    { type: "array", items: { type: "integer", minimum: 0, maximum: 1 }, maxItems: 0 },
    { type: "array", items: stringSchema(2), maxItems: 0 }
  ).status, "compatible", "empty arrays have no item-edge obligation");
});

test("closed-object rules cover required and optional producer fields", () => {
  const producer = objectSchema({ value: stringSchema(8) }, []);
  const consumer = objectSchema({ value: stringSchema(8) }, ["value"]);
  assert.equal(resolveCompatibility(producer, consumer).status, "incompatible");

  const optionalExtra = objectSchema({ value: stringSchema(8), extra: stringSchema(8) }, ["value"]);
  const noExtra = objectSchema({ value: stringSchema(8) }, ["value"]);
  assert.equal(resolveCompatibility(optionalExtra, noExtra).status, "incompatible");
  assert.equal(resolveCompatibility(noExtra, optionalExtra).status, "compatible");

  assert.equal(resolveCompatibility(objectSchema({}, []), objectSchema({}, [])).status, "compatible");
  assert.equal(resolveCompatibility(
    objectSchema({ nested: objectSchema({ value: stringSchema(3) }, ["value"]) }, ["nested"]),
    objectSchema({ nested: objectSchema({ value: stringSchema(8) }, ["value"]) }, ["nested"])
  ).status, "compatible");
  assert.equal(resolveCompatibility(
    objectSchema({ nested: objectSchema({ value: stringSchema(8) }, ["value"]) }, ["nested"]),
    objectSchema({ nested: objectSchema({ value: stringSchema(3) }, ["value"]) }, ["nested"])
  ).status, "incompatible");
});

test("unsupported profile and malformed schemas are indeterminate", () => {
  const string = stringSchema(8);
  assertIndeterminate({ ...string, pattern: "^a$" }, string, "unsupported_keyword");
  assertIndeterminate({ ...string, $ref: "https://example.invalid/schema" }, string, "unsupported_keyword");
  assertIndeterminate({ ...string, format: "uuid" }, string, "unsupported_keyword");
  assertIndeterminate({ type: "string" }, string, "invalid_schema");
  assertIndeterminate({ type: "string", maxLength: 65537 }, string, "invalid_schema");
  assertIndeterminate({ type: "integer", minimum: 0, maximum: 1.5 }, string, "invalid_schema");
  assertIndeterminate({ type: "integer", minimum: 2, maximum: 1 }, string, "invalid_schema");
  assertIndeterminate({ type: "number", minimum: -1e101, maximum: 0 }, string, "invalid_schema");
  assertIndeterminate({ type: "array", items: string, maxItems: 1001 }, string, "invalid_schema");
  assertIndeterminate({ type: "array", items: string }, string, "invalid_schema");
  assertIndeterminate({ type: "array", items: string, minItems: 2, maxItems: 1 }, string, "invalid_schema");
  const tooManyProperties = {};
  for (let index = 0; index <= LIMITS.maxObjectProperties; index++) {
    tooManyProperties[`p${index}`] = string;
  }
  assertIndeterminate(objectSchema(tooManyProperties, []), objectSchema({}, []), "schema_property_limit");
  assertIndeterminate(JSON.parse('{"type":"boolean","minimum":0}'), { type: "boolean" }, "unsupported_keyword");
  assertIndeterminate(objectSchema({ value: string }, ["missing"]), objectSchema({}, []), "invalid_schema");
  assertIndeterminate(objectSchema({ value: string }, ["value", "value"]), objectSchema({}, []), "invalid_schema");
  assertIndeterminate(objectSchema({ value: string }, [], true), objectSchema({}, []), "invalid_schema");
  assertIndeterminate(objectSchema({ "bad-name": string }, []), objectSchema({}, []), "invalid_property_name");
  assertIndeterminate(objectSchema({ value: { type: "object", properties: {}, required: [] } }, []), objectSchema({}, []), "invalid_schema");
});

test("limits fail closed with deterministic reasons", () => {
  let deep = stringSchema(1);
  for (let index = 0; index < LIMITS.maxDepth + 1; index++) {
    deep = { type: "array", items: deep, maxItems: 1 };
  }
  assertIndeterminate(deep, stringSchema(1), "schema_depth_exceeded");

  const wide = {};
  for (let index = 0; index < LIMITS.maxObjectProperties; index++) {
    wide[`p${index}`] = { type: "string", maxLength: 1 };
  }
  const nested = {};
  for (let index = 0; index < LIMITS.maxObjectProperties; index++) {
    nested[`p${index}`] = objectSchema(wide, []);
  }
  assertIndeterminate(objectSchema(nested, []), objectSchema({}, []), "schema_node_limit");

  let wideArray = { type: "string", maxLength: 1 };
  for (let index = 0; index < 3; index++) {
    wideArray = { type: "array", items: wideArray, minItems: 1000, maxItems: 1000 };
  }
  assertIndeterminate(
    wideArray,
    { type: "array", items: { type: "string", maxLength: 1 }, maxItems: 0 },
    "witness_limit_exceeded"
  );
});

test("value validation uses JSON code points and strict types", () => {
  assert.equal(validateValue(stringSchema(1), "😀"), true);
  assert.equal(validateValue(stringSchema(1), "ab"), false);
  assert.equal(validateValue(stringSchema(3), "ééé"), true);
  assert.equal(validateValue({ type: "integer", minimum: 0, maximum: 2 }, 1), true);
  assert.equal(validateValue({ type: "integer", minimum: 0, maximum: 2 }, 1.5), false);
  assert.equal(validateValue({ type: "number", minimum: 0, maximum: 2 }, Number.POSITIVE_INFINITY), false);
  assert.equal(validateValue({ type: "null" }, null), true);
  assert.equal(validateValue({ type: "boolean" }, false), true);
});
