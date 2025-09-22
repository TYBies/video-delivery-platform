import { MetadataManager } from '../lib/metadata';
import { VideoMetadata } from '../types';
import fs from 'fs/promises';
import path from 'path';

describe('MetadataManager', () => {
  let metadataManager: MetadataManager;
  const testStoragePath = './test-uploads';
  
  const sampleMetadata: VideoMetadata = {
    id: 'test-video-123',
    filename: 'sample-video.mp4',
    clientName: 'Test Client',
    projectName: 'Test Project',
    uploadDate: new Date('2024-01-15T10:30:00Z'),
    fileSize: 1048576,
    downloadCount: 0,
    status: 'local',
    localPath: './test-uploads/videos/test-video-123/video.mp4',
    downloadUrl: '/download/test-video-123',
    isActive: true,
    checksumMD5: 'abc123def456'
  };

  beforeAll(async () => {
    metadataManager = new MetadataManager(testStoragePath);
    
    // Create test directory structure
    await fs.mkdir(path.join(testStoragePath, 'videos', 'test-video-123'), { recursive: true });
    await fs.mkdir(path.join(testStoragePath, 'metadata'), { recursive: true });
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch (error) {
      console.log('Cleanup error (expected):', error);
    }
  });

  describe('validateMetadata', () => {
    it('should validate correct metadata', () => {
      const result = metadataManager.validateMetadata(sampleMetadata);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject metadata with missing required fields', () => {
      const invalidMetadata = { ...sampleMetadata };
      delete (invalidMetadata as any).filename;
      
      const result = metadataManager.validateMetadata(invalidMetadata);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: filename');
    });

    it('should reject metadata with invalid status', () => {
      const invalidMetadata = { ...sampleMetadata, status: 'invalid-status' as any };
      
      const result = metadataManager.validateMetadata(invalidMetadata);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('status must be one of: local, backed-up, cloud-only');
    });
  });

  describe('saveMetadata and loadMetadata', () => {
    it('should save and load metadata correctly', async () => {
      await metadataManager.saveMetadata(sampleMetadata);
      
      const loaded = await metadataManager.loadMetadata('test-video-123');
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe('test-video-123');
      expect(loaded?.filename).toBe('sample-video.mp4');
      expect(loaded?.clientName).toBe('Test Client');
      expect(loaded?.uploadDate).toEqual(sampleMetadata.uploadDate);
    });

    it('should return null for non-existent metadata', async () => {
      const loaded = await metadataManager.loadMetadata('non-existent-id');
      expect(loaded).toBeNull();
    });
  });

  describe('updateMetadata', () => {
    it('should update existing metadata', async () => {
      await metadataManager.saveMetadata(sampleMetadata);
      
      const updated = await metadataManager.updateMetadata('test-video-123', {
        downloadCount: 5,
        status: 'backed-up'
      });
      
      expect(updated?.downloadCount).toBe(5);
      expect(updated?.status).toBe('backed-up');
    });

    it('should throw error for non-existent video', async () => {
      await expect(
        metadataManager.updateMetadata('non-existent', { downloadCount: 1 })
      ).rejects.toThrow('Video metadata not found');
    });
  });

  describe('getAllMetadata', () => {
    it('should return all videos from index', async () => {
      await metadataManager.saveMetadata(sampleMetadata);
      
      const allVideos = await metadataManager.getAllMetadata();
      expect(Array.isArray(allVideos)).toBe(true);
      expect(allVideos.length).toBeGreaterThan(0);
      expect(allVideos[0].id).toBe('test-video-123');
    });

    it('should return empty array when no videos exist', async () => {
      const emptyManager = new MetadataManager('./empty-test-path');
      const allVideos = await emptyManager.getAllMetadata();
      expect(Array.isArray(allVideos)).toBe(true);
      expect(allVideos.length).toBe(0);
    });
  });

  describe('search functions', () => {
    beforeEach(async () => {
      await metadataManager.saveMetadata(sampleMetadata);
    });

    it('should find videos by client name', async () => {
      const videos = await metadataManager.getVideosByClient('Test Client');
      expect(videos.length).toBeGreaterThan(0);
      expect(videos[0].clientName).toBe('Test Client');
    });

    it('should find videos by project name', async () => {
      const videos = await metadataManager.getVideosByProject('Test Project');
      expect(videos.length).toBeGreaterThan(0);
      expect(videos[0].projectName).toBe('Test Project');
    });

    it('should find videos by status', async () => {
      const videos = await metadataManager.getVideosByStatus('local');
      expect(videos.length).toBeGreaterThan(0);
      expect(videos[0].status).toBe('local');
    });

    it('should find active videos only', async () => {
      const videos = await metadataManager.getActiveVideos();
      expect(videos.length).toBeGreaterThan(0);
      expect(videos[0].isActive).toBe(true);
    });
  });

  describe('utility functions', () => {
    beforeEach(async () => {
      await metadataManager.saveMetadata(sampleMetadata);
    });

    it('should increment download count', async () => {
      await metadataManager.incrementDownloadCount('test-video-123');
      
      const updated = await metadataManager.loadMetadata('test-video-123');
      expect(updated?.downloadCount).toBe(1);
    });

    it('should update video status', async () => {
      await metadataManager.updateVideoStatus('test-video-123', 'backed-up');
      
      const updated = await metadataManager.loadMetadata('test-video-123');
      expect(updated?.status).toBe('backed-up');
    });

    it('should set video active/inactive', async () => {
      await metadataManager.setVideoActive('test-video-123', false);
      
      const updated = await metadataManager.loadMetadata('test-video-123');
      expect(updated?.isActive).toBe(false);
    });
  });
});