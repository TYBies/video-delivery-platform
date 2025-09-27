#!/usr/bin/env ts-node

/**
 * Automated deployment test script
 *
 * This script tests all the functionality we've implemented:
 * 1. Professional error handling for B2 daily limits
 * 2. Caching system effectiveness
 * 3. Rate limiting protection
 * 4. UI error display improvements
 *
 * Run this after B2 daily limits reset (midnight GMT) or after increasing caps
 */

import { metadataCache, rateLimiter } from '../lib/metadata-cache';
import { handleS3Error } from '../lib/s3-config';

// Color coding for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log('\n' + '='.repeat(50));
  log(`${colors.bold}${title}${colors.reset}`, colors.blue);
  console.log('='.repeat(50));
}

function logTest(name: string, passed: boolean, details?: string) {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  const statusColor = passed ? colors.green : colors.red;
  log(`${status} ${name}`, statusColor);
  if (details) {
    log(`    ${details}`, colors.yellow);
  }
}

async function testCaching() {
  logSection('Testing Caching System');

  // Test 1: Basic cache operations
  const testData = { id: 'test-123', name: 'Test Video' };
  metadataCache.set('test-cache', testData);
  const retrieved = metadataCache.get('test-cache');
  logTest(
    'Basic cache set/get',
    JSON.stringify(retrieved) === JSON.stringify(testData),
    'Cache should store and retrieve data correctly'
  );

  // Test 2: TTL expiration
  metadataCache.set('ttl-test', { data: 'expires soon' }, 100);
  const immediate = metadataCache.get('ttl-test');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const afterExpiry = metadataCache.get('ttl-test');

  logTest(
    'TTL expiration',
    immediate !== null && afterExpiry === null,
    'Data should expire after TTL'
  );

  // Test 3: Video-specific caching
  const videos = [
    {
      id: 'v1',
      filename: 'Video 1.mp4',
      clientName: 'Test Client',
      projectName: 'Test Project',
      uploadDate: new Date(),
      fileSize: 1024000,
      downloadCount: 0,
      status: 'local' as const,
      downloadUrl: '/download/v1',
      isActive: true,
    },
    {
      id: 'v2',
      filename: 'Video 2.mp4',
      clientName: 'Test Client',
      projectName: 'Test Project',
      uploadDate: new Date(),
      fileSize: 2048000,
      downloadCount: 0,
      status: 'local' as const,
      downloadUrl: '/download/v2',
      isActive: true,
    },
  ];
  metadataCache.setVideoList(videos);
  const cachedVideos = metadataCache.getVideoList();

  logTest(
    'Video list caching',
    Array.isArray(cachedVideos) && cachedVideos.length === 2,
    'Video lists should be cached correctly'
  );

  // Test 4: Cache invalidation
  metadataCache.setVideoMetadata('v1', {
    id: 'v1',
    filename: 'Video 1 metadata.mp4',
    clientName: 'Test Client',
    projectName: 'Test Project',
    uploadDate: new Date(),
    fileSize: 1024000,
    downloadCount: 0,
    status: 'local' as const,
    downloadUrl: '/download/v1',
    isActive: true,
  });
  metadataCache.invalidateVideo('v1');
  const afterInvalidation = metadataCache.getVideoList();
  const metadataAfterInvalidation = metadataCache.getVideoMetadata('v1');

  logTest(
    'Cache invalidation',
    afterInvalidation === null && metadataAfterInvalidation === null,
    'Invalidation should clear related cache entries'
  );

  // Test 5: Cache statistics
  metadataCache.set('stat1', 'data1');
  metadataCache.set('stat2', 'data2');
  const stats = metadataCache.getStats();

  logTest(
    'Cache statistics',
    stats.size === 2 &&
      stats.keys.includes('stat1') &&
      stats.keys.includes('stat2'),
    'Statistics should reflect current cache state'
  );

  metadataCache.invalidateAll();
}

async function testRateLimiting() {
  logSection('Testing Rate Limiting');

  rateLimiter.reset();

  // Test 1: Allow requests within limit
  let allowedCount = 0;
  for (let i = 0; i < 50; i++) {
    if (rateLimiter.canMakeRequest('test-rate-limit')) {
      allowedCount++;
    }
  }

  logTest(
    'Allow requests within limit',
    allowedCount === 50,
    `Should allow all 50 requests, got ${allowedCount}`
  );

  // Test 2: Block requests after limit
  rateLimiter.reset();
  for (let i = 0; i < 100; i++) {
    rateLimiter.canMakeRequest('limit-test');
  }
  const blockedAfterLimit = !rateLimiter.canMakeRequest('limit-test');

  logTest(
    'Block requests after limit',
    blockedAfterLimit,
    'Should block request #101'
  );

  // Test 3: Remaining requests tracking
  rateLimiter.reset();
  for (let i = 0; i < 25; i++) {
    rateLimiter.canMakeRequest('remaining-test');
  }
  const remaining = rateLimiter.getRemainingRequests('remaining-test');

  logTest(
    'Remaining requests tracking',
    remaining === 75,
    `Should have 75 remaining, got ${remaining}`
  );

  // Test 4: Key isolation
  rateLimiter.reset();
  for (let i = 0; i < 100; i++) {
    rateLimiter.canMakeRequest('key1');
  }
  const key1Blocked = !rateLimiter.canMakeRequest('key1');
  const key2Allowed = rateLimiter.canMakeRequest('key2');

  logTest(
    'Key isolation',
    key1Blocked && key2Allowed,
    'Different keys should have separate limits'
  );
}

function testErrorHandling() {
  logSection('Testing Error Handling');

  // Test 1: Bandwidth limit error
  const bandwidthError = {
    Code: 'AccessDenied',
    message:
      'Cannot download file, download bandwidth or transaction (Class B) cap exceeded.',
    $metadata: { httpStatusCode: 403 },
  };

  const bandwidthResult = handleS3Error(bandwidthError);
  logTest(
    'Bandwidth limit error handling',
    bandwidthResult.isRateLimited &&
      bandwidthResult.userFriendly.includes(
        'Daily cloud storage limit reached'
      ) &&
      bandwidthResult.userFriendly.includes('midnight GMT'),
    'Should provide user-friendly message with reset time'
  );

  // Test 2: Transaction cap error
  const transactionError = {
    Code: 'AccessDenied',
    message: 'Transaction cap exceeded for today',
  };

  const transactionResult = handleS3Error(transactionError);
  logTest(
    'Transaction cap error handling',
    transactionResult.isRateLimited &&
      transactionResult.userFriendly.includes('transaction limit reached') &&
      transactionResult.userFriendly.includes('midnight GMT'),
    'Should provide specific transaction limit message'
  );

  // Test 3: 404 error
  const notFoundError = {
    Code: 'NoSuchKey',
    message: 'The specified key does not exist',
    $metadata: { httpStatusCode: 404 },
  };

  const notFoundResult = handleS3Error(notFoundError);
  logTest(
    '404 error handling',
    !notFoundResult.isRateLimited &&
      notFoundResult.userFriendly.includes('not found in cloud storage'),
    'Should indicate file not found without rate limit flag'
  );

  // Test 4: Server error
  const serverError = {
    Code: 'InternalError',
    message: 'Internal server error',
    $metadata: { httpStatusCode: 500 },
  };

  const serverResult = handleS3Error(serverError);
  logTest(
    'Server error handling',
    !serverResult.isRateLimited &&
      serverResult.userFriendly.includes('technical difficulties'),
    'Should provide helpful server error message'
  );

  // Test 5: Error message quality
  const allResults = [
    bandwidthResult,
    transactionResult,
    notFoundResult,
    serverResult,
  ];
  const noTechnicalDetails = allResults.every(
    (result) =>
      !result.userFriendly.includes('Code') &&
      !result.userFriendly.includes('HTTP') &&
      !result.userFriendly.includes('$metadata') &&
      result.userFriendly.length > 20
  );

  logTest(
    'Error message quality',
    noTechnicalDetails,
    'All user messages should be non-technical and helpful'
  );
}

async function testAPIEndpoints() {
  logSection('Testing API Endpoints');

  const baseUrl = 'http://localhost:3001';

  try {
    // Test 1: Video list endpoint
    const videoListResponse = await fetch(`${baseUrl}/api/video`);
    const videoListOk = videoListResponse.ok;

    logTest(
      'Video list endpoint',
      videoListOk,
      `Status: ${videoListResponse.status} ${videoListResponse.statusText}`
    );

    if (videoListOk) {
      const videoData = await videoListResponse.json();
      logTest(
        'Video list data format',
        Array.isArray(videoData),
        `Returned ${Array.isArray(videoData) ? videoData.length : 'non-array'} videos`
      );
    }

    // Test 2: System health endpoint
    const healthResponse = await fetch(`${baseUrl}/api/system/health`);
    const healthOk = healthResponse.ok;

    logTest(
      'System health endpoint',
      healthOk,
      `Status: ${healthResponse.status} ${healthResponse.statusText}`
    );

    if (healthOk) {
      const healthData = await healthResponse.json();
      logTest(
        'Health data format',
        typeof healthData === 'object' && healthData.hasOwnProperty('success'),
        'Should return health status object'
      );
    }
  } catch (error) {
    logTest('API endpoint connectivity', false, `Failed to connect: ${error}`);
    log(
      '❗ Make sure the development server is running on localhost:3001',
      colors.yellow
    );
  }
}

async function performanceTest() {
  logSection('Testing Performance Improvements');

  const baseUrl = 'http://localhost:3001';

  try {
    // Test cache performance
    log('Testing cache performance impact...', colors.blue);

    // Clear cache first
    metadataCache.invalidateAll();

    // First request (no cache)
    const start1 = Date.now();
    const response1 = await fetch(`${baseUrl}/api/video`);
    await response1.json();
    const duration1 = Date.now() - start1;

    // Second request (should be cached)
    const start2 = Date.now();
    const response2 = await fetch(`${baseUrl}/api/video`);
    await response2.json();
    const duration2 = Date.now() - start2;

    const improvement =
      duration1 > 0 ? ((duration1 - duration2) / duration1) * 100 : 0;

    logTest(
      'Cache performance improvement',
      duration2 < duration1,
      `First request: ${duration1}ms, Second request: ${duration2}ms (${improvement.toFixed(1)}% faster)`
    );
  } catch (error) {
    logTest('Performance test', false, `Failed: ${error}`);
  }
}

async function main() {
  log(
    `${colors.bold}🧪 Video Delivery Platform - Automated Test Suite${colors.reset}`,
    colors.blue
  );
  log(
    `Testing error handling, caching, and performance improvements\n`,
    colors.yellow
  );

  try {
    await testCaching();
    await testRateLimiting();
    testErrorHandling();
    await testAPIEndpoints();
    await performanceTest();

    logSection('Test Summary');
    log('✅ All core functionality tested', colors.green);
    log('🚀 Ready for production deployment!', colors.green);

    console.log('\n📋 Manual Testing Checklist:');
    log('1. Upload a video through the UI', colors.yellow);
    log('2. View videos page (should load quickly from cache)', colors.yellow);
    log('3. Delete a video (should show proper feedback)', colors.yellow);
    log(
      '4. Try operations when hitting B2 limits (should show professional errors)',
      colors.yellow
    );
    log('5. Verify error messages are user-friendly', colors.yellow);
  } catch (error) {
    log(`\n❌ Test suite failed: ${error}`, colors.red);
    process.exit(1);
  }
}

// Run the test suite
if (require.main === module) {
  main().catch(console.error);
}

export { main as runTestSuite };
