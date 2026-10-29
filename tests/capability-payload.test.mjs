// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PAYLOAD_BYTES, MAX_PAYLOAD_NODES, validatePayload } from "../src/capability-payload.mjs";

const object = (properties, required = Object.keys(properties)) =>
  ({ type: "object", properties, required, additionalProperties: false });
const string = (maxLength, minLength) => ({ type: "string", ...(minLength === undefined ? {} : { minLength }), maxLength });
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const array = (items, maxItems, minItems) => ({ type: "array", items, ...(minItems === undefined ? {} : { minItems }), maxItems });

const codes = (schema, value, options) => validatePayload(schema, value, options).map((entry) => entry.code);

test("accepts every supported payload type and required/closed object rules", () => {
  const schema = object({
    name: string(64, 1),
    enabled: { type: "boolean" },
    count: integer(0, 10),
    ratio: { type: "number", minimum: 0, maximum: 1 },
    tags: array(string(16), 4, 1),
    nothing: { type: "null" },
  });
  assert.deepEqual(validatePayload(schema, {
    name: "héllo 🙂", enabled: true, count: 3, ratio: 0.5, tags: ["a", "b"], nothing: null,
  }), []);
  assert.deepEqual(codes(schema, {
    name: "x", enabled: true, count: 3, ratio: 0.5, tags: ["a"], nothing: null, extra: 1,
  }), ["invalid_payload"]);
  assert.deepEqual(codes(schema, { name: "x", enabled: true, count: 3, ratio: 0.5, tags: ["a"] }), ["invalid_payload"]);
});

test("enforces bounded arrays, string lengths and numeric ranges", () => {
  const schema = array(string(3, 1), 2, 1);
  assert.deepEqual(validatePayload(schema, ["a", "bc"]), []);
  assert.deepEqual(codes(schema, []), ["invalid_payload"]);
  assert.deepEqual(codes(schema, ["a", "b", "c"]), ["invalid_payload"]);
  assert.deepEqual(codes(schema, ["abcd"]), ["invalid_payload"]);
  assert.deepEqual(codes(schema, [""]), ["invalid_payload"]);
  assert.deepEqual(codes(integer(2, 4), 5), ["invalid_payload"]);
  assert.deepEqual(codes(integer(2, 4), 1), ["invalid_payload"]);
  assert.deepEqual(codes(integer(2, 4), 2.5), ["invalid_payload"]);
  assert.deepEqual(codes({ type: "number", minimum: -1, maximum: 1 }, -1), []);
});

test("rejects malformed Unicode values and object keys", () => {
  assert.deepEqual(codes(string(10), "ok"), []);
  assert.deepEqual(codes(string(10), "bad \ud800"), ["invalid_unicode"]);
  const schema = object({ a: { type: "null" } });
  assert.deepEqual(codes(schema, { "bad \udc00": null }), ["invalid_unicode"]);
});

test("rejects documents beyond the depth, node and byte bounds", () => {
  const nestedSchema = (depth) => {
    let schema = { type: "null" };
    for (let index = 1; index < depth; index++) {
      schema = { type: "object", properties: { a: schema }, required: ["a"], additionalProperties: false };
    }
    return schema;
  };
  const nestedValue = (depth) => {
    let value = null;
    for (let index = 1; index < depth; index++) value = { a: value };
    return value;
  };
  assert.deepEqual(validatePayload(nestedSchema(32), nestedValue(32)), []);
  assert.deepEqual(codes(nestedSchema(32), nestedValue(33)), ["payload_too_deep"]);
  assert.deepEqual(codes({ type: "null" }, new Array(MAX_PAYLOAD_NODES + 10).fill(null)), ["payload_too_complex"]);
  assert.deepEqual(codes(string(MAX_PAYLOAD_BYTES), "x".repeat(MAX_PAYLOAD_BYTES + 1)), ["payload_too_large"]);
  assert.deepEqual(validatePayload(string(10), "abcd", { maxBytes: 6 }), []);
  assert.deepEqual(codes(string(10), "abcd", { maxBytes: 5 }), ["payload_too_large"]);
});

test("rejects non-JSON and non-finite values", () => {
  assert.deepEqual(codes({ type: "null" }, undefined), ["invalid_json_value"]);
  assert.deepEqual(codes({ type: "number", minimum: 0, maximum: 1 }, Number.NaN), ["nonfinite_number"]);
  assert.deepEqual(codes({ type: "null" }, new Date()), ["invalid_json_value"]);
  assert.deepEqual(codes({ type: "null" }, { toJSON() { throw new Error("must not be called"); } }), ["invalid_json_value"]);
  const array = [];
  array.toJSON = () => [];
  assert.deepEqual(codes({ type: "array", items: { type: "null" }, maxItems: 0 }, array), ["invalid_json_value"]);
});

test("counts string lengths in code points, not UTF-16 or UTF-8 units", () => {
  assert.deepEqual(validatePayload(string(2), "🙂🙂"), []);
  assert.deepEqual(codes(string(2), "🙂🙂🙂"), ["invalid_payload"]);
  assert.deepEqual(validatePayload(string(1), "é"), []);
});

test("rejects unsupported schema keywords, types and assertion gaps", () => {
  assert.deepEqual(codes({ type: "string", maxLength: 10, pattern: "x" }, "x"), ["unsupported_keyword"]);
  assert.deepEqual(codes({ type: "object", properties: {}, required: [], additionalProperties: true }, {}), ["invalid_schema"]);
  assert.deepEqual(codes({ type: "array", items: { type: "null" } }, []), ["invalid_schema"]);
  assert.deepEqual(codes({ type: "array", items: { type: "null" }, maxItems: 2, uniqueItems: true }, []), ["unsupported_keyword"]);
  assert.deepEqual(codes({ type: "integer", minimum: 5, maximum: 1 }, 3), ["invalid_schema"]);
  assert.deepEqual(codes({ type: "wat" }, null), ["invalid_schema"]);
});
