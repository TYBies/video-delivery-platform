import { LocalStorage } from './storage';
import { R2Storage } from './r2-storage';
import { MetadataManager } from './metadata';
import { EnvironmentValidator } from './env-config';
import { VideoMetadata } from '../types';

export interface HybridStorageConfig {
  enableR2Backup: boolean;
  autoBackup: boolean;
  fallbackToR2: boolean;
}

export class HybridStorage {
  private localStorage: LocalStorage;
  private r2Storage?: R2Storage;
  private metadataManager: MetadataManager;
  private config: HybridStorageConfig;

  constructor(config?: Partial<HybridStorageConfig>) {
    this.localStorage = new LocalStorage();
    this.metadataManager = new MetadataManager();

    // Initialize R2 storage if configured
    const r2Configured = EnvironmentValidator.isR2Configured();

    this.config = {
      enableR2Backup: r2Configured,
      autoBackup: r2Configured,
      fallbackToR2: r2Configured,
      ...config,
    };

    if (this.config.enableR2Backup && r2Configured) {
      try {
        this.r2Storage = new R2Storage();
      } catch (error) {
        console.warn('R2 storage initialization failed:', error);
        this.config.enableR2Backup = false;
        this.config.autoBackup = false;
        this.config.fallbackToR2 = false;
      }
    }
  }

  /**
   * Save video with automatic backup to R2
   */
  async saveVideo(
    fileBuffer: Buffer,
    originalFilename: string,
    clientName: string,
    projectName: string
  ): Promise<VideoMetadata> {
    // Save to local storage first
    const metadata = await this.localStorage.saveVideo(
      fileBuffer,
      originalFilename,
      clientName,
      projectName
    );

    // Save metadata
    await this.metadataManager.saveMetadata(metadata);

    // Auto-backup to R2 if enabled
    if (this.config.autoBackup && this.r2Storage) {
      try {
        const backupResult = await this.r2Storage.uploadVideo(
          metadata.id,
          fileBuffer,
          metadata
        );

        if (backupResult.success) {
          // Update metadata to reflect backup status
          const updatedMetadata = await this.metadataManager.updateMetadata(
            metadata.id,
            {
              status: 'backed-up',
              r2Path: backupResult.r2Path,
            }
          );

          return updatedMetadata || metadata;
        } else {
          console.warn(
            `R2 backup failed for video ${metadata.id}:`,
            backupResult.error
          );
        }
      } catch (error) {
        console.warn(`R2 backup error for video ${metadata.id}:`, error);
      }
    }

    return metadata;
  }

  /**
   * Get video stream with fallback to R2
   */
  async getVideoStream(videoId: string): Promise<{
    stream: NodeJS.ReadableStream;
    size: number;
    filename: string;
    source: 'local' | 'r2';
  }> {
    // Try local storage first
    try {
      const localResult = await this.localStorage.getVideoStream(videoId);
      await this.metadataManager.incrementDownloadCount(videoId);

      return {
        stream: localResult.stream,
        size: localResult.size,
        filename: localResult.filename,
        source: 'local',
      };
    } catch {
      console.log(
        `Local video not found for ${videoId}, trying R2 fallback...`
      );

      // Fallback to R2 if enabled
      if (this.config.fallbackToR2 && this.r2Storage) {
        try {
          const r2Result = await this.r2Storage.getVideoStream(videoId);

          if (r2Result.success && r2Result.stream) {
            await this.metadataManager.incrementDownloadCount(videoId);

            return {
              stream: r2Result.stream,
              size: r2Result.contentLength || 0,
              filename: `video-${videoId}`,
              source: 'r2',
            };
          }
        } catch (r2Error) {
          console.error(`R2 fallback failed for ${videoId}:`, r2Error);
        }
      }

      throw new Error(`Video ${videoId} not found in local storage or R2`);
    }
  }

  /**
   * Manually backup video to R2
   */
  async backupVideo(
    videoId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.r2Storage) {
      return {
        success: false,
        error: 'R2 storage not configured',
      };
    }

    try {
      // Get video metadata
      const metadata = await this.metadataManager.loadMetadata(videoId);
      if (!metadata) {
        return {
          success: false,
          error: 'Video metadata not found',
        };
      }

      // Check if already backed up
      if (metadata.status === 'backed-up') {
        return {
          success: true,
          error: 'Video already backed up',
        };
      }

      // Read video from local storage
      const videoBuffer = await this.localStorage.readVideo(videoId);

      // Upload to R2
      const backupResult = await this.r2Storage.uploadVideo(
        videoId,
        videoBuffer,
        metadata
      );

      if (backupResult.success) {
        // Update metadata
        await this.metadataManager.updateMetadata(videoId, {
          status: 'backed-up',
          r2Path: backupResult.r2Path,
        });

        return { success: true };
      } else {
        return {
          success: false,
          error: backupResult.error,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Backup failed: ${error}`,
      };
    }
  }

  /**
   * Delete video from both local and R2 storage
   */
  async deleteVideo(
    videoId: string
  ): Promise<{ success: boolean; error?: string }> {
    let localDeleted = false;
    let r2Deleted = false;
    const errors: string[] = [];

    // Delete from local storage
    try {
      localDeleted = await this.localStorage.deleteVideo(videoId);
    } catch (error) {
      errors.push(`Local deletion failed: ${error}`);
    }

    // Delete from R2 if configured
    if (this.r2Storage) {
      try {
        const r2Result = await this.r2Storage.deleteVideo(videoId);
        r2Deleted = r2Result.success;

        if (!r2Result.success && r2Result.error) {
          errors.push(`R2 deletion failed: ${r2Result.error}`);
        }
      } catch (error) {
        errors.push(`R2 deletion error: ${error}`);
      }
    }

    // Delete metadata
    try {
      await this.metadataManager.deleteMetadata(videoId);
    } catch (error) {
      errors.push(`Metadata deletion failed: ${error}`);
    }

    const success = localDeleted || r2Deleted;

    return {
      success,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  }

  /**
   * Get storage statistics from both local and R2
   */
  async getStorageStats(): Promise<{
    local: { totalSize: number; videoCount: number };
    r2?: { totalSize: number; videoCount: number };
    combined: { totalSize: number; videoCount: number };
  }> {
    // Get local stats
    const localStats = await this.localStorage.getStorageStats();

    let r2Stats: { totalSize: number; videoCount: number } | undefined;

    // Get R2 stats if available
    if (this.r2Storage) {
      try {
        const r2Result = await this.r2Storage.getStorageStats();
        if (r2Result.success) {
          r2Stats = {
            totalSize: r2Result.totalSize || 0,
            videoCount: r2Result.videoCount || 0,
          };
        }
      } catch (error) {
        console.warn('Failed to get R2 stats:', error);
      }
    }

    // Calculate combined stats (avoid double counting)
    const allVideos = await this.metadataManager.getAllMetadata();
    const combinedSize = allVideos.reduce(
      (sum, video) => sum + video.fileSize,
      0
    );

    return {
      local: localStats,
      r2: r2Stats,
      combined: {
        totalSize: combinedSize,
        videoCount: allVideos.length,
      },
    };
  }

  /**
   * Check video availability across storage systems
   */
  async checkVideoAvailability(videoId: string): Promise<{
    local: boolean;
    r2: boolean;
    metadata: boolean;
  }> {
    const availability = {
      local: false,
      r2: false,
      metadata: false,
    };

    // Check local storage
    try {
      availability.local = await this.localStorage.videoExists(videoId);
    } catch (error) {
      console.warn(`Error checking local availability for ${videoId}:`, error);
    }

    // Check R2 storage
    if (this.r2Storage) {
      try {
        const r2Result = await this.r2Storage.videoExists(videoId);
        availability.r2 = r2Result.exists;
      } catch (error) {
        console.warn(`Error checking R2 availability for ${videoId}:`, error);
      }
    }

    // Check metadata
    try {
      const metadata = await this.metadataManager.loadMetadata(videoId);
      availability.metadata = !!metadata;
    } catch (error) {
      console.warn(
        `Error checking metadata availability for ${videoId}:`,
        error
      );
    }

    return availability;
  }

  /**
   * Get configuration status
   */
  getConfig(): HybridStorageConfig & { r2Available: boolean } {
    return {
      ...this.config,
      r2Available: !!this.r2Storage,
    };
  }

  /**
   * Test all storage systems
   */
  async testConnections(): Promise<{
    local: { success: boolean; error?: string };
    r2?: { success: boolean; error?: string };
  }> {
    const results: any = {
      local: { success: false },
    };

    // Test local storage
    try {
      await this.localStorage.getStorageStats();
      results.local = { success: true };
    } catch (error) {
      results.local = {
        success: false,
        error: `Local storage test failed: ${error}`,
      };
    }

    // Test R2 storage
    if (this.r2Storage) {
      try {
        const r2Result = await this.r2Storage.testConnection();
        results.r2 = r2Result;
      } catch (error) {
        results.r2 = {
          success: false,
          error: `R2 connection test failed: ${error}`,
        };
      }
    }

    return results;
  }
}
