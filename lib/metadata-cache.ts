// Professional metadata caching system to reduce B2 Class B transactions
// In production, this would typically use Redis or similar

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class MetadataCache {
  private cache = new Map<string, CacheEntry<any>>();
  private readonly defaultTTL = 5 * 60 * 1000; // 5 minutes
  private readonly videoListTTL = 2 * 60 * 1000; // 2 minutes for video lists
  private readonly metadataTTL = 10 * 60 * 1000; // 10 minutes for individual metadata

  private isExpired(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private cleanup(): void {
    // Remove expired entries to prevent memory leaks
    const keysToDelete: string[] = [];
    this.cache.forEach((entry, key) => {
      if (this.isExpired(entry)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.cache.delete(key));
  }

  get<T>(key: string): T | null {
    this.cleanup();

    const entry = this.cache.get(key);
    if (!entry || this.isExpired(entry)) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set<T>(key: string, data: T, customTTL?: number): void {
    const ttl = customTTL || this.defaultTTL;
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  // Specialized methods for different data types
  getVideoList(): any[] | null {
    return this.get<any[]>('video-list');
  }

  setVideoList(videos: any[]): void {
    this.set('video-list', videos, this.videoListTTL);
  }

  getVideoMetadata(videoId: string): any | null {
    return this.get(`metadata:${videoId}`);
  }

  setVideoMetadata(videoId: string, metadata: any): void {
    this.set(`metadata:${videoId}`, metadata, this.metadataTTL);
  }

  invalidateVideo(videoId: string): void {
    // Invalidate specific video metadata and the video list
    this.cache.delete(`metadata:${videoId}`);
    this.cache.delete('video-list');
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  // Get cache statistics for monitoring
  getStats() {
    this.cleanup();
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

// Singleton instance
export const metadataCache = new MetadataCache();

// Rate limiting helpers
class RateLimiter {
  private requests = new Map<string, number[]>();
  private readonly windowMs = 60 * 1000; // 1 minute window
  private readonly maxRequests = 100; // Max requests per window

  canMakeRequest(key: string = 'default'): boolean {
    const now = Date.now();
    const requests = this.requests.get(key) || [];

    // Remove old requests outside the window
    const validRequests = requests.filter(timestamp => now - timestamp < this.windowMs);

    if (validRequests.length >= this.maxRequests) {
      return false;
    }

    validRequests.push(now);
    this.requests.set(key, validRequests);
    return true;
  }

  getRemainingRequests(key: string = 'default'): number {
    const now = Date.now();
    const requests = this.requests.get(key) || [];
    const validRequests = requests.filter(timestamp => now - timestamp < this.windowMs);
    // Update the stored requests to only include valid ones
    this.requests.set(key, validRequests);
    return Math.max(0, this.maxRequests - validRequests.length);
  }

  // For testing - reset rate limiter state
  reset(): void {
    this.requests.clear();
  }
}

export const rateLimiter = new RateLimiter();