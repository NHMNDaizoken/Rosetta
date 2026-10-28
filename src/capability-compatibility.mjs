// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
export const LIMITS = Object.freeze({
  maxSchemaNodes: 4096,
  maxDepth: 32,
  maxObjectProperties: 64,
  maxProofComparisons: 10000,
  maxWitnessValues: 100000,
  maxDocumentDepth: 256,
});

const WITNESS_LIMIT = Symbol("witness_limit");

const TYPES = new Set(["object", "array", "string", "integer", "number", "boolean", "null"]);
const PROPERTY_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const ALLOWED_KEYWORDS = {
  object: new Set(["type", "description", "properties", "required", "additionalProperties"]),
  array: new Set(["type", "description", "items", "minItems", "maxItems"]),
  string: new Set(["type", "description", "minLength", "maxLength"]),
  integer: new Set(["type", "description", "minimum", "maximum"]),
  number: new Set(["type", "description", "minimum", "maximum"]),
  boolean: new Set(["type", "description"]),
  null: new Set(["type", "description"]),
};

const compatible = () => ({ status: "compatible" });
const indeterminate = (reason, producerPointer = "", consumerPointer = "") =>
  ({ status: "indeterminate", reason, producerPointer, consumerPointer });
const incompatible = (reason, witness, producerPointer = "", consumerPointer = "") =>
  ({ status: "incompatible", reason, witness, producerPointer, consumerPointer });

export function parseStrictJson(text) {
  if (typeof text !== "string" || !text.isWellFormed()) throw new SyntaxError("invalid_unicode");
  let value;
  try { value = JSON.parse(text); } catch { throw new SyntaxError("invalid_json"); }
  assertWireValue(value, 1);
  assertNoDuplicateKeys(text);
  return value;
}

function assertWireValue(value, depth) {
  if (depth > LIMITS.maxDocumentDepth) throw new SyntaxError("document_too_deep");
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw new SyntaxError("invalid_unicode");
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new SyntaxError("nonfinite_number");
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    for (const item of value) assertWireValue(item, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (!key.isWellFormed()) throw new SyntaxError("invalid_unicode");
      assertWireValue(item, depth + 1);
    }
    return;
  }
  throw new SyntaxError("invalid_json");
}

function assertNoDuplicateKeys(text) {
  const stack = [];
  let index = 0;
  const skipWhitespace = () => {
    while (index < text.length && /\s/.test(text[index])) index++;
  };
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const start = index++;
      while (index < text.length) {
        if (text[index] === "\\") { index += 2; continue; }
        if (text[index++] === '"') break;
      }
      const top = stack.at(-1);
      if (top?.type === "object" && top.expectKey) {
        const key = JSON.parse(text.slice(start, index));
        if (top.keys.has(key)) throw new SyntaxError("duplicate_key");
        top.keys.add(key);
        skipWhitespace();
        if (text[index] !== ":") throw new SyntaxError("invalid_json");
        top.expectKey = false;
        index++;
      }
      continue;
    }
    if (char === "{") {
      stack.push({ type: "object", keys: new Set(), expectKey: true });
      index++;
      continue;
    }
    if (char === "[") {
      stack.push({ type: "array" });
      index++;
      continue;
    }
    if (char === "}" || char === "]") {
      stack.pop();
      index++;
      continue;
    }
    if (char === ",") {
      if (stack.at(-1)?.type === "object") stack.at(-1).expectKey = true;
      index++;
      continue;
    }
    index++;
  }
}

export function resolveCompatibility(producer, consumer) {
  const budget = { nodes: 0 };
  const producerError = checkSchema(producer, "", 1, budget);
  if (producerError) return indeterminate(producerError.reason, producerError.pointer);
  const consumerError = checkSchema(consumer, "", 1, budget);
  if (consumerError) return indeterminate(consumerError.reason, consumerError.pointer);

  const context = { comparisons: 0, witnessValues: 0 };
  let result;
  try {
    result = compareNodes(producer, consumer, "", "", context);
  } catch (error) {
    if (error === WITNESS_LIMIT) return indeterminate("witness_limit_exceeded");
    throw error;
  }
  if (result.status === "incompatible" &&
      (!validateValue(producer, result.witness) || validateValue(consumer, result.witness))) {
    return indeterminate("witness_not_proven", result.producerPointer, result.consumerPointer);
  }
  return result;
}

function checkSchema(schema, pointer, depth, budget) {
  if (depth > LIMITS.maxDepth) return { reason: "schema_depth_exceeded", pointer };
  if (++budget.nodes > LIMITS.maxSchemaNodes) return { reason: "schema_node_limit", pointer };
  if (!isObject(schema)) return { reason: "invalid_schema", pointer };
  if (typeof schema.type !== "string" || !TYPES.has(schema.type)) {
    return { reason: "invalid_schema", pointer: `${pointer}/type` };
  }
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_KEYWORDS[schema.type].has(key)) {
      return { reason: "unsupported_keyword", pointer: `${pointer}/${escapePointer(key)}` };
    }
  }
  if ("description" in schema &&
      (typeof schema.description !== "string" || schema.description.length === 0 ||
       schema.description.length > 1024 || !schema.description.isWellFormed())) {
    return { reason: "invalid_schema", pointer: `${pointer}/description` };
  }

  if (schema.type === "object") {
    if (!isObject(schema.properties) || schema.additionalProperties !== false) {
      return { reason: "invalid_schema", pointer };
    }
    const names = Object.keys(schema.properties);
    if (names.length > LIMITS.maxObjectProperties) return { reason: "schema_property_limit", pointer: `${pointer}/properties` };
    for (const name of names) {
      if (!PROPERTY_NAME.test(name)) return { reason: "invalid_property_name", pointer: `${pointer}/properties/${escapePointer(name)}` };
      const error = checkSchema(schema.properties[name], `${pointer}/properties/${escapePointer(name)}`, depth + 1, budget);
      if (error) return error;
    }
    if (!Array.isArray(schema.required) || schema.required.length > LIMITS.maxObjectProperties) {
      return { reason: "invalid_schema", pointer: `${pointer}/required` };
    }
    const required = new Set();
    for (const name of schema.required) {
      if (typeof name !== "string" || !PROPERTY_NAME.test(name) || required.has(name) || !Object.hasOwn(schema.properties, name)) {
        return { reason: "invalid_schema", pointer: `${pointer}/required` };
      }
      required.add(name);
    }
    return null;
  }

  if (schema.type === "array") {
    if (!isObject(schema.items) || !Number.isInteger(schema.maxItems) ||
        schema.maxItems < 0 || schema.maxItems > 1000) {
      return { reason: "invalid_schema", pointer };
    }
    if ("minItems" in schema && (!Number.isInteger(schema.minItems) || schema.minItems < 0 ||
        schema.minItems > schema.maxItems)) {
      return { reason: "invalid_schema", pointer: `${pointer}/minItems` };
    }
    return checkSchema(schema.items, `${pointer}/items`, depth + 1, budget);
  }

  if (schema.type === "string") {
    if (!Number.isInteger(schema.maxLength) || schema.maxLength < 0 || schema.maxLength > 65536) {
      return { reason: "invalid_schema", pointer: `${pointer}/maxLength` };
    }
    if ("minLength" in schema && (!Number.isInteger(schema.minLength) || schema.minLength < 0 ||
        schema.minLength > schema.maxLength)) {
      return { reason: "invalid_schema", pointer: `${pointer}/minLength` };
    }
    return null;
  }

  if (schema.type === "integer") {
    if (!Number.isSafeInteger(schema.minimum) || !Number.isSafeInteger(schema.maximum) ||
        schema.minimum > schema.maximum) {
      return { reason: "invalid_schema", pointer: `${pointer}/minimum` };
    }
    return null;
  }

  if (schema.type === "number") {
    if (typeof schema.minimum !== "number" || typeof schema.maximum !== "number" ||
        !Number.isFinite(schema.minimum) || !Number.isFinite(schema.maximum) ||
        Math.abs(schema.minimum) > 1e100 || Math.abs(schema.maximum) > 1e100 ||
        schema.minimum > schema.maximum) {
      return { reason: "invalid_schema", pointer: `${pointer}/minimum` };
    }
  }
  return null;
}

function compareNodes(producer, consumer, producerPointer, consumerPointer, context) {
  if (++context.comparisons > LIMITS.maxProofComparisons) {
    return indeterminate("comparison_budget_exceeded", producerPointer, consumerPointer);
  }
  if (producer.type !== consumer.type) {
    if (producer.type === "integer" && consumer.type === "number") {
      return compareNumberIntervals(producer, consumer, producerPointer, consumerPointer);
    }
    if (producer.type === "number" && consumer.type === "integer") {
      return compareNumberToInteger(producer, consumer, producerPointer, consumerPointer);
    }
    return incompatible("type_mismatch", sampleValue(producer, context), producerPointer, consumerPointer);
  }

  switch (producer.type) {
    case "object": return compareObjects(producer, consumer, producerPointer, consumerPointer, context);
    case "array": return compareArrays(producer, consumer, producerPointer, consumerPointer, context);
    case "string": return compareStrings(producer, consumer, producerPointer, consumerPointer);
    case "integer":
    case "number": return compareNumberIntervals(producer, consumer, producerPointer, consumerPointer);
    default: return compatible();
  }
}

function compareNumberIntervals(producer, consumer, producerPointer, consumerPointer) {
  if (producer.minimum >= consumer.minimum && producer.maximum <= consumer.maximum) return compatible();
  const witness = producer.minimum < consumer.minimum ? producer.minimum : producer.maximum;
  return incompatible("numeric_interval_not_contained", witness, producerPointer, consumerPointer);
}

function compareNumberToInteger(producer, consumer, producerPointer, consumerPointer) {
  const fractional = findFractional(producer.minimum, producer.maximum);
  if (fractional !== undefined) {
    return incompatible("number_to_integer", fractional, producerPointer, consumerPointer);
  }
  const outside = findIntegerOutside(producer.minimum, producer.maximum, consumer.minimum, consumer.maximum);
  if (outside !== undefined) {
    return incompatible("numeric_interval_not_contained", outside, producerPointer, consumerPointer);
  }
  return indeterminate("numeric_precision", producerPointer, consumerPointer);
}

function findFractional(minimum, maximum) {
  if (!Number.isInteger(minimum)) return minimum;
  if (!Number.isInteger(maximum)) return maximum;
  if (minimum === maximum) return undefined;
  const midpoint = minimum + (maximum - minimum) / 2;
  if (!Number.isInteger(midpoint)) return midpoint;
  const below = minimum + 0.5;
  if (below > minimum && below <= maximum) return below;
  const above = maximum - 0.5;
  if (above < maximum && above >= minimum) return above;
  return undefined;
}

function findIntegerOutside(minimum, maximum, consumerMinimum, consumerMaximum) {
  if (minimum < consumerMinimum) {
    const candidate = Math.ceil(minimum);
    if (candidate <= maximum && candidate < consumerMinimum) return candidate;
  }
  if (maximum > consumerMaximum) {
    const candidate = Math.floor(maximum);
    if (candidate >= minimum && candidate > consumerMaximum) return candidate;
  }
  return undefined;
}

function compareStrings(producer, consumer, producerPointer, consumerPointer) {
  const producerMinimum = producer.minLength ?? 0;
  const consumerMinimum = consumer.minLength ?? 0;
  if (producerMinimum >= consumerMinimum && producer.maxLength <= consumer.maxLength) return compatible();
  const length = producer.maxLength > consumer.maxLength
    ? Math.max(producerMinimum, consumer.maxLength + 1)
    : producerMinimum;
  return incompatible("string_length_not_contained", "a".repeat(length), producerPointer, consumerPointer);
}

function compareArrays(producer, consumer, producerPointer, consumerPointer, context) {
  const producerMinimum = producer.minItems ?? 0;
  const consumerMinimum = consumer.minItems ?? 0;
  if (producerMinimum < consumerMinimum || producer.maxItems > consumer.maxItems) {
    const length = producer.maxItems > consumer.maxItems
      ? Math.max(producerMinimum, consumer.maxItems + 1)
      : producerMinimum;
    const witness = Array.from({ length }, () => sampleValue(producer.items, context));
    return incompatible("array_length_not_contained", witness, producerPointer, consumerPointer);
  }
  if (producer.maxItems === 0) return compatible();
  const item = compareNodes(
    producer.items, consumer.items, `${producerPointer}/items`, `${consumerPointer}/items`, context
  );
  if (item.status !== "incompatible") return item;
  const length = Math.max(producerMinimum, 1);
  return {
    status: "incompatible",
    reason: item.reason,
    producerPointer: item.producerPointer,
    consumerPointer: item.consumerPointer,
    witness: Array.from({ length }, () => item.witness),
  };
}

function compareObjects(producer, consumer, producerPointer, consumerPointer, context) {
  const producerRequired = new Set(producer.required);
  for (const name of consumer.required) {
    if (!producerRequired.has(name)) {
      return incompatible(
        "required_property_not_guaranteed",
        sampleRequiredObject(producer, context),
        `${producerPointer}/required`,
        `${consumerPointer}/required`
      );
    }
  }

  const producerKeys = Object.keys(producer.properties).sort();
  for (const name of producerKeys) {
    if (!Object.hasOwn(consumer.properties, name)) {
      const witness = sampleRequiredObject(producer, context);
      witness[name] = sampleValue(producer.properties[name], context);
      return incompatible(
        "unexpected_producer_property",
        witness,
        `${producerPointer}/properties/${escapePointer(name)}`,
        `${consumerPointer}/properties`
      );
    }
  }

  for (const name of producerKeys) {
    const child = compareNodes(
      producer.properties[name],
      consumer.properties[name],
      `${producerPointer}/properties/${escapePointer(name)}`,
      `${consumerPointer}/properties/${escapePointer(name)}`,
      context
    );
    if (child.status === "indeterminate") return child;
    if (child.status === "incompatible") {
      const witness = sampleRequiredObject(producer, context);
      witness[name] = child.witness;
      return {
        status: "incompatible",
        reason: child.reason,
        producerPointer: child.producerPointer,
        consumerPointer: child.consumerPointer,
        witness,
      };
    }
  }
  return compatible();
}

function sampleRequiredObject(schema, context) {
  witnessSlot(context);
  const value = {};
  for (const name of schema.required) value[name] = sampleValue(schema.properties[name], context);
  return value;
}

export function validateValue(schema, value) {
  switch (schema.type) {
    case "object": {
      if (!isObject(value)) return false;
      for (const name of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties, name) || !validateValue(schema.properties[name], value[name])) return false;
      }
      return schema.required.every((name) => Object.hasOwn(value, name));
    }
    case "array":
      return Array.isArray(value) &&
        value.length >= (schema.minItems ?? 0) && value.length <= schema.maxItems &&
        value.every((item) => validateValue(schema.items, item));
    case "string":
      return typeof value === "string" && value.isWellFormed() &&
        codePointLength(value) >= (schema.minLength ?? 0) && codePointLength(value) <= schema.maxLength;
    case "integer":
      return typeof value === "number" && Number.isInteger(value) &&
        value >= schema.minimum && value <= schema.maximum;
    case "number":
      return typeof value === "number" && Number.isFinite(value) &&
        value >= schema.minimum && value <= schema.maximum;
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}

function sampleValue(schema, context) {
  switch (schema.type) {
    case "object": return sampleRequiredObject(schema, context);
    case "array": {
      witnessSlot(context);
      const length = schema.minItems ?? 0;
      return Array.from({ length }, () => sampleValue(schema.items, context));
    }
    case "string": {
      const length = schema.minLength ?? 0;
      witnessSlot(context, Math.max(1, length));
      return "a".repeat(length);
    }
    case "integer":
    case "number":
      witnessSlot(context);
      return schema.minimum;
    case "boolean":
      witnessSlot(context);
      return false;
    case "null":
      witnessSlot(context);
      return null;
    default: throw new Error("unsupported schema type");
  }
}

function witnessSlot(context, units = 1) {
  context.witnessValues += units;
  if (context.witnessValues > LIMITS.maxWitnessValues) throw WITNESS_LIMIT;
}

function codePointLength(value) {
  let length = 0;
  for (const _ of value) length++;
  return length;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapePointer(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}
