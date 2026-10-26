// node trial/aggregate.mjs <dir> : combines every shard's checkpoint under <dir>
// and compares each result with the corpus's recorded verdict.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const corpus = JSON.parse(fs.readFileSync('syntax_corpus/oracle/vbe_oracle_cases.json', 'utf8')).cases;
const byId = new Map(corpus.map((c) => [c.id, c]));
const results = new Map();
const files = [];
(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walk(p); } else if (e.name.endsWith('.jsonl')) { files.push(p); }
    }
})(dir);
for (const f of files) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!line.trim()) { continue; }
        try { const { result } = JSON.parse(line); results.set(result.caseId, result); } catch { /* torn last line */ }
    }
}
const tally = {};
const differs = [];
const builds = new Set();
for (const [id, r] of results) {
    const kase = byId.get(id);
    const host = r.host ?? kase?.host ?? 'excel';
    builds.add(`${host} ${r.hostBuild}`);
    const t = (tally[host] ??= { run: 0, matched: 0, differs: 0, other: 0 });
    t.run++;
    if (r.outcome !== 'accepted' && r.outcome !== 'rejected') { t.other++; differs.push({ id, host, expected: kase?.expected, outcome: r.outcome, stage: r.stage, message: r.message }); continue; }
    if (kase?.expected === 'observe' || kase?.expected === r.outcome) { t.matched++; continue; }
    t.differs++;
    differs.push({ id, host, expected: kase?.expected, outcome: r.outcome, stage: r.stage, message: r.message });
}
const missing = corpus.filter((c) => !results.has(c.id)).map((c) => c.id);
console.log(`checkpoint files ${files.length}, results ${results.size} of ${corpus.length}, missing ${missing.length}`);
console.log(`builds: ${[...builds].sort().join('; ')}`);
console.log(JSON.stringify(tally, null, 1));
console.log(`not matching the recorded verdict: ${differs.length}`);
for (const d of differs) { console.log(`  ${d.host} ${d.id}: expected ${d.expected}, got ${d.outcome} (${d.stage}) ${String(d.message ?? '').slice(0, 160)}`); }
if (missing.length) { console.log(`missing (first 50): ${missing.slice(0, 50).join(', ')}`); }
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ tally, differs, missing }, null, 1));
