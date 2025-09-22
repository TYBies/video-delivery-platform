import { LocalStorage } from '../lib/storage';
import fs from 'fs/promises';

describe('LocalStorage with UUID', () => {
  let storage: LocalStorage;
  const testStoragePath = './test-uuid-uploads';

  beforeAll(async () => {
    // Set test environment
    process.env.STORAGE_PATH = testStoragePath;
    process.env.UPLOAD_MAX_SIZE = '1048576'; // 1MB for testing
    
    storage = new LocalStorage();
    
    // Create test directory
    await fs.mkdir(`${testStoragePath}/videos`, { recursive: true });
  });

  afterAll(async () => {
    // Clean up
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch (error) {
      console.log('Cleanup error (expected):', error);
    }
  });

  it('should save video with UUID and return metadata', async () => {
    const testBuffer = Buffer.from('test video content');
    
    const metadata = await storage.saveVideo(
      testBuffer,
      'test.mp4',
      'Test Client',
      'Test Project'
    );

    expect(metadata.id).toBeDefined();
    expect(typeof metadata.id).toBe('string');
    expect(metadata.id.length).toBeGreaterThan(0);
    expect(metadata.filename).toBe('test.mp4');
    expect(metadata.clientName).toBe('Test Client');
    expect(metadata.checksumMD5).toBeDefined();
  });
});