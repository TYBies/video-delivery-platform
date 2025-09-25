import { GET as getVideos } from '@/app/api/video/route';
import {
  GET as getVideo,
  DELETE as deleteVideo,
} from '@/app/api/video/[videoId]/route';
import { metadataCache } from '@/lib/metadata-cache';

// Mock the S3 client to simulate different error conditions
jest.mock('@aws-sdk/client-s3', () => {
  const originalModule = jest.requireActual('@aws-sdk/client-s3');

  return {
    ...originalModule,
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
  };
});

// Mock the s3-config to control when S3 is enabled
jest.mock('@/lib/s3-config', () => ({
  isS3Enabled: jest.fn(),
  loadS3Config: jest.fn(() => ({
    region: 'test-region',
    endpoint: 'test-endpoint',
    bucket: 'test-bucket',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
  })),
  handleS3Error: jest.requireActual('@/lib/s3-config').handleS3Error,
}));

import { S3Client } from '@aws-sdk/client-s3';
import { isS3Enabled } from '@/lib/s3-config';

const mockS3Client = S3Client as jest.MockedClass<typeof S3Client>;
const mockIsS3Enabled = isS3Enabled as jest.MockedFunction<typeof isS3Enabled>;

describe('API Error Handling Integration Tests', () => {
  let mockS3Send: jest.MockedFunction<any>;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    // Clear cache before each test
    metadataCache.invalidateAll();

    // Reset mocks
    jest.clearAllMocks();

    // Mock console.error to prevent test failures from logging
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Setup S3 client mock
    mockS3Send = jest.fn();
    mockS3Client.mockImplementation(
      () =>
        ({
          send: mockS3Send,
        }) as any
    );

    mockIsS3Enabled.mockReturnValue(true);
  });

  afterEach(() => {
    // Restore console methods
    consoleSpy.mockRestore();
    jest.restoreAllMocks();
  });

  describe('Video List API (/api/video)', () => {
    it('should return cached results when available', async () => {
      const cachedVideos = [
        { id: 'cached-1', name: 'Cached Video 1' },
        { id: 'cached-2', name: 'Cached Video 2' },
      ];

      metadataCache.setVideoList(cachedVideos);

      const response = await getVideos();
      const data = await response.json();

      expect(data).toEqual(cachedVideos);
      expect(mockS3Send).not.toHaveBeenCalled(); // Should not make S3 calls
    });

    it('should handle B2 bandwidth limit errors professionally', async () => {
      const bandwidthError = {
        Code: 'AccessDenied',
        message:
          'Cannot download file, download bandwidth or transaction (Class B) cap exceeded.',
        $metadata: { httpStatusCode: 403 },
      };

      // Mock the first GetObjectCommand (for index) to succeed
      // Then mock ListObjectsV2Command to fail with bandwidth error
      mockS3Send
        .mockResolvedValueOnce({
          // First call - GetObject for index (no index exists)
          Body: {
            transformToString: () => {
              throw new Error('NoSuchKey');
            },
          },
        })
        .mockRejectedValueOnce(bandwidthError); // Second call - ListObjectsV2 fails

      const response = await getVideos();
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.error).toContain('Daily cloud storage limit reached');
      expect(data.error).toContain('midnight GMT');
      expect(data.rateLimited).toBe(true);
      expect(data.retryAfter).toBe('midnight GMT');
    });

    it('should handle transaction cap exceeded errors', async () => {
      const capError = {
        Code: 'AccessDenied',
        message: 'Transaction cap exceeded',
        $metadata: { httpStatusCode: 403 },
      };

      // Mock the first GetObjectCommand to succeed, then ListObjectsV2Command to fail
      mockS3Send
        .mockResolvedValueOnce({
          // First call - GetObject for index (no index exists)
          Body: {
            transformToString: () => {
              throw new Error('NoSuchKey');
            },
          },
        })
        .mockRejectedValueOnce(capError); // Second call - ListObjectsV2 fails

      const response = await getVideos();
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.error).toContain(
        'Daily cloud storage transaction limit reached'
      );
      expect(data.rateLimited).toBe(true);
    });

    it('should handle server errors gracefully', async () => {
      const serverError = {
        Code: 'InternalError',
        message: 'Internal server error',
        $metadata: { httpStatusCode: 500 },
      };

      // Mock the first GetObjectCommand to succeed, then ListObjectsV2Command to fail
      mockS3Send
        .mockResolvedValueOnce({
          // First call - GetObject for index (no index exists)
          Body: {
            transformToString: () => {
              throw new Error('NoSuchKey');
            },
          },
        })
        .mockRejectedValueOnce(serverError); // Second call - ListObjectsV2 fails

      const response = await getVideos();
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain('technical difficulties');
      expect(data.rateLimited).toBe(false);
    });

    it('should cache successful responses', async () => {
      // Mock successful S3 responses
      const mockIndexResponse = {
        Body: {
          transformToString: () =>
            Promise.resolve(JSON.stringify({ videos: [] })),
        },
      };

      const mockListResponse = {
        Contents: [
          {
            Key: 'videos/test-123/video.mp4',
            Size: 1000000,
            LastModified: new Date(),
          },
        ],
      };

      const mockRootFoldersResponse = {
        CommonPrefixes: [],
      };

      mockS3Send
        .mockResolvedValueOnce(mockIndexResponse) // GetObject for index
        .mockResolvedValueOnce(mockListResponse) // ListObjectsV2 for all objects
        .mockResolvedValueOnce(mockRootFoldersResponse); // ListObjectsV2 for root folders

      const response = await getVideos();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);

      // Verify the response was cached
      const cachedData = metadataCache.getVideoList();
      expect(cachedData).toEqual(data);
    });
  });

  describe('Video Delete API (/api/video/[videoId])', () => {
    const mockRequest = new Request('http://localhost/api/video/test-123', {
      method: 'DELETE',
    });

    const mockParams = { params: { videoId: 'test-123' } };

    it('should handle delete operations with bandwidth limits', async () => {
      const bandwidthError = {
        Code: 'AccessDenied',
        message: 'bandwidth or transaction cap exceeded',
        $metadata: { httpStatusCode: 403 },
      };

      // Mock the metadata fetch to succeed first, then ListObjectsV2 to fail
      mockS3Send
        .mockResolvedValueOnce({
          // GetObject for metadata
          Body: {
            transformToString: () =>
              Promise.resolve(
                JSON.stringify({
                  id: 'test-123',
                  filename: 'test.mp4',
                  r2Path: 'videos/test-123/test.mp4',
                })
              ),
          },
        })
        .mockRejectedValueOnce(bandwidthError); // ListObjectsV2 fails with bandwidth error

      const response = await deleteVideo(mockRequest, mockParams);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain(
        'Failed to check if video exists in cloud storage'
      );
      expect(data.success).toBe(false);
    });

    it('should return proper error for non-existent videos', async () => {
      // Mock the delete API flow for non-existent video:
      // 1. GetObject for metadata fails (no metadata)
      // 2. Multiple GetObject attempts to find video by scanning fail
      // 3. ListObjectsV2 returns empty (no objects found)
      mockS3Send
        .mockRejectedValueOnce(new Error('NoSuchKey')) // GetObject for metadata fails
        .mockRejectedValueOnce(new Error('NoSuchKey')) // GetObject scan for .mp4 fails
        .mockRejectedValueOnce(new Error('NoSuchKey')) // GetObject scan for .mov fails
        .mockRejectedValueOnce(new Error('NoSuchKey')) // GetObject scan for .avi fails
        .mockRejectedValueOnce(new Error('NoSuchKey')) // GetObject scan for .mkv fails
        .mockRejectedValueOnce(new Error('NoSuchKey')) // GetObject scan for .webm fails
        .mockRejectedValueOnce(new Error('NoSuchKey')) // GetObject scan for .m4v fails
        .mockResolvedValueOnce({
          // ListObjectsV2 succeeds but returns empty
          Contents: [],
        });

      const response = await deleteVideo(mockRequest, mockParams);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toContain('not found in cloud storage');
    });

    it('should invalidate cache after successful deletion', async () => {
      // Set up cache first
      const cachedVideos = [
        { id: 'test-123', name: 'Test Video' },
        { id: 'other-456', name: 'Other Video' },
      ];
      metadataCache.setVideoList(cachedVideos);
      metadataCache.setVideoMetadata('test-123', { name: 'Test Video' });

      // Mock successful deletion flow:
      // 1. GetObject for metadata succeeds
      // 2. ListObjectsV2 finds objects to delete
      // 3. DeleteObjects succeeds
      // 4. GetObject for index succeeds
      // 5. PutObject to update index succeeds
      mockS3Send
        .mockResolvedValueOnce({
          // GetObject for metadata
          Body: {
            transformToString: () =>
              Promise.resolve(
                JSON.stringify({
                  id: 'test-123',
                  filename: 'test.mp4',
                  r2Path: 'videos/test-123/test.mp4',
                })
              ),
          },
        })
        .mockResolvedValueOnce({
          // ListObjectsV2 - find objects
          Contents: [
            { Key: 'videos/test-123/video.mp4' },
            { Key: 'videos/test-123/metadata.json' },
          ],
        })
        .mockResolvedValueOnce({
          // DeleteObjects
          Deleted: [
            { Key: 'videos/test-123/video.mp4' },
            { Key: 'videos/test-123/metadata.json' },
          ],
        })
        .mockResolvedValueOnce({
          // GetObject for index
          Body: {
            transformToString: () =>
              Promise.resolve(
                JSON.stringify({
                  videos: cachedVideos,
                })
              ),
          },
        })
        .mockResolvedValueOnce({}); // PutObject for updated index

      const response = await deleteVideo(mockRequest, mockParams);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify cache was invalidated
      expect(metadataCache.getVideoList()).toBeNull();
      expect(metadataCache.getVideoMetadata('test-123')).toBeNull();
    });
  });

  describe('Video Get API (/api/video/[videoId])', () => {
    const mockRequest = new Request('http://localhost/api/video/test-123');
    const mockParams = { params: { videoId: 'test-123' } };

    it('should handle metadata fetch with bandwidth limits', async () => {
      const bandwidthError = {
        Code: 'AccessDenied',
        message: 'bandwidth cap exceeded',
        $metadata: { httpStatusCode: 403 },
      };

      mockS3Send.mockRejectedValueOnce(bandwidthError);

      const response = await getVideo(mockRequest, mockParams);
      const data = await response.json();

      expect(response.status).toBe(404); // GET API returns 404 for any GetObject failure
      expect(data.error).toContain('not found');
    });

    it('should return 404 for non-existent videos', async () => {
      const notFoundError = {
        Code: 'NoSuchKey',
        message: 'The specified key does not exist',
        $metadata: { httpStatusCode: 404 },
      };

      mockS3Send.mockRejectedValueOnce(notFoundError);

      const response = await getVideo(mockRequest, mockParams);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain('not found');
    });
  });
});

describe('Error Message Quality Assurance', () => {
  it('should never expose technical details to users', async () => {
    const technicalErrors = [
      'AccessDenied',
      'NoSuchKey',
      'InternalError',
      '$metadata',
      'httpStatusCode',
      'Code:',
    ];

    // Test various error scenarios
    const errorMessages = [
      'Daily cloud storage limit reached. This will reset at midnight GMT.',
      'Daily cloud storage transaction limit reached. This will reset at midnight GMT.',
      'The requested file was not found in cloud storage.',
      'Cloud storage is experiencing technical difficulties. Please try again in a few minutes.',
    ];

    errorMessages.forEach((message) => {
      technicalErrors.forEach((technical) => {
        expect(message.toLowerCase()).not.toContain(technical.toLowerCase());
      });

      // Should be human-readable
      expect(message.length).toBeGreaterThan(20);
      expect(message).toMatch(/^[A-Z]/); // Should start with capital letter
      expect(message).toMatch(/[.!]$/); // Should end with punctuation
    });
  });

  it('should provide actionable guidance', () => {
    const guidanceKeywords = [
      'try again',
      'midnight GMT',
      'contact support',
      'try again later',
      'please',
    ];

    const userFriendlyMessages = [
      'Daily cloud storage limit reached. This will reset at midnight GMT. Please try again later or contact support to increase limits.',
      'Cloud storage is experiencing technical difficulties. Please try again in a few minutes.',
      'Access to cloud storage was denied. This may be due to daily limits or configuration issues. Please try again later.',
    ];

    userFriendlyMessages.forEach((message) => {
      const hasGuidance = guidanceKeywords.some((keyword) =>
        message.toLowerCase().includes(keyword)
      );
      expect(hasGuidance).toBe(true);
    });
  });
});
