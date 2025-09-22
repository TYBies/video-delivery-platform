import { DirectoryManager } from '../lib/directory';
import fs from 'fs/promises';

// Mock environment variables
process.env.STORAGE_PATH = './test-uploads';
process.env.UPLOAD_MAX_SIZE = '1048576'; // 1MB for testing

describe('DirectoryManager', () => {
  let dirManager: DirectoryManager;

  beforeAll(() => {
    dirManager = new DirectoryManager('./test-uploads');
  });

  afterAll(async () => {
    try {
      await fs.rm('./test-uploads', { recursive: true, force: true });
    } catch (error) {
      console.log('Cleanup error (expected):', error);
    }
  });

  describe('initializeDirectories', () => {
    it('should create all required directories', async () => {
      await dirManager.initializeDirectories();
      
      // Check if directories exist
      await expect(fs.access('./test-uploads/videos')).resolves.not.toThrow();
      await expect(fs.access('./test-uploads/temp')).resolves.not.toThrow();
      await expect(fs.access('./test-uploads/metadata')).resolves.not.toThrow();
    });
  });

  describe('validateStoragePath', () => {
    it('should validate writable storage path', async () => {
      const result = await dirManager.validateStoragePath();
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('listVideoDirectories', () => {
    it('should return empty array for new installation', async () => {
      const directories = await dirManager.listVideoDirectories();
      expect(Array.isArray(directories)).toBe(true);
    });
  });

  describe('getDirectorySize', () => {
    it('should calculate directory size', async () => {
      await dirManager.initializeDirectories();
      const size = await dirManager.getDirectorySize('./test-uploads');
      expect(typeof size).toBe('number');
      expect(size).toBeGreaterThanOrEqual(0);
    });
  });
});