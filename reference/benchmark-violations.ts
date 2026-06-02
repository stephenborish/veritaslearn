import { performance } from "perf_hooks";

// In real node with Promise.all on N+1 queries to a real database, it will hit connection limits,
// or queue up.
// A more realistic benchmark showing N+1 against a database emulator would be nice, but to establish a baseline
// the conceptual mock works. Let's make the mock more representative of a real remote db call.

// Let's refine the mock to simulate concurrent connection limits/overhead which is the real issue with N+1
// over HTTP to Firebase.

const MOCK_LATENCY = 50;

let concurrentConnections = 0;
const simulateDbCall = async () => {
    concurrentConnections++;
    // Simulate connection penalty
    const penalty = Math.max(0, (concurrentConnections - 5) * 10);
    await new Promise(resolve => setTimeout(resolve, MOCK_LATENCY + penalty));
    concurrentConnections--;
}

const mockGetViolationsOnce = async (sessionId: string) => {
  await simulateDbCall();
  return [{ id: `v-${sessionId}`, sessionId, timestamp: new Date().toISOString() }];
};

const mockGetAllViolationsForSessions = async (sessionIds: string[]) => {
  const chunks = [];
  for (let i = 0; i < sessionIds.length; i += 30) {
    chunks.push(sessionIds.slice(i, i + 30));
  }

  const results = await Promise.all(chunks.map(async chunk => {
    await simulateDbCall();
    return chunk.map(sessionId => ({ id: `v-${sessionId}`, sessionId, timestamp: new Date().toISOString() }));
  }));

  return results.flat();
};

async function runBenchmark() {
  const sessionCount = 50;
  const sessions = Array.from({ length: sessionCount }).map((_, i) => ({ id: `s-${i}` }));

  console.log(`Benchmarking for ${sessionCount} sessions...`);

  const startNPlus1 = performance.now();
  const violationPromises = sessions.map(async (s) => {
    const vList = await mockGetViolationsOnce(s.id);
    return vList.map((v: any) => ({ ...v, session: s }));
  });
  const resultsNPlus1 = await Promise.all(violationPromises);
  const endNPlus1 = performance.now();
  const timeNPlus1 = endNPlus1 - startNPlus1;

  console.log(`[Baseline] N+1 Queries: ${timeNPlus1.toFixed(2)}ms`);

  // Wait a bit for connections to clear
  await new Promise(r => setTimeout(r, 100));

  const startOptimized = performance.now();
  const sessionIds = sessions.map(s => s.id);
  const allViolations = await mockGetAllViolationsForSessions(sessionIds);

  // The client side mapping we'll add
  // For larger sets, we should use a Map for O(1) lookup
  const sessionMap = new Map(sessions.map(s => [s.id, s]));
  const resultsOptimized = allViolations.map((v: any) => ({
    ...v,
    session: sessionMap.get(v.sessionId)
  }));

  const endOptimized = performance.now();
  const timeOptimized = endOptimized - startOptimized;

  console.log(`[Optimized] Bulk Query: ${timeOptimized.toFixed(2)}ms`);
  console.log(`Improvement: ${((timeNPlus1 - timeOptimized) / timeNPlus1 * 100).toFixed(2)}% faster`);
}

runBenchmark().catch(console.error);
