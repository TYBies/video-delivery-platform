import { StartupService } from '../lib/startup-service';
import fs from 'fs/promises';
import path from 'path';
import { beforeEach, afterEach, describe, it, expect } from '@jest/globals';

describe('StartupService', () => {
  let service: StartupService;
  let testStoragePath: string;

  beforeEach(async () => {
    testStoragePath = path.join(__dirname, 'test-startup');
    service = new StartupService(testStoragePath);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  const createTestOrphanFile = async (videoId: string, filename: string = 'video.mp4'): Promise<void> => {
    const videoDir = path.join(testStoragePath, 'videos', videoId);
    await fs.mkdir(videoDir, { recursive: true });
    
    const videoPath = path.join(videoDir, filename);
    const testContent = 'fake video content for testing';
    await fs.writeFile(videoPath, testContent);
  };

  const createExpiredUploadState = async (uploadId: string): Promise<void> => {
    const stateDir = path.join(testStoragePath, 'state');
    await fs.mkdir(stateDir, { recursive: true });
    
    const stateFile = {
      uploadId,
      videoId: 'test-video',
      metadata: {
        filename: 'test.mp4',
        clientName: 'test',
        projectName: 'test',
        totalSize: 1000,
      },
      progress: {
        uploadedSize: 1000,
        chunkSize: 1024,
        lastChunkIndex: 0,
        completedChunks: [],
      },
      integrity: {
        chunkChecksums: {},
      },
      timing: {
        startTime: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
        lastActivity: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
      status: {
        current: 'completed',
        retryCount: 0,
        maxRetries: 3,
      },
    };
    
    const stateFilePath = path.join(stateDir, `${uploadId}.json`);
    await fs.writeFile(stateFilePath, JSON.stringify(stateFile, null, 2));
  };

  describe('runStartupTasks', () => {
    it('should complete startup tasks without errors', async () => {
      await expect(service.runStartupTasks()).resolves.not.toThrow();
    });

    it('should recover orphaned files during startup', async () => {
      // Create orphaned file
      await createTestOrphanFile('startup-orphan', 'test-video.mp4');
      
      await service.runStartupTasks();
      
      // Check that metadata was created
      const metadataPath = path.join(testStoragePath, 'videos', 'startup-orphan', 'metadata.json');
      const exists = await fs.access(metadataPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should clean up expired upload states during startup', async () => {
      // Create expired upload state
      await createExpiredUploadState('expired-upload');
      
      await service.runStartupTasks();
      
      // Check that expired state was cleaned up
      const stateFilePath = path.join(testStoragePath, 'state', 'expired-upload.json');
      const exists = await fs.access(stateFilePath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should handle startup tasks with no work to do', async () => {
      // No orphans or expired states
      await expect(service.runStartupTasks()).resolves.not.toThrow();
    });
  });

  describe('getSystemHealth', () => {
    it('should return healthy status with no issues', async () => {
      const health = await service.getSystemHealth();
      
      expect(health.systemStatus).toBe('healthy');
      expect(health.activeUploads).toBe(0);
      expect(health.orphanedFiles).toBe(0);
    });

    it('should return warning status with orphaned files', async () => {
      // Create orphaned file
      await createTestOrphanFile('health-orphan', 'video.mp4');
      
      const health = await service.getSystemHealth();
      
      expect(health.systemStatus).toBe('warning');
      expect(health.orphanedFiles).toBe(1);
    });

    it('should count active uploads correctly', async () => {
      // Create active upload state
      const stateDir = path.join(testStoragePath, 'state');
      await fs.mkdir(stateDir, { recursive: true });
      
      const activeStateFile = {
        uploadId: 'active-upload',
        videoId: 'test-video',
        metadata: {
          filename: 'test.mp4',
          clientName: 'test',
          projectName: 'test',
          totalSize: 1000,
        },
        progress: {
          uploadedSize: 500,
          chunkSize: 1024,
          lastChunkIndex: 0,
          completedChunks: [],
        },
        integrity: {
          chunkChecksums: {},
        },
        timing: {
          startTime: new Date(),
          lastActivity: new Date(),
        },
        status: {
          current: 'active',
          retryCount: 0,
          maxRetries: 3,
        },
      };
      
      const stateFilePath = path.join(stateDir, 'active-upload.json');
      await fs.writeFile(stateFilePath, JSON.stringify(activeStateFile, null, 2));
      
      const health = await service.getSystemHealth();
      
      expect(health.activeUploads).toBe(1);
    });

    it('should handle errors gracefully', async () => {
      // Create service with invalid path to trigger errors
      const invalidService = new StartupService('/invalid/path/that/does/not/exist');
      
      const health = await invalidService.getSystemHealth();
      
      expect(health.systemStatus).toBe('error');
      expect(health.activeUploads).toBe(0);
      expect(health.orphanedFiles).toBe(0);
      expect(health.lastOrphanScan).toBeNull();
    });
  });
});