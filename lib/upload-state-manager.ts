import fs from 'fs/promises';
import path from 'path';
import { UploadState, UploadStateFile } from '../types';

export class UploadStateManager {
  private storagePath: string;
  private statePath: string;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || process.env.STORAGE_PATH || './uploads';
    this.statePath = path.join(this.storagePath, 'state');
  }

  /**
   * Initialize the state directory
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.statePath, { recursive: true });
  }

  /**
   * Save upload state to persistent storage
   */
  async saveUploadState(state: UploadState): Promise<void> {
    await this.initialize();
    const stateFilePath = path.join(this.statePath, `${state.uploadId}.json`);

    // Preserve existing fields if a state file already exists (e.g., completedChunks, chunkChecksums, lastError)
    let previous: Partial<UploadStateFile> | null = null;
    try {
      const prevData = await fs.readFile(stateFilePath, 'utf-8');
      previous = JSON.parse(prevData);
    } catch {}

    const stateFile: UploadStateFile = {
      uploadId: state.uploadId,
      videoId: state.videoId,
      metadata: {
        filename: state.filename,
        clientName: state.clientName,
        projectName: state.projectName,
        totalSize: state.totalSize,
      },
      progress: {
        uploadedSize: state.uploadedSize,
        chunkSize: state.chunkSize,
        lastChunkIndex: state.lastChunkIndex,
        completedChunks:
          (previous &&
            previous.progress &&
            previous.progress.completedChunks) ||
          [],
      },
      integrity: {
        expectedChecksum: state.checksumMD5,
        chunkChecksums:
          (previous &&
            previous.integrity &&
            previous.integrity.chunkChecksums) ||
          {},
      },
      timing: {
        startTime: state.startTime,
        lastActivity: state.lastActivity,
      },
      status: {
        current: state.status,
        retryCount: state.retryCount,
        maxRetries: state.maxRetries,
        lastError:
          (previous && previous.status && previous.status.lastError) ||
          undefined,
      },
    };

    await fs.writeFile(stateFilePath, JSON.stringify(stateFile, null, 2));
  }

  /**
   * Load upload state from persistent storage
   */
  async loadUploadState(uploadId: string): Promise<UploadState | null> {
    try {
      const stateFilePath = path.join(this.statePath, `${uploadId}.json`);
      const data = await fs.readFile(stateFilePath, 'utf-8');
      const stateFile: UploadStateFile = JSON.parse(data);

      const state: UploadState = {
        uploadId: stateFile.uploadId,
        videoId: stateFile.videoId,
        filename: stateFile.metadata.filename,
        clientName: stateFile.metadata.clientName,
        projectName: stateFile.metadata.projectName,
        totalSize: stateFile.metadata.totalSize,
        uploadedSize: stateFile.progress.uploadedSize,
        chunkSize: stateFile.progress.chunkSize,
        lastChunkIndex: stateFile.progress.lastChunkIndex,
        checksumMD5: stateFile.integrity.expectedChecksum,
        startTime: new Date(stateFile.timing.startTime),
        lastActivity: new Date(stateFile.timing.lastActivity),
        status: stateFile.status.current,
        retryCount: stateFile.status.retryCount,
        maxRetries: stateFile.status.maxRetries,
      };

      return state;
    } catch (error) {
      console.error(`Failed to load upload state for ${uploadId}:`, error);
      return null;
    }
  }

  /**
   * Update upload progress
   */
  async updateUploadProgress(
    uploadId: string,
    uploadedSize: number
  ): Promise<void> {
    const state = await this.loadUploadState(uploadId);
    if (!state) {
      throw new Error(`Upload state not found for ID: ${uploadId}`);
    }

    state.uploadedSize = uploadedSize;
    state.lastActivity = new Date();

    await this.saveUploadState(state);
  }

  /**
   * Mark upload as completed
   */
  async markUploadComplete(uploadId: string): Promise<void> {
    const stateFilePath = path.join(this.statePath, `${uploadId}.json`);
    try {
      const data = await fs.readFile(stateFilePath, 'utf-8');
      const stateFile: UploadStateFile = JSON.parse(data);
      stateFile.status.current = 'completed';
      stateFile.timing.lastActivity = new Date();
      await fs.writeFile(stateFilePath, JSON.stringify(stateFile, null, 2));
    } catch {
      throw new Error(`Upload state not found for ID: ${uploadId}`);
    }
  }

  /**
   * Mark upload as failed
   */
  async markUploadFailed(uploadId: string, error: string): Promise<void> {
    const stateFilePath = path.join(this.statePath, `${uploadId}.json`);
    try {
      const data = await fs.readFile(stateFilePath, 'utf-8');
      const stateFile: UploadStateFile = JSON.parse(data);
      stateFile.status.current = 'failed';
      stateFile.status.retryCount = (stateFile.status.retryCount || 0) + 1;
      stateFile.status.lastError = error;
      stateFile.timing.lastActivity = new Date();
      await fs.writeFile(stateFilePath, JSON.stringify(stateFile, null, 2));
    } catch {
      throw new Error(`Upload state not found for ID: ${uploadId}`);
    }
  }

  /**
   * Clean up expired upload states
   */
  async cleanupExpiredUploads(maxAgeHours: number = 24): Promise<number> {
    try {
      await this.initialize();
      const files = await fs.readdir(this.statePath);
      const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
      let cleanedCount = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.statePath, file);
        try {
          const data = await fs.readFile(filePath, 'utf-8');
          const stateFile: UploadStateFile = JSON.parse(data);
          const lastActivity = new Date(stateFile.timing.lastActivity);

          if (
            lastActivity < cutoffTime &&
            (stateFile.status.current === 'completed' ||
              stateFile.status.current === 'failed')
          ) {
            await fs.unlink(filePath);
            cleanedCount++;
            console.log(
              `Cleaned up expired upload state: ${stateFile.uploadId}`
            );
          }
        } catch (error) {
          console.warn(`Failed to process state file ${file}:`, error);
        }
      }

      return cleanedCount;
    } catch (error) {
      console.error('Failed to cleanup expired uploads:', error);
      return 0;
    }
  }

  /**
   * Get all active upload states
   */
  async getActiveUploads(): Promise<UploadState[]> {
    try {
      await this.initialize();
      const files = await fs.readdir(this.statePath);
      const activeUploads: UploadState[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const uploadId = file.replace('.json', '');
        const state = await this.loadUploadState(uploadId);

        if (state && state.status === 'active') {
          activeUploads.push(state);
        }
      }

      return activeUploads;
    } catch (error) {
      console.error('Failed to get active uploads:', error);
      return [];
    }
  }

  /**
   * Delete upload state
   */
  async deleteUploadState(uploadId: string): Promise<boolean> {
    try {
      const stateFilePath = path.join(this.statePath, `${uploadId}.json`);
      await fs.unlink(stateFilePath);
      return true;
    } catch (error) {
      console.error(`Failed to delete upload state for ${uploadId}:`, error);
      return false;
    }
  }

  /**
   * Get upload state file path
   */
  getStateFilePath(uploadId: string): string {
    return path.join(this.statePath, `${uploadId}.json`);
  }

  /**
   * Check if upload state exists
   */
  async uploadStateExists(uploadId: string): Promise<boolean> {
    try {
      const stateFilePath = path.join(this.statePath, `${uploadId}.json`);
      await fs.access(stateFilePath);
      return true;
    } catch {
      return false;
    }
  }
}
