'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface VideoStatus {
  success: boolean;
  videoId: string;
  status: {
    upload: string;
    compression: string;
    available: boolean;
  };
  metadata: {
    filename: string;
    clientName: string;
    projectName: string;
    fileSize: number;
    uploadDate: string;
    downloadUrl: string;
  };
  compression?: {
    enabled: boolean;
    status: string;
    originalSize?: number;
    compressedSize?: number;
    compressionRatio?: number;
    quality?: string;
    startTime?: string;
    completedTime?: string;
  } | null;
}

export default function VideoPage() {
  const params = useParams();
  const videoId = params.videoId as string;
  const [videoStatus, setVideoStatus] = useState<VideoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVideoStatus = async () => {
      try {
        const response = await fetch(`/api/video/${videoId}/status`);
        const data = await response.json();

        if (data.success) {
          setVideoStatus(data);
        } else {
          setError(data.error || 'Failed to load video');
        }
      } catch {
        setError('Failed to fetch video status');
      } finally {
        setLoading(false);
      }
    };

    if (videoId) {
      fetchVideoStatus();

      // Poll for compression status updates
      const interval = setInterval(fetchVideoStatus, 10000); // Check every 10 seconds

      return () => clearInterval(interval);
    }
  }, [videoId]);

  const formatFileSize = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading video information...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 text-xl mb-4">❌ Error</div>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!videoStatus) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Video not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              🎉 Your Video is Ready!
            </h1>
            <p className="text-gray-600">
              Upload completed successfully. Your video is available for
              download.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Video Information */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900">
                Video Details
              </h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Filename
                  </label>
                  <p className="text-gray-900">
                    {videoStatus.metadata.filename}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Client
                  </label>
                  <p className="text-gray-900">
                    {videoStatus.metadata.clientName}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Project
                  </label>
                  <p className="text-gray-900">
                    {videoStatus.metadata.projectName}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    File Size
                  </label>
                  {videoStatus.compression?.enabled ? (
                    <div className="space-y-1">
                      {videoStatus.compression.originalSize && (
                        <p className="text-sm text-gray-600">
                          Original:{' '}
                          {formatFileSize(videoStatus.compression.originalSize)}
                        </p>
                      )}
                      {videoStatus.compression.status === 'completed' &&
                      videoStatus.compression.compressedSize ? (
                        <div>
                          <p className="text-gray-900 font-medium">
                            Compressed:{' '}
                            {formatFileSize(
                              videoStatus.compression.compressedSize
                            )}
                          </p>
                          <p className="text-sm text-green-600">
                            Saved:{' '}
                            {videoStatus.compression.compressionRatio?.toFixed(
                              1
                            )}
                            % (
                            {formatFileSize(
                              (videoStatus.compression.originalSize || 0) -
                                videoStatus.compression.compressedSize
                            )}
                            )
                          </p>
                        </div>
                      ) : (
                        <p className="text-gray-900">
                          Current:{' '}
                          {formatFileSize(videoStatus.metadata.fileSize)}
                          {videoStatus.compression.status === 'processing' && (
                            <span className="text-yellow-600 ml-2">
                              (compressing...)
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-900">
                      {formatFileSize(videoStatus.metadata.fileSize)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Upload Date
                  </label>
                  <p className="text-gray-900">
                    {formatDate(videoStatus.metadata.uploadDate)}
                  </p>
                </div>
              </div>
            </div>

            {/* Status and Download */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900">
                Status & Download
              </h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Upload Status
                  </label>
                  <div className="flex items-center">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      ✅ {videoStatus.status.upload}
                    </span>
                  </div>
                </div>

                {videoStatus.compression?.enabled && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Compression Status
                    </label>
                    <div className="space-y-2">
                      <div className="flex items-center">
                        {videoStatus.status.compression === 'processing' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            🔄 Processing ({videoStatus.compression.quality})
                          </span>
                        ) : videoStatus.status.compression === 'completed' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            ✅ Completed ({videoStatus.compression.quality})
                          </span>
                        ) : videoStatus.status.compression === 'failed' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            ❌ Failed
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                            ➖ Disabled
                          </span>
                        )}
                      </div>

                      {videoStatus.compression.status === 'completed' &&
                        videoStatus.compression.compressionRatio && (
                          <div className="text-sm text-green-600">
                            <p>
                              Size reduction:{' '}
                              {videoStatus.compression.compressionRatio.toFixed(
                                1
                              )}
                              %
                            </p>
                            {videoStatus.compression.originalSize &&
                              videoStatus.compression.compressedSize && (
                                <p>
                                  {formatFileSize(
                                    videoStatus.compression.originalSize
                                  )}{' '}
                                  →{' '}
                                  {formatFileSize(
                                    videoStatus.compression.compressedSize
                                  )}
                                </p>
                              )}
                          </div>
                        )}
                    </div>
                  </div>
                )}

                <div className="pt-4">
                  <a
                    href={videoStatus.metadata.downloadUrl}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center"
                    download
                  >
                    📥 Download Video
                  </a>

                  <p className="text-sm text-gray-500 mt-2 text-center">
                    Click to download your video file
                  </p>
                </div>
              </div>
            </div>
          </div>

          {videoStatus.status.compression === 'processing' &&
            videoStatus.compression && (
              <div className="mt-8 p-4 bg-blue-50 rounded-lg">
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-blue-800">
                      Compression in Progress ({videoStatus.compression.quality}{' '}
                      quality)
                    </h3>
                    <p className="text-sm text-blue-700 mt-1">
                      Your video is being compressed in the background to reduce
                      file size. You can download it now, and the compressed
                      version will be available later.
                    </p>
                    {videoStatus.compression.originalSize && (
                      <p className="text-sm text-blue-600 mt-1">
                        Original size:{' '}
                        {formatFileSize(videoStatus.compression.originalSize)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

          {videoStatus.status.compression === 'completed' &&
            videoStatus.compression?.compressionRatio && (
              <div className="mt-8 p-4 bg-green-50 rounded-lg">
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <div className="text-green-600 text-xl">✅</div>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-green-800">
                      Compression Completed
                    </h3>
                    <p className="text-sm text-green-700 mt-1">
                      Your video has been successfully compressed with{' '}
                      {videoStatus.compression.compressionRatio.toFixed(1)}%
                      size reduction.
                    </p>
                    {videoStatus.compression.originalSize &&
                      videoStatus.compression.compressedSize && (
                        <div className="text-sm text-green-600 mt-2 space-y-1">
                          <p>
                            Original:{' '}
                            {formatFileSize(
                              videoStatus.compression.originalSize
                            )}
                          </p>
                          <p>
                            Compressed:{' '}
                            {formatFileSize(
                              videoStatus.compression.compressedSize
                            )}
                          </p>
                          <p className="font-medium">
                            Saved:{' '}
                            {formatFileSize(
                              videoStatus.compression.originalSize -
                                videoStatus.compression.compressedSize
                            )}
                          </p>
                        </div>
                      )}
                  </div>
                </div>
              </div>
            )}

          <div className="mt-8 text-center">
            <a
              href="/"
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              ← Upload Another Video
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
