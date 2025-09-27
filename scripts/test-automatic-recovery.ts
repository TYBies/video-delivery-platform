#!/usr/bin/env tsx

/**
 * Test Automatic Recovery
 *
 * This script demonstrates the automatic recovery system by:
 * 1. Creating an orphaned file
 * 2. Simulating an upload request
 * 3. Showing how the system automatically recovers and provides a download link
 */

import { EnhancedUploadHandler } from '../lib/enhanced-upload-handler';
import { getBackgroundRecoveryService } from '../lib/background-recovery-service';
import fs from 'fs/promises';
import path from 'path';

async function createOrphanedFile(): Promise<string> {
  const videoId = `test-orphan-${Date.now()}`;
  const videoDir = path.join('./uploads/videos', videoId);
  await fs.mkdir(videoDir, { recursive: true });

  // Create a test video file
  const videoPath = path.join(videoDir, 'recovered-video.mp4');
  const testContent = Buffer.alloc(50 * 1024, 'test video content'); // 50KB file
  await fs.writeFile(videoPath, testContent);

  console.log(`📁 Created orphaned file: ${videoPath}`);
  return videoId;
}

async function simulateUploadRequest(): Promise<void> {
  console.log('\n🔄 Simulating upload request that would normally fail...');

  const handler = new EnhancedUploadHandler();

  // Create a mock request (in real scenario, this would be a failed upload)
  const mockRequest = {
    body: null,
  } as any;

  try {
    // This would normally fail, but should automatically recover the orphaned file
    const result = await handler.handleUploadWithRecovery(
      mockRequest,
      'test-client',
      'test-project',
      'recovered-video.mp4',
      50 * 1024 // 50KB
    );

    console.log('✅ Upload completed with automatic recovery!');
    console.log(`📋 Video ID: ${result.id}`);
    console.log(`🔗 Download URL: ${result.downloadUrl}`);
    console.log(`📊 File Size: ${result.fileSize} bytes`);
    console.log(`👤 Client: ${result.clientName}`);
    console.log(`📁 Project: ${result.projectName}`);
  } catch (error) {
    console.error('❌ Upload failed even with recovery:', error);
  }
}

async function testBackgroundRecovery(): Promise<void> {
  console.log('\n🔍 Testing background recovery service...');

  const service = getBackgroundRecoveryService();
  const result = await service.forceRecoveryCheck();

  console.log(`📊 Recovery Results:`);
  console.log(`   Orphans found: ${result.orphansFound}`);
  console.log(`   Orphans recovered: ${result.orphansRecovered}`);
  console.log(`   Orphans failed: ${result.orphansFailed}`);
}

async function main() {
  console.log('🧪 Testing Automatic Recovery System\n');

  try {
    // Test 1: Create orphaned file and simulate recovery during upload
    console.log('📋 Test 1: Upload with automatic orphan recovery');
    await createOrphanedFile();
    await simulateUploadRequest();

    // Test 2: Background recovery service
    console.log('\n📋 Test 2: Background recovery service');

    // Create another orphaned file
    await createOrphanedFile();
    await testBackgroundRecovery();

    console.log('\n🎉 All tests completed!');
    console.log('\n💡 Key Benefits:');
    console.log('   ✅ Users get download links even when uploads fail');
    console.log('   ✅ No manual intervention required');
    console.log('   ✅ Automatic background recovery');
    console.log('   ✅ Seamless user experience');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  main().catch(console.error);
}

export { main as testAutomaticRecovery };
