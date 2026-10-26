// node trial/shard.mjs <index> <count> <out> : writes shard <index> of <count> of the corpus.
// `crash` as the index writes the cases recorded as crashing a host build instead.
// Cases are sorted by host and id and cut into contiguous runs of about equal
// expected time, so a shard mostly stays in one host. The weights are seconds
// per case measured on a hosted runner (run 40267844599).
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
    const weight = { access: 2.2, excel: 1, word: 0.65, powerpoint: 0.5 };
    const w = (c) => weight[c.host ?? 'excel'];
    const total = all.reduce((sum, c) => sum + w(c), 0);
    const per = total / Number(count);
    let acc = 0;
    cases = all.filter((c) => {
        const shard = Math.min(Number(count) - 1, Math.floor((acc + w(c) / 2) / per));
        acc += w(c);
        return shard === Number(index);
    });
}
fs.writeFileSync(out, JSON.stringify({ ...doc, cases }));
const hosts = {};
for (const c of cases) { hosts[c.host ?? 'excel'] = (hosts[c.host ?? 'excel'] ?? 0) + 1; }
console.log(`shard ${index}/${count}: ${cases.length} cases ${JSON.stringify(hosts)}`);
