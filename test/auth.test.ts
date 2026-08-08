import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bearerToken, constantTimeEqual, isAuthorized, parseKeys } from "../src/auth.ts";

describe("publish key parsing", () => {
  it("splits, trims, and drops empty entries", () => {
    assert.deepEqual(parseKeys(" alpha , beta ,, gamma "), ["alpha", "beta", "gamma"]);
  });

  it("treats missing configuration as no keys", () => {
    assert.deepEqual(parseKeys(undefined), []);
    assert.deepEqual(parseKeys(""), []);
  });
});

describe("bearer token extraction", () => {
  it("accepts the scheme case-insensitively", () => {
    assert.equal(bearerToken("Bearer abc"), "abc");
    assert.equal(bearerToken("bearer abc"), "abc");
  });

  it("rejects other schemes and missing headers", () => {
    assert.equal(bearerToken("Basic abc"), null);
    assert.equal(bearerToken(null), null);
  });
});

describe("constant time comparison", () => {
  it("matches only identical strings", () => {
    assert.equal(constantTimeEqual("secret", "secret"), true);
    assert.equal(constantTimeEqual("secret", "secreT"), false);
    assert.equal(constantTimeEqual("secret", "secrets"), false);
  });
});

describe("authorization", () => {
  const keys = ["key-one", "key-two"];

  it("accepts any configured key", () => {
    assert.equal(isAuthorized("Bearer key-one", keys), true);
    assert.equal(isAuthorized("Bearer key-two", keys), true);
  });

  it("rejects unknown keys, wrong schemes, and absent headers", () => {
    assert.equal(isAuthorized("Bearer key-three", keys), false);
    assert.equal(isAuthorized("Basic key-one", keys), false);
    assert.equal(isAuthorized(null, keys), false);
  });

  it("rejects every request when no keys are configured", () => {
    assert.equal(isAuthorized("Bearer key-one", []), false);
    assert.equal(isAuthorized("Bearer ", []), false);
  });
});
