import fs from "node:fs";
import path from "node:path";

const runsDir = path.resolve("evals", "runs");

function pct(numerator, denominator) {
  if (!denominator) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function readJsonlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  const records = [];

  for (const file of files) {
    const full = path.join(dir, file);
    const lines = fs.readFileSync(full, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        records.push(JSON.parse(line));
      } catch {
        // ignore malformed rows to keep report robust
      }
    }
  }

  return records;
}

const runs = readJsonlFiles(runsDir);

const totalRuns = runs.length;
const acceptedRuns = runs.filter((r) => r.accepted === true).length;
const acceptanceRate = pct(acceptedRuns, totalRuns);

const reasonCounts = new Map();
for (const r of runs) {
  const code = r.reasonCode;
  if (!code) continue;
  reasonCounts.set(code, (reasonCounts.get(code) || 0) + 1);
}

const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

const workflowMap = new Map();
for (const r of runs) {
  const key = r.workflow || "unknown";
  if (!workflowMap.has(key)) workflowMap.set(key, { total: 0, accepted: 0 });
  const item = workflowMap.get(key);
  item.total += 1;
  if (r.accepted === true) item.accepted += 1;
}

const workflows = [...workflowMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

console.log("=== Agent Eval Top-Failures Report ===");
console.log(`Runs: ${totalRuns}`);
console.log(`Accepted: ${acceptedRuns}`);
console.log(`Acceptance rate: ${acceptanceRate}`);
console.log("");
console.log("Top 3 failure reasons:");
if (topReasons.length === 0) {
  console.log("- none");
} else {
  for (const [reason, count] of topReasons) {
    console.log(`- ${reason}: ${count}`);
  }
}
console.log("");
console.log("Per-workflow acceptance:");
if (workflows.length === 0) {
  console.log("- none");
} else {
  for (const [workflow, stats] of workflows) {
    console.log(`- ${workflow}: ${stats.accepted}/${stats.total} (${pct(stats.accepted, stats.total)})`);
  }
}
