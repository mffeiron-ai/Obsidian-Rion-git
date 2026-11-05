// src/git/exec.ts
import { execFile } from "child_process";
function runGit(cwd, gitPath, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      gitPath,
      // quotepath=false：否则中文/空格路径会被输出成 "\346\225\264..." 这样的八进制转义。
      ["-c", "core.quotepath=false", ...args],
      {
        cwd,
        timeout: options.timeoutMs ?? 3e4,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          // 桌面端没有 TTY，交互式索要密码只会把进程挂死。
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0"
        }
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const err = error;
        const numericCode = typeof err.code === "number" ? err.code : -1;
        const spawnError = typeof err.code === "string" ? err.code : err.killed ? "timeout" : void 0;
        resolve({ code: numericCode, stdout, stderr, spawnError });
      }
    );
  });
}

// src/git/history.ts
var RECORD = "";
var FIELD = "";
function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}
function toUTC(date) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
function fromUTC(timestamp) {
  const d = new Date(timestamp);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function parseNumstatLog(raw) {
  const commits = [];
  for (const record of raw.split(RECORD)) {
    const body = record.replace(/^\n+/, "");
    if (!body.trim()) continue;
    const lines = body.split("\n");
    const header = lines[0] ?? "";
    const [hash, date = "", ...subjectParts] = header.split(FIELD);
    if (!hash || !date) continue;
    let files = 0;
    let total = 0;
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const parts = line.split("	");
      const added = parts[0];
      const deleted = parts[1];
      if (added === void 0 || deleted === void 0) continue;
      files += 1;
      if (added === "-" || deleted === "-") continue;
      const a = Number.parseInt(added, 10);
      const d = Number.parseInt(deleted, 10);
      if (!Number.isNaN(a)) total += a;
      if (!Number.isNaN(d)) total += d;
    }
    commits.push({
      hash,
      date,
      subject: subjectParts.join(FIELD),
      files,
      lines: total
    });
  }
  return commits;
}
async function readCommitStats(ctx, maxCommits = 3e3) {
  const res = await runGit(ctx.cwd, ctx.gitPath, [
    "log",
    `--max-count=${maxCommits}`,
    "--date=short",
    "--numstat",
    `--pretty=format:${RECORD}%H${FIELD}%ad${FIELD}%s`
  ]);
  return res.code === 0 ? parseNumstatLog(res.stdout) : [];
}
function eachDay(startDate, endDate) {
  const days = [];
  const end = toUTC(endDate);
  for (let t = toUTC(startDate); t <= end; t += 864e5) {
    days.push(fromUTC(t));
  }
  return days;
}
function aggregateDaily(commits, startDate, endDate) {
  const buckets = /* @__PURE__ */ new Map();
  for (const day of eachDay(startDate, endDate)) {
    buckets.set(day, { date: day, commits: 0, files: 0, lines: 0 });
  }
  for (const commit of commits) {
    const bucket = buckets.get(commit.date);
    if (!bucket) continue;
    bucket.commits += 1;
    bucket.files += commit.files;
    bucket.lines += commit.lines;
  }
  return [...buckets.values()];
}
function aggregateByWeek(daily) {
  const weeks = [];
  let currentKey = "";
  for (const day of daily) {
    const weekday = (new Date(toUTC(day.date)).getUTCDay() + 6) % 7;
    const weekStart = fromUTC(toUTC(day.date) - weekday * 864e5);
    if (weekStart !== currentKey) {
      currentKey = weekStart;
      weeks.push({
        weekStart,
        commits: 0,
        files: 0,
        lines: 0
      });
    }
    const bucket = weeks[weeks.length - 1];
    if (!bucket) continue;
    bucket.commits += day.commits;
    bucket.files += day.files;
    bucket.lines += day.lines;
  }
  return weeks;
}
function todayString() {
  const now = /* @__PURE__ */ new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}
function shiftDays(date, days) {
  return fromUTC(toUTC(date) + days * 864e5);
}

// smoke10.ts
console.log("--- \u89E3\u6790\u6837\u4F8B\uFF08\u542B\u4E8C\u8FDB\u5236\uFF09---");
var sample = "abc123|2026-11-05|\u7B2C\u4E00\u6B21\u63D0\u4EA4\n3	2	src/a.ts\n-	-	img.png\n\ndef456|2026-11-04|\u7B2C\u4E8C\u6B21\n0	5	b.md\n";
for (const c of parseNumstatLog(sample.replace(/\|/g, ""))) {
  console.log(`  ${c.hash.slice(0, 7)} ${c.date} files=${c.files} lines=${c.lines} "${c.subject}"`);
}
async function main() {
  const ctx = { cwd: process.argv[2], gitPath: "git" };
  const commits = await readCommitStats(ctx);
  console.log("\n--- \u771F\u5B9E\u4ED3\u5E93 ---");
  console.log("\u63D0\u4EA4\u6570:", commits.length);
  console.log("\u524D 3 \u6761:", commits.slice(0, 3).map((c) => `${c.date} ${c.files}\u6587\u4EF6 ${c.lines}\u884C`).join(" | "));
  const today = todayString();
  const start = shiftDays(today, -(26 * 7 - 1));
  const daily = aggregateDaily(commits, start, today);
  console.log("\u65E5\u5386\u5929\u6570:", daily.length, "(\u5E94\u4E3A 182)");
  console.log("\u533A\u95F4\u63D0\u4EA4\u6570:", daily.reduce((s, d) => s + d.commits, 0));
  const weeks = aggregateByWeek(daily);
  console.log("\u5468\u6570:", weeks.length);
  console.log("\u6700\u540E\u4E00\u5468:", JSON.stringify(weeks[weeks.length - 1]));
  console.log("\u6708\u4EFD\u6807\u7B7E\u6837\u672C:", eachDay(start, start).concat(eachDay(today, today)).join(","));
}
main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
