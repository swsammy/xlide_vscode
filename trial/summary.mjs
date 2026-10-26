// node trial/summary.mjs <observations json> : one line per probe, editor errors against the VBE verdict.
import fs from 'node:fs';

const doc = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(`complete=${doc.complete} observations=${doc.observations.length}`);
for (const o of doc.observations) {
    const errors = o.modules.flatMap((m) => m.diagnostics.filter((d) => d.severity === 0).map((d) => `${m.name}:${d.code}`));
    const published = o.modules.every((m) => m.publicationEventSeen);
    const editorRejects = errors.length > 0;
    const vbeRejects = o.nativeVerdict.outcome === 'rejected';
    console.log(`${editorRejects === vbeRejects ? 'match   ' : 'MISMATCH'} ${o.id} vbe=${o.nativeVerdict.outcome}@${o.nativeVerdict.hostBuild} editor=[${errors.join(', ')}] published=${published}`);
}
