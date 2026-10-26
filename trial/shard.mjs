// node trial/shard.mjs <index> <count> <out> : writes shard <index> of <count> of the corpus.
// `crash` as the index writes the cases recorded as crashing a host build instead.
// Cases are sorted by host and id and cut into contiguous runs, so a shard
// mostly stays in one host.
import fs from 'node:fs';

const [index, count, out] = process.argv.slice(2);
const doc = JSON.parse(fs.readFileSync('syntax_corpus/oracle/vbe_oracle_cases.json', 'utf8'));
const crash = (c) => Object.hasOwn(c, 'crashesHostBuilds');
let cases;
if (index === 'crash') {
    cases = doc.cases.filter(crash);
} else {
    const all = doc.cases.filter((c) => !crash(c))
        .sort((a, b) => (a.host ?? 'excel').localeCompare(b.host ?? 'excel') || a.id.localeCompare(b.id));
    const size = Math.ceil(all.length / Number(count));
    cases = all.slice(Number(index) * size, (Number(index) + 1) * size);
}
fs.writeFileSync(out, JSON.stringify({ ...doc, cases }));
const hosts = {};
for (const c of cases) { hosts[c.host ?? 'excel'] = (hosts[c.host ?? 'excel'] ?? 0) + 1; }
console.log(`shard ${index}/${count}: ${cases.length} cases ${JSON.stringify(hosts)}`);
