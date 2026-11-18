import { parentPort } from 'node:worker_threads';

globalThis.self = { postMessage: result => parentPort.postMessage(result) };
await import('../src/kerrprobe-worker.js');
parentPort.on('message', data => self.onmessage({ data }));
