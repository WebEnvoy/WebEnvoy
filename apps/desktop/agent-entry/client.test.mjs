import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localRequest } from './client.mjs';

test('localRequest preserves UTF-8 when a socket response splits a code point', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'webenvoy-client-test-'));
  const socketPath = join(dataDir, 'runtime.sock');
  const server = createServer(socket => {
    socket.setNoDelay(true);
    socket.once('data', () => {
      const payload = Buffer.from(JSON.stringify({ ok: true, text: '时间和范围' }), 'utf8');
      const splitAt = payload.indexOf(Buffer.from('间', 'utf8')) + 1;
      const header = Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n`, 'ascii');
      socket.write(header);
      socket.write(payload.subarray(0, splitAt), () => setTimeout(() => socket.end(payload.subarray(splitAt)), 20));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  try {
    assert.deepEqual(await localRequest(dataDir, '/status'), { ok: true, text: '时间和范围' });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
