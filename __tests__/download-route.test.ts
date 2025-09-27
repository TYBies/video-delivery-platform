import { GET as downloadGet } from '@/app/api/download/[videoId]/route';

// Mocks
jest.mock('@/lib/hybrid-storage', () => ({
  HybridStorage: jest.fn().mockImplementation(() => ({
    getVideoStream: jest.fn(),
  })),
}));

jest.mock('@/lib/metadata', () => ({
  MetadataManager: jest.fn().mockImplementation(() => ({
    loadMetadata: jest.fn(),
    incrementDownloadCount: jest.fn(),
  })),
}));

jest.mock('@/lib/s3-config', () => ({
  isS3Enabled: jest.fn(() => false),
}));

import { HybridStorage } from '@/lib/hybrid-storage';
import { MetadataManager } from '@/lib/metadata';
import { Readable } from 'stream';

describe('Download Route (/api/download/[videoId])', () => {
  const mockHybrid = HybridStorage as jest.MockedClass<typeof HybridStorage>;
  const mockMetadata = MetadataManager as jest.MockedClass<
    typeof MetadataManager
  >;

  const baseMeta = {
    id: 'vid-1',
    filename: 'movie.mp4',
    clientName: 'c',
    projectName: 'p',
    uploadDate: new Date(),
    fileSize: 10,
    downloadCount: 0,
    status: 'local' as const,
    localPath: '/tmp/x',
    downloadUrl: '/download/vid-1',
    isActive: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets no-store and local source when serving from local', async () => {
    // Arrange
    const stream = Readable.from(Buffer.from('hello')) as any;
    (mockHybrid as any).mockImplementation(() => ({
      getVideoStream: jest.fn().mockResolvedValue({
        stream,
        size: 5,
        filename: 'video.mp4',
        source: 'local',
      }),
    }));

    (mockMetadata as any).mockImplementation(() => ({
      loadMetadata: jest.fn().mockResolvedValue(baseMeta),
    }));

    // Act
    const res = await downloadGet(new Request('http://localhost'), {
      params: { videoId: 'vid-1' },
    } as any);

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Video-Source')).toBe('local');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Content-Length')).toBe('5');
  });

  it('sets long cache and r2 source when serving from R2', async () => {
    // Arrange
    const stream = Readable.from(Buffer.from('world!')) as any;
    (mockHybrid as any).mockImplementation(() => ({
      getVideoStream: jest.fn().mockResolvedValue({
        stream,
        size: 6,
        filename: 'video.mp4',
        source: 'r2',
      }),
    }));

    (mockMetadata as any).mockImplementation(() => ({
      loadMetadata: jest.fn().mockResolvedValue(baseMeta),
    }));

    // Act
    const res = await downloadGet(new Request('http://localhost'), {
      params: { videoId: 'vid-1' },
    } as any);

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Video-Source')).toBe('r2');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Content-Length')).toBe('6');
  });

  it('returns 404 when metadata is missing', async () => {
    (mockMetadata as any).mockImplementation(() => ({
      loadMetadata: jest.fn().mockResolvedValue(null),
    }));

    const res = await downloadGet(new Request('http://localhost'), {
      params: { videoId: 'missing' },
    } as any);

    expect(res.status).toBe(404);
  });
});
