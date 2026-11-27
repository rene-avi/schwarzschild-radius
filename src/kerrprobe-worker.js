import { createKerrProbe, packKerrProbe } from './kerrprobe.js';

self.onmessage = ({ data }) => {
  try {
    const start = performance.now();
    const probe = createKerrProbe(data);
    const result = probe.state === 'refused' ? { notice: probe.notice } : { packet: packKerrProbe(probe) };
    self.postMessage({ ...result, computeMs: performance.now() - start });
  } catch (error) {
    self.postMessage({ notice: `Probe not released: ${error.message}` });
  }
};
