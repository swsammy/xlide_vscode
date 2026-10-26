// node trial/run-shard.mjs <cases.json> <out dir> <name> : runs the oracle on a shard
// with a checkpoint. The oracle stops a run at an infrastructure failure; this
// records the case that caused it, sets it aside, and resumes from the
// checkpoint, so one case cannot hide the rest of the shard.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [casesPath, outDir, name] = process.argv.slice(2);
const doc = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
const checkpoint = path.join(outDir, `${name}.jsonl`);
const setAside = [];
const started = Date.now();
for (let pass = 1; pass <= 25; pass++) {
    const remaining = path.join(outDir, `${name}-cases.json`);
    fs.writeFileSync(remaining, JSON.stringify(doc));
    const out = path.join(outDir, `${name}-pass${pass}.json`);
    const run = spawnSync(process.execPath, ['syntax_corpus/oracle/run_vbe_oracle.mjs', '--cases', remaining, '--json', '--checkpoint', checkpoint],
        { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'inherit'] });
    fs.writeFileSync(out, run.stdout ?? '');
    console.log(`pass ${pass}: exit ${run.status} after ${((Date.now() - started) / 60000).toFixed(1)} min`);
    let summary;
    try { summary = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'))); } catch { console.log('no JSON output; stopping'); break; }
    if (!summary.oracleFailureCount) { break; }
    const failed = summary.results.filter((r) => r.outcome !== 'accepted' && r.outcome !== 'rejected');
    if (!failed.length) { console.log('oracle failure without a failing case; stopping'); break; }
    for (const f of failed) {
        console.log(`  set aside ${f.caseId}: ${f.outcome} ${f.stage} ${String(f.message).slice(0, 200)}`);
        setAside.push(f);
    }
    const drop = new Set(failed.map((f) => f.caseId));
    doc.cases = doc.cases.filter((c) => !drop.has(c.id));
}
fs.writeFileSync(path.join(outDir, `${name}-set-aside.json`), JSON.stringify(setAside, null, 1));
console.log(`set aside ${setAside.length} case(s); total ${((Date.now() - started) / 60000).toFixed(1)} min`);
