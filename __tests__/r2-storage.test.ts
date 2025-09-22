import { R2Storage } from '../lib/r2-storage';
import { R2Client } from '../lib/r2-client';
import { VideoMetadata } from '../types';

// Mock the R2Client and AWS SDK
jest.mock('../lib/r2-client');
jest.mock('@aws-sdk/client-s3');

describe('R2Storage', () => {
  let r2Storage: R2Storage;
  let mockR2Client: jest.Mocked<R2Client>;
  let mockS3Client: any;

  const sampleMetadata: VideoMetadata = {
    id: 'test-video-123',
    filename: 'sample-video.mp4',
    clientName: 'Test Client',
    projectName: 'Test Project',
    uploadDate: new Date('2024-01-15T10:30:00Z'),
    fileSize: 1048576,
    downloadCount: 0,
    status: 'local',
    localPath: './uploads/videos/test-video-123/video.mp4',
    downloadUrl: '/download/test-video-123',
    isActive: true,
    checksumMD5: 'abc123def456'
  };

  beforeEach(() => {
    // Mock S3 client methods
    mockS3Client = {
      send: jest.fn()
    };

    // Mock R2Client
    mockR2Client = {
      getClient: jest.fn().mockReturnValue(mockS3Client),
      getBucket: jest.fn().mockReturnValue('test-bucket'),
      getConfig: jest.fn(),
      validateConfig: jest.fn(),
      testConnection: jest.fn(),
      getEndpointUrl: jest.fn(),
      getPublicUrl: jest.fn(),
      destroy: jest.fn()
    } as any;

    (R2Client as jest.MockedClass<typeof R2Client>).mockImplementation(() => mockR2Client);

    r2Storage = new R2Storage(mockR2Client);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadVideo', () => {
    it('should successfully upload video to R2', async () => {
      const testBuffer = Buffer.from('test video content');
      
      // Mock successful upload
      mockS3Client.send.mockResolvedValue({
        ETag: '"abc123"'
      });

      const result = await r2Storage.uploadVideo('test-video-123', testBuffer, sampleMetadata);

      expect(result.success).toBe(true);
      expect(result.r2Path).toBe('videos/test-video-123/video.mp4');
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    });

    it('should handle upload errors gracefully', async () => {
      const testBuffer = Buffer.from('test video content');
      
      // Mock upload failure
      mockS3Client.send.mockRejectedValue(new Error('Upload failed'));

      const result = await r2Storage.uploadVideo('test-video-123', testBuffer, sampleMetadata);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('videoExists', () => {
    it('should return true when video exists', async () => {
      // Mock successful head object
      mockS3Client.send.mockResolvedValue({
        ContentLength: 1048576
      });

      const result = await r2Storage.videoExists('test-video-123');

      expect(result.exists).toBe(true);
      expect(result.r2Path).toBe('videos/test-video-123/video.mp4');
    });

    it('should return false when video does not exist', async () => {
      // Mock head object failure for all extensions
      mockS3Client.send.mockRejectedValue(new Error('Not found'));

      const result = await r2Storage.videoExists('non-existent-video');

      expect(result.exists).toBe(false);
    });
  });

  describe('deleteVideo', () => {
    it('should successfully delete video from R2', async () => {
      // Mock successful delete
      mockS3Client.send.mockResolvedValue({});

      const result = await r2Storage.deleteVideo('test-video-123');

      expect(result.success).toBe(true);
      expect(mockS3Client.send).toHaveBeenCalled();
    });

    it('should handle delete errors gracefully', async () => {
      // Mock delete failure for all extensions
      mockS3Client.send.mockRejectedValue(new Error('Delete failed'));

      const result = await r2Storage.deleteVideo('test-video-123');

      expect(result.success).toBe(false);
    });
  });

  describe('listVideos', () => {
    it('should successfully list videos from R2', async () => {
      const mockVideos = [
        {
          Key: 'videos/video1/video.mp4',
          Size: 1048576,
          LastModified: new Date('2024-01-15T10:30:00Z')
        },
        {
          Key: 'videos/video2/video.mov',
          Size: 2097152,
          LastModified: new Date('2024-01-16T10:30:00Z')
        }
      ];

      // Mock successful list
      mockS3Client.send.mockResolvedValue({
        Contents: mockVideos
      });

      const result = await r2Storage.listVideos();

      expect(result.success).toBe(true);
      expect(result.videos).toHaveLength(2);
      expect(result.videos![0].key).toBe('videos/video1/video.mp4');
      expect(result.videos![0].size).toBe(1048576);
    });

    it('should handle empty list gracefully', async () => {
      // Mock empty list
      mockS3Client.send.mockResolvedValue({
        Contents: []
      });

      const result = await r2Storage.listVideos();

      expect(result.success).toBe(true);
      expect(result.videos).toHaveLength(0);
    });
  });

  describe('getStorageStats', () => {
    it('should calculate storage statistics correctly', async () => {
      const mockVideos = [
        {
          Key: 'videos/video1/video.mp4',
          Size: 1048576,
          LastModified: new Date()
        },
        {
          Key: 'videos/video2/video.mov',
          Size: 2097152,
          LastModified: new Date()
        }
      ];

      // Mock successful list
      mockS3Client.send.mockResolvedValue({
        Contents: mockVideos
      });

      const result = await r2Storage.getStorageStats();

      expect(result.success).toBe(true);
      expect(result.totalSize).toBe(3145728); // 1048576 + 2097152
      expect(result.videoCount).toBe(2);
    });
  });

  describe('testConnection', () => {
    it('should successfully test R2 connection', async () => {
      // Mock successful list (connection test)
      mockS3Client.send.mockResolvedValue({
        Contents: []
      });

      const result = await r2Storage.testConnection();

      expect(result.success).toBe(true);
    });

    it('should handle connection failure', async () => {
      // Mock connection failure
      mockS3Client.send.mockRejectedValue(new Error('Connection failed'));

      const result = await r2Storage.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Content Type Detection', () => {
    it('should successfully upload videos with different formats', async () => {
      const testBuffer = Buffer.from('test video content');
      
      // Mock successful upload
      mockS3Client.send.mockResolvedValue({ ETag: '"abc123"' });

      // Test different video formats
      const formats = ['video.mp4', 'video.mov', 'video.avi', 'video.mkv', 'video.webm'];

      for (const filename of formats) {
        const metadata = { ...sampleMetadata, filename };
        const result = await r2Storage.uploadVideo('test-video', testBuffer, metadata);

        expect(result.success).toBe(true);
        expect(mockS3Client.send).toHaveBeenCalled();
      }
    });
  });
});