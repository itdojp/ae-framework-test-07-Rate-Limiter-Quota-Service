import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address !== 'string') {
        const port = address.port;
        server.close(() => resolve(port));
        return;
      }
      server.close(() => reject(new Error('failed to reserve port')));
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`health check timeout: ${baseUrl}`);
}

function startServer(port: number, stateFilePath: string): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, ['dist/index.js'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      STATE_BACKEND: 'file',
      STATE_FILE_PATH: stateFilePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return child;
}

async function stopServer(child: ChildProcessWithoutNullStreams, timeoutMs = 3000): Promise<void> {
  if (child.killed || child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
      resolve();
    }, timeoutMs);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function postJson(url: string, payload: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  return {
    status: response.status,
    body,
  };
}

describe('E2E restart with file backend', () => {
  it('retains policy/state/idempotency after process restart', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'rl-e2e-'));
    const stateFile = join(workspace, 'runtime-state.json');
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    let server: ChildProcessWithoutNullStreams | null = null;

    try {
      server = startServer(port, stateFile);
      await waitForHealth(baseUrl);

      const createPolicy = await postJson(`${baseUrl}/ratelimit/policies`, {
        policy_id: 'P-E2E',
        tenant_id: 'TENANT-E2E',
        name: 'e2e policy',
        status: 'ACTIVE',
        priority: 99,
        scope: {
          subject_type: 'USER',
          resource_type: 'ENDPOINT',
        },
        match: {
          resource_pattern: '/api/v1/orders*',
        },
        limits: [
          {
            kind: 'TOKEN_BUCKET',
            capacity: 10,
            refill_tokens_per_sec: 1,
            initial_tokens: 10,
            behavior_on_denied: 'DENY',
          },
          {
            kind: 'FIXED_WINDOW',
            window_seconds: 60,
            limit: 20,
            behavior_on_denied: 'DENY',
          },
        ],
      });
      expect(createPolicy.status).toBe(201);

      const firstConsume = await postJson(`${baseUrl}/ratelimit/consume`, {
        tenant_id: 'TENANT-E2E',
        request_id: 'e2e-req-1',
        subject: { type: 'USER', id: 'U-E2E-1' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 3,
        now: '2026-02-15T00:00:00.000Z',
      });
      expect(firstConsume.status).toBe(200);
      expect(firstConsume.body.allowed).toBe(true);
      expect(firstConsume.body.remaining).toBe(7);

      await stopServer(server);
      server = null;

      server = startServer(port, stateFile);
      await waitForHealth(baseUrl);

      const listResponse = await fetch(`${baseUrl}/ratelimit/policies?tenant_id=TENANT-E2E`);
      const listBody = await listResponse.json() as { items: Array<{ policy_id: string }> };
      expect(listResponse.status).toBe(200);
      expect(listBody.items[0]?.policy_id).toBe('P-E2E');

      const secondConsume = await postJson(`${baseUrl}/ratelimit/consume`, {
        tenant_id: 'TENANT-E2E',
        request_id: 'e2e-req-2',
        subject: { type: 'USER', id: 'U-E2E-1' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 1,
        now: '2026-02-15T00:00:00.000Z',
      });
      expect(secondConsume.status).toBe(200);
      expect(secondConsume.body.allowed).toBe(true);
      expect(secondConsume.body.remaining).toBe(6);

      const replay = await postJson(`${baseUrl}/ratelimit/consume`, {
        tenant_id: 'TENANT-E2E',
        request_id: 'e2e-req-2',
        subject: { type: 'USER', id: 'U-E2E-1' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 1,
        now: '2026-02-15T00:00:01.000Z',
      });
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(secondConsume.body);

      const conflict = await postJson(`${baseUrl}/ratelimit/consume`, {
        tenant_id: 'TENANT-E2E',
        request_id: 'e2e-req-2',
        subject: { type: 'USER', id: 'U-E2E-1' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 2,
        now: '2026-02-15T00:00:01.000Z',
      });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error).toBe('IDEMPOTENCY_KEY_REUSE');
    } finally {
      if (server) {
        await stopServer(server);
      }
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 20000);
});
