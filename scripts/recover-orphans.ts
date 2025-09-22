#!/usr/bin/env tsx

/**
 * Orphan Recovery Utility
 * 
 * This script scans for orphaned video files and attempts to recover them
 * by reconstructing metadata and registering them in the system.
 */

import { OrphanRecoveryService } from '../lib/orphan-recovery-service';
import path from 'path';

async function main() {
  console.log('🔍 Starting orphan recovery process...\n');

  const storagePath = process.env.STORAGE_PATH || './uploads';
  const service = new OrphanRecoveryService(storagePath);

  try {
    // Initialize the service
    await service.initialize();

    // Scan for orphaned files
    console.log('📁 Scanning for orphaned video files...');
    const orphans = await service.scanForOrphans();

    if (orphans.length === 0) {
      console.log('✅ No orphaned files found. All videos have proper metadata.');
      return;
    }

    console.log(`📋 Found ${orphans.length} orphaned file(s):\n`);

    // Display found orphans
    orphans.forEach((orphan, index) => {
      const sizeMB = Math.round(orphan.size / 1024 / 1024);
      console.log(`${index + 1}. Video ID: ${orphan.videoId}`);
      console.log(`   File: ${path.basename(orphan.path)}`);
      console.log(`   Size: ${sizeMB} MB`);
      console.log(`   Created: ${orphan.createdDate.toISOString()}`);
      console.log(`   Path: ${orphan.path}\n`);
    });

    // Attempt recovery
    console.log('🔧 Starting recovery process...\n');
    const result = await service.recoverAllOrphans();

    console.log('📊 Recovery Results:');
    console.log(`✅ Successfully recovered: ${result.recovered} files`);
    console.log(`❌ Failed to recover: ${result.failed} files`);

    if (result.recovered > 0) {
      console.log('\n🎉 Recovery complete! The recovered videos should now be available for download.');
      console.log('   You can check the video list in your application to see the recovered files.');
    }

    if (result.failed > 0) {
      console.log('\n⚠️  Some files could not be recovered. Check the logs for details.');
      console.log('   You may need to manually review these files or provide additional information.');
    }

    // Show orphan registry
    const registry = await service.getOrphanRegistry();
    if (Object.keys(registry.orphans).length > 0) {
      console.log('\n📝 Orphan Registry Summary:');
      Object.entries(registry.orphans).forEach(([videoId, info]) => {
        console.log(`   ${videoId}: ${info.recoveryStatus} (${info.recoveryAttempts} attempts)`);
      });
    }

  } catch (error) {
    console.error('❌ Recovery process failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

export { main as recoverOrphans };