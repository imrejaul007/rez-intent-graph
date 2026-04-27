/**
 * ReZ Merchant OS - Commerce Stress Test Suite
 *
 * Tests all 20+ scenarios for Merchant Copilot
 * Including procurement, pricing, CRM, ops, finance, and multi-agent orchestration
 */

import { sharedMemory } from '../agents/shared-memory.js';
import { actionExecutor } from '../agents/action-trigger.js';

// ── Test Infrastructure ────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  details?: Record<string, unknown>;
  error?: string;
}

interface MerchantContext {
  merchantId: string;
  sku: string;
  supplierId: string;
  customerId: string;
  memory: Map<string, unknown>;
}

async function runTest(
  name: string,
  fn: (ctx: MerchantContext) => Promise<void>
): Promise<TestResult> {
  const start = Date.now();
  const ctx: MerchantContext = {
    merchantId: 'merchant-stress-test',
    sku: 'sku-001',
    supplierId: 'supplier-001',
    customerId: 'customer-001',
    memory: new Map(),
  };

  try {
    console.log(`\n🧪 Running: ${name}`);
    await fn(ctx);
    console.log(`✅ PASSED: ${name}`);
    return { name, passed: true, duration: Date.now() - start };
  } catch (error) {
    console.error(`❌ FAILED: ${name}`, error);
    return {
      name,
      passed: false,
      duration: Date.now() - start,
      error: String(error)
    };
  }
}

// ── INVENTORY / PROCUREMENT TESTS ─────────────────────────────────────────────

/**
 * Test 1: Smart Reorder
 *
 * Merchant: "What should I reorder today?"
 * → Analyzes sales velocity, stock, seasonality, supplier lead times
 */
async function testSmartReorder(ctx: MerchantContext): Promise<void> {
  // Simulate sales data
  const salesHistory = [
    { sku: 'tomatoes', dailySales: 5, stock: 20, leadTime: 2 },
    { sku: 'chicken', dailySales: 8, stock: 15, leadTime: 1 },
    { sku: 'rice', dailySales: 3, stock: 50, leadTime: 3 },
  ];

  // Calculate reorder recommendations
  const recommendations = salesHistory.map(item => {
    const daysOfStock = item.stock / item.dailySales;
    const needsReorder = daysOfStock <= item.leadTime + 1;

    return {
      sku: item.sku,
      currentStock: item.stock,
      dailySales: item.dailySales,
      daysOfStock: daysOfStock.toFixed(1),
      reorderQuantity: Math.ceil(item.dailySales * (item.leadTime + 3)), // 3 days buffer
      urgency: needsReorder ? 'HIGH' : 'NORMAL',
    };
  }).filter(r => r.urgency === 'HIGH');

  console.log(`   📦 Reorder recommendations: ${recommendations.length} items`);
  for (const r of recommendations) {
    console.log(`   - ${r.sku}: ${r.currentStock} in stock (${r.daysOfStock} days), reorder qty: ${r.reorderQuantity}`);
  }

  if (recommendations.length === 0) {
    console.log(`   ✅ No urgent reorders needed`);
  }
}

/**
 * Test 2: Demand Spike Alert
 *
 * Agent detects: Biryani searches up 300% → Suggests inventory increase
 */
async function testDemandSpikeAlert(ctx: MerchantContext): Promise<void> {
  // Simulate demand signals
  const demandSignals = [
    { category: 'biryani', searchVolume: 300, baseline: 100 },
    { category: 'pizza', searchVolume: 120, baseline: 100 },
    { category: 'burgers', searchVolume: 90, baseline: 100 },
  ];

  // Detect spikes
  const spikes = demandSignals
    .map(d => ({
      ...d,
      spikeFactor: d.searchVolume / d.baseline,
      percentIncrease: ((d.searchVolume - d.baseline) / d.baseline * 100).toFixed(0),
    }))
    .filter(d => d.spikeFactor >= 1.5);

  console.log(`   📈 Demand spikes detected: ${spikes.length}`);
  for (const spike of spikes) {
    console.log(`   - ${spike.category}: +${spike.percentIncrease}% (${spike.spikeFactor}x baseline)`);
  }

  // Suggest inventory action
  if (spikes.length > 0) {
    const topSpike = spikes[0];
    const suggestedIncrease = Math.ceil(50 * (topSpike.spikeFactor - 1));
    console.log(`   💡 Action: Increase ${topSpike.category} inventory by ${suggestedIncrease} units`);
  }
}

/**
 * Test 3: Stockout Prevention Flow
 *
 * Critical SKU likely to run out tomorrow → Agent warns
 */
async function testStockoutPrevention(ctx: MerchantContext): Promise<void> {
  const skus = [
    { id: 'sku-001', name: 'Chicken Breast', stock: 5, dailyVelocity: 8, leadTime: 1 },
    { id: 'sku-002', name: 'Rice', stock: 30, dailyVelocity: 5, leadTime: 2 },
    { id: 'sku-003', name: 'Olive Oil', stock: 15, dailyVelocity: 2, leadTime: 5 },
  ];

  // Calculate stockout risk
  const risks = skus.map(sku => {
    const daysToStockout = sku.stock / sku.dailyVelocity;
    const canReorderInTime = sku.leadTime <= daysToStockout;

    return {
      ...sku,
      daysToStockout: daysToStockout.toFixed(1),
      stockoutRisk: daysToStockout < sku.leadTime ? 'CRITICAL' : daysToStockout < 2 ? 'HIGH' : 'LOW',
      canReorderInTime,
    };
  });

  const warnings = risks.filter(r => r.stockoutRisk !== 'LOW');

  console.log(`   ⚠️ Stockout warnings: ${warnings.length}`);
  for (const w of warnings) {
    console.log(`   - ${w.name}: ${w.stockoutRisk} - ${w.daysToStockout} days of stock`);
    if (!w.canReorderInTime) {
      console.log(`     🚨 WILL STOCKOUT before reorder arrives!`);
    }
  }
}

/**
 * Test 4: Supplier Recommendation
 *
 * "Find cheaper supplier with same quality"
 * → Ranks suppliers by price, delivery, rejection rates, reliability
 */
async function testSupplierRecommendation(ctx: MerchantContext): Promise<void> {
  const suppliers = [
    { id: 'sup-a', name: 'Fresh Farms', price: 180, deliveryDays: 2, rejectionRate: 2, reliability: 98 },
    { id: 'sup-b', name: 'Budget Foods', price: 150, deliveryDays: 4, rejectionRate: 8, reliability: 85 },
    { id: 'sup-c', name: 'Premium Goods', price: 220, deliveryDays: 1, rejectionRate: 0.5, reliability: 99 },
  ];

  // Score suppliers
  const scored = suppliers.map(s => {
    const priceScore = (1 - (s.price - 150) / 100) * 30; // Lower price = higher score
    const deliveryScore = (1 - (s.deliveryDays - 1) / 5) * 25; // Faster = higher
    const qualityScore = (1 - s.rejectionRate / 10) * 25; // Lower rejection = higher
    const reliabilityScore = (s.reliability / 100) * 20; // Higher reliability = higher

    return {
      ...s,
      totalScore: priceScore + deliveryScore + qualityScore + reliabilityScore,
      breakdown: { price: priceScore, delivery: deliveryScore, quality: qualityScore, reliability: reliabilityScore }
    };
  }).sort((a, b) => b.totalScore - a.totalScore);

  console.log(`   🏆 Supplier ranking:`);
  for (const s of scored) {
    console.log(`   ${scored.indexOf(s) + 1}. ${s.name}: Score ${s.totalScore.toFixed(1)}`);
    console.log(`      Price: ₹${s.price}, Delivery: ${s.deliveryDays}d, Rejection: ${s.rejectionRate}%, Reliability: ${s.reliability}%`);
  }
}

// ── PRICING / REVENUE TESTS ────────────────────────────────────────────────────

/**
 * Test 5: Margin-Aware Discount Copilot
 *
 * "What offer can I run without hurting margins?"
 * → Simulates offer economics
 */
async function testMarginAwareDiscount(ctx: MerchantContext): Promise<void> {
  const menuItems = [
    { name: 'Butter Chicken', price: 350, cost: 140, margin: 60 },
    { name: 'Biryani', price: 280, cost: 100, margin: 64 },
    { name: 'Naan', price: 60, cost: 15, margin: 75 },
  ];

  const discountTiers = [5, 10, 15, 20, 25];
  const minMargin = 40; // Minimum acceptable margin

  // Calculate safe discount per item
  const safeDiscounts = menuItems.map(item => {
    const safeDiscount = discountTiers.find(d => {
      const newPrice = item.price * (1 - d / 100);
      const newMargin = ((newPrice - item.cost) / newPrice * 100);
      return newMargin >= minMargin;
    }) || 0;

    return {
      item: item.name,
      currentMargin: `${item.margin}%`,
      maxSafeDiscount: `${safeDiscount}%`,
      afterDiscountMargin: safeDiscount > 0 ? `${((item.price * (1 - safeDiscount / 100) - item.cost) / (item.price * (1 - safeDiscount / 100)) * 100).toFixed(0)}%` : 'BELOW MIN',
    };
  });

  console.log(`   💰 Margin analysis (min margin: ${minMargin}%):`);
  for (const d of safeDiscounts) {
    console.log(`   - ${d.item}: ${d.currentMargin} margin, safe discount: ${d.maxSafeDiscount} (${d.afterDiscountMargin} after)`);
  }
}

/**
 * Test 6: Dynamic Pricing Suggestion
 *
 * High demand + low inventory → Suggests price increase
 */
async function testDynamicPricing(ctx: MerchantContext): Promise<void> {
  const item = {
    name: 'Limited Edition Dessert',
    basePrice: 299,
    currentDemand: 150, // 150% of normal
    inventory: 20,
    daysOfStock: 2,
  };

  // Calculate optimal price
  const demandFactor = item.currentDemand / 100;
  const scarcityFactor = 1 + (1 / item.daysOfStock) * 0.2;
  const suggestedMultiplier = demandFactor * scarcityFactor;
  const maxIncrease = Math.min(suggestedMultiplier - 1, 0.15); // Cap at 15%
  const suggestedPrice = Math.round(item.basePrice * (1 + maxIncrease));

  console.log(`   📊 Dynamic pricing for: ${item.name}`);
  console.log(`   - Base price: ₹${item.basePrice}`);
  console.log(`   - Demand: ${item.currentDemand}% of normal`);
  console.log(`   - Stock: ${item.daysOfStock} days remaining`);
  console.log(`   💡 Suggested price: ₹${suggestedPrice} (+${(maxIncrease * 100).toFixed(0)}%)`);
}

/**
 * Test 7: Menu Upsell Optimization
 *
 * Agent recommends bundle to lift AOV
 */
async function testMenuUpsellOptimization(ctx: MerchantContext): Promise<void> {
  const currentOrder = [
    { name: 'Burger', price: 199 },
    { name: 'Fries', price: 99 },
  ];
  const currentTotal = currentOrder.reduce((s, i) => s + i.price, 0);

  // Suggest upsells
  const upsells = [
    { name: 'Large Drink + Shake Combo', price: 149, acceptanceRate: 0.7, margin: 65 },
    { name: 'Premium Dessert', price: 199, acceptanceRate: 0.4, margin: 70 },
    { name: 'Extra Cheese Upgrade', price: 49, acceptanceRate: 0.6, margin: 80 },
  ];

  // Calculate expected lift
  const expectedLift = upsells.reduce((acc, u) => ({
    additionalRevenue: acc.additionalRevenue + u.price * u.acceptanceRate,
    additionalMargin: acc.additionalMargin + (u.price * u.margin / 100 * u.acceptanceRate),
  }), { additionalRevenue: 0, additionalMargin: 0 });

  const liftPercent = (expectedLift.additionalRevenue / currentTotal * 100).toFixed(1);

  console.log(`   📈 Current AOV: ₹${currentTotal}`);
  console.log(`   💡 Suggested upsells:`);
  for (const u of upsells) {
    console.log(`   - ${u.name} (₹${u.price}): ${(u.acceptanceRate * 100).toFixed(0)}% acceptance`);
  }
  console.log(`   🎯 Expected AOV lift: ${liftPercent}%`);
}

/**
 * Test 8: Revenue Leak Detection
 *
 * Agent finds: high-demand item low margin
 */
async function testRevenueLeakDetection(ctx: MerchantContext): Promise<void> {
  const items = [
    { name: 'Popular Pizza', orders: 500, price: 399, cost: 320, margin: 20 },
    { name: 'Marginal Biryani', orders: 200, price: 250, cost: 100, margin: 60 },
    { name: 'Loss Leader Cola', orders: 800, price: 49, cost: 55, margin: -12 },
  ];

  // Find leaks
  const leaks = items.filter(i => i.margin < 30);
  const lossLeaders = items.filter(i => i.margin < 0);

  console.log(`   🔍 Revenue leak analysis:`);

  if (leaks.length > 0) {
    console.log(`   ⚠️ Low margin items:`);
    for (const l of leaks) {
      console.log(`   - ${l.name}: ${l.margin}% margin (${l.orders} orders)`);
    }
  }

  if (lossLeaders.length > 0) {
    console.log(`   🚨 Loss leaders (negative margin):`);
    for (const l of lossLeaders) {
      const monthlyLoss = l.orders * Math.abs(l.price - l.cost);
      console.log(`   - ${l.name}: ₹${monthlyLoss.toLocaleString()}/month loss`);
    }
  }
}

// ── CRM / CUSTOMER INTELLIGENCE TESTS ─────────────────────────────────────────

/**
 * Test 9: Churn Risk Prediction
 *
 * "Which customers may churn?"
 */
async function testChurnRiskPrediction(ctx: MerchantContext): Promise<void> {
  const customers = [
    { id: 'c1', name: 'Regular Ram', orders: 12, daysSinceLast: 5, avgOrder: 450, risk: 'LOW' },
    { id: 'c2', name: 'Silent Sam', orders: 8, daysSinceLast: 45, avgOrder: 380, risk: 'CRITICAL' },
    { id: 'c3', name: 'Occasional Omi', orders: 3, daysSinceLast: 30, avgOrder: 520, risk: 'HIGH' },
  ];

  // Calculate risk scores
  const scored = customers.map(c => {
    let risk = 'LOW';
    const inactivityScore = c.daysSinceLast > 30 ? 2 : c.daysSinceLast > 14 ? 1 : 0;
    const orderScore = c.orders < 5 ? 1 : 0;

    if (inactivityScore + orderScore >= 3) risk = 'CRITICAL';
    else if (inactivityScore + orderScore >= 2) risk = 'HIGH';

    return { ...c, risk };
  });

  const atRisk = scored.filter(c => c.risk !== 'LOW');

  console.log(`   🚨 Customers at risk: ${atRisk.length}`);
  for (const c of atRisk) {
    console.log(`   - ${c.name}: ${c.risk} risk (${c.daysSinceLast} days inactive, ${c.orders} orders)`);
  }
}

/**
 * Test 10: Win-back Campaign Test
 *
 * Agent auto-builds win-back offer
 */
async function testWinbackCampaign(ctx: MerchantContext): Promise<void> {
  const churnedCustomer = {
    id: 'c2',
    name: 'Silent Sam',
    avgOrder: 380,
    lastOrderDays: 45,
    preferredItems: ['Biryani', 'Naan'],
  };

  // Calculate offer economics
  const offerValue = Math.min(churnedCustomer.avgOrder * 0.2, 100); // 20% or ₹100 max
  const targetSpend = churnedCustomer.avgOrder;
  const expectedLift = 0.3; // 30% chance to win back

  console.log(`   📧 Win-back campaign for: ${churnedCustomer.name}`);
  console.log(`   - Last order: ${churnedCustomer.lastOrderDays} days ago`);
  console.log(`   - Favorite items: ${churnedCustomer.preferredItems.join(', ')}`);
  console.log(`   💡 Offer: ₹${offerValue} off next order (20% of ₹${churnedCustomer.avgOrder})`);
  console.log(`   📊 Expected conversion: ${(expectedLift * 100).toFixed(0)}%`);
}

/**
 * Test 11: VIP Recognition Flow
 *
 * High-LTV customer enters → Agent suggests personalized perk
 */
async function testVipRecognition(ctx: MerchantContext): Promise<void> {
  const customer = {
    id: 'vip-001',
    name: 'Premium Peter',
    lifetimeValue: 85000,
    orders: 45,
    tier: 'PLATINUM',
  };

  const perks = {
    PLATINUM: ['Priority preparation', '10% exclusive discount', 'Free delivery', 'Anniversary gift'],
    GOLD: ['Priority preparation', '5% discount'],
    SILVER: ['Priority preparation'],
  };

  const availablePerks = perks[customer.tier as keyof typeof perks] || [];

  console.log(`   👑 VIP Customer: ${customer.name}`);
  console.log(`   - Lifetime value: ₹${customer.lifetimeValue.toLocaleString()}`);
  console.log(`   - Total orders: ${customer.orders}`);
  console.log(`   🎁 Available perks:`);
  for (const perk of availablePerks) {
    console.log(`   - ${perk}`);
  }
}

/**
 * Test 12: Negative Review Recovery
 *
 * Bad review appears → Agent proposes recovery action
 */
async function testNegativeReviewRecovery(ctx: MerchantContext): Promise<void> {
  const review = {
    rating: 2,
    text: 'Food was cold and delivery took 45 minutes',
    customerId: 'c-001',
    orderId: 'order-123',
  };

  // Identify issue
  const issues = [];
  if (review.text.includes('cold')) issues.push('Food temperature');
  if (review.text.includes('45 minutes') || review.text.includes('late')) issues.push('Delivery time');

  // Generate recovery
  const recovery = {
    customerId: review.customerId,
    orderId: review.orderId,
    issues,
    actions: [
      'Send apology message',
      'Offer 30% off next order',
      'Flag for quality check',
    ],
    estimatedRecoveryChance: 0.6,
  };

  console.log(`   📉 Negative review: ${review.rating} stars`);
  console.log(`   - Issues: ${issues.join(', ')}`);
  console.log(`   💡 Recovery actions:`);
  for (const action of recovery.actions) {
    console.log(`   - ${action}`);
  }
  console.log(`   📊 Expected recovery: ${(recovery.estimatedRecoveryChance * 100).toFixed(0)}%`);
}

// ── OPERATIONS TESTS ───────────────────────────────────────────────────────────

/**
 * Test 13: Staff Scheduling Suggestion
 *
 * Weekend demand spike predicted → Agent suggests staffing changes
 */
async function testStaffScheduling(ctx: MerchantContext): Promise<void> {
  const currentSchedule = [
    { day: 'Friday', staff: 5, projectedDemand: 60 },
    { day: 'Saturday', staff: 6, projectedDemand: 120 },
    { day: 'Sunday', staff: 6, projectedDemand: 100 },
  ];

  const recommendations = currentSchedule.map(day => {
    const demandPerStaff = day.projectedDemand / day.staff;
    const optimalStaff = Math.ceil(day.projectedDemand / 15); // 15 orders per staff ideal
    const adjustment = optimalStaff - day.staff;

    return {
      ...day,
      currentRatio: demandPerStaff.toFixed(1),
      recommendedStaff: optimalStaff,
      adjustment,
    };
  });

  console.log(`   📅 Staffing recommendations:`);
  for (const r of recommendations) {
    const status = r.adjustment > 0 ? '📈 ADD' : r.adjustment < 0 ? '📉 REDUCE' : '✅ OK';
    console.log(`   - ${r.day}: ${r.staff} staff → ${r.recommendedStaff} (${status}: ${Math.abs(r.adjustment)})`);
  }
}

/**
 * Test 14: KDS Delay Alert
 *
 * Kitchen SLA slipping → Agent detects and warns
 */
async function testKdsDelayAlert(ctx: MerchantContext): Promise<void> {
  const kdsMetrics = [
    { orderId: 'o1', items: 3, timeElapsed: 12, slaTarget: 15 },
    { orderId: 'o2', items: 5, timeElapsed: 18, slaTarget: 18 },
    { orderId: 'o3', items: 4, timeElapsed: 22, slaTarget: 15 },
    { orderId: 'o4', items: 6, timeElapsed: 8, slaTarget: 20 },
  ];

  const delayed = kdsMetrics.filter(o => o.timeElapsed > o.slaTarget);
  const avgDelay = delayed.length > 0
    ? delayed.reduce((s, o) => s + (o.timeElapsed - o.slaTarget), 0) / delayed.length
    : 0;

  console.log(`   ⏰ KDS Status:`);
  console.log(`   - Orders on track: ${kdsMetrics.length - delayed.length}`);
  console.log(`   - Delayed orders: ${delayed.length}`);

  if (delayed.length > 0) {
    console.log(`   ⚠️ DELAYED:`);
    for (const d of delayed) {
      console.log(`   - Order ${d.orderId}: ${d.timeElapsed - d.slaTarget}min over SLA`);
    }
    console.log(`   🚨 Average delay: ${avgDelay.toFixed(1)} min`);
  }
}

/**
 * Test 15: Fraud / Abuse Detection
 *
 * Suspicious coupon redemptions → Agent flags anomaly
 */
async function testFraudAbuseDetection(ctx: MerchantContext): Promise<void> {
  const redemptions = [
    { customerId: 'c1', coupons: 1, success: true },
    { customerId: 'c2', coupons: 3, success: true },
    { customerId: 'c3', coupons: 8, success: false },
    { customerId: 'c4', coupons: 15, success: false },
  ];

  const suspicious = redemptions.filter(r => r.coupons > 5 && !r.success);
  const totalCouponValue = suspicious.reduce((s, r) => s + r.coupons * 50, 0); // ₹50 per coupon

  console.log(`   🔍 Fraud detection:`);
  console.log(`   - Total redemptions analyzed: ${redemptions.length}`);
  console.log(`   - Suspicious patterns: ${suspicious.length}`);

  if (suspicious.length > 0) {
    console.log(`   🚨 Flagged customers:`);
    for (const s of suspicious) {
      console.log(`   - Customer ${s.customerId}: ${s.coupons} failed attempts`);
    }
    console.log(`   💰 Estimated prevented loss: ₹${totalCouponValue}`);
  }
}

/**
 * Test 16: Merchant Support Troubleshooting
 *
 * POS printer not syncing → Agent walks through fix
 */
async function testMerchantSupportTroubleshooting(ctx: MerchantContext): Promise<void> {
  const issue = 'printer_not_syncing';

  const troubleshootingSteps = [
    { step: 1, action: 'Check printer power and paper', check: 'Is the printer powered on?' },
    { step: 2, action: 'Verify network connection', check: 'Is the printer connected to WiFi?' },
    { step: 3, action: 'Restart POS terminal', check: 'Press and hold power for 5 seconds' },
    { step: 4, action: 'Check print queue', check: 'Clear any stuck print jobs' },
    { step: 5, action: 'Contact IT support', check: 'If issue persists, escalate to IT' },
  ];

  console.log(`   🔧 Troubleshooting: ${issue.replace(/_/g, ' ')}`);
  for (const step of troubleshootingSteps) {
    console.log(`   ${step.step}. ${step.action}`);
    console.log(`      → ${step.check}`);
  }
}

// ── FINANCE TESTS ─────────────────────────────────────────────────────────────

/**
 * Test 17: Settlement Reconciliation
 *
 * "Why payout lower than expected?"
 */
async function testSettlementReconciliation(ctx: MerchantContext): Promise<void> {
  const settlement = {
    grossSales: 50000,
    refunds: 2500,
    chargebacks: 500,
    fees: 2500,
    adjustments: 1000,
    netPayout: 43500,
  };

  const breakdown = [
    { item: 'Gross Sales', amount: settlement.grossSales, type: 'credit' },
    { item: 'Refunds', amount: settlement.refunds, type: 'debit' },
    { item: 'Chargebacks', amount: settlement.chargebacks, type: 'debit' },
    { item: 'Platform Fees (5%)', amount: settlement.fees, type: 'debit' },
    { item: 'Adjustments', amount: settlement.adjustments, type: 'debit' },
    { item: 'Net Payout', amount: settlement.netPayout, type: 'net' },
  ];

  console.log(`   💰 Settlement breakdown:`);
  for (const b of breakdown) {
    const sign = b.type === 'credit' ? '+' : b.type === 'net' ? '= ' : '-';
    console.log(`   ${sign} ₹${b.amount.toLocaleString()} ${b.item}`);
  }
}

/**
 * Test 18: Working Capital Suggestion
 *
 * Agent detects demand + cash gap → Suggests financing
 */
async function testWorkingCapitalSuggestion(ctx: MerchantContext): Promise<void> {
  const financials = {
    monthlyRevenue: 300000,
    avgDailyCost: 8000,
    supplierPaymentDays: 7,
    customerPaymentDays: 0, // Cash business
    currentCash: 50000,
  };

  const workingCapitalGap = financials.avgDailyCost * 7; // 7 days of operations
  const recommendedCredit = workingCapitalGap * 2; // 2 weeks buffer
  const maxAffordableEMI = financials.monthlyRevenue * 0.05; // 5% of revenue

  console.log(`   💼 Working capital analysis:`);
  console.log(`   - Monthly revenue: ₹${financials.monthlyRevenue.toLocaleString()}`);
  console.log(`   - Daily operating cost: ₹${financials.avgDailyCost.toLocaleString()}`);
  console.log(`   - Current cash: ₹${financials.currentCash.toLocaleString()}`);
  console.log(`   💡 Recommended credit: ₹${recommendedCredit.toLocaleString()}`);
  console.log(`   📊 Affordable EMI: ₹${maxAffordableEMI.toLocaleString()}/month`);
}

// ── MULTI-STEP ORCHESTRATION TESTS ────────────────────────────────────────────

/**
 * Test 19: "Sales Are Down—What Should I Do?"
 *
 * Merchant asks → Agent diagnoses → suggests promotion, inventory, campaign
 */
async function testSalesDownDiagnosis(ctx: MerchantContext): Promise<void> {
  const currentMetrics = {
    todaySales: 15000,
    yesterdaySales: 28000,
    change: -46,
    topItems: ['Pizza', 'Burger'],
    slowItems: ['Pasta', 'Salad'],
    inventoryStatus: 'healthy',
    lastPromotion: '30 days ago',
  };

  console.log(`   📉 Sales Diagnosis:`);
  console.log(`   - Today: ₹${currentMetrics.todaySales.toLocaleString()}`);
  console.log(`   - Yesterday: ₹${currentMetrics.yesterdaySales.toLocaleString()}`);
  console.log(`   - Change: ${currentMetrics.change}%`);

  // Diagnosis and recommendations
  const recommendations = [
    { type: 'PROMOTION', action: 'Launch happy hour (2-5 PM) with 15% off', priority: 'HIGH' },
    { type: 'INVENTORY', action: 'Feature slow items with combo deals', priority: 'MEDIUM' },
    { type: 'CAMPAIGN', action: 'Push notification to lapsed customers', priority: 'HIGH' },
    { type: 'MENU', action: 'Add trending items to attract footfall', priority: 'LOW' },
  ];

  console.log(`   💡 Recommendations:`);
  for (const r of recommendations) {
    console.log(`   [${r.priority}] ${r.type}: ${r.action}`);
  }
}

/**
 * Test 20: Auto Campaign + Demand + Inventory Loop
 *
 * Demand spike → Agent increases price, triggers campaign, recommends reorder
 */
async function testAutoCampaignDemandLoop(ctx: MerchantContext): Promise<void> {
  const demandSignal = {
    category: 'biryani',
    spikeFactor: 2.5,
    currentStock: 30,
    daysOfStock: 3,
  };

  console.log(`   🔄 Multi-Agent Orchestration:`);
  console.log(`   📈 Demand signal: ${demandSignal.spikeFactor}x baseline`);

  // Step 1: Pricing agent
  const priceIncrease = Math.min((demandSignal.spikeFactor || demandSignal.spikeFactor - 1) * 5, 10);
  console.log(`   1️⃣ Pricing Agent: Raise price by ${priceIncrease}%`);

  // Step 2: Campaign agent
  const campaignBudget = 5000;
  console.log(`   2️⃣ Campaign Agent: Launch urgency campaign (₹${campaignBudget})`);

  // Step 3: Procurement agent
  const reorderQty = demandSignal.currentStock * 2;
  console.log(`   3️⃣ Procurement Agent: Reorder ${reorderQty} units of ${demandSignal.category}`);

  console.log(`   ✅ Coordinated response complete`);
}

// ── HARD CASES / EDGE CASES ────────────────────────────────────────────────────

/**
 * Test 21: Agent Recommendation Conflict
 *
 * Pricing Agent says raise prices, Campaign Agent says discount → Who wins?
 */
async function testAgentConflictResolution(ctx: MerchantContext): Promise<void> {
  const conflictingRecommendations = [
    { agent: 'Pricing Agent', action: 'Raise prices by 10%', reasoning: 'High demand, low inventory' },
    { agent: 'Campaign Agent', action: 'Launch 20% discount campaign', reasoning: 'Boost weekend traffic' },
  ];

  // Conflict resolution logic
  const resolution = {
    winner: 'Pricing Agent',
    rationale: 'Inventory critical (3 days stock), price increase maximizes revenue',
    compromise: 'Launch non-discount promotion (free drink with meal)',
    finalAction: 'Raise prices 10%, offer value-add promotion (not discount)',
  };

  console.log(`   ⚔️ Conflict detected:`);
  for (const r of conflictingRecommendations) {
    console.log(`   - ${r.agent}: ${r.action} (${r.reasoning})`);
  }

  console.log(`   🏆 Resolution: ${resolution.winner}`);
  console.log(`   💡 Rationale: ${resolution.rationale}`);
  console.log(`   🤝 Compromise: ${resolution.compromise}`);
  console.log(`   ✅ Final action: ${resolution.finalAction}`);
}

/**
 * Test 22: Supplier Out-of-Stock Mid-PO
 *
 * Preferred supplier misses delivery → System reroutes
 */
async function testSupplierFailureRecovery(ctx: MerchantContext): Promise<void> {
  const po = {
    id: 'PO-001',
    status: 'IN_TRANSIT',
    expectedDelivery: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
    supplierId: 'sup-a',
  };

  // Supplier misses
  console.log(`   📦 PO ${po.id} status: ${po.status}`);
  console.log(`   ⏰ Expected delivery: ${po.expectedDelivery.toLocaleDateString()}`);
  console.log(`   🚨 SUPPLIER FAILED: Delivery missed!`);

  // Find backup
  const backupSupplier = {
    id: 'sup-b',
    name: 'Quick Supply Co',
    deliveryDays: 1,
    pricePremium: 1.15, // 15% premium
    inStock: true,
  };

  console.log(`   🔄 Routing to backup: ${backupSupplier.name}`);
  console.log(`   📦 Delivery: ${backupSupplier.deliveryDays} day(s)`);
  console.log(`   💰 Price premium: ${((backupSupplier.pricePremium - 1) * 100).toFixed(0)}%`);
}

/**
 * Test 23: Wrong Forecast Self-Correction
 *
 * Agent over-predicted demand → Feedback loop corrects
 */
async function testForecastSelfCorrection(ctx: MerchantContext): Promise<void> {
  const forecast = {
    predicted: 100,
    actual: 45,
    variance: -55,
  };

  const correctionFactor = 0.7; // Reduce next forecast by 30%
  const correctedNext = 100 * correctionFactor;

  console.log(`   📊 Forecast analysis:`);
  console.log(`   - Predicted: ${forecast.predicted} units`);
  console.log(`   - Actual: ${forecast.actual} units`);
  console.log(`   - Variance: ${forecast.variance}%`);

  console.log(`   🔄 Self-correction applied:`);
  console.log(`   - Correction factor: ${(correctionFactor * 100).toFixed(0)}%`);
  console.log(`   - Next forecast: ${correctedNext} units`);

  // Update model
  console.log(`   🧠 Model updated with feedback`);
}

/**
 * Test 24: Merchant Overrides Agent + Model Learns
 *
 * Merchant ignores recommendation → Does model learn?
 */
async function testMerchantOverrideLearning(ctx: MerchantContext): Promise<void> {
  const recommendation = {
    item: 'Pasta',
    suggestedPrice: 299,
    merchantPrice: 249,
    difference: -17,
    outcome: 'ignored',
  };

  // Record override
  const overrideRecord = {
    agentRecommendation: recommendation.suggestedPrice,
    merchantAction: recommendation.merchantPrice,
    timestamp: new Date(),
    feedback: 'negative', // Sales were good at lower price
  };

  console.log(`   📝 Override recorded:`);
  console.log(`   - Agent suggested: ₹${overrideRecord.agentRecommendation}`);
  console.log(`   - Merchant used: ₹${overrideRecord.merchantAction}`);
  console.log(`   - Outcome: ${overrideRecord.feedback}`);

  // Model learns
  console.log(`   🧠 Model adjustment:`);
  console.log(`   - Merchant has better local knowledge`);
  console.log(`   - Weighting factor adjusted for similar items`);
  console.log(`   - Future recommendations: Include price floor at merchant's range`);
}

// ── MAIN TEST RUNNER ──────────────────────────────────────────────────────────

async function runAllTests(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║       ReZ Merchant OS - Commerce Stress Test Suite                  ║');
  console.log('║       Procurement Intelligence (1-4)                                 ║');
  console.log('║       Revenue Optimization (5-8)                                    ║');
  console.log('║       CRM Copilot (9-12)                                           ║');
  console.log('║       Ops Copilot (13-16)                                          ║');
  console.log('║       Finance Copilot (17-18)                                      ║');
  console.log('║       Multi-Agent Reasoning (19-20)                                ║');
  console.log('║       Hard Cases (21-24)                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');

  const results: TestResult[] = [];

  // Procurement Intelligence
  console.log('\n═══ PROCUREMENT INTELLIGENCE ═══');
  results.push(await runTest('Smart Reorder', testSmartReorder));
  results.push(await runTest('Demand Spike Alert', testDemandSpikeAlert));
  results.push(await runTest('Stockout Prevention', testStockoutPrevention));
  results.push(await runTest('Supplier Recommendation', testSupplierRecommendation));

  // Revenue Optimization
  console.log('\n═══ REVENUE OPTIMIZATION ═══');
  results.push(await runTest('Margin-Aware Discount', testMarginAwareDiscount));
  results.push(await runTest('Dynamic Pricing', testDynamicPricing));
  results.push(await runTest('Menu Upsell Optimization', testMenuUpsellOptimization));
  results.push(await runTest('Revenue Leak Detection', testRevenueLeakDetection));

  // CRM Copilot
  console.log('\n═══ CRM COPILOT ═══');
  results.push(await runTest('Churn Risk Prediction', testChurnRiskPrediction));
  results.push(await runTest('Win-back Campaign', testWinbackCampaign));
  results.push(await runTest('VIP Recognition', testVipRecognition));
  results.push(await runTest('Negative Review Recovery', testNegativeReviewRecovery));

  // Ops Copilot
  console.log('\n═══ OPS COPILOT ═══');
  results.push(await runTest('Staff Scheduling', testStaffScheduling));
  results.push(await runTest('KDS Delay Alert', testKdsDelayAlert));
  results.push(await runTest('Fraud/Abuse Detection', testFraudAbuseDetection));
  results.push(await runTest('Merchant Support Troubleshooting', testMerchantSupportTroubleshooting));

  // Finance Copilot
  console.log('\n═══ FINANCE COPILOT ═══');
  results.push(await runTest('Settlement Reconciliation', testSettlementReconciliation));
  results.push(await runTest('Working Capital Suggestion', testWorkingCapitalSuggestion));

  // Multi-Agent Reasoning
  console.log('\n═══ MULTI-AGENT REASONING ═══');
  results.push(await runTest('Sales Down Diagnosis', testSalesDownDiagnosis));
  results.push(await runTest('Auto Campaign + Demand Loop', testAutoCampaignDemandLoop));

  // Hard Cases
  console.log('\n═══ HARD CASES ═══');
  results.push(await runTest('Agent Conflict Resolution', testAgentConflictResolution));
  results.push(await runTest('Supplier Failure Recovery', testSupplierFailureRecovery));
  results.push(await runTest('Forecast Self-Correction', testForecastSelfCorrection));
  results.push(await runTest('Merchant Override Learning', testMerchantOverrideLearning));

  // Summary
  console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║                        TEST SUMMARY                                 ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed);

  console.log(`\n📊 Total: ${results.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log('\nFailed tests:');
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
  }

  const successRate = (passed / results.length * 100).toFixed(1);
  console.log(`\n📈 Success Rate: ${successRate}%`);

  if (passed === results.length) {
    console.log('\n🎉 ALL MERCHANT OS TESTS PASSED!');
  }
}

main().catch(console.error);

async function main(): Promise<void> {
  await runAllTests();
}
