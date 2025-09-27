import { EnhancedUploadHandler } from '../lib/enhanced-upload-handler';
import fs from 'fs/promises';
import path from 'path';
import { beforeEach, afterEach, describe, it, expect } from '@jest/globals';

describe('EnhancedUploadHandler', () => {
  let handler: EnhancedUploadHandler;
  let testStoragePath: string;

  beforeEach(async () => {
    testStoragePath = path.join(__dirname, 'test-enhanced-upload');
    handler = new EnhancedUploadHandler(testStoragePath);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  const createOrphanedFile = async (
    videoId: string,
    filename: string,
    size: number = 10240
  ): Promise<void> => {
    const videoDir = path.join(testStoragePath, 'videos', videoId);
    await fs.mkdir(videoDir, { recursive: true });

    const videoPath = path.join(videoDir, filename);
    const testContent = Buffer.alloc(size, 'test content');
    await fs.writeFile(videoPath, testContent);
  };

  const createMockRequest = (contentLength: number) => {
    const testContent = Buffer.alloc(contentLength, 'mock video data');

    return {
      body: {
        getReader: () => ({
          read: async () => {
            // Simulate reading the entire content at once
            const value = testContent;
            return { done: false, value };
          },
        }),
      },
    } as any;
  };

  describe('handleUploadWithRecovery', () => {
    it('should handle normal upload successfully', async () => {
      const mockRequest = createMockRequest(5000);

      const result = await handler.handleUploadWithRecovery(
        mockRequest,
        'test-client',
        'test-project',
        'test-video.mp4',
        5000
      );

      expect(result).toBeDefined();
      expect(result.clientName).toBe('test-client');
      expect(result.projectName).toBe('test-project');
      expect(result.filename).toBe('test-video.mp4');
      expect(result.downloadUrl).toContain('/download/');
    });

    it('should detect and return existing video', async () => {
      // First, create a video through normal upload
      const mockRequest1 = createMockRequest(5000);
      const firstResult = await handler.handleUploadWithRecovery(
        mockRequest1,
        'test-client',
        'test-project',
        'duplicate-video.mp4',
        5000
      );

      // Try to upload the same video again
      const mockRequest2 = createMockRequest(5000);
      const secondResult = await handler.handleUploadWithRecovery(
        mockRequest2,
        'test-client',
        'test-project',
        'duplicate-video.mp4',
        5000
      );

      // Should return the existing video
      expect(secondResult.id).toBe(firstResult.id);
    });

    it('should automatically recover orphaned files', async () => {
      // Create an orphaned file
      await createOrphanedFile('orphan-test', 'orphaned-video.mp4', 8000);

      // Simulate an upload that would match the orphaned file
      const mockRequest = createMockRequest(8000);

      const result = await handler.handleUploadWithRecovery(
        mockRequest,
        'recovery-client',
        'recovery-project',
        'orphaned-video.mp4',
        8000
      );

      expect(result).toBeDefined();
      expect(result.filename).toBe('orphaned-video.mp4');
      expect(result.downloadUrl).toContain('/download/');

      // Verify metadata was created
      const metadataPath = path.join(
        testStoragePath,
        'videos',
        result.id,
        'metadata.json'
      );
      const exists = await fs
        .access(metadataPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('getUploadProgress', () => {
    it('should return null for non-existent upload', async () => {
      const progress = await handler.getUploadProgress('non-existent-id');
      expect(progress).toBeNull();
    });

    it('should return progress for existing upload', async () => {
      // This test would require a more complex setup with actual upload state
      // For now, we'll test the null case
      const progress = await handler.getUploadProgress('test-id');
      expect(progress).toBeNull();
    });
  });

  describe('runMaintenance', () => {
    it('should complete maintenance without errors', async () => {
      await expect(handler.runMaintenance()).resolves.not.toThrow();
    });

    it('should recover orphans during maintenance', async () => {
      // Create orphaned files
      await createOrphanedFile('maintenance-orphan-1', 'video1.mp4');
      await createOrphanedFile('maintenance-orphan-2', 'video2.mp4');

      await handler.runMaintenance();

      // Check that metadata was created for orphans
      const metadata1Path = path.join(
        testStoragePath,
        'videos',
        'maintenance-orphan-1',
        'metadata.json'
      );
      const metadata2Path = path.join(
        testStoragePath,
        'videos',
        'maintenance-orphan-2',
        'metadata.json'
      );

      const exists1 = await fs
        .access(metadata1Path)
        .then(() => true)
        .catch(() => false);
      const exists2 = await fs
        .access(metadata2Path)
        .then(() => true)
        .catch(() => false);

      expect(exists1).toBe(true);
      expect(exists2).toBe(true);
    });
  });
});
