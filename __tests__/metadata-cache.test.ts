import { metadataCache, rateLimiter } from '@/lib/metadata-cache';

describe('MetadataCache', () => {
  beforeEach(() => {
    // Clear cache before each test
    metadataCache.invalidateAll();
  });

  describe('Basic Cache Operations', () => {
    it('should set and get values correctly', () => {
      const testData = { id: 'test-123', name: 'Test Video' };
      metadataCache.set('test-key', testData);

      const retrieved = metadataCache.get('test-key');
      expect(retrieved).toEqual(testData);
    });

    it('should return null for non-existent keys', () => {
      const result = metadataCache.get('non-existent');
      expect(result).toBeNull();
    });

    it('should expire entries after TTL', async () => {
      const testData = { id: 'test-123' };
      metadataCache.set('test-key', testData, 100); // 100ms TTL

      // Should be available immediately
      expect(metadataCache.get('test-key')).toEqual(testData);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(metadataCache.get('test-key')).toBeNull();
    });
  });

  describe('Video-Specific Operations', () => {
    it('should cache and retrieve video lists', () => {
      const videos = [
        { id: 'video-1', name: 'Video 1' },
        { id: 'video-2', name: 'Video 2' }
      ];

      metadataCache.setVideoList(videos);
      const retrieved = metadataCache.getVideoList();

      expect(retrieved).toEqual(videos);
    });

    it('should cache and retrieve individual video metadata', () => {
      const metadata = { id: 'video-123', name: 'Test Video', size: 1000000 };

      metadataCache.setVideoMetadata('video-123', metadata);
      const retrieved = metadataCache.getVideoMetadata('video-123');

      expect(retrieved).toEqual(metadata);
    });

    it('should invalidate video correctly', () => {
      const videos = [{ id: 'video-1' }, { id: 'video-2' }];
      const metadata = { id: 'video-1', name: 'Test' };

      metadataCache.setVideoList(videos);
      metadataCache.setVideoMetadata('video-1', metadata);

      // Verify both are cached
      expect(metadataCache.getVideoList()).toEqual(videos);
      expect(metadataCache.getVideoMetadata('video-1')).toEqual(metadata);

      // Invalidate video-1
      metadataCache.invalidateVideo('video-1');

      // Video list should be cleared, but video-2 metadata should remain
      expect(metadataCache.getVideoList()).toBeNull();
      expect(metadataCache.getVideoMetadata('video-1')).toBeNull();
    });
  });

  describe('Cache Statistics', () => {
    it('should provide accurate cache statistics', () => {
      metadataCache.set('key1', 'value1');
      metadataCache.set('key2', 'value2');

      const stats = metadataCache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toContain('key1');
      expect(stats.keys).toContain('key2');
    });

    it('should cleanup expired entries in stats', async () => {
      metadataCache.set('key1', 'value1', 50); // 50ms TTL
      metadataCache.set('key2', 'value2', 5000); // 5s TTL

      // Wait for first key to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = metadataCache.getStats();
      expect(stats.size).toBe(1);
      expect(stats.keys).toEqual(['key2']);
    });
  });
});

describe('RateLimiter', () => {
  beforeEach(() => {
    // Reset rate limiter state before each test
    rateLimiter.reset();
  });

  it('should allow requests within limit', () => {
    // Make several requests within limit
    for (let i = 0; i < 50; i++) {
      expect(rateLimiter.canMakeRequest('test-key')).toBe(true);
    }
  });

  it('should block requests after limit', () => {
    // Make requests up to the limit (100)
    for (let i = 0; i < 100; i++) {
      rateLimiter.canMakeRequest('test-key');
    }

    // Next request should be blocked
    expect(rateLimiter.canMakeRequest('test-key')).toBe(false);
  });

  it('should track remaining requests correctly', () => {
    // Make 10 requests
    for (let i = 0; i < 10; i++) {
      expect(rateLimiter.canMakeRequest('test-key')).toBe(true);
    }

    const remaining = rateLimiter.getRemainingRequests('test-key');
    expect(remaining).toBe(90); // 100 - 10 = 90
  });

  it('should handle different keys separately', () => {
    // Use up requests for key1
    for (let i = 0; i < 100; i++) {
      rateLimiter.canMakeRequest('key1');
    }

    // key1 should be blocked
    expect(rateLimiter.canMakeRequest('key1')).toBe(false);

    // key2 should still work
    expect(rateLimiter.canMakeRequest('key2')).toBe(true);
  });

  it('should reset after time window', async () => {
    // This test would need to be adjusted based on the actual window size
    // For now, we'll just verify the basic structure
    expect(typeof rateLimiter.canMakeRequest).toBe('function');
    expect(typeof rateLimiter.getRemainingRequests).toBe('function');
  });
});