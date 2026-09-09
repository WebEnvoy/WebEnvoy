import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { request } from 'node:http';
import type { RuntimeEndpointConfig, RuntimeSupervisorState } from './runtimeSupervisor.js';
import { resolveLodeAssetBundle } from './lodeAssetBundle.js';

type InstalledState = RuntimeEndpointConfig & { ready: boolean; runtime_id: string; error?: string; services: { id: 'core' | 'harbor'; pid: number }[] };
export async function connectInstalledRuntime(directory: string) {
  const readStatus = () => new Promise<InstalledState>((resolve, reject) => {
    const req = request({ socketPath: join(directory, 'runtime.sock'), path: '/status' }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; if (text.length > 65536) req.destroy(new Error('Installed Runtime response is too large')); });
      response.on('end', () => { try { resolve(JSON.parse(text)); } catch { reject(new Error('Installed Runtime response is invalid')); } });
    });
    req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('Installed Runtime is unavailable; use the installed diagnostic command'))); req.end();
  });
  const initial = await readStatus();
  const owner = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8'));
  if (!initial.ready || owner.runtime_id !== initial.runtime_id || !/^[A-Za-z0-9_-]{32,512}$/.test(owner.credential)) throw new Error('Installed Runtime is unavailable or ownership does not match');
  for (const key of ['coreEndpoint', 'harborEndpoint'] as const) {
    if (owner[key] !== initial[key] || !/^http:\/\/127\.0\.0\.1:\d+$/.test(initial[key])) throw new Error('Installed Runtime endpoint mismatch');
  }
  const token = (endpoint: string) => [initial.coreEndpoint, initial.harborEndpoint].some(configured => new URL(endpoint).href === new URL(configured).href) ? owner.credential as string : undefined;
  return {
    config: { coreEndpoint: initial.coreEndpoint, harborEndpoint: initial.harborEndpoint },
    async readState(_config: RuntimeEndpointConfig): Promise<RuntimeSupervisorState> {
      const state = await readStatus();
      const ready = state.ready && state.runtime_id === initial.runtime_id;
      const checkedAt = new Date().toISOString();
      return { mode: 'real', checkedAt, canUseLiveRuntime: ready, failClosed: !ready,
        summary: ready ? '已连接安装的独立 Runtime；退出 App 不停止实例。' : 'Runtime 已变化或不可用，请重新打开 App。', lodeAssets: resolveLodeAssetBundle(),
        services: state.services.map(service => ({ id: service.id, name: service.id === 'core' ? 'Core' : 'Harbor', endpoint: state[service.id === 'core' ? 'coreEndpoint' : 'harborEndpoint'], pid: service.pid, processState: ready ? 'running' : 'failed', launchSource: 'packaged-path', checkedAt, repairAction: '使用安装入口诊断或显式重启 Runtime，再打开 App。', health: { state: ready ? 'ready' : 'unavailable', url: state[service.id === 'core' ? 'coreEndpoint' : 'harborEndpoint'], summary: '独立 Runtime 连接' }, ...(service.id === 'core' ? { admission: { state: ready ? 'ready' as const : 'unavailable' as const, url: state.coreEndpoint, summary: '独立 Runtime 连接' } } : {}) })) };
    },
    stop() { /* Closing App releases only this connection; Runtime owns the browser processes. */ },
    getCoreRuntimeSupervisorToken: token,
    getHarborRuntimeSupervisorToken: token,
    getHarborManualAuthSupervisorToken: token,
  };
}
