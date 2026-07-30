import assert from "node:assert/strict";
import test from "node:test";
import { isNewerVersion, renderUpdateNotice } from "../src/utils/update.js";

test("detects newer stable semantic versions", () => {
  assert.equal(isNewerVersion("0.1.1", "0.1.0"), true);
  assert.equal(isNewerVersion("0.2.0", "0.1.9"), true);
  assert.equal(isNewerVersion("1.0.0", "0.99.99"), true);
  assert.equal(isNewerVersion("0.1.0", "0.1.0"), false);
  assert.equal(isNewerVersion("0.0.9", "0.1.0"), false);
});

test("ignores malformed and prerelease versions", () => {
  assert.equal(isNewerVersion("latest", "0.1.0"), false);
  assert.equal(isNewerVersion("0.2.0-beta.1", "0.1.0"), false);
  assert.equal(isNewerVersion("0.2.0", "dev"), false);
});

test("renders versions and the global update command", () => {
  const notice = renderUpdateNotice("0.2.0");
  assert.match(notice, /Update available/);
  assert.match(notice, /v0\.1\.0/);
  assert.match(notice, /v0\.2\.0/);
  assert.match(notice, /npm install -g mdxctl@latest/);
});
