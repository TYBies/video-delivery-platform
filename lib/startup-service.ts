import { OrphanRecoveryService } from './orphan-recovery-service';
import { UploadStateManager } from './upload-state-manager';
import { initializeBackgroundRecovery } from './background-recovery-service';

export class StartupService {
  private orphanRecoveryService: OrphanRecoveryService;
  private uploadStateManager: UploadStateManager;

  constructor(storagePath?: string) {
    this.orphanRecoveryService = new OrphanRecoveryService(storagePath);
    this.uploadStateManager = new UploadStateManager(storagePath);
  }

  /**
   * Run all startup tasks
   */
  async runStartupTasks(): Promise<void> {
    console.log('🚀 Running startup tasks...');

    try {
      // Initialize services
      await this.orphanRecoveryService.initialize();
      await this.uploadStateManager.initialize();

      // Run tasks in parallel
      await Promise.all([
        this.runOrphanRecovery(),
        this.cleanupExpiredUploads(),
        this.cleanupInvalidOrphans(),
      ]);

      // Start background recovery service
      console.log('🔄 Starting background recovery service...');
      initializeBackgroundRecovery(5); // Check every 5 minutes
      
      console.log('✅ Startup tasks completed successfully');
    } catch (error) {
      console.error('❌ Startup tasks failed:', error);
      throw error;
    }
  }

  /**
   * Run orphan recovery process
   */
  private async runOrphanRecovery(): Promise<void> {
    try {
      console.log('🔍 Scanning for orphaned files...');
      
      const orphans = await this.orphanRecoveryService.scanForOrphans();
      
      if (orphans.length === 0) {
        console.log('✅ No orphaned files found');
        return;
      }

      console.log(`📋 Found ${orphans.length} orphaned file(s), attempting recovery...`);
      
      const result = await this.orphanRecoveryService.recoverAllOrphans();
      
      console.log(`🔧 Orphan recovery complete: ${result.recovered} recovered, ${result.failed} failed`);
      
      if (result.recovered > 0) {
        console.log(`✅ Successfully recovered ${result.recovered} orphaned video(s)`);
      }
      
      if (result.failed > 0) {
        console.warn(`⚠️  Failed to recover ${result.failed} orphaned file(s)`);
      }
    } catch (error) {
      console.error('❌ Orphan recovery failed:', error);
    }
  }

  /**
   * Clean up expired upload states
   */
  private async cleanupExpiredUploads(): Promise<void> {
    try {
      console.log('🧹 Cleaning up expired upload states...');
      
      const cleanedCount = await this.uploadStateManager.cleanupExpiredUploads(24);
      
      if (cleanedCount > 0) {
        console.log(`✅ Cleaned up ${cleanedCount} expired upload state(s)`);
      } else {
        console.log('✅ No expired upload states to clean up');
      }
    } catch (error) {
      console.error('❌ Upload state cleanup failed:', error);
    }
  }

  /**
   * Clean up invalid orphaned files
   */
  private async cleanupInvalidOrphans(): Promise<void> {
    try {
      console.log('🗑️  Cleaning up invalid orphaned files...');
      
      const cleanedCount = await this.orphanRecoveryService.cleanupInvalidOrphans();
      
      if (cleanedCount > 0) {
        console.log(`✅ Cleaned up ${cleanedCount} invalid orphaned file(s)`);
      } else {
        console.log('✅ No invalid orphaned files to clean up');
      }
    } catch (error) {
      console.error('❌ Invalid orphan cleanup failed:', error);
    }
  }

  /**
   * Get system health status
   */
  async getSystemHealth(): Promise<{
    activeUploads: number;
    orphanedFiles: number;
    lastOrphanScan: Date | null;
    systemStatus: 'healthy' | 'warning' | 'error';
  }> {
    try {
      // Validate storage accessibility for a reliable health status
      await this.orphanRecoveryService.initialize();
      await this.uploadStateManager.initialize();

      const activeUploads = await this.uploadStateManager.getActiveUploads();
      const orphans = await this.orphanRecoveryService.scanForOrphans();
      const registry = await this.orphanRecoveryService.getOrphanRegistry();

      const systemStatus = orphans.length > 0 ? 'warning' : 'healthy';

      return {
        activeUploads: activeUploads.length,
        orphanedFiles: orphans.length,
        lastOrphanScan: registry.lastScan || null,
        systemStatus,
      };
    } catch (error) {
      console.error('Failed to get system health:', error);
      return {
        activeUploads: 0,
        orphanedFiles: 0,
        lastOrphanScan: null,
        systemStatus: 'error',
      };
    }
  }
}
