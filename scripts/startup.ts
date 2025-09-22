#!/usr/bin/env tsx

/**
 * Application Startup Script
 * 
 * This script runs essential startup tasks including:
 * - Orphan file recovery
 * - Cleanup of expired upload states
 * - System health checks
 */

import { StartupService } from '../lib/startup-service';

async function main() {
  console.log('🚀 Starting application startup tasks...\n');

  const startupService = new StartupService();

  try {
    // Run all startup tasks
    await startupService.runStartupTasks();

    // Get and display system health
    const health = await startupService.getSystemHealth();
    
    console.log('\n📊 System Health Status:');
    console.log(`   Status: ${health.systemStatus.toUpperCase()}`);
    console.log(`   Active uploads: ${health.activeUploads}`);
    console.log(`   Orphaned files: ${health.orphanedFiles}`);
    
    if (health.lastOrphanScan) {
      console.log(`   Last orphan scan: ${health.lastOrphanScan.toISOString()}`);
    }

    if (health.systemStatus === 'warning') {
      console.log('\n⚠️  System has warnings - check orphaned files');
    } else if (health.systemStatus === 'error') {
      console.log('\n❌ System has errors - manual intervention may be required');
    } else {
      console.log('\n✅ System is healthy');
    }

    console.log('\n🎉 Startup tasks completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Startup tasks failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

export { main as runStartup };