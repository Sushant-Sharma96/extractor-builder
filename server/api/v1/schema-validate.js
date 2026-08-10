'use strict';
/**
 * Minimal JSON Schema subset validator for API contract tests.
 * Supports: type, required, properties, additionalProperties, enum, const,
 * nullable (type array), items, oneOf (shallow), minimum, maximum, minLength.
 */

function isType(value, t) {
  if (t === 'null') return value === null;
  if (t === 'array') return Array.isArray(value);
  if (t === 'integer') return Number.isInteger(value);
  if (t === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (t === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === t;
}

function validate(schema, value, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.nullable === true && value === null) return errors;

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: value not in enum`);
    return errors;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => isType(value, t))) {
      errors.push(`${path}: expected type ${types.join('|')}, got ${value === null ? 'null' : typeof value}`);
      return errors;
    }
  }

  if (value === null || value === undefined) return errors;

  if (typeof value === 'string' && schema.minLength != null && value.length < schema.minLength) {
    errors.push(`${path}: minLength ${schema.minLength}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: minimum ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: maximum ${schema.maximum}`);
  }

  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((s) => validate(s, value, path).length === 0);
    if (matches.length !== 1) {
      errors.push(`${path}: oneOf matched ${matches.length} schemas`);
    }
    return errors;
  }

  if (isType(value, 'object') && schema.properties) {
    for (const key of schema.required || []) {
      if (!(key in value) || value[key] === undefined) {
        errors.push(`${path}.${key}: required`);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (value[key] !== undefined) {
        errors.push(...validate(sub, value[key], `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!schema.properties[key]) errors.push(`${path}.${key}: additional property not allowed`);
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      errors.push(...validate(schema.items, item, `${path}[${i}]`));
    });
  }

  return errors;
}

function assertValid(schema, value, label) {
  const errors = validate(schema, value);
  if (errors.length) {
    const err = new Error(`${label}:\n  - ${errors.join('\n  - ')}`);
    err.errors = errors;
    throw err;
  }
}

module.exports = { validate, assertValid };
