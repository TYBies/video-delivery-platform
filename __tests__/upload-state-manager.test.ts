import { UploadStateManager } from '../lib/upload-state-manager';
import { UploadState } from '../types';
import fs from 'fs/promises';
import path from 'path';
import { beforeEach, afterEach, describe, it, expect } from '@jest/globals';

describe('UploadStateManager', () => {
  let manager: UploadStateManager;
  let testStoragePath: string;

  beforeEach(async () => {
    testStoragePath = path.join(__dirname, 'test-uploads');
    manager = new UploadStateManager(testStoragePath);
    await manager.initialize();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  const createTestUploadState = (): UploadState => ({
    uploadId: 'test-upload-123',
    videoId: 'video-456',
    filename: 'test-video.mp4',
    clientName: 'test-client',
    projectName: 'test-project',
    totalSize: 1000000,
    uploadedSize: 500000,
    chunkSize: 1024 * 1024,
    lastChunkIndex: 0,
    checksumMD5: 'abc123def456',
    startTime: new Date('2023-01-01T10:00:00Z'),
    lastActivity: new Date('2023-01-01T10:30:00Z'),
    status: 'active',
    retryCount: 0,
    maxRetries: 3,
  });

  describe('saveUploadState', () => {
    it('should save upload state to file', async () => {
      const state = createTestUploadState();
      
      await manager.saveUploadState(state);
      
      const stateFilePath = manager.getStateFilePath(state.uploadId);
      const exists = await fs.access(stateFilePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create state directory if it does not exist', async () => {
      // Remove the state directory
      const statePath = path.join(testStoragePath, 'state');
      await fs.rm(statePath, { recursive: true, force: true });
      
      const state = createTestUploadState();
      await manager.saveUploadState(state);
      
      const exists = await fs.access(statePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('loadUploadState', () => {
    it('should load saved upload state', async () => {
      const originalState = createTestUploadState();
      await manager.saveUploadState(originalState);
      
      const loadedState = await manager.loadUploadState(originalState.uploadId);
      
      expect(loadedState).not.toBeNull();
      expect(loadedState!.uploadId).toBe(originalState.uploadId);
      expect(loadedState!.videoId).toBe(originalState.videoId);
      expect(loadedState!.filename).toBe(originalState.filename);
      expect(loadedState!.totalSize).toBe(originalState.totalSize);
      expect(loadedState!.uploadedSize).toBe(originalState.uploadedSize);
      expect(loadedState!.status).toBe(originalState.status);
    });

    it('should return null for non-existent upload state', async () => {
      const loadedState = await manager.loadUploadState('non-existent-id');
      expect(loadedState).toBeNull();
    });

    it('should handle corrupted state files', async () => {
      const uploadId = 'corrupted-upload';
      const stateFilePath = manager.getStateFilePath(uploadId);
      
      // Write invalid JSON
      await fs.writeFile(stateFilePath, 'invalid json content');
      
      const loadedState = await manager.loadUploadState(uploadId);
      expect(loadedState).toBeNull();
    });
  });

  describe('updateUploadProgress', () => {
    it('should update upload progress', async () => {
      const state = createTestUploadState();
      await manager.saveUploadState(state);
      
      const newUploadedSize = 750000;
      await manager.updateUploadProgress(state.uploadId, newUploadedSize);
      
      const updatedState = await manager.loadUploadState(state.uploadId);
      expect(updatedState!.uploadedSize).toBe(newUploadedSize);
      expect(updatedState!.lastActivity.getTime()).toBeGreaterThan(state.lastActivity.getTime());
    });

    it('should throw error for non-existent upload', async () => {
      await expect(manager.updateUploadProgress('non-existent', 1000))
        .rejects.toThrow('Upload state not found for ID: non-existent');
    });
  });

  describe('markUploadComplete', () => {
    it('should mark upload as completed', async () => {
      const state = createTestUploadState();
      await manager.saveUploadState(state);
      
      await manager.markUploadComplete(state.uploadId);
      
      const updatedState = await manager.loadUploadState(state.uploadId);
      expect(updatedState!.status).toBe('completed');
    });
  });

  describe('markUploadFailed', () => {
    it('should mark upload as failed with error message', async () => {
      const state = createTestUploadState();
      await manager.saveUploadState(state);
      
      const errorMessage = 'Network connection lost';
      await manager.markUploadFailed(state.uploadId, errorMessage);
      
      const updatedState = await manager.loadUploadState(state.uploadId);
      expect(updatedState!.status).toBe('failed');
      expect(updatedState!.retryCount).toBe(1);
      
      // Check that error is stored in the state file
      const stateFilePath = manager.getStateFilePath(state.uploadId);
      const data = await fs.readFile(stateFilePath, 'utf-8');
      const stateFile = JSON.parse(data);
      expect(stateFile.status.lastError).toBe(errorMessage);
    });
  });

  describe('cleanupExpiredUploads', () => {
    it('should clean up expired completed uploads', async () => {
      const oldState = createTestUploadState();
      oldState.uploadId = 'old-upload';
      oldState.status = 'completed';
      oldState.lastActivity = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      
      await manager.saveUploadState(oldState);
      
      const cleanedCount = await manager.cleanupExpiredUploads(24);
      expect(cleanedCount).toBe(1);
      
      const loadedState = await manager.loadUploadState(oldState.uploadId);
      expect(loadedState).toBeNull();
    });

    it('should not clean up active uploads', async () => {
      const activeState = createTestUploadState();
      activeState.status = 'active';
      activeState.lastActivity = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      
      await manager.saveUploadState(activeState);
      
      const cleanedCount = await manager.cleanupExpiredUploads(24);
      expect(cleanedCount).toBe(0);
      
      const loadedState = await manager.loadUploadState(activeState.uploadId);
      expect(loadedState).not.toBeNull();
    });
  });

  describe('getActiveUploads', () => {
    it('should return only active uploads', async () => {
      const activeState1 = createTestUploadState();
      activeState1.uploadId = 'active-1';
      activeState1.status = 'active';
      
      const activeState2 = createTestUploadState();
      activeState2.uploadId = 'active-2';
      activeState2.status = 'active';
      
      const completedState = createTestUploadState();
      completedState.uploadId = 'completed-1';
      completedState.status = 'completed';
      
      await manager.saveUploadState(activeState1);
      await manager.saveUploadState(activeState2);
      await manager.saveUploadState(completedState);
      
      const activeUploads = await manager.getActiveUploads();
      expect(activeUploads).toHaveLength(2);
      expect(activeUploads.map(u => u.uploadId)).toContain('active-1');
      expect(activeUploads.map(u => u.uploadId)).toContain('active-2');
      expect(activeUploads.map(u => u.uploadId)).not.toContain('completed-1');
    });
  });

  describe('uploadStateExists', () => {
    it('should return true for existing upload state', async () => {
      const state = createTestUploadState();
      await manager.saveUploadState(state);
      
      const exists = await manager.uploadStateExists(state.uploadId);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent upload state', async () => {
      const exists = await manager.uploadStateExists('non-existent');
      expect(exists).toBe(false);
    });
  });

  describe('deleteUploadState', () => {
    it('should delete upload state file', async () => {
      const state = createTestUploadState();
      await manager.saveUploadState(state);
      
      const deleted = await manager.deleteUploadState(state.uploadId);
      expect(deleted).toBe(true);
      
      const exists = await manager.uploadStateExists(state.uploadId);
      expect(exists).toBe(false);
    });

    it('should return false for non-existent upload state', async () => {
      const deleted = await manager.deleteUploadState('non-existent');
      expect(deleted).toBe(false);
    });
  });
});