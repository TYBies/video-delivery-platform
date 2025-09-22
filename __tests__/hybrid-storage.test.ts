import { HybridStorage } from '../lib/hybrid-storage';
import { LocalStorage } from '../lib/storage';
import { R2Storage } from '../lib/r2-storage';
import { MetadataManager } from '../lib/metadata';
import { EnvironmentValidator } from '../lib/env-config';

// Mock all dependencies
jest.mock('../lib/storage');
jest.mock('../lib/r2-storage');
jest.mock('../lib/metadata');
jest.mock('../lib/env-config');

describe('HybridStorage', () => {
    let hybridStorage: HybridStorage;
    let mockLocalStorage: jest.Mocked<LocalStorage>;
    let mockR2Storage: jest.Mocked<R2Storage>;
    let mockMetadataManager: jest.Mocked<MetadataManager>;

    const sampleMetadata = {
        id: 'test-video-123',
        filename: 'sample-video.mp4',
        clientName: 'Test Client',
        projectName: 'Test Project',
        uploadDate: new Date('2024-01-15T10:30:00Z'),
        fileSize: 1048576,
        downloadCount: 0,
        status: 'local' as const,
        localPath: './uploads/videos/test-video-123/video.mp4',
        downloadUrl: '/download/test-video-123',
        isActive: true,
        checksumMD5: 'abc123def456'
    };

    beforeEach(() => {
        // Mock EnvironmentValidator
        (EnvironmentValidator.isR2Configured as jest.Mock).mockReturnValue(true);

        // Mock LocalStorage
        mockLocalStorage = {
            saveVideo: jest.fn(),
            readVideo: jest.fn(),
            getVideoStream: jest.fn(),
            deleteVideo: jest.fn(),
            videoExists: jest.fn(),
            getStorageStats: jest.fn(),
            validateFile: jest.fn(),
            createVideoDirectory: jest.fn(),
            cleanupTempFiles: jest.fn()
        } as any;

        // Mock R2Storage
        mockR2Storage = {
            uploadVideo: jest.fn(),
            downloadVideo: jest.fn(),
            getVideoStream: jest.fn(),
            deleteVideo: jest.fn(),
            videoExists: jest.fn(),
            getStorageStats: jest.fn(),
            testConnection: jest.fn(),
            listVideos: jest.fn(),
            uploadVideoFromFile: jest.fn()
        } as any;

        // Mock MetadataManager
        mockMetadataManager = {
            saveMetadata: jest.fn(),
            loadMetadata: jest.fn(),
            updateMetadata: jest.fn(),
            deleteMetadata: jest.fn(),
            getAllMetadata: jest.fn(),
            incrementDownloadCount: jest.fn(),
            getVideosByClient: jest.fn(),
            getVideosByProject: jest.fn(),
            getVideosByStatus: jest.fn(),
            getActiveVideos: jest.fn(),
            updateVideoStatus: jest.fn(),
            setVideoActive: jest.fn(),
            validateMetadata: jest.fn(),
            rebuildIndex: jest.fn()
        } as any;

        // Setup mocks
        (LocalStorage as jest.MockedClass<typeof LocalStorage>).mockImplementation(() => mockLocalStorage);
        (R2Storage as jest.MockedClass<typeof R2Storage>).mockImplementation(() => mockR2Storage);
        (MetadataManager as jest.MockedClass<typeof MetadataManager>).mockImplementation(() => mockMetadataManager);

        hybridStorage = new HybridStorage();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('saveVideo', () => {
        it('should save video locally and backup to R2', async () => {
            const testBuffer = Buffer.from('test video content');

            // Mock successful local save
            mockLocalStorage.saveVideo.mockResolvedValue(sampleMetadata);

            // Mock successful metadata save
            mockMetadataManager.saveMetadata.mockResolvedValue();

            // Mock successful R2 backup
            mockR2Storage.uploadVideo.mockResolvedValue({
                success: true,
                r2Path: 'videos/test-video-123/video.mp4'
            });

            // Mock metadata update
            mockMetadataManager.updateMetadata.mockResolvedValue({
                ...sampleMetadata,
                status: 'backed-up'
            });

            const result = await hybridStorage.saveVideo(
                testBuffer,
                'sample-video.mp4',
                'Test Client',
                'Test Project'
            );

            expect(mockLocalStorage.saveVideo).toHaveBeenCalledWith(
                testBuffer,
                'sample-video.mp4',
                'Test Client',
                'Test Project'
            );
            expect(mockMetadataManager.saveMetadata).toHaveBeenCalledWith(sampleMetadata);
            expect(mockR2Storage.uploadVideo).toHaveBeenCalledWith(
                sampleMetadata.id,
                testBuffer,
                sampleMetadata
            );
            expect(result.status).toBe('backed-up');
        });

        it('should continue if R2 backup fails', async () => {
            const testBuffer = Buffer.from('test video content');

            // Mock successful local save
            mockLocalStorage.saveVideo.mockResolvedValue(sampleMetadata);
            mockMetadataManager.saveMetadata.mockResolvedValue();

            // Mock R2 backup failure
            mockR2Storage.uploadVideo.mockResolvedValue({
                success: false,
                error: 'R2 upload failed'
            });

            const result = await hybridStorage.saveVideo(
                testBuffer,
                'sample-video.mp4',
                'Test Client',
                'Test Project'
            );

            expect(result).toEqual(sampleMetadata);
            expect(mockLocalStorage.saveVideo).toHaveBeenCalled();
            expect(mockR2Storage.uploadVideo).toHaveBeenCalled();
        });
    });

    describe('getVideoStream', () => {
        it('should return local stream when available', async () => {
            const mockStream = {} as NodeJS.ReadableStream;

            // Mock successful local stream
            mockLocalStorage.getVideoStream.mockResolvedValue({
                stream: mockStream,
                size: 1048576,
                filename: 'video.mp4'
            });

            const result = await hybridStorage.getVideoStream('test-video-123');

            expect(result.source).toBe('local');
            expect(result.stream).toBe(mockStream);
            expect(mockMetadataManager.incrementDownloadCount).toHaveBeenCalledWith('test-video-123');
        });

        it('should fallback to R2 when local fails', async () => {
            const mockStream = {} as any;

            // Mock local failure
            mockLocalStorage.getVideoStream.mockRejectedValue(new Error('Local file not found'));

            // Mock successful R2 stream
            mockR2Storage.getVideoStream.mockResolvedValue({
                success: true,
                stream: mockStream,
                contentLength: 1048576
            });

            const result = await hybridStorage.getVideoStream('test-video-123');

            expect(result.source).toBe('r2');
            expect(result.stream).toBe(mockStream);
            expect(mockMetadataManager.incrementDownloadCount).toHaveBeenCalledWith('test-video-123');
        });

        it('should throw error when both local and R2 fail', async () => {
            // Mock local failure
            mockLocalStorage.getVideoStream.mockRejectedValue(new Error('Local file not found'));

            // Mock R2 failure
            mockR2Storage.getVideoStream.mockResolvedValue({
                success: false,
                error: 'R2 file not found'
            });

            await expect(hybridStorage.getVideoStream('test-video-123')).rejects.toThrow(
                'Video test-video-123 not found in local storage or R2'
            );
        });
    });

    describe('backupVideo', () => {
        it('should successfully backup video to R2', async () => {
            const testBuffer = Buffer.from('test video content');

            // Mock metadata loading
            mockMetadataManager.loadMetadata.mockResolvedValue(sampleMetadata);

            // Mock local video reading
            mockLocalStorage.readVideo.mockResolvedValue(testBuffer);

            // Mock successful R2 upload
            mockR2Storage.uploadVideo.mockResolvedValue({
                success: true,
                r2Path: 'videos/test-video-123/video.mp4'
            });

            // Mock metadata update
            mockMetadataManager.updateMetadata.mockResolvedValue({
                ...sampleMetadata,
                status: 'backed-up'
            });

            const result = await hybridStorage.backupVideo('test-video-123');

            expect(result.success).toBe(true);
            expect(mockR2Storage.uploadVideo).toHaveBeenCalledWith(
                'test-video-123',
                testBuffer,
                sampleMetadata
            );
        });

        it('should return error when video metadata not found', async () => {
            mockMetadataManager.loadMetadata.mockResolvedValue(null);

            const result = await hybridStorage.backupVideo('non-existent-video');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Video metadata not found');
        });

        it('should skip backup if already backed up', async () => {
            const backedUpMetadata = { ...sampleMetadata, status: 'backed-up' as const };
            mockMetadataManager.loadMetadata.mockResolvedValue(backedUpMetadata);

            const result = await hybridStorage.backupVideo('test-video-123');

            expect(result.success).toBe(true);
            expect(result.error).toBe('Video already backed up');
            expect(mockR2Storage.uploadVideo).not.toHaveBeenCalled();
        });
    });

    describe('deleteVideo', () => {
        it('should delete from both local and R2 storage', async () => {
            // Mock successful deletions
            mockLocalStorage.deleteVideo.mockResolvedValue(true);
            mockR2Storage.deleteVideo.mockResolvedValue({ success: true });
            mockMetadataManager.deleteMetadata.mockResolvedValue(true);

            const result = await hybridStorage.deleteVideo('test-video-123');

            expect(result.success).toBe(true);
            expect(mockLocalStorage.deleteVideo).toHaveBeenCalledWith('test-video-123');
            expect(mockR2Storage.deleteVideo).toHaveBeenCalledWith('test-video-123');
            expect(mockMetadataManager.deleteMetadata).toHaveBeenCalledWith('test-video-123');
        });

        it('should succeed if at least one deletion succeeds', async () => {
            // Mock local failure, R2 success
            mockLocalStorage.deleteVideo.mockRejectedValue(new Error('Local delete failed'));
            mockR2Storage.deleteVideo.mockResolvedValue({ success: true });
            mockMetadataManager.deleteMetadata.mockResolvedValue(true);

            const result = await hybridStorage.deleteVideo('test-video-123');

            expect(result.success).toBe(true);
            expect(result.error).toContain('Local deletion failed');
        });
    });

    describe('getStorageStats', () => {
        it('should return combined storage statistics', async () => {
            // Mock local stats
            mockLocalStorage.getStorageStats.mockResolvedValue({
                totalSize: 1048576,
                videoCount: 1
            });

            // Mock R2 stats
            mockR2Storage.getStorageStats.mockResolvedValue({
                success: true,
                totalSize: 2097152,
                videoCount: 2
            });

            // Mock metadata for combined stats
            mockMetadataManager.getAllMetadata.mockResolvedValue([sampleMetadata]);

            const result = await hybridStorage.getStorageStats();

            expect(result.local.totalSize).toBe(1048576);
            expect(result.r2?.totalSize).toBe(2097152);
            expect(result.combined.videoCount).toBe(1);
        });
    });

    describe('checkVideoAvailability', () => {
        it('should check availability across all storage systems', async () => {
            // Mock availability checks
            mockLocalStorage.videoExists.mockResolvedValue(true);
            mockR2Storage.videoExists.mockResolvedValue({ exists: true });
            mockMetadataManager.loadMetadata.mockResolvedValue(sampleMetadata);

            const result = await hybridStorage.checkVideoAvailability('test-video-123');

            expect(result.local).toBe(true);
            expect(result.r2).toBe(true);
            expect(result.metadata).toBe(true);
        });
    });

    describe('testConnections', () => {
        it('should test both local and R2 connections', async () => {
            // Mock successful tests
            mockLocalStorage.getStorageStats.mockResolvedValue({
                totalSize: 0,
                videoCount: 0
            });
            mockR2Storage.testConnection.mockResolvedValue({ success: true });

            const result = await hybridStorage.testConnections();

            expect(result.local.success).toBe(true);
            expect(result.r2?.success).toBe(true);
        });
    });
});