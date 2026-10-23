import { test } from "vitest";
import assert from "node:assert/strict";
import { parseReportWords, tsvWords } from "../src/report-import";
const pkg = "com.test.game";
test("positioned report parser keeps For Dev sections across pages and extracts build identity", () => {
  const w = (text: string, x: number, y: number) => ({ text, x, y, h: 0.01 });
  const r = parseReportWords([
    [
      w("Package Name", 0.08, 0.1),
      w(pkg, 0.48, 0.1),
      w("Version (bundleVersion)", 0.08, 0.15),
      w("0.1.3", 0.48, 0.15),
      w("Bundle Version Code", 0.08, 0.2),
      w("13", 0.48, 0.2),
      w("FOR DEV", 0.08, 0.3),
      w("2. ADS IDS", 0.08, 0.35),
      w("Banner", 0.08, 0.4),
      w("unit-a", 0.48, 0.4),
    ],
    [
      w("Interstitial", 0.08, 0.1),
      w("unit-b", 0.48, 0.1),
      w("3. IN-APP PURCHASES", 0.08, 0.2),
      w("In-App Purchasing", 0.08, 0.25),
      w("ENABLED", 0.48, 0.25),
    ],
  ]);
  assert.equal(r.packageId, pkg);
  assert.equal(r.versionCode, "13");
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[1].section, "2. ADS IDS");
  assert.equal(r.rows[1].page, 2);
  assert.equal(
    tsvWords("header\n5\t1\t1\t1\t1\t1\t10\t20\t20\t10\t90\tPASS", 100, 100)[0]
      .text,
    "PASS",
  );
});
