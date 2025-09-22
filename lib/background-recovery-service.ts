import { EnhancedUploadHandler } from './enhanced-upload-handler';
import { OrphanRecoveryService } from './orphan-recovery-service';

export class BackgroundRecoveryService {
  private uploadHandler: EnhancedUploadHandler;
  private orphanRecovery: OrphanRecoveryService;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(storagePath?: string) {
    this.uploadHandler = new EnhancedUploadHandler(storagePath);
    this.orphanRecovery = new OrphanRecoveryService(storagePath);
  }

  /**
   * Start the background recovery service
   */
  start(intervalMinutes: number = 5): void {
    if (this.isRunning) {
      console.log('Background recovery service is already running');
      return;
    }

    console.log(`Starting background recovery service (interval: ${intervalMinutes} minutes)`);
    this.isRunning = true;

    // Run immediately on start
    this.runRecoveryCheck();

    // Set up periodic checks
    this.intervalId = setInterval(() => {
      this.runRecoveryCheck();
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Stop the background recovery service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    console.log('Stopping background recovery service');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Run a single recovery check
   */
  private async runRecoveryCheck(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      console.log('🔍 Running background recovery check...');

      // Scan for orphaned files and recover them automatically
      const orphans = await this.orphanRecovery.scanForOrphans();
      
      if (orphans.length > 0) {
        console.log(`📋 Found ${orphans.length} orphaned file(s), recovering automatically...`);
        
        const result = await this.orphanRecovery.recoverAllOrphans();
        
        if (result.recovered > 0) {
          console.log(`✅ Automatically recovered ${result.recovered} orphaned video(s)`);
        }
        
        if (result.failed > 0) {
          console.warn(`⚠️  Failed to recover ${result.failed} orphaned file(s)`);
        }
      }

      // Run maintenance tasks
      await this.uploadHandler.runMaintenance();

    } catch (error) {
      console.error('❌ Background recovery check failed:', error);
    }
  }

  /**
   * Force an immediate recovery check
   */
  async forceRecoveryCheck(): Promise<{
    orphansFound: number;
    orphansRecovered: number;
    orphansFailed: number;
  }> {
    try {
      console.log('🔧 Forcing immediate recovery check...');

      const orphans = await this.orphanRecovery.scanForOrphans();
      
      if (orphans.length === 0) {
        return {
          orphansFound: 0,
          orphansRecovered: 0,
          orphansFailed: 0,
        };
      }

      const result = await this.orphanRecovery.recoverAllOrphans();
      
      return {
        orphansFound: orphans.length,
        orphansRecovered: result.recovered,
        orphansFailed: result.failed,
      };
    } catch (error) {
      console.error('Force recovery check failed:', error);
      return {
        orphansFound: 0,
        orphansRecovered: 0,
        orphansFailed: 0,
      };
    }
  }

  /**
   * Get service status
   */
  getStatus(): {
    isRunning: boolean;
    intervalMinutes: number | null;
  } {
    const intervalMinutes = this.intervalId ? 5 : null; // Default interval
    
    return {
      isRunning: this.isRunning,
      intervalMinutes,
    };
  }
}

// Global instance for the background service
let backgroundService: BackgroundRecoveryService | null = null;

/**
 * Get or create the global background recovery service
 */
export function getBackgroundRecoveryService(): BackgroundRecoveryService {
  if (!backgroundService) {
    backgroundService = new BackgroundRecoveryService();
  }
  return backgroundService;
}

/**
 * Initialize and start the background recovery service
 */
export function initializeBackgroundRecovery(intervalMinutes: number = 5): void {
  const service = getBackgroundRecoveryService();
  service.start(intervalMinutes);
}

/**
 * Stop the background recovery service
 */
export function stopBackgroundRecovery(): void {
  if (backgroundService) {
    backgroundService.stop();
  }
}