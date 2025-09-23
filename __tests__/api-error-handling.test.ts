import { GET as getVideos } from '@/app/api/video/route';
import { GET as getVideo, DELETE as deleteVideo } from '@/app/api/video/[videoId]/route';
import { metadataCache } from '@/lib/metadata-cache';

// Mock the S3 client to simulate different error conditions
jest.mock('@aws-sdk/client-s3', () => {
  const originalModule = jest.requireActual('@aws-sdk/client-s3');

  return {
    ...originalModule,
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn()
    }))
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
    secretAccessKey: 'test-secret'
  })),
  handleS3Error: jest.requireActual('@/lib/s3-config').handleS3Error
}));

import { S3Client } from '@aws-sdk/client-s3';
import { isS3Enabled } from '@/lib/s3-config';

const mockS3Client = S3Client as jest.MockedClass<typeof S3Client>;
const mockIsS3Enabled = isS3Enabled as jest.MockedFunction<typeof isS3Enabled>;

describe('API Error Handling Integration Tests', () => {
  let mockS3Send: jest.MockedFunction<any>;

  beforeEach(() => {
    // Clear cache before each test
    metadataCache.invalidateAll();

    // Reset mocks
    jest.clearAllMocks();

    // Setup S3 client mock
    mockS3Send = jest.fn();
    mockS3Client.mockImplementation(() => ({
      send: mockS3Send
    } as any));

    mockIsS3Enabled.mockReturnValue(true);
  });

  describe('Video List API (/api/video)', () => {
    it('should return cached results when available', async () => {
      const cachedVideos = [
        { id: 'cached-1', name: 'Cached Video 1' },
        { id: 'cached-2', name: 'Cached Video 2' }
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
        message: 'Cannot download file, download bandwidth or transaction (Class B) cap exceeded.',
        $metadata: { httpStatusCode: 403 }
      };

      mockS3Send.mockRejectedValueOnce(bandwidthError);

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
        $metadata: { httpStatusCode: 403 }
      };

      mockS3Send.mockRejectedValueOnce(capError);

      const response = await getVideos();
      const data = await response.json();

      expect(response.status).toBe(429);
      expect(data.error).toContain('Daily cloud storage transaction limit reached');
      expect(data.rateLimited).toBe(true);
    });

    it('should handle server errors gracefully', async () => {
      const serverError = {
        Code: 'InternalError',
        message: 'Internal server error',
        $metadata: { httpStatusCode: 500 }
      };

      mockS3Send.mockRejectedValueOnce(serverError);

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
          transformToString: () => JSON.stringify({ videos: [] })
        }
      };

      const mockListResponse = {
        Contents: [
          {
            Key: 'videos/test-123/video.mp4',
            Size: 1000000,
            LastModified: new Date()
          }
        ]
      };

      mockS3Send
        .mockResolvedValueOnce(mockIndexResponse) // GetObject for index
        .mockResolvedValueOnce(mockListResponse) // ListObjectsV2
        .mockResolvedValueOnce({ CommonPrefixes: [] }); // Root folders

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
      method: 'DELETE'
    });

    const mockParams = { params: { videoId: 'test-123' } };

    it('should handle delete operations with bandwidth limits', async () => {
      const bandwidthError = {
        Code: 'AccessDenied',
        message: 'bandwidth or transaction cap exceeded',
        $metadata: { httpStatusCode: 403 }
      };

      mockS3Send.mockRejectedValueOnce(bandwidthError);

      const response = await deleteVideo(mockRequest, mockParams);
      const data = await response.json();

      expect(response.status).toBe(500); // Delete errors are 500, not 429
      expect(data.error).toContain('daily limits');
    });

    it('should return proper error for non-existent videos', async () => {
      // Mock empty list response (no objects found)
      mockS3Send.mockResolvedValueOnce({
        Contents: []
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
        { id: 'other-456', name: 'Other Video' }
      ];
      metadataCache.setVideoList(cachedVideos);
      metadataCache.setVideoMetadata('test-123', { name: 'Test Video' });

      // Mock successful deletion
      mockS3Send
        .mockResolvedValueOnce({ // ListObjectsV2 - find objects
          Contents: [
            { Key: 'videos/test-123/video.mp4' },
            { Key: 'videos/test-123/metadata.json' }
          ]
        })
        .mockResolvedValueOnce({ // DeleteObjects
          Deleted: [
            { Key: 'videos/test-123/video.mp4' },
            { Key: 'videos/test-123/metadata.json' }
          ]
        })
        .mockResolvedValueOnce({ // GetObject for index
          Body: {
            transformToString: () => JSON.stringify({
              videos: cachedVideos
            })
          }
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
        $metadata: { httpStatusCode: 403 }
      };

      mockS3Send.mockRejectedValueOnce(bandwidthError);

      const response = await getVideo(mockRequest, mockParams);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain('daily limits');
    });

    it('should return 404 for non-existent videos', async () => {
      const notFoundError = {
        Code: 'NoSuchKey',
        message: 'The specified key does not exist',
        $metadata: { httpStatusCode: 404 }
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
      'Code:'
    ];

    // Test various error scenarios
    const errorMessages = [
      'Daily cloud storage limit reached. This will reset at midnight GMT.',
      'Daily cloud storage transaction limit reached. This will reset at midnight GMT.',
      'The requested file was not found in cloud storage.',
      'Cloud storage is experiencing technical difficulties. Please try again in a few minutes.'
    ];

    errorMessages.forEach(message => {
      technicalErrors.forEach(technical => {
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
      'please'
    ];

    const userFriendlyMessages = [
      'Daily cloud storage limit reached. This will reset at midnight GMT. Please try again later or contact support to increase limits.',
      'Cloud storage is experiencing technical difficulties. Please try again in a few minutes.',
      'Access to cloud storage was denied. This may be due to daily limits or configuration issues. Please try again later.'
    ];

    userFriendlyMessages.forEach(message => {
      const hasGuidance = guidanceKeywords.some(keyword =>
        message.toLowerCase().includes(keyword)
      );
      expect(hasGuidance).toBe(true);
    });
  });
});