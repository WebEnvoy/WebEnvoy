import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureForPath, PYTHON_DIAGNOSTIC_HELPERS } from './standalone-observation-cost-diagnostic.mjs';

// Diagnostic companion only: the formal CLI measurements are a separate run.
const [packageArg, pointerArg] = process.argv.slice(2);
assert.ok(packageArg && pointerArg, 'usage: node standalone-observation-cost-profile.mjs PACKAGE MATERIALS_POINTER');
const packageRoot = resolve(packageArg);
const materials = (await readFile(pointerArg, 'utf8')).trim();
const manifest = JSON.parse(await readFile(join(packageRoot, 'agent-manifest.json'), 'utf8'));
assert.equal(manifest.workspace.commit, '5bfb19347ea1dd4079d4d9524686deedc5f2d872');
const version = spawnSync(join(packageRoot, 'bin/webenvoy'), ['--version'], { encoding: 'utf8', timeout: 30_000 });
assert.equal(version.status, 0);
assert.equal(JSON.parse(version.stdout).integrity, 'verified');
const { verifyCamoufoxUpstreamInstall, CAMOUFOX_UPSTREAM_PINS } = await import(pathToFileURL(join(packageRoot, 'agent-entry/provider-artifact.mjs')));
await verifyCamoufoxUpstreamInstall({ provider: 'camoufox', ...CAMOUFOX_UPSTREAM_PINS,
  browser_install_root: join(materials, 'browser/Camoufox.app'), browser_executable: join(materials, 'browser/Camoufox.app/Contents/MacOS/camoufox'),
  python_path: join(materials, 'venv/bin/python'), browser_source_path: join(materials, 'camoufox-152.0.4-beta.30-mac.arm64.zip'),
  camoufox_source_path: join(materials, 'camoufox-0.5.6-py3-none-any.whl'),
  playwright_source_path: join(materials, 'playwright-1.60.0-py3-none-macosx_11_0_arm64.whl') });
const root = await mkdtemp('/tmp/webenvoy-556-profile-');
const evidence = join(root, 'evidence.json');
const fixtures = Object.fromEntries(['/controls/32', '/controls/128', '/controls/160', '/stress'].map(path => [path, fixtureForPath(path)]));
const server = createServer((request, response) => {
  const fixture = fixtures[request.url];
  response.writeHead(fixture ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(fixture?.html ?? 'not found');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const config = { packageRoot, materials, root, evidence, origin, candidate: manifest.workspace.commit,
  manifest_sha256: createHash('sha256').update(await readFile(join(packageRoot, 'agent-manifest.json'))).digest('hex'),
  fixtures: Object.fromEntries(Object.entries(fixtures).map(([path, item]) => [path, { sha256: item.sha256, bytes: Buffer.byteLength(item.html) }])) };
await writeFile(join(root, 'config.json'), JSON.stringify(config), { mode: 0o600 });
const source = `${PYTHON_DIAGNOSTIC_HELPERS}
import asyncio, hashlib, importlib.util, json, os
from pathlib import Path

cfg = json.loads(Path(sys.argv[1]).read_text())
module_root = Path(cfg['packageRoot']) / 'dist-electron/runtime/harbor/dist/packages/runtime-api/src'
sys.path.insert(0, str(module_root))
spec = importlib.util.spec_from_file_location('camoufox_adapter', module_root / 'camoufox-upstream-driver.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
profile = Path(cfg['root']) / 'profile'
profile.mkdir(mode=0o700)
report = {'candidate': cfg['candidate'], 'kind': 'instrumented_direct_production_methods',
 'manifest_sha256': cfg['manifest_sha256'],
 'fixtures': cfg['fixtures'], 'started_at': time.time(), 'samples': [], 'starts': [],
 'protocol_count_scope': 'Python to Playwright driver sends, NOT browser wire round-trips',
 'cpu_scope': 'Python process only, NOT browser/Node/OS CPU',
 'timing_scope': 'inclusive nested method times; exclusive subtracts measured children; sums of inclusive are invalid',
 'authentication': 'direct diagnostic; no Core/Grant/Plugin verification claim',
 'cleanup': 'pending'}
def persist():
    Path(cfg['evidence']).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\\n')
    os.chmod(cfg['evidence'], 0o600)
deadline = time.monotonic() + 900
driver = None

async def measured(label, request):
    meter.rows.clear()
    counts, stop_counter = start_playwright_protocol_counter()
    cpu = process_cpu_ns()
    start = time.perf_counter_ns()
    result = None
    error = None
    try:
        result = await asyncio.wait_for(driver.interact(request), timeout=min(60, max(0.001, deadline-time.monotonic())))
    except Exception as exc:
        error = type(exc).__name__
    finally:
        wall = time.perf_counter_ns() - start
        cpu = process_cpu_ns() - cpu
        stop_counter()
    serial = time.perf_counter_ns()
    encoded = json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode() if result is not None else b''
    serial = time.perf_counter_ns() - serial
    snapshot = result.get('snapshot') if isinstance(result, dict) else None
    row = {'label': label, 'wall_ms': wall/1e6, 'python_cpu_ms': cpu/1e6,
      'json_encode_ms': serial/1e6, 'response_bytes': len(encoded), 'methods': meter.snapshot(),
      'protocol_sends': dict(counts), 'protocol_send_count': sum(counts.values()),
      'status': result.get('status') if result else None, 'failure_class': result.get('failure_class') if result else None,
      'dispatch_state': result.get('dispatch_state') if result else None, 'exception': error,
      'timeout': error == 'TimeoutError',
      'snapshot': {'controls': len(snapshot['controls']), 'coverage': snapshot['coverage'],
        'continuation': {k:v for k,v in snapshot['continuation'].items() if k != 'next_cursor'}} if snapshot else None}
    report['samples'].append(row)
    persist()
    print(json.dumps({'label':label, 'wall_ms':row['wall_ms'], 'status':row['status'], 'error':error}), flush=True)
    if error or not result or result.get('status') != 'completed':
        raise RuntimeError('sample_failed_stop')
    return result

async def main():
    global driver, meter
    try:
        for size in (32, 128, 160, 800):
            if time.monotonic() >= deadline:
                raise RuntimeError('live_budget_exhausted')
            path = '/stress' if size == 800 else '/controls/' + str(size)
            request = {'profile_dir': str(profile), 'install_root': str(Path(cfg['materials']) / 'browser/Camoufox.app'),
              'browser_path': str(Path(cfg['materials']) / 'browser/Camoufox.app/Contents/MacOS/camoufox'),
              'url': cfg['origin'] + path, 'headless': False, 'scope_semantics': 'legacy_request_guard_v1',
              'environment': {'language': 'en-US', 'timezone': 'UTC'},
              'source': {'source': 'official_release', 'source_sha256': adapter.SOURCE_SHA256_PIN,
                'camoufox_version': adapter.CAMOUFOX_VERSION_PIN, 'browser_version': adapter.BROWSER_VERSION_PIN,
                'playwright_version': adapter.PLAYWRIGHT_VERSION_PIN}}
            start = time.perf_counter_ns()
            driver = await asyncio.wait_for(adapter.Driver.create(request, adapter.CamoufoxAdapter()), 60)
            report['starts'].append({'controls': size, 'wall_ms': (time.perf_counter_ns()-start)/1e6})
            meter = WebEnvoyMeasurement()
            wrap_shared_driver_methods(driver, meter)
            state = driver.pages[driver.current]
            for round in range(1 if size == 800 else 3):
                prefix = str(size) + '-r' + str(round)
                common = {'provider_page_ref': state.ref, 'page_ref': state.ref, 'page_id': state.ref,
                  'document_generation': state.generation, 'expected_origin': cfg['origin'],
                  'authorized_origins': [cfg['origin']], 'scope_semantics': 'legacy_request_guard_v1'}
                result = await measured(prefix+'-snapshot', dict(common, action='snapshot', limit=128))
                first = result['snapshot']
                current = first
                refs = [x['target_ref'] for x in current['controls']]
                segments = 1
                while current['continuation']['has_more']:
                    assert segments < 16, 'continuation_did_not_terminate'
                    result = await measured(prefix+'-continuation-'+str(segments), dict(common, action='snapshot', limit=128,
                      observation_ref=first['observation_ref'], cursor=current['continuation']['next_cursor']))
                    current = result['snapshot']
                    assert current['observation_ref'] == first['observation_ref'] and current['captured_at'] == first['captured_at']
                    assert len(current['controls']) > 0
                    refs.extend(x['target_ref'] for x in current['controls'])
                    segments += 1
                assert len(refs) == len(set(refs)) == first['coverage']['controls']['captured_count']
                if size != 800:
                    assert len(refs) == size and current['coverage']['controls']['complete']
                    assert len(first['controls']) == min(128,size) and segments == (2 if size==160 else 1)
                    target = current['controls'][-1]
                    assert target['role']=='textbox' and target['disambiguation']!='ambiguous'
                    await measured(prefix+'-input', dict(common, action='input', observation_ref=first['observation_ref'],
                      target_ref=target['target_ref'], text='sample-'+str(round)))
            await asyncio.wait_for(driver.close(), 20)
            driver = None
        report['state'] = 'completed'
    except Exception as exc:
        report['state'] = 'stopped'
        report['error'] = type(exc).__name__ + ':' + str(exc)
    finally:
        try:
            if driver is not None:
                await asyncio.wait_for(driver.close(), 20)
            report['cleanup'] = 'driver_closed'
        except Exception as exc:
            report['cleanup'] = type(exc).__name__
        report['ended_at'] = time.time()
        persist()
asyncio.run(main())
`;
await writeFile(join(root, 'profile.py'), source, { mode: 0o600 });
console.log(JSON.stringify({ evidence, root }));
try {
  const compileOnly = process.argv.includes('--self-check');
  const pythonArgs = compileOnly ? ['-B', '-c', 'import sys; compile(open(sys.argv[1]).read(), sys.argv[1], "exec"); print("generated-python-compile-passed")', join(root, 'profile.py')]
    : ['-B', join(root, 'profile.py'), join(root, 'config.json')];
  const child = spawn(join(materials, 'venv/bin/python'), pythonArgs, { stdio: 'inherit', detached: true });
  let forced = false;
  const watchdog = setTimeout(() => { forced = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {} }, 920_000);
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); });
  clearTimeout(watchdog);
  if (forced) {
    let report = {};
    try { report = JSON.parse(await readFile(evidence, 'utf8')); } catch {}
    await writeFile(evidence, JSON.stringify({ ...report, state: 'watchdog_terminated', cleanup: 'process_group_signaled_not_verified' }, null, 2), { mode: 0o600 });
  }
  if (!compileOnly && !forced) {
    const report = JSON.parse(await readFile(evidence, 'utf8'));
    console.log(JSON.stringify({ evidence, state: report.state, cleanup: report.cleanup }));
    if (report.state !== 'completed' || report.cleanup !== 'driver_closed') process.exitCode = 1;
  }
  if (code !== 0 || forced) process.exitCode = 1;
} finally {
  await new Promise(done => server.close(done));
}
