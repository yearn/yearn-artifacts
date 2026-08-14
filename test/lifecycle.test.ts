import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { RETENTION_TIERS } from "../src/index.ts";

// The tier lengths exist twice: RETENTION_TIERS drives the "Expires:" date a
// report page shows, and config/r2-lifecycle.json drives when R2 actually
// deletes the object. These tests fail when either side is edited alone, so
// the displayed date cannot silently drift from the real deletion.

type LifecycleRule = {
  id: string;
  enabled: boolean;
  conditions: { prefix: string };
  deleteObjectsTransition?: { condition: { type: string; maxAge: number } };
};

const configPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "config",
  "r2-lifecycle.json"
);
const config = JSON.parse(readFileSync(configPath, "utf8")) as { rules: LifecycleRule[] };
const deleteRules = config.rules.filter((rule) => rule.deleteObjectsTransition);

describe("r2 lifecycle config", () => {
  it("deletes each expiring tier after exactly the length the page displays", () => {
    for (const [tier, days] of Object.entries(RETENTION_TIERS)) {
      if (days === null) continue;
      const rule = deleteRules.find((candidate) => candidate.conditions.prefix === `${tier}/`);
      assert.ok(rule, `no delete rule for tier prefix ${tier}/`);
      assert.equal(rule.enabled, true, `delete rule for ${tier}/ is disabled`);
      assert.equal(rule.deleteObjectsTransition!.condition.type, "Age");
      assert.equal(rule.deleteObjectsTransition!.condition.maxAge, days * 86400);
    }
  });

  it("scopes every delete rule to one expiring tier, so archive/ is never deleted", () => {
    const expiringPrefixes = Object.entries(RETENTION_TIERS)
      .filter(([, days]) => days !== null)
      .map(([tier]) => `${tier}/`);
    assert.deepEqual(
      deleteRules.map((rule) => rule.conditions.prefix).sort(),
      expiringPrefixes.sort()
    );
  });
});
