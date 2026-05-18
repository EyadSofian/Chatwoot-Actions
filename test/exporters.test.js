import test from "node:test";
import assert from "node:assert/strict";
import { flattenObject, toCsv } from "../src/exporters.js";

test("flattenObject flattens nested records", () => {
  assert.deepEqual(flattenObject({ a: { b: 1 }, c: "x" }), {
    "a.b": 1,
    c: "x"
  });
});

test("toCsv escapes commas and quotes", () => {
  const csv = toCsv([{ name: 'A "quoted", value', count: 2 }]);
  assert.equal(csv, 'name,count\n"A ""quoted"", value",2');
});
