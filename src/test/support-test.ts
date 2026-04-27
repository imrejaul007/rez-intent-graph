/**
 * Support Agent Test Suite
 * Tests support scenarios across all 9 apps
 */

import { handleSupportRequest, type SupportCategory } from '../agents/support-agent.js';

async function runSupportTest(
  name: string,
  category: SupportCategory,
  message: string,
  userId: string = 'test-user-001'
): Promise<void> {
  console.log(`\n🧪 Testing: ${name}`);
  console.log(`   Category: ${category}`);
  console.log(`   Message: "${message}"`);

  try {
    const response = await handleSupportRequest({
      category,
      userId,
      message,
      priority: 'medium',
    });

    console.log(`   ✅ Response: ${response.message}`);

    if (response.actions && response.actions.length > 0) {
      console.log(`   📋 Actions:`);
      for (const action of response.actions) {
        console.log(`      - ${action.type}: ${JSON.stringify(action.payload)}`);
      }
    }

    if (response.escalation) {
      console.log(`   🚨 Escalation: ${response.escalation.reason}`);
      console.log(`      Department: ${response.escalation.department}`);
      console.log(`      Priority: ${response.escalation.priority}`);
    }
  } catch (error) {
    console.error(`   ❌ Error:`, error);
  }
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Support Agent - Scenario Test Suite');
  console.log('  Testing 9 Apps × 5 Scenarios Each');
  console.log('═══════════════════════════════════════════════════════════════');

  // ── Hotel OTA Support ──────────────────────────────────────────────
  console.log('\n🏨 HOTEL OTA SUPPORT');
  await runSupportTest('Late Check-in', 'hotel_ota', 'My flight is delayed, I will arrive at 2 AM');
  await runSupportTest('Refund Guidance', 'hotel_ota', 'I need to cancel, what refund do I get?');
  await runSupportTest('Room Complaint', 'hotel_ota', 'AC not cooling properly');
  await runSupportTest('Booking Confusion', 'hotel_ota', 'I booked two rooms, did breakfast include for both?');
  await runSupportTest('Local Concierge', 'hotel_ota', 'What is a good pharmacy near hotel?');

  // ── Room QR Support ────────────────────────────────────────────────
  console.log('\n🏠 ROOM QR SUPPORT');
  await runSupportTest('WiFi Troubleshooting', 'room_qr', 'How do I connect to WiFi?');
  await runSupportTest('Housekeeping Follow-up', 'room_qr', 'I requested towels an hour ago and still waiting');
  await runSupportTest('Billing Question', 'room_qr', 'Why was minibar charged to my room?');
  await runSupportTest('Amenity Guidance', 'room_qr', 'Is spa included in my package?');
  await runSupportTest('Emergency Assistance', 'room_qr', 'I need a doctor right now');

  // ── ReZ Consumer Support ────────────────────────────────────────────
  console.log('\n🛒 REZ CONSUMER SUPPORT');
  await runSupportTest('Cashback Missing', 'rez_consumer', 'My cashback did not show up');
  await runSupportTest('Coins Expiry', 'rez_consumer', 'When do my coins expire?');
  await runSupportTest('Order Tracking', 'rez_consumer', 'My delivery is late');
  await runSupportTest('App Guidance', 'rez_consumer', 'How do I use Promo Coins?');
  await runSupportTest('Fraud Report', 'rez_consumer', 'I did not make this transaction');

  // ── Web Menu Support ───────────────────────────────────────────────
  console.log('\n🍽️ WEB MENU SUPPORT');
  await runSupportTest('Dietary Guidance', 'web_menu', 'Does this contain gluten?');
  await runSupportTest('Order Modification', 'web_menu', 'Can I remove onions from my order?');
  await runSupportTest('Wrong Order', 'web_menu', 'I got the wrong dish');
  await runSupportTest('Wait Time', 'web_menu', 'How long is the table wait?');
  await runSupportTest('Bill Split', 'web_menu', 'How do we split this bill?');

  // ── Merchant OS Support ─────────────────────────────────────────────
  console.log('\n🏪 MERCHANT OS SUPPORT');
  await runSupportTest('POS Help', 'merchant_os', 'Printer is not syncing');
  await runSupportTest('Settlement Question', 'merchant_os', 'When will my payout arrive?');
  await runSupportTest('Campaign Guidance', 'merchant_os', 'How do I create a cashback offer?');
  await runSupportTest('Inventory Error', 'merchant_os', 'Stock is not updating correctly');
  await runSupportTest('Complaint Guidance', 'merchant_os', 'How should I handle a negative review?');

  // ── Karma Support ──────────────────────────────────────────────────
  console.log('\n⭐ KARMA SUPPORT');
  await runSupportTest('Points Missing', 'karma', 'My challenge points did not credit');
  await runSupportTest('Tier Benefits', 'karma', 'What does Gold tier include?');
  await runSupportTest('Challenge Help', 'karma', 'How do I finish this mission?');
  await runSupportTest('Redemption Issue', 'karma', 'My reward code failed');
  await runSupportTest('Anti-abuse Review', 'karma', 'Why was my reward blocked?');

  // ── Rendez Support ────────────────────────────────────────────────
  console.log('\n💕 RENDEZ SUPPORT');
  await runSupportTest('Safety Report', 'rendez', 'I want to report a user');
  await runSupportTest('Booking Help', 'rendez', 'Our date reservation is not showing');
  await runSupportTest('Profile Guidance', 'rendez', 'How do I improve my matches?');
  await runSupportTest('Gift Delivery', 'rendez', 'The gift did not arrive');
  await runSupportTest('Date Cancellation', 'rendez', 'I need to cancel tonight');

  // ── AdBazaar Support ───────────────────────────────────────────────
  console.log('\n📊 ADBAZAAR SUPPORT');
  await runSupportTest('Campaign Underperforming', 'adbazaar', 'Why are my impressions so low?');
  await runSupportTest('Ad Rejection', 'adbazaar', 'Why was my ad rejected?');
  await runSupportTest('Budget Overspend', 'adbazaar', 'Did my campaign exceed my cap?');
  await runSupportTest('Audience Setup', 'adbazaar', 'How do I target students?');
  await runSupportTest('ROI Explanation', 'adbazaar', 'Which campaign gave me sales?');

  // ── NextaBiZ Support ──────────────────────────────────────────────
  console.log('\n💼 NEX TABIZ SUPPORT');
  await runSupportTest('Invoice Error', 'nextabiz', 'My invoice has an error');
  await runSupportTest('Workflow Setup', 'nextabiz', 'How do I setup a workflow?');
  await runSupportTest('Vendor Payment', 'nextabiz', 'What is my vendor payment status?');
  await runSupportTest('Report Interpretation', 'nextabiz', 'Help me understand this report');
  await runSupportTest('Integration Help', 'nextabiz', 'My integration is not syncing');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  All Support Scenarios Tested');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
