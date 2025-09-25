import { OrphanRecoveryService } from '../lib/orphan-recovery-service';
import { OrphanFile } from '../types';
import fs from 'fs/promises';
import path from 'path';
import { beforeEach, afterEach, describe, it, expect } from '@jest/globals';

describe('OrphanRecoveryService', () => {
  let service: OrphanRecoveryService;
  let testStoragePath: string;

  beforeEach(async () => {
    testStoragePath = path.join(__dirname, 'test-recovery');
    // Provide a silent logger for testing to prevent console output
    const silentLogger = {
      log: () => {},
      error: () => {},
      warn: () => {},
    };
    service = new OrphanRecoveryService(testStoragePath, silentLogger);
    await service.initialize();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  const createTestOrphanFile = async (
    videoId: string,
    filename: string = 'video.mp4'
  ): Promise<OrphanFile> => {
    const videoDir = path.join(testStoragePath, 'videos', videoId);
    await fs.mkdir(videoDir, { recursive: true });

    const videoPath = path.join(videoDir, filename);
    const testContent = 'fake video content for testing';
    await fs.writeFile(videoPath, testContent);

    const stats = await fs.stat(videoPath);

    return {
      path: videoPath,
      size: stats.size,
      createdDate: stats.birthtime,
      videoId: videoId,
    };
  };

  const createTestVideoWithMetadata = async (
    videoId: string
  ): Promise<void> => {
    const videoDir = path.join(testStoragePath, 'videos', videoId);
    await fs.mkdir(videoDir, { recursive: true });

    // Create video file
    const videoPath = path.join(videoDir, 'video.mp4');
    await fs.writeFile(videoPath, 'fake video content');

    // Create metadata file
    const metadataPath = path.join(videoDir, 'metadata.json');
    const metadata = {
      id: videoId,
      filename: 'video.mp4',
      clientName: 'test-client',
      projectName: 'test-project',
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  };

  describe('scanForOrphans', () => {
    it('should find orphaned video files', async () => {
      // Create orphaned file
      await createTestOrphanFile('orphan-1', 'test-video.mp4');

      // Create file with metadata (not orphaned)
      await createTestVideoWithMetadata('not-orphan-1');

      const orphans = await service.scanForOrphans();

      expect(orphans).toHaveLength(1);
      expect(orphans[0].videoId).toBe('orphan-1');
      expect(orphans[0].path).toContain('test-video.mp4');
    });

    it('should handle multiple orphaned files', async () => {
      await createTestOrphanFile('orphan-1', 'video1.mp4');
      await createTestOrphanFile('orphan-2', 'video2.mov');
      await createTestOrphanFile('orphan-3', 'video3.avi');

      const orphans = await service.scanForOrphans();

      expect(orphans).toHaveLength(3);
      const videoIds = orphans.map((o) => o.videoId);
      expect(videoIds).toContain('orphan-1');
      expect(videoIds).toContain('orphan-2');
      expect(videoIds).toContain('orphan-3');
    });

    it('should ignore non-video files', async () => {
      const videoDir = path.join(testStoragePath, 'videos', 'test-dir');
      await fs.mkdir(videoDir, { recursive: true });

      // Create non-video files
      await fs.writeFile(path.join(videoDir, 'readme.txt'), 'text file');
      await fs.writeFile(path.join(videoDir, 'image.jpg'), 'image file');

      const orphans = await service.scanForOrphans();

      expect(orphans).toHaveLength(0);
    });

    it('should handle empty videos directory', async () => {
      const orphans = await service.scanForOrphans();
      expect(orphans).toHaveLength(0);
    });
  });

  describe('validateOrphanFile', () => {
    it('should validate legitimate video files', async () => {
      const orphan = await createTestOrphanFile('test-orphan', 'video.mp4');

      const isValid = await service.validateOrphanFile(orphan);

      expect(isValid).toBe(true);
    });

    it('should reject files with invalid extensions', async () => {
      const orphan = await createTestOrphanFile('test-orphan', 'document.txt');

      const isValid = await service.validateOrphanFile(orphan);

      expect(isValid).toBe(false);
    });

    it('should reject very small files', async () => {
      const videoDir = path.join(testStoragePath, 'videos', 'tiny-file');
      await fs.mkdir(videoDir, { recursive: true });

      const videoPath = path.join(videoDir, 'tiny.mp4');
      await fs.writeFile(videoPath, 'x'); // 1 byte file

      const stats = await fs.stat(videoPath);
      const orphan: OrphanFile = {
        path: videoPath,
        size: stats.size,
        createdDate: stats.birthtime,
        videoId: 'tiny-file',
      };

      const isValid = await service.validateOrphanFile(orphan);

      expect(isValid).toBe(false);
    });

    it('should handle non-existent files', async () => {
      const orphan: OrphanFile = {
        path: '/non/existent/file.mp4',
        size: 1000,
        createdDate: new Date(),
        videoId: 'non-existent',
      };

      const isValid = await service.validateOrphanFile(orphan);

      expect(isValid).toBe(false);
    });
  });

  describe('reconstructMetadata', () => {
    it('should reconstruct metadata from orphan file', async () => {
      const orphan = await createTestOrphanFile(
        'test-orphan',
        'client-project-video.mp4'
      );

      const metadata = await service.reconstructMetadata(orphan);

      expect(metadata).not.toBeNull();
      expect(metadata!.id).toBe('test-orphan');
      expect(metadata!.filename).toBe('client-project-video.mp4');
      expect(metadata!.clientName).toBe('client');
      expect(metadata!.projectName).toBe('project');
      expect(metadata!.fileSize).toBe(orphan.size);
      expect(metadata!.status).toBe('local');
      expect(metadata!.isActive).toBe(true);
      expect(metadata!.downloadUrl).toBe('/download/test-orphan');
      expect(metadata!.checksumMD5).toBeDefined();
    });

    it('should handle simple filenames', async () => {
      const orphan = await createTestOrphanFile('simple-orphan', 'video.mp4');

      const metadata = await service.reconstructMetadata(orphan);

      expect(metadata).not.toBeNull();
      expect(metadata!.clientName).toBe('recovered');
      expect(metadata!.projectName).toBe('recovered');
    });

    it('should handle file access errors', async () => {
      const orphan: OrphanFile = {
        path: '/non/existent/file.mp4',
        size: 1000,
        createdDate: new Date(),
        videoId: 'non-existent',
      };

      const metadata = await service.reconstructMetadata(orphan);

      expect(metadata).toBeNull();
    });
  });

  describe('recoverOrphan', () => {
    it('should successfully recover valid orphan', async () => {
      const orphan = await createTestOrphanFile(
        'recoverable-orphan',
        'test-video.mp4'
      );

      const metadata = await service.recoverOrphan(orphan);

      expect(metadata).not.toBeNull();
      expect(metadata!.id).toBe('recoverable-orphan');
      expect(metadata!.filename).toBe('test-video.mp4');

      // Check that metadata was saved
      const metadataPath = path.join(
        testStoragePath,
        'videos',
        'recoverable-orphan',
        'metadata.json'
      );
      const exists = await fs
        .access(metadataPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should fail to recover invalid orphan', async () => {
      const orphan = await createTestOrphanFile(
        'invalid-orphan',
        'document.txt'
      );

      const metadata = await service.recoverOrphan(orphan);

      expect(metadata).toBeNull();
    });

    it('should update orphan registry on recovery', async () => {
      const orphan = await createTestOrphanFile('registry-test', 'video.mp4');

      await service.recoverOrphan(orphan);

      const registry = await service.getOrphanRegistry();
      expect(registry.orphans['registry-test']).toBeDefined();
      expect(registry.orphans['registry-test'].recoveryStatus).toBe(
        'recovered'
      );
      expect(registry.orphans['registry-test'].recoveryAttempts).toBe(1);
    });
  });

  describe('recoverAllOrphans', () => {
    it('should recover multiple orphans', async () => {
      await createTestOrphanFile('orphan-1', 'video1.mp4');
      await createTestOrphanFile('orphan-2', 'video2.mov');
      await createTestOrphanFile('orphan-3', 'invalid.txt'); // This should fail

      const result = await service.recoverAllOrphans();

      expect(result.recovered).toBe(2);
      expect(result.failed).toBe(1);
    });

    it('should handle empty orphan list', async () => {
      const result = await service.recoverAllOrphans();

      expect(result.recovered).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('cleanupInvalidOrphans', () => {
    it('should move invalid orphans to cleanup directory', async () => {
      // Create invalid orphan
      const videoDir = path.join(testStoragePath, 'videos', 'invalid-orphan');
      await fs.mkdir(videoDir, { recursive: true });
      const invalidPath = path.join(videoDir, 'document.txt');
      await fs.writeFile(invalidPath, 'not a video');

      const cleanedCount = await service.cleanupInvalidOrphans();

      expect(cleanedCount).toBe(1);

      // Check that file was moved to cleanup directory
      const cleanupDir = path.join(testStoragePath, 'recovery', 'invalid');
      const files = await fs.readdir(cleanupDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toContain('invalid-orphan_document.txt');
    });

    it('should not affect valid orphans', async () => {
      await createTestOrphanFile('valid-orphan', 'video.mp4');

      const cleanedCount = await service.cleanupInvalidOrphans();

      expect(cleanedCount).toBe(0);

      // Check that valid orphan still exists
      const videoPath = path.join(
        testStoragePath,
        'videos',
        'valid-orphan',
        'video.mp4'
      );
      const exists = await fs
        .access(videoPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });
});
