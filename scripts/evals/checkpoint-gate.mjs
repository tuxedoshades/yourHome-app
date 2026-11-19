import fs from "node:fs";
import path from "node:path";

const handoffPath = path.resolve("HANDOFF.md");
const runsDir = path.resolve("evals", "runs");

function readRuns() {
  if (!fs.existsSync(runsDir)) return [];
  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith(".jsonl"));
  const out = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(runsDir, file), "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        out.push(JSON.parse(line));
      } catch {
        // Ignore malformed historical run rows and continue evaluating valid entries.
      }
    }
  }
  return out;
}

function pct(n, d) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : "0.0%";
}

const handoffExists = fs.existsSync(handoffPath);
const handoffFresh = handoffExists ? Date.now() - fs.statSync(handoffPath).mtimeMs < 1000 * 60 * 60 * 48 : false;

const runs = readRuns();
const total = runs.length;
const accepted = runs.filter((r) => r.accepted === true).length;

const reasons = new Map();
for (const r of runs) {
  if (!r.reasonCode) continue;
  reasons.set(r.reasonCode, (reasons.get(r.reasonCode) || 0) + 1);
}
const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

console.log("=== YourHome Drift Checkpoint ===");
console.log(`handoff.md present: ${handoffExists ? "yes" : "no"}`);
console.log(`handoff.md fresh (<48h): ${handoffFresh ? "yes" : "no"}`);
console.log(`runs: ${total}`);
console.log(`acceptance: ${accepted}/${total} (${pct(accepted, total)})`);
console.log("top failure reasons:");
if (!top.length) console.log("- none");
else top.forEach(([k, v]) => console.log(`- ${k}: ${v}`));

if (!handoffExists || !handoffFresh) {
  console.log("ACTION: refresh HANDOFF.md before long autonomous runs.");
}
