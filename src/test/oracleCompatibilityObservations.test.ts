// Opt-in: replays programs the VBE oracle has measured in the real extension and
// records the diagnostics it publishes, in a fresh Excel, Word, PowerPoint or
// Access project chosen by each probe's host. Skipped unless
// XLIDE_ORACLE_OBSERVATION_MANIFEST names a manifest of probes and
// XLIDE_ORACLE_OBSERVATION_OUTPUT the file to write; see "Editor observations"
// in syntax_corpus/oracle/README.md.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { OfficeHostApp } from '../officeHostApps';
import { encodeModuleUri } from '../xlideFileSystem';
import { deleteModule, listReferences, readModules } from '../vba/projectService';
import { activate, closeAllEditors, EXTENSION_ID, open, workspaceRoot } from './support';

interface PublicationWitness {
    moduleName: string;
    code: string;
    severity: 'information';
    sourceText: string;
}
interface Probe {
    id: string;
    host: string;
    modules: Array<{ name: string; type: 'standard' | 'class'; source: string }>;
    nativeVerdict: { outcome: 'accepted' | 'rejected'; hostBuild: string; [key: string]: unknown };
    publicationBarrier: PublicationWitness;
    targetPublicationBarriers?: PublicationWitness[];
    requireNoErrors: boolean;
    /** Observe a known missing diagnostic without requiring that mismatch to persist. */
    requireErrors?: boolean;
}
/**
 * The seed copied for each probe, by host: a file that already has a VBA
 * project (product writes do not create one), and the document modules it
 * keeps, which must hold no code. Every other module is deleted first.
 */
const SEEDS: Record<OfficeHostApp, { fixture: string; documents: string[] }> = {
    excel: { fixture: 'ShapesFixture.xlsm', documents: ['Sheet1', 'ThisWorkbook'] },
    word: { fixture: 'WordFormFixture.docm', documents: ['ThisDocument'] },
    powerpoint: { fixture: 'PowerPointFixture.pptm', documents: [] },
    access: { fixture: 'AccessFixture.accdb', documents: [] },
};
const inputPath = process.env.XLIDE_ORACLE_OBSERVATION_MANIFEST;
const outputPath = process.env.XLIDE_ORACLE_OBSERVATION_OUTPUT;
const normalize = (source: string): string => source.replace(/\r\n/g, '\n').trimEnd();
const codeOf = (diagnostic: vscode.Diagnostic): string | number | undefined =>
    typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;

/** Subscribe before opening documents; completion depends on semantic publication, not elapsed quiet time. */
function publicationBarrier(probe: Probe, documents: Map<string, vscode.TextDocument>): {
    ready: Promise<void>; check: () => void; dispose: () => void; publishedUris: Set<string>;
} {
    const publishedUris = new Set<string>();
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    // Attach rejection handling immediately; opening documents may take longer than the deadline.
    void ready.catch(() => undefined);
    const check = (): void => {
        if (documents.size !== probe.modules.length) { return; }
        for (const module of probe.modules) {
            const document = documents.get(module.name);
            if (!document || normalize(document.getText()) !== normalize(module.source)) { return; }
        }
        for (const witness of [probe.publicationBarrier, ...(probe.targetPublicationBarriers ?? [])]) {
            const document = documents.get(witness.moduleName);
            if (!document) { return; }
            const finding = vscode.languages.getDiagnostics(document.uri).find(d =>
                codeOf(d) === witness.code && d.severity === vscode.DiagnosticSeverity.Information
                && document.getText(d.range) === witness.sourceText);
            if (!finding) { return; }
        }
        resolve();
    };
    const listener = vscode.languages.onDidChangeDiagnostics(event => {
        for (const uri of event.uris) { publishedUris.add(uri.toString()); }
        check();
    });
    const timer = setTimeout(() => reject(new Error(`${probe.id}: modules not written, opened and published within 30 s`)), 30000);
    return { ready, check, publishedUris, dispose: () => { clearTimeout(timer); listener.dispose(); } };
}

(inputPath && outputPath ? suite : suite.skip)('Native oracle compatibility observations', () => {
    suiteSetup(activate);
    test('records native programs from fresh projects through published diagnostics', async function () {
        this.timeout(1800000);
        assert.ok(inputPath && outputPath);
        const input = JSON.parse(fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '')) as { cases: Probe[] };
        assert.ok(input.cases.length > 0);
        assert.equal(new Set(input.cases.map(p => p.id)).size, input.cases.length);
        const extension = vscode.extensions.getExtension(EXTENSION_ID)!;
        const observations: unknown[] = [];
        let complete = false;
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        const record = (): void => fs.writeFileSync(outputPath, JSON.stringify({ complete, inputPath, observations }, null, 2) + '\n');
        record();
        for (const probe of input.cases) {
            const seed = Object.hasOwn(SEEDS, probe.host) ? SEEDS[probe.host as OfficeHostApp] : undefined;
            assert.ok(seed, `${probe.id}: no seed for host ${probe.host}`);
            const fixture = path.join(extension.extensionPath, 'tests', 'fixtures', 'binaries', seed.fixture);
            assert.ok(probe.modules.length > 0);
            // Every module needs its own witness, or one could still be unpublished when the rest are read.
            const witnesses = [probe.publicationBarrier, ...(probe.targetPublicationBarriers ?? [])];
            for (const witness of witnesses) {
                assert.equal(witness.code, 'unused-variable', `${probe.id}: witness code`);
                assert.equal(witness.severity, 'information', `${probe.id}: witness severity`);
            }
            assert.deepEqual([...new Set(witnesses.map(w => w.moduleName))].sort(), probe.modules.map(m => m.name).sort(),
                `${probe.id}: one publication witness for every module`);
            await closeAllEditors();
            const project = path.join(workspaceRoot(), `OracleObservation_${randomUUID().replaceAll('-', '')}${path.extname(seed.fixture)}`);
            fs.copyFileSync(fixture, project);
            const documents = new Map<string, vscode.TextDocument>();
            let barrier: ReturnType<typeof publicationBarrier> | undefined;
            try {
                // This seed already has a VBA project; product writes intentionally do not create one.
                // Remove unrelated VBA modules before the product sees this unique disposable identity.
                for (const module of readModules(project)) {
                    if (module.type !== 'document') { deleteModule(project, module.name); }
                }
                const seedModules = readModules(project);
                assert.deepEqual(seedModules.map(m => m.name).sort(), [...seed.documents].sort());
                for (const module of seedModules) {
                    assert.equal(module.type, 'document');
                    assert.equal(module.hasCode, false, `seed document ${module.name} must contain no code`);
                }
                const seedProjectContext = { host: probe.host, fixture: path.basename(fixture), modules: seedModules,
                    references: listReferences(project) };
                const published = publicationBarrier(probe, documents);
                barrier = published;
                for (const module of probe.modules) {
                    assert.ok(module.type === 'standard' || module.type === 'class');
                    const cancellation = new vscode.CancellationTokenSource();
                    try {
                        await vscode.lm.invokeTool('xlide_writeModule', {
                            input: { filePath: project, moduleName: module.name, source: module.source, kind: module.type },
                            toolInvocationToken: undefined,
                        }, cancellation.token);
                    } finally { cancellation.dispose(); }
                }
                // Open the caller last, after every source/dependency is already current in this new project.
                const ordered = [...probe.modules].sort((a, b) => Number(a.name === probe.publicationBarrier.moduleName) - Number(b.name === probe.publicationBarrier.moduleName));
                for (const module of ordered) {
                    const uri = encodeModuleUri(project, module.name);
                    const document = await vscode.workspace.openTextDocument(uri);
                    documents.set(module.name, document);
                    assert.equal(normalize(document.getText()), normalize(module.source), `${probe.id}: imported ${module.name}`);
                    await open(uri);
                }
                published.check();
                await published.ready;
                const modules = probe.modules.map(module => {
                    const document = documents.get(module.name)!;
                    assert.equal(normalize(document.getText()), normalize(module.source));
                    assert.equal(document.isDirty, false, 'observation must preserve measured source');
                    return {
                        name: module.name, type: module.type, uri: document.uri.toString(), version: document.version,
                        measuredSource: module.source, source: document.getText(),
                        publicationEventSeen: published.publishedUris.has(document.uri.toString()),
                        diagnostics: vscode.languages.getDiagnostics(document.uri).map(d => ({
                            code: codeOf(d), severity: d.severity, message: d.message, source: d.source,
                            range: { start: { line: d.range.start.line, character: d.range.start.character }, end: { line: d.range.end.line, character: d.range.end.character } },
                            sourceText: document.getText(d.range),
                        })),
                    };
                });
                const errors = modules.flatMap(m => m.diagnostics).filter(d => d.severity === vscode.DiagnosticSeverity.Error);
                observations.push({ id: probe.id, project, seedProjectContext, recordedAt: new Date().toISOString(), nativeVerdict: probe.nativeVerdict,
                    publicationBarrier: probe.publicationBarrier, targetPublicationBarriers: probe.targetPublicationBarriers, modules });
                record();
                if (probe.requireNoErrors) { assert.deepEqual(errors, [], 'native valid control must resolve'); }
                if (probe.requireErrors ?? probe.nativeVerdict.outcome === 'rejected') {
                    assert.ok(errors.length > 0, 'native negative control needs an Error diagnostic');
                }
                // Known mismatches are observed, never required to persist after a fix.
            } finally {
                barrier?.dispose();
                try { await closeAllEditors(); } finally { fs.rmSync(project, { force: true }); }
            }
        }
        complete = true;
        record();
    });
});
