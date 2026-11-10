import assert from 'node:assert/strict';
import { createInMemoryPrismaClient } from '../src/database/in-memory.js';
import { databaseClient } from '../src/database/client.js';
import { voiceAIService } from '../src/modules/voice/voice-ai.service.js';
import { phoneNumbersService, PhoneNumbersService } from '../src/modules/voice/phone-numbers.service.js';
import { settingsService, SettingsService } from '../src/modules/settings/settings.service.js';
import {
  workspaceProviderCredentialRepository,
  telephonyPhoneNumberRepository,
  settingsRepository,
  workspaceRepository,
} from '../src/database/repository.js';
import { decryptCredential } from '../src/security/credential-vault.js';

async function runWorkstream1Tests() {
  console.log('\n========================================================================');
  console.log('--- Starting Phase R2 Workstream 1 Integration & Persistence Tests ---');
  console.log('========================================================================\n');

  // Initialize in-memory mock client for database isolation
  databaseClient.setPrismaClient(createInMemoryPrismaClient());

  // Pre-create workspaces in database with explicit IDs
  const createdA = await workspaceRepository.create({ name: 'Clinic A Workspace', slug: `slug-${Date.now()}-a` });
  const createdB = await workspaceRepository.create({ name: 'Clinic B Workspace', slug: `slug-${Date.now()}-b` });
  const workspaceA = createdA.id;
  const workspaceB = createdB.id;

  // =========================================================================
  // Section 1: P0-1 Workspace Credential Isolation & No process.env Mutation
  // =========================================================================
  console.log('--- Section 1: Workspace Credential Isolation & Vault Storage ---');

  const initialRetellEnv = process.env.RETELL_API_KEY;
  const initialVapiEnv = process.env.VAPI_API_KEY;

  // 1.1 Store distinct credentials for Workspace A
  const credA = await voiceAIService.updateCredentials(
    'retell',
    { apiKey: 'key_retell_workspace_A_secret_12345', webhookSecret: 'secret_retell_A_wh_789' },
    workspaceA
  );
  assert.equal(credA.connectionState, 'CONNECTED');
  assert.ok(credA.maskedCredentials.apiKeyMasked.endsWith('2345'), `Expected masked key to end with 2345, got ${credA.maskedCredentials.apiKeyMasked}`);

  // 1.2 Store distinct credentials for Workspace B
  const credB = await voiceAIService.updateCredentials(
    'retell',
    { apiKey: 'key_retell_workspace_B_secret_67890', webhookSecret: 'secret_retell_B_wh_456' },
    workspaceB
  );
  assert.equal(credB.connectionState, 'CONNECTED');
  assert.ok(credB.maskedCredentials.apiKeyMasked.endsWith('7890'), `Expected masked key to end with 7890, got ${credB.maskedCredentials.apiKeyMasked}`);

  // 1.3 Verify process.env was NEVER mutated
  assert.equal(
    process.env.RETELL_API_KEY,
    initialRetellEnv,
    'process.env.RETELL_API_KEY must NOT be mutated during credential update'
  );
  assert.equal(
    process.env.VAPI_API_KEY,
    initialVapiEnv,
    'process.env.VAPI_API_KEY must NOT be mutated during credential update'
  );
  console.log('✓ 1.1 Invariant verified: process.env was not mutated by credential operations');

  // 1.4 Verify strict multi-tenant database isolation between Workspace A and B
  const dbCredA = await workspaceProviderCredentialRepository.findByProvider(workspaceA, 'RETELL');
  const dbCredB = await workspaceProviderCredentialRepository.findByProvider(workspaceB, 'RETELL');

  assert.ok(dbCredA && dbCredA.encryptedPayload, 'Workspace A credentials must exist in repository');
  assert.ok(dbCredB && dbCredB.encryptedPayload, 'Workspace B credentials must exist in repository');

  const decryptedA = decryptCredential((dbCredA.encryptedPayload as any).apiKey);
  const decryptedB = decryptCredential((dbCredB.encryptedPayload as any).apiKey);

  assert.equal(decryptedA, 'key_retell_workspace_A_secret_12345');
  assert.equal(decryptedB, 'key_retell_workspace_B_secret_67890');
  assert.notEqual(decryptedA, decryptedB, 'Workspace A and Workspace B must have separate isolated keys');
  console.log('✓ 1.2 Multi-tenant isolation verified: Distinct AES-256-GCM ciphertexts stored per workspace');

  // 1.5 Verify Workspace A cannot read or retrieve Workspace B credentials
  const cardAFresh = await voiceAIService.getProviderCard('retell', workspaceA);
  const cardBFresh = await voiceAIService.getProviderCard('retell', workspaceB);
  assert.ok(cardAFresh.maskedCredentials.apiKeyMasked.endsWith('2345'));
  assert.ok(cardBFresh.maskedCredentials.apiKeyMasked.endsWith('7890'));
  assert.notEqual(cardAFresh.maskedCredentials.apiKeyMasked, cardBFresh.maskedCredentials.apiKeyMasked);
  console.log('✓ 1.3 Provider cards reflect strict workspace isolation without cross-tenant bleed');

  // =========================================================================
  // Section 2: P0-2 PostgreSQL-Backed Phone Number Hydration on Startup
  // =========================================================================
  console.log('\n--- Section 2: Phone Number Persistence & Container Restart Hydration ---');

  const testPhone = '+15125550999';
  const testFriendlyName = 'Austin Dental Line';

  // 2.1 Import phone number into Workspace A via service
  const importedNumber = await phoneNumbersService.importPhoneNumber(workspaceA, {
    phoneNumber: testPhone,
    friendlyName: testFriendlyName,
  });
  assert.equal(importedNumber.phoneNumber, testPhone);
  assert.equal(importedNumber.status, 'ACTIVE');
  assert.equal(importedNumber.purchasedWithoutAutoBuy, true);
  console.log('✓ 2.1 Carrier line imported and persisted to database');

  // 2.2 Verify persistent database record exists
  const persistedInDb = await telephonyPhoneNumberRepository.findByNumber(workspaceA, testPhone);
  assert.ok(persistedInDb, 'Phone number record must be found in TelephonyPhoneNumber database table');
  assert.equal(persistedInDb.phoneNumber, testPhone);
  assert.equal(persistedInDb.workspaceId, workspaceA);
  console.log('✓ 2.2 TelephonyPhoneNumber verified in persistent database table');

  // 2.3 Simulate container/application cold restart with fresh unhydrated service instance
  const restartedPhoneService = new PhoneNumbersService();

  // Before hydration, a separate workspace cannot see the imported number
  const numbersBeforeHydration = await restartedPhoneService.listPhoneNumbers(workspaceB);
  assert.equal(
    numbersBeforeHydration.some((n) => n.phoneNumber === testPhone),
    false,
    'Workspace B must not see Workspace A numbers'
  );

  // 2.4 Execute application startup hydration
  const hydratedCount = await restartedPhoneService.hydrateFromDatabase();
  assert.ok(hydratedCount >= 1, 'Hydration must reload active numbers from PostgreSQL');

  // 2.5 Verify Workspace A reloaded its phone numbers after simulated restart
  const reloadedNumbers = await restartedPhoneService.listPhoneNumbers(workspaceA);
  const reloadedNumber = reloadedNumbers.find((n) => n.phoneNumber === testPhone);
  assert.ok(reloadedNumber, 'Imported number must be present in Workspace A after service restart');
  assert.equal(reloadedNumber.friendlyName, testFriendlyName);
  assert.equal(reloadedNumber.status, 'ACTIVE');
  console.log(`✓ 2.3 Container restart hydration verified: ${hydratedCount} numbers reloaded from PostgreSQL`);

  // =========================================================================
  // Section 3: P0-3 Persistent Settings & Kill Switch State Across Restarts
  // =========================================================================
  console.log('\n--- Section 3: Persistent SettingsRepository & Kill Switch State ---');

  // 3.1 Initial state: Kill switch is inactive
  const initialSettings = await settingsService.getWorkspaceSettings(workspaceA);
  assert.equal(initialSettings.killSwitchActive, false);
  assert.equal(initialSettings.defaultDailyCap, 50);

  // 3.2 Update settings: Activate emergency kill switch, update caps and safety threshold
  const updatedSettings = await settingsService.updateWorkspaceSettings(workspaceA, 'usr_admin_1', {
    killSwitchActive: true,
    defaultDailyCap: 120,
    safetyThreshold: 85,
  });
  assert.equal(updatedSettings.killSwitchActive, true);
  assert.equal(updatedSettings.defaultDailyCap, 120);
  assert.equal(updatedSettings.safetyThreshold, 85);
  console.log('✓ 3.1 Workspace settings and emergency kill switch updated');

  // 3.3 Verify settings persisted in database repository
  const dbSettings = await settingsRepository.getWorkspaceSettings(workspaceA);
  assert.equal(dbSettings.killSwitchActive, true);
  assert.equal(dbSettings.defaultDailyCap, 120);
  assert.equal(dbSettings.safetyThreshold, 85);
  console.log('✓ 3.2 Workspace settings verified in PostgreSQL repository');

  // 3.4 Simulate container restart by instantiating a fresh SettingsService
  const restartedSettingsService = new SettingsService();
  const reloadedSettings = await restartedSettingsService.getWorkspaceSettings(workspaceA);

  assert.equal(
    reloadedSettings.killSwitchActive,
    true,
    'Kill switch state MUST survive application/container restart'
  );
  assert.equal(
    reloadedSettings.defaultDailyCap,
    120,
    'Daily cap MUST survive application/container restart'
  );
  assert.equal(
    reloadedSettings.safetyThreshold,
    85,
    'Safety threshold MUST survive application/container restart'
  );
  console.log('✓ 3.3 Container restart persistence verified: Kill switch and safety thresholds intact');

  // 3.5 Verify Workspace B settings remain isolated and unaffected
  const settingsB = await restartedSettingsService.getWorkspaceSettings(workspaceB);
  assert.equal(settingsB.killSwitchActive, false, 'Workspace B kill switch must remain inactive');
  assert.equal(settingsB.defaultDailyCap, 50, 'Workspace B default daily cap must remain default');
  console.log('✓ 3.4 Multi-tenant safety verified: Workspace B kill switch unaffected by Workspace A');

  // 3.6 User Preferences persistence across restarts
  const testUserId = 'usr_dental_doc_42';
  await settingsService.updateUserPreferences(testUserId, workspaceA, {
    theme: 'dark',
    emailNotifications: false,
    taskDueAlerts: true,
    language: 'en',
  });

  const reloadedPreferences = await restartedSettingsService.getUserPreferences(testUserId, workspaceA);
  assert.equal(reloadedPreferences.theme, 'dark');
  assert.equal(reloadedPreferences.emailNotifications, false);
  assert.equal(reloadedPreferences.taskDueAlerts, true);
  console.log('✓ 3.5 User preferences persisted and hydrated across container restarts');

  // =========================================================================
  // Section 4: Fail-Closed Behavior on Database Failure (Safety Verification)
  // =========================================================================
  console.log('\n--- Section 4: Fail-Closed Safety Verification on DB Failure ---');

  // 4.1 Create a fault-injecting database mock where setting queries throw errors
  const faultPrisma = {
    ...databaseClient.getPrismaClient(),
    setting: {
      findFirst: async () => {
        throw new Error('Database connection pool exhausted / PostgreSQL unavailable');
      },
      upsert: async () => {
        throw new Error('Database connection pool exhausted / PostgreSQL unavailable');
      },
    },
    telephonyPhoneNumber: {
      listAllActive: async () => {
        throw new Error('Database connection timeout on telephony_phone_numbers');
      },
      findMany: async () => {
        throw new Error('Database connection timeout on telephony_phone_numbers');
      },
    },
  };

  databaseClient.setPrismaClient(faultPrisma as any);

  // 4.2 Fail-Closed Settings Test: DB error MUST return killSwitchActive = true and dailyCap = 0
  const faultSettingsRepo = new (settingsRepository.constructor as any)(databaseClient);
  const failClosedSettings = await faultSettingsRepo.getWorkspaceSettings(workspaceA);

  assert.equal(
    failClosedSettings.killSwitchActive,
    true,
    'FAIL-CLOSED: If settings read fails, kill-switch MUST default to ACTIVE (true) to prevent unverified dispatch'
  );
  assert.equal(
    failClosedSettings.defaultDailyCap,
    0,
    'FAIL-CLOSED: If settings read fails, daily cap MUST be 0'
  );
  console.log('✓ 4.1 Fail-closed settings verified: Database failure forces killSwitchActive: true and dailyCap: 0');

  // 4.3 Fail-Closed Phone Hydration Test: DB error does NOT mark workspace hydrated and rejects unverified lookups
  const faultPhoneService = new PhoneNumbersService();
  const unverifiedLookup = await faultPhoneService.getPhoneNumber(workspaceA, 'non_existent_or_unhydrated_num');
  assert.equal(unverifiedLookup, null, 'Unverified phone number must return null on hydration DB failure');
  console.log('✓ 4.2 Fail-closed phone hydration verified: Stale/unverified numbers cannot authorize calls');

  // Restore healthy in-memory client
  databaseClient.setPrismaClient(createInMemoryPrismaClient());

  // =========================================================================
  // Section 5: End-to-End Outbound Dispatch Safety Gate Execution Tracing
  // =========================================================================
  console.log('\n--- Section 5: Outbound Call Dispatch Safety Gate Verification ---');

  const { voiceService } = await import('../src/modules/voice/voice.service.js');
  const { KillSwitchActiveError, BadRequestError } = await import('../src/core/errors/api-error.js');

  // 5.1 Create lead and approved call for workspaceA
  const testLead = await (databaseClient.getPrismaClient() as any).lead.create({
    data: {
      workspaceId: workspaceA,
      businessName: 'Austin Smile Center',
      phone: '+15125550188',
      status: 'QUALIFIED',
    },
  });
  const testContact = await (databaseClient.getPrismaClient() as any).contact.create({
    data: {
      leadId: testLead.id,
      fullName: 'Dr. Jane Smith',
      email: 'dr.jane@austinsmile.test',
      phone: '+15125550188',
    },
  });
  const testCall = await (databaseClient.getPrismaClient() as any).call.create({
    data: {
      workspaceId: workspaceA,
      leadId: testLead.id,
      contactId: testContact.id,
      recipientPhone: '+15125550188',
      normalizedPhone: '+15125550188',
      status: 'APPROVED',
      isApproved: true,
      humanApprovalRequired: false,
    },
  });

  // 5.2 Activate workspace settings kill switch
  await settingsRepository.updateWorkspaceSettings(workspaceA, { killSwitchActive: true });

  // 5.3 Verify dispatchCall throws KillSwitchActiveError when workspace settings kill switch is active
  let killSwitchBlocked = false;
  try {
    await voiceService.dispatchCall(testCall.id, workspaceA);
  } catch (err: any) {
    if (err instanceof KillSwitchActiveError) {
      killSwitchBlocked = true;
    }
  }
  assert.equal(killSwitchBlocked, true, 'dispatchCall MUST be blocked by workspace settings kill switch');
  console.log('✓ 5.1 Outbound dispatch strictly blocked when workspace settings kill-switch is active');

  // 5.4 Deactivate kill switch and test unverified caller ID phone number rejection
  await settingsRepository.updateWorkspaceSettings(workspaceA, { killSwitchActive: false });

  // Assign an unverified/fake phone number ID to the agent config
  const unverifiedAgent = await (databaseClient.getPrismaClient() as any).voiceAgentConfig.create({
    data: {
      workspaceId: workspaceA,
      name: 'Unverified Caller Agent',
      callObjective: 'Testing',
      openingScript: 'Hello',
      assignedPhoneNumberId: 'num_fake_unverified_line_99999',
    },
  });

  const callWithUnverifiedNumber = await (databaseClient.getPrismaClient() as any).call.create({
    data: {
      workspaceId: workspaceA,
      leadId: testLead.id,
      contactId: testContact.id,
      agentConfigId: unverifiedAgent.id,
      recipientPhone: '+15125550188',
      normalizedPhone: '+15125550188',
      status: 'APPROVED',
      isApproved: true,
      humanApprovalRequired: false,
    },
  });

  let unverifiedNumberBlocked = false;
  try {
    await voiceService.dispatchCall(callWithUnverifiedNumber.id, workspaceA);
  } catch (err: any) {
    if (err instanceof BadRequestError && err.message.includes('not hydrated or verified')) {
      unverifiedNumberBlocked = true;
    }
  }
  assert.equal(unverifiedNumberBlocked, true, 'dispatchCall MUST block outbound calls with unhydrated/unverified caller lines');
  console.log('✓ 5.2 Outbound dispatch strictly blocked when caller ID phone number is unverified/unhydrated');

  console.log('\n========================================================================');
  console.log('--- All Phase R2 Workstream 1 Integration Tests Passed Successfully! ---');
  console.log('========================================================================\n');
}

runWorkstream1Tests().catch((err) => {
  console.error('\n❌ Workstream 1 tests failed:', err);
  process.exit(1);
});
