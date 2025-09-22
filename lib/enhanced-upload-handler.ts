import { NextRequest } from 'next/server';
import { StreamingUploadHandler } from './streaming-upload';
import { OrphanRecoveryService } from './orphan-recovery-service';
import { UploadStateManager } from './upload-state-manager';
import { VideoMetadata } from '../types';
import crypto from 'crypto';

export class EnhancedUploadHandler {
  private storagePath: string;
  private streamingHandler: StreamingUploadHandler;
  private orphanRecovery: OrphanRecoveryService;
  private stateManager: UploadStateManager;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || process.env.STORAGE_PATH || './uploads';
    this.streamingHandler = new StreamingUploadHandler(this.storagePath);
    this.orphanRecovery = new OrphanRecoveryService(this.storagePath);
    this.stateManager = new UploadStateManager(this.storagePath);
  }

  /**
   * Handle upload with automatic recovery capabilities
   */
  async handleUploadWithRecovery(
    request: NextRequest,
    clientName: string,
    projectName: string,
    filename: string,
    contentLength: number
  ): Promise<VideoMetadata> {
    // Generate upload ID for tracking
    const uploadId = this.generateUploadId();
    
    console.log(`Starting enhanced upload: ${filename} (ID: ${uploadId})`);

    try {
      // Initialize services
      await this.stateManager.initialize();
      await this.orphanRecovery.initialize();

      // Check for existing orphaned files that match this upload
      const existingVideo = await this.checkForExistingVideo(clientName, projectName, filename, contentLength);
      if (existingVideo) {
        console.log(`Found existing video for ${filename}, returning immediately`);
        return existingVideo;
      }

      // Create initial upload state
      const uploadState = {
        uploadId,
        videoId: '', // Will be set by streaming handler
        filename,
        clientName,
        projectName,
        totalSize: contentLength,
        uploadedSize: 0,
        chunkSize: 1024 * 1024, // 1MB chunks
        lastChunkIndex: 0,
        startTime: new Date(),
        lastActivity: new Date(),
        status: 'active' as const,
        retryCount: 0,
        maxRetries: 3,
      };

      await this.stateManager.saveUploadState(uploadState);

      // Attempt the upload
      const metadata = await this.streamingHandler.handleStreamingUpload(
        request,
        clientName,
        projectName,
        filename,
        contentLength,
        uploadId
      );

      // Mark upload as completed
      uploadState.videoId = metadata.id;
      await this.stateManager.markUploadComplete(uploadId);

      console.log(`Upload completed successfully: ${metadata.id}`);
      return metadata;

    } catch (error) {
      console.error(`Upload failed for ${uploadId}:`, error);
      
      // Mark upload as failed
      await this.stateManager.markUploadFailed(uploadId, error instanceof Error ? error.message : 'Unknown error');

      // Attempt automatic recovery
      const recoveredVideo = await this.attemptAutomaticRecovery(clientName, projectName, filename, contentLength);
      if (recoveredVideo) {
        console.log(`Automatic recovery successful for ${filename}`);
        return recoveredVideo;
      }

      // If recovery fails, throw the original error
      throw error;
    }
  }

  /**
   * Check for existing video that matches the upload parameters
   */
  private async checkForExistingVideo(
    clientName: string,
    projectName: string,
    filename: string,
    contentLength: number
  ): Promise<VideoMetadata | null> {
    try {
      // First, run a quick orphan scan to catch any recent orphans
      await this.orphanRecovery.recoverAllOrphans();

      // Check if there's already a video with similar characteristics
      const { MetadataManager } = await import('./metadata');
      const metadataManager = new MetadataManager(this.storagePath);
      
      const clientVideos = await metadataManager.getVideosByClient(clientName);
      
      // Look for videos with same filename and similar size (within 5% tolerance)
      for (const video of clientVideos) {
        if (video.filename === filename && 
            video.projectName === projectName &&
            Math.abs(video.fileSize - contentLength) / contentLength < 0.05) {
          
          console.log(`Found existing video: ${video.id} for ${filename}`);
          return video;
        }
      }

      return null;
    } catch (error) {
      console.error('Error checking for existing video:', error);
      return null;
    }
  }

  /**
   * Attempt automatic recovery of failed upload
   */
  private async attemptAutomaticRecovery(
    clientName: string,
    projectName: string,
    filename: string,
    contentLength: number
  ): Promise<VideoMetadata | null> {
    try {
      console.log(`Attempting automatic recovery for ${filename}...`);

      // Scan for orphaned files
      const orphans = await this.orphanRecovery.scanForOrphans();
      
      // Look for orphans that might match this upload
      for (const orphan of orphans) {
        // Check if file size matches (within 10% tolerance for partial uploads)
        const sizeTolerance = Math.abs(orphan.size - contentLength) / contentLength;
        
        if (sizeTolerance < 0.1) {
          console.log(`Found potential orphan match: ${orphan.videoId}`);
          
          // Attempt to recover this orphan
          const recovered = await this.orphanRecovery.recoverOrphan(orphan);
          if (recovered) {
            // Update the recovered metadata with correct client/project info
            const { MetadataManager } = await import('./metadata');
            const metadataManager = new MetadataManager(this.storagePath);
            
            const updatedMetadata = await metadataManager.updateMetadata(recovered.id, {
              clientName,
              projectName,
              filename,
            });

            if (updatedMetadata) {
              console.log(`Successfully recovered and updated orphan: ${updatedMetadata.id}`);
              return updatedMetadata;
            }
          }
        }
      }

      console.log('No suitable orphans found for recovery');
      return null;
    } catch (error) {
      console.error('Automatic recovery failed:', error);
      return null;
    }
  }

  /**
   * Generate unique upload ID
   */
  private generateUploadId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Get upload progress for resumable uploads
   */
  async getUploadProgress(uploadId: string): Promise<{
    uploadedSize: number;
    totalSize: number;
    percentage: number;
    status: string;
  } | null> {
    try {
      const state = await this.stateManager.loadUploadState(uploadId);
      if (!state) {
        return null;
      }

      const percentage = Math.round((state.uploadedSize / state.totalSize) * 100);

      return {
        uploadedSize: state.uploadedSize,
        totalSize: state.totalSize,
        percentage,
        status: state.status,
      };
    } catch (error) {
      console.error(`Failed to get upload progress for ${uploadId}:`, error);
      return null;
    }
  }

  /**
   * Resume a failed upload
   */
  async resumeUpload(uploadId: string, request: NextRequest): Promise<VideoMetadata> {
    const state = await this.stateManager.loadUploadState(uploadId);
    if (!state) {
      throw new Error(`Upload state not found for ID: ${uploadId}`);
    }

    console.log(`Resuming upload: ${uploadId} from ${state.uploadedSize}/${state.totalSize} bytes`);

    // For now, restart the upload (in a full implementation, this would resume from the last chunk)
    return this.handleUploadWithRecovery(
      request,
      state.clientName,
      state.projectName,
      state.filename,
      state.totalSize
    );
  }

  /**
   * Clean up old upload states and run maintenance
   */
  async runMaintenance(): Promise<void> {
    try {
      console.log('Running upload system maintenance...');
      
      // Clean up expired upload states
      const cleanedStates = await this.stateManager.cleanupExpiredUploads(24);
      if (cleanedStates > 0) {
        console.log(`Cleaned up ${cleanedStates} expired upload states`);
      }

      // Run orphan recovery
      const result = await this.orphanRecovery.recoverAllOrphans();
      if (result.recovered > 0) {
        console.log(`Recovered ${result.recovered} orphaned files`);
      }

      // Clean up invalid orphans
      const invalidCleaned = await this.orphanRecovery.cleanupInvalidOrphans();
      if (invalidCleaned > 0) {
        console.log(`Cleaned up ${invalidCleaned} invalid orphaned files`);
      }

      console.log('Maintenance completed');
    } catch (error) {
      console.error('Maintenance failed:', error);
    }
  }
}
