import { run } from 'node:test';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
try {
  const directory = new URL('./', import.meta.url);
  const files = (await readdir(directory)).filter(name => name.endsWith('.test.js')).sort()
    .map(name => fileURLToPath(new URL(name, directory)));
  if (files.length === 0) throw new Error('No test files found');
  const stream = run({ files, isolation: 'none' });
  for await (const event of stream) {
    if (event.type === 'test:pass' && event.data.details.type !== 'suite') passed++;
    if (event.type === 'test:fail' && event.data.details.type !== 'suite') {
      failed++;
      console.error(`FAIL ${event.data.name}: ${event.data.details.error?.stack || event.data.details.error}`);
    }
  }
} catch (error) {
  failed++;
  console.error(error);
}
console.log(`TOTAL ${passed + failed} pass ${passed} fail ${failed}`);
process.exitCode = failed > 0 || passed === 0 ? 1 : 0;
