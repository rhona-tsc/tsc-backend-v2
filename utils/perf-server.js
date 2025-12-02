// utils/perf-server.js (Node)
import { performance } from "node:perf_hooks";

export const perf = {
  start(label) {
    performance.mark(label + ":start");
    console.time(label);
  },
  end(label) {
    performance.mark(label + ":end");
    performance.measure(label, label + ":start", label + ":end");
    console.timeEnd(label);
    const list = performance.getEntriesByName(label);
    const m = list[list.length - 1];
    if (m) console.log("⏱", label, m.duration.toFixed(1), "ms");
  },
};

// No rAF on server; use setImmediate to yield
export const nextPaint = () => new Promise((r) => setImmediate(r));