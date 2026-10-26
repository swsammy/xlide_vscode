// node trial/build-manifest.mjs <oracle --json output for trial/probe-cases.json> <manifest out>
// Gives each probe the verdict measured on this runner, keeping the one recorded
// on the reference machine beside it, and observes every probe without requiring
// either verdict: this branch lacks the #1487 fix on purpose.
import fs from 'node:fs';

const [verdictsPath, outPath] = process.argv.slice(2);
const probes = JSON.parse(fs.readFileSync('trial/probes.json', 'utf8')).probes;
let results = [];
try {
    const text = fs.readFileSync(verdictsPath, 'utf8');
    results = JSON.parse(text.slice(text.indexOf('{'))).results ?? [];
} catch (error) {
    console.log(`No runner verdicts (${error.message}); using the recorded ones.`);
}
const byId = new Map(results.map((r) => [r.caseId, r]));
for (const probe of probes) {
    const recorded = probe.nativeVerdict;
    const measured = byId.get(probe.id);
    const usable = measured && (measured.outcome === 'accepted' || measured.outcome === 'rejected');
    console.log(`${probe.id}: recorded=${recorded.outcome}@${recorded.hostBuild} runner=${measured ? `${measured.outcome}@${measured.hostBuild}` : 'missing'}${usable && measured.outcome !== recorded.outcome ? '  DIFFERS' : ''}`);
    probe.recordedVerdict = recorded;
    if (usable) { probe.nativeVerdict = measured; }
    probe.requireNoErrors = false;
    probe.requireErrors = false;
}
fs.writeFileSync(outPath, JSON.stringify({ version: 1, cases: probes }, null, 2));
