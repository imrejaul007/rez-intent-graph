// ── Quick Smoke Test ───────────────────────────────────────────────────────────────
// Fast test to verify agents and actions work

import 'dotenv/config';
import { connectDB } from '../database/mongodb.js';
import { sharedMemory } from '../agents/shared-memory.js';
import { getSwarmCoordinator } from '../agents/swarm-coordinator.js';
import { runDemandSignalAgent } from '../agents/demand-signal-agent.js';
import { runScarcityAgent } from '../agents/scarcity-agent.js';
import { actionExecutor, handleDemandSignalAction } from '../agents/action-trigger.js';

async function main() {
  console.log('🔥 Running quick smoke test...\n');

  // Connect to MongoDB first
  await connectDB();
  console.log('✅ MongoDB connected\n');

  // Enable dangerous mode for action executor
  getSwarmCoordinator().enableDangerousMode();
  console.log('✅ Dangerous mode enabled\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Shared Memory
  try {
    await sharedMemory.set('smoke-test', { value: Date.now() }, 60);
    const retrieved = await sharedMemory.get('smoke-test');
    if (retrieved) {
      console.log('✅ Shared Memory working');
      passed++;
    } else {
      throw new Error('Value not retrieved');
    }
  } catch (e) {
    console.log('❌ Shared Memory failed:', e);
    failed++;
  }

  // Test 2: Demand Signal Agent
  try {
    const result = await runDemandSignalAgent();
    if (result.success) {
      console.log('✅ Demand Signal Agent working');
      passed++;
    } else {
      throw new Error(result.error);
    }
  } catch (e) {
    console.log('❌ Demand Signal Agent failed:', e);
    failed++;
  }

  // Test 3: Scarcity Agent
  try {
    const result = await runScarcityAgent();
    if (result.success) {
      console.log('✅ Scarcity Agent working');
      passed++;
    } else {
      throw new Error(result.error);
    }
  } catch (e) {
    console.log('❌ Scarcity Agent failed:', e);
    failed++;
  }

  // Test 4: Action Trigger
  try {
    const result = await actionExecutor.execute({
      type: 'alert_support',
      target: 'test',
      payload: { type: 'test', severity: 'low', message: 'smoke test' },
      agent: 'smoke-test',
      skipPermission: true,
      risk: 'low',
    });
    if (result) {
      console.log('✅ Action Executor working');
      passed++;
    } else {
      throw new Error('Action returned false');
    }
  } catch (e) {
    console.log('❌ Action Executor failed:', e);
    failed++;
  }

  // Test 5: Demand Signal Action
  try {
    await handleDemandSignalAction({
      merchantId: 'smoke-test-merchant',
      category: 'DINING',
      demandCount: 50,
      unmetDemandPct: 60,
      avgPriceExpectation: 100,
      topCities: ['Mumbai'],
      trend: 'rising',
      spikeDetected: true,
      spikeFactor: 4.0,
      timestamp: new Date(),
    });
    console.log('✅ Demand Signal Action working');
    passed++;
  } catch (e) {
    console.log('❌ Demand Signal Action failed:', e);
    failed++;
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
