import assert from 'node:assert/strict';
import { leadQuerySchema, createLeadSchema } from '../src/modules/leads/lead.schema.js';
import { updateLeadStageSchema } from '../src/modules/crm/crm.schema.js';
import { dateRangeFilterSchema, exportAnalyticsQuerySchema } from '../src/modules/analytics/analytics.schema.js';
import { listOutreachQuerySchema } from '../src/modules/outreach/outreach.schema.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';

async function runContractAlignmentTests() {
  console.log('\n--- Running Frontend-Backend Contract Alignment Tests ---');

  // 1. All 16 Lead Statuses accepted in query schema
  console.log('Test 1: Lead query schema accepts all 16 canonical acquisition statuses');
  const all16Statuses = [
    'NEW',
    'DISCOVERED',
    'IMPORTED',
    'RESEARCH_PENDING',
    'RESEARCHED',
    'QUALIFICATION_PENDING',
    'QUALIFIED',
    'CALL_READY',
    'CONTACTED',
    'INTERESTED',
    'MEETING',
    'WON',
    'LOST',
    'DISQUALIFIED',
    'REPLIED',
    'OPT_OUT',
  ];

  for (const status of all16Statuses) {
    const parsed = leadQuerySchema.parse({ status });
    assert.equal(parsed.status, status, `Status ${status} should parse successfully`);
  }
  console.log('✓ All 16 statuses verified');

  // 2. Lead creation schema permits optional campaignId
  console.log('Test 2: Create lead schema permits optional campaignId');
  const withoutCampaign = createLeadSchema.parse({
    businessName: 'Apex Dental Care',
    domain: 'apexdental.com',
    phone: '+14155552671',
  });
  assert.equal(withoutCampaign.campaignId, undefined);
  assert.equal(withoutCampaign.businessName, 'Apex Dental Care');

  const withCampaign = createLeadSchema.parse({
    businessName: 'Apex Dental Care',
    campaignId: '123e4567-e89b-12d3-a456-426614174000',
  });
  assert.equal(withCampaign.campaignId, '123e4567-e89b-12d3-a456-426614174000');
  console.log('✓ Optional campaignId verified');

  // 3. CRM update stage schema accepts both { stage } and { status }
  console.log('Test 3: CRM stage schema preprocesses { stage } into { status }');
  const parsedFromStage = updateLeadStageSchema.parse({ stage: 'MEETING' });
  assert.equal(parsedFromStage.status, 'MEETING');

  const parsedFromStatus = updateLeadStageSchema.parse({ status: 'WON' });
  assert.equal(parsedFromStatus.status, 'WON');

  const parsedFromStageWithNotes = updateLeadStageSchema.parse({
    stage: 'INTERESTED',
    notes: 'Decision maker requested follow-up demo',
  });
  assert.equal(parsedFromStageWithNotes.status, 'INTERESTED');
  assert.equal(parsedFromStageWithNotes.notes, 'Decision maker requested follow-up demo');
  console.log('✓ Stage/status preprocessing verified');

  // 4. Analytics schema normalizes startDate/endDate and date strings
  console.log('Test 4: Analytics date range accepts flexible date formats and parameter aliases');
  const parsedRangeWithAliases = dateRangeFilterSchema.parse({
    startDate: '2026-01-01',
    endDate: '2026-01-31',
  });
  assert.ok(parsedRangeWithAliases.from?.startsWith('2026-01-01'));
  assert.ok(parsedRangeWithAliases.to?.startsWith('2026-01-31'));

  const parsedExportWithDateOnly = exportAnalyticsQuerySchema.parse({
    from: '2026-02-01',
    to: '2026-02-28',
    format: 'csv',
  });
  assert.ok(parsedExportWithDateOnly.from?.startsWith('2026-02-01'));
  assert.ok(parsedExportWithDateOnly.to?.startsWith('2026-02-28'));
  assert.equal(parsedExportWithDateOnly.format, 'csv');
  console.log('✓ Analytics date range normalization verified');

  // 5. Outreach query schema accepts 'CANCELLED' status
  console.log('Test 5: Outreach query schema accepts CANCELLED status filter');
  const parsedOutreachQuery = listOutreachQuerySchema.parse({
    status: 'CANCELLED',
    page: 1,
    limit: 20,
  });
  assert.equal(parsedOutreachQuery.status, 'CANCELLED');
  console.log('✓ Outreach CANCELLED filter verified');

  // 6. Settings service provider status includes Geoapify and WhatsApp
  console.log('Test 6: Provider configuration status includes Geoapify and WhatsApp');
  const settingsService = new SettingsService({} as any, {} as any, {} as any);
  const providers = await settingsService.getProviderStatus();

  const geoapify = providers.find((p) => p.provider === 'Geoapify Places API');
  assert.ok(geoapify, 'Geoapify provider should be listed');
  assert.equal(geoapify?.category, 'LEAD_SCRAPING');
  assert.ok(Array.isArray(geoapify?.features));

  const whatsapp = providers.find((p) => p.provider === 'Meta WhatsApp Cloud API');
  assert.ok(whatsapp, 'WhatsApp provider should be listed');
  assert.equal(whatsapp?.category, 'WHATSAPP');
  assert.ok(Array.isArray(whatsapp?.features));

  // Verify no sensitive keys leaked in provider status
  for (const p of providers) {
    assert.equal(typeof p.isConfigured, 'boolean');
    assert.ok(p.status === 'CONFIGURED' || p.status === 'NOT_CONFIGURED');
    assert.equal((p as any).apiKey, undefined);
    assert.equal((p as any).token, undefined);
    assert.equal((p as any).secret, undefined);
  }
  console.log('✓ Provider status configuration and security verified');

  // 7. Outreach distinct CANCELLED vs FAILED verification
  console.log('Test 7: OutreachRepository.cancel sets status CANCELLED and query distinguishes CANCELLED vs FAILED');
  const { OutreachRepository } = await import('../src/database/repository.js');
  const store = new Map<string, any>();
  const mockDbClient = {
    getPrismaClient: () => ({
      emailMessage: {
        findFirst: async ({ where }: any) => {
          return store.get(where.id) || null;
        },
        update: async ({ where, data }: any) => {
          const item = store.get(where.id);
          const updated = { ...item, ...data };
          store.set(where.id, updated);
          return updated;
        },
        findMany: async ({ where, skip, take }: any) => {
          let results = Array.from(store.values()).filter((item) => {
            if (where.status && item.status !== where.status) return false;
            return true;
          });
          if (skip !== undefined && take !== undefined) {
            results = results.slice(skip, skip + take);
          }
          return results;
        },
        count: async ({ where }: any) => {
          return Array.from(store.values()).filter((item) => {
            if (where.status && item.status !== where.status) return false;
            return true;
          }).length;
        },
      },
    }),
  } as any;

  const repo = new OutreachRepository(mockDbClient);

  // Seed one draft to be cancelled and one existing failed dispatch
  store.set('msg-to-cancel', {
    id: 'msg-to-cancel',
    status: 'DRAFT',
    isApproved: false,
    emailCampaignId: 'ec-1',
    contactId: 'c-1',
    subject: 'Draft subject',
    bodyText: 'Draft body',
    emailCampaign: { campaignId: 'camp-1', campaign: { workspaceId: 'ws-1' } },
    contact: { leadId: 'lead-1', lead: { workspaceId: 'ws-1' }, email: 'test@example.com' },
  });

  store.set('msg-failed', {
    id: 'msg-failed',
    status: 'FAILED',
    isApproved: false,
    emailCampaignId: 'ec-1',
    contactId: 'c-2',
    subject: 'Failed subject',
    bodyText: 'Failed body',
    emailCampaign: { campaignId: 'camp-1', campaign: { workspaceId: 'ws-1' } },
    contact: { leadId: 'lead-2', lead: { workspaceId: 'ws-1' }, email: 'fail@example.com' },
  });

  // Execute cancel
  const cancelledResult = await repo.cancel('msg-to-cancel', 'ws-1', 'user-1');
  assert.equal(cancelledResult.status, 'CANCELLED', 'cancel() must set status to CANCELLED');

  // Query filter: status = 'CANCELLED'
  const cancelledQuery = await repo.findManyPaginated('ws-1', { status: 'CANCELLED' });
  assert.equal(cancelledQuery.total, 1, 'Should find exactly 1 CANCELLED record');
  assert.equal(cancelledQuery.data[0].id, 'msg-to-cancel');

  // Query filter: status = 'FAILED'
  const failedQuery = await repo.findManyPaginated('ws-1', { status: 'FAILED' });
  assert.equal(failedQuery.total, 1, 'Should find exactly 1 FAILED record');
  assert.equal(failedQuery.data[0].id, 'msg-failed');

  console.log('✓ Verified CANCELLED and FAILED statuses are completely distinct');

  console.log('\n--- All Contract Alignment Tests Passed Successfully! ---');
}

runContractAlignmentTests().catch((err) => {
  console.error('Contract alignment test failed:', err);
  process.exit(1);
});
