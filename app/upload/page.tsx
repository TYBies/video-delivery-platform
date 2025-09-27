'use client';

import { useState, useEffect } from 'react';

export default function UploadPage() {
  const uploadMode = process.env.NEXT_PUBLIC_UPLOAD_MODE || 'server'; // 'server' | 's3'
  const s3Endpoint = process.env.NEXT_PUBLIC_S3_ENDPOINT || '';
  const MAX_DIRECT_GB = Number(process.env.NEXT_PUBLIC_MAX_DIRECT_GB || '5');
  const MAX_DIRECT_BYTES = MAX_DIRECT_GB * 1024 * 1024 * 1024;
  const [file, setFile] = useState<File | null>(null);
  const [clientName, setClientName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [uploading, setUploading] = useState(false);
  type UploadResult = {
    videoId: string;
    downloadUrl?: string;
    metadata: {
      clientName: string;
      projectName: string;
      fileSize: number;
      status: 'local' | 'backed-up' | 'cloud-only';
    };
    compression?: {
      compressionRatio: number;
      originalSize: number;
      compressedSize: number;
    };
  } | null;
  const [result, setResult] = useState<UploadResult>(null);
  const [error, setError] = useState('');
  type DiskSpaceResponse = {
    success: boolean;
    diskSpace: { available: string; percentUsed: number };
    warning?: string;
  } | null;
  const [diskSpace, setDiskSpace] = useState<DiskSpaceResponse>(null);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [uploadSpeed, setUploadSpeed] = useState<string>('');
  const [enableCompression, setEnableCompression] = useState<boolean>(false);
  const [linkCopied, setLinkCopied] = useState<boolean>(false);
  const [compressionQuality, setCompressionQuality] = useState<
    'professional' | 'high' | 'medium' | 'web'
  >('high');
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean>(false);

  // Load disk space info and FFmpeg status on component mount
  useEffect(() => {
    // Load disk space
    fetch('/api/disk-space')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setDiskSpace(data);
        }
      })
      .catch((err) => console.error('Failed to load disk space:', err));

    // Check FFmpeg availability
    fetch('/api/ffmpeg-status')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setFfmpegAvailable(data.ffmpegAvailable);
        }
      })
      .catch((err) => console.error('Failed to check FFmpeg status:', err));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file || !clientName || !projectName) {
      setError('Please fill in all fields and select a video file');
      return;
    }

    // Check file size (25GB limit for large movies)
    const maxSize = 25 * 1024 * 1024 * 1024; // 25GB
    if (file.size > maxSize) {
      const fileSizeGB =
        Math.round((file.size / 1024 / 1024 / 1024) * 100) / 100;
      setError(
        `File too large. Maximum size is 25GB, your file is ${fileSizeGB} GB`
      );
      return;
    }

    setUploading(true);
    setError('');
    setResult(null);
    setUploadProgress('');
    setProgressPercent(0);
    setUploadSpeed('');

    try {
      if (uploadMode === 's3' && file && file.size > MAX_DIRECT_BYTES) {
        const fileSizeGB =
          Math.round((file.size / 1024 / 1024 / 1024) * 100) / 100;
        setError(
          `File is ${fileSizeGB} GB, which exceeds the ${MAX_DIRECT_GB} GB direct upload limit. Please compress locally first (see instructions below).`
        );
        setUploading(false);
        return;
      }
      if (uploadMode === 's3') {
        // Direct-to-S3 with presigned PUT (Backblaze B2 compatible)
        setUploadProgress('Requesting upload URL...');
        const presignRes = await fetch('/api/uploads/presign-put', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || 'video/mp4',
            contentLength: file.size,
          }),
        });
        if (!presignRes.ok) throw new Error('Failed to presign upload');
        const { url, videoId, key } = await presignRes.json();

        setUploadProgress('Uploading to storage...');

        // Use XMLHttpRequest for progress tracking in S3 uploads too
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const startTime = Date.now();

          // Track upload progress
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const percent = Math.round((e.loaded / e.total) * 100);
              const uploadedMB = Math.round(e.loaded / 1024 / 1024);
              const totalMB = Math.round(e.total / 1024 / 1024);

              // Calculate upload speed
              const elapsed = (Date.now() - startTime) / 1000; // seconds
              setProgressPercent(percent);
              setUploadProgress(
                `${uploadedMB} MB / ${totalMB} MB (${percent}%)`
              );

              if (elapsed > 1 && e.loaded > 0) {
                // Wait at least 1 second for accurate speed calculation
                const speedMBps = e.loaded / 1024 / 1024 / elapsed;
                const remainingBytes = e.total - e.loaded;
                const bytesPerSecond = e.loaded / elapsed;

                if (remainingBytes > 0 && bytesPerSecond > 0) {
                  const remainingSeconds = remainingBytes / bytesPerSecond;
                  const remainingMinutes = Math.round(remainingSeconds / 60);
                  setUploadSpeed(
                    `${speedMBps.toFixed(1)} MB/s - ${remainingMinutes > 0 ? `${remainingMinutes} min` : '< 1 min'} remaining`
                  );
                } else {
                  setUploadSpeed(`${speedMBps.toFixed(1)} MB/s`);
                }
              }
            }
          });

          // Handle completion
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setUploadProgress('Upload complete, finalizing...');
              setProgressPercent(100);
              resolve();
            } else {
              // More specific error messages for different status codes
              let errorMsg = `Storage upload failed (${xhr.status})`;
              if (xhr.status === 403) {
                errorMsg =
                  'Upload failed: Cloud storage bandwidth limit exceeded. Please try again later.';
              } else if (xhr.status === 404) {
                errorMsg =
                  'Upload failed: Cloud storage endpoint not found. Please contact support.';
              } else if (xhr.status >= 500) {
                errorMsg =
                  'Upload failed: Cloud storage server error. Please try again.';
              }
              setError(errorMsg);
              reject(new Error(errorMsg));
            }
          });

          // Handle errors
          xhr.addEventListener('error', () => {
            setError(
              'Upload failed: Network connection error. Please check your internet and try again.'
            );
            reject(new Error('Network error'));
          });

          // Start the upload
          xhr.open('PUT', url);
          xhr.setRequestHeader(
            'Content-Type',
            file.type || 'application/octet-stream'
          );
          xhr.send(file);
        });

        // Register metadata
        setUploadProgress('Finalizing...');
        const register = await fetch('/api/video/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId,
            clientName,
            projectName,
            filename: file.name,
            fileSize: file.size,
            key,
          }),
        });
        const regData = await register.json();
        if (!register.ok || !regData.success) {
          // Provide clearer error message for registration failures
          let errorMsg = regData.error || 'Failed to register metadata';
          if (
            regData.error &&
            regData.error.includes('Daily cloud storage limit reached')
          ) {
            errorMsg = regData.error; // Use the professional error message
          } else if (
            regData.error &&
            regData.error.includes('not found in cloud storage')
          ) {
            errorMsg =
              'Upload completed but file verification failed. This may be due to daily cloud storage transaction limits. Please try again after midnight GMT.';
          } else if (register.status === 404) {
            errorMsg =
              'Upload completed but registration failed. The file was uploaded successfully but could not be registered. Please contact support.';
          }
          setError(errorMsg);
          setUploading(false);
          return;
        }
        setResult({ videoId, metadata: regData.metadata });
        setUploading(false);
        setUploadProgress('');
        setProgressPercent(0);
        setUploadSpeed('');
        setFile(null);
        setClientName('');
        setProjectName('');
        return;
      }

      // Use streaming upload for all files in server mode to get progress tracking
      console.log('Using streaming upload with progress tracking');
      setUploadProgress('Preparing upload...');

      // Use XMLHttpRequest for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const startTime = Date.now();

        // Track upload progress
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            const uploadedMB = Math.round(e.loaded / 1024 / 1024);
            const totalMB = Math.round(e.total / 1024 / 1024);

            // Calculate upload speed
            const elapsed = (Date.now() - startTime) / 1000; // seconds
            const speedMBps = e.loaded / 1024 / 1024 / elapsed;
            const remainingBytes = e.total - e.loaded;
            const remainingTime = remainingBytes / (e.loaded / elapsed);

            setProgressPercent(percent);
            setUploadProgress(`${uploadedMB} MB / ${totalMB} MB (${percent}%)`);
            setUploadSpeed(
              `${speedMBps.toFixed(1)} MB/s - ${Math.round(remainingTime / 60)} min remaining`
            );
          }
        });

        // Handle completion
        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            setUploadProgress('Processing...');
            setProgressPercent(100);
            try {
              const data = JSON.parse(xhr.responseText);
              if (data.success) {
                setResult(data);
                setFile(null);
                setClientName('');
                setProjectName('');
                resolve();
              } else {
                setError(data.error || 'Upload failed');
                reject(new Error(data.error || 'Upload failed'));
              }
            } catch (e) {
              setError('Failed to parse response');
              reject(e);
            }
          } else {
            setError(`Upload failed with status ${xhr.status}`);
            reject(new Error(`HTTP ${xhr.status}`));
          }
        });

        // Handle errors
        xhr.addEventListener('error', () => {
          setError('Network error during upload');
          reject(new Error('Network error'));
        });

        xhr.addEventListener('abort', () => {
          setError('Upload was cancelled');
          reject(new Error('Upload cancelled'));
        });

        // Choose API endpoint based on compression settings
        const apiEndpoint = enableCompression
          ? '/api/upload-with-compression'
          : '/api/upload-stream';

        // Start the upload
        xhr.open('POST', apiEndpoint);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('X-Filename', file.name);
        xhr.setRequestHeader('X-Client-Name', clientName);
        xhr.setRequestHeader('X-Project-Name', projectName);

        if (enableCompression) {
          xhr.setRequestHeader('X-Enable-Compression', 'true');
          xhr.setRequestHeader('X-Compression-Quality', compressionQuality);
        }

        xhr.send(file);
      });
    } catch (err) {
      // Only set error if one hasn't already been set during the upload process
      if (!error) {
        setError(
          'Upload failed: ' +
            (err instanceof Error ? err.message : 'Unknown error')
        );
      }
    } finally {
      setUploading(false);
      setUploadProgress('');
      setProgressPercent(0);
      setUploadSpeed('');
    }
  };

  const copyDownloadLink = async () => {
    if (!result) return;

    // Generate the permanent download link
    const downloadUrl = `${window.location.origin}/api/direct-download/${result.videoId}`;

    try {
      await navigator.clipboard.writeText(downloadUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      alert('Failed to copy link');
    }
  };

  return (
    <main>
      <div className="card">
        <h2>Video Upload</h2>

        {diskSpace && (
          <div
            className={`alert ${diskSpace.warning ? 'alert-warning' : 'alert-info'}`}
          >
            <strong>Disk Space:</strong> {diskSpace.diskSpace.available}{' '}
            available ({diskSpace.diskSpace.percentUsed}% used)
            {diskSpace.warning && (
              <div style={{ marginTop: '5px', fontWeight: 'bold' }}>
                ⚠️ {diskSpace.warning}
              </div>
            )}
          </div>
        )}
        <div style={{ marginBottom: '8px', fontSize: '12px', color: '#666' }}>
          Mode:{' '}
          {uploadMode === 's3'
            ? `Direct-to-Cloud (${s3Endpoint.includes('backblazeb2.com') ? 'Backblaze B2' : 'S3-compatible'})`
            : 'Server Upload'}
        </div>

        <form onSubmit={handleSubmit} style={{ marginTop: '20px' }}>
          <div className="form-group">
            <label htmlFor="clientName">Client Name:</label>
            <input
              type="text"
              id="clientName"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="form-control"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="projectName">Project Name:</label>
            <input
              type="text"
              id="projectName"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="form-control"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="video">Video File:</label>
            <input
              type="file"
              id="video"
              accept="video/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="form-control"
              required
            />
            {file && (
              <div
                style={{ marginTop: '5px', fontSize: '12px', color: '#666' }}
              >
                Selected: {file.name} (
                {file.size > 1024 * 1024 * 1024
                  ? `${Math.round((file.size / 1024 / 1024 / 1024) * 100) / 100} GB`
                  : `${Math.round((file.size / 1024 / 1024) * 100) / 100} MB`}
                )
              </div>
            )}
            {uploadMode === 's3' && file && file.size > MAX_DIRECT_BYTES && (
              <div className="alert alert-warning" style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  File exceeds {MAX_DIRECT_GB} GB direct upload limit
                </div>
                <div>
                  Please compress locally, then upload the compressed file using
                  one of these commands:
                </div>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    background: '#f8f9fa',
                    padding: 8,
                    borderRadius: 4,
                    marginTop: 8,
                  }}
                >
                  ffmpeg -i &quot;INPUT&quot; -c:v libx264 -crf 22 -preset
                  medium -c:a aac -b:a 192k &quot;OUTPUT.mp4&quot;
                </pre>
                <div style={{ marginTop: 6 }}>
                  Tip: Lower CRF (e.g. 18) = higher quality; higher CRF (e.g.
                  26) = smaller size.
                </div>
              </div>
            )}
          </div>

          {/* Video Compression Options */}
          {ffmpegAvailable && file && (
            <div
              className="form-group"
              style={{
                padding: '15px',
                backgroundColor: '#f8f9fa',
                borderRadius: '8px',
                border: '1px solid #dee2e6',
              }}
            >
              <h4 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>
                Video Compression (Optional)
              </h4>

              <div style={{ marginBottom: '10px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={enableCompression}
                    onChange={(e) => setEnableCompression(e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  <span>
                    Compress video to reduce file size (recommended for large
                    files)
                  </span>
                </label>
              </div>

              {enableCompression && (
                <div>
                  <label
                    htmlFor="compressionQuality"
                    style={{
                      display: 'block',
                      marginBottom: '5px',
                      fontSize: '14px',
                    }}
                  >
                    Compression Quality:
                  </label>
                  <select
                    id="compressionQuality"
                    value={compressionQuality}
                    onChange={(e) =>
                      setCompressionQuality(
                        e.target.value as
                          | 'professional'
                          | 'high'
                          | 'medium'
                          | 'web'
                      )
                    }
                    className="form-control"
                  >
                    <option value="professional">
                      🏆 Professional (CRF 14) - Visually lossless, master
                      quality
                    </option>
                    <option value="high">
                      ⭐ High Quality (CRF 18) - Near-lossless, client delivery
                    </option>
                    <option value="medium">
                      📱 Standard (CRF 22) - Excellent quality, balanced size
                    </option>
                    <option value="web">
                      🌐 Web Optimized (CRF 26) - High quality, fast streaming
                    </option>
                  </select>

                  <div
                    style={{
                      marginTop: '8px',
                      fontSize: '12px',
                      color: '#666',
                    }}
                  >
                    💡 Your{' '}
                    {Math.round((file.size / 1024 / 1024 / 1024) * 100) / 100}{' '}
                    GB file could become{' '}
                    {compressionQuality === 'professional' &&
                      '12-16 GB (30-40% smaller)'}
                    {compressionQuality === 'high' &&
                      '8-12 GB (40-60% smaller)'}
                    {compressionQuality === 'medium' &&
                      '5-8 GB (60-75% smaller)'}
                    {compressionQuality === 'web' && '3-5 GB (75-85% smaller)'}{' '}
                    after compression
                  </div>
                </div>
              )}
            </div>
          )}

          {!ffmpegAvailable && file && file.size > 1024 * 1024 * 1024 && (
            <div className="alert alert-warning">
              💡 <strong>Tip:</strong> Install FFmpeg to enable video
              compression and reduce your{' '}
              {Math.round((file.size / 1024 / 1024 / 1024) * 100) / 100} GB file
              size by 60-80%
            </div>
          )}

          <button
            type="submit"
            disabled={
              uploading ||
              (uploadMode === 's3' && !!file && file.size > MAX_DIRECT_BYTES)
            }
            className="btn"
          >
            {uploading ? uploadProgress || 'Uploading...' : 'Upload Video'}
          </button>

          {uploading && (
            <div style={{ marginTop: '15px' }}>
              <div className="progress-bar">
                <div
                  className="progress-bar-inner"
                  style={{ width: `${progressPercent}%` }}
                >
                  {progressPercent > 0 && `${progressPercent}%`}
                </div>
              </div>

              <div
                style={{ fontSize: '14px', color: '#666', marginBottom: '5px' }}
              >
                <strong>Status:</strong> {uploadProgress || 'Starting...'}
              </div>

              {uploadSpeed && (
                <div style={{ fontSize: '12px', color: '#888' }}>
                  <strong>Speed:</strong> {uploadSpeed}
                </div>
              )}

              {file && file.size > 1024 * 1024 * 1024 && (
                <div
                  style={{
                    marginTop: '10px',
                    fontSize: '12px',
                    color: '#666',
                    fontStyle: 'italic',
                  }}
                >
                  Large file detected: Using streaming upload for better
                  performance.
                </div>
              )}
            </div>
          )}
        </form>
      </div>

      {error && <div className="alert alert-danger">Error: {error}</div>}

      {result && (
        <div className="alert alert-success">
          <h3>Upload Successful!</h3>
          <p>
            <strong>Video ID:</strong> {result.videoId}
          </p>
          <p>
            <strong>Client:</strong> {result.metadata.clientName}
          </p>
          <p>
            <strong>Project:</strong> {result.metadata.projectName}
          </p>
          <p>
            <strong>File Size:</strong>{' '}
            {result.metadata.fileSize > 1024 * 1024 * 1024
              ? `${Math.round((result.metadata.fileSize / 1024 / 1024 / 1024) * 100) / 100} GB`
              : `${Math.round((result.metadata.fileSize / 1024 / 1024) * 100) / 100} MB`}
          </p>
          {result.compression && (
            <p>
              <strong>Compression:</strong>{' '}
              {result.compression.compressionRatio.toFixed(1)}% size reduction (
              {Math.round(
                (result.compression.originalSize / 1024 / 1024 / 1024) * 100
              ) / 100}{' '}
              GB →{' '}
              {Math.round(
                (result.compression.compressedSize / 1024 / 1024 / 1024) * 100
              ) / 100}{' '}
              GB)
            </p>
          )}
          <p>
            <strong>Status:</strong> {result.metadata.status}
          </p>
          <div style={{ marginTop: '20px' }}>
            <strong>Permanent Download Link:</strong>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginTop: '10px',
                padding: '10px',
                background: '#f8f9fa',
                borderRadius: '4px',
                border: '1px solid #dee2e6',
              }}
            >
              <code style={{ flex: 1, wordBreak: 'break-all' }}>
                {window.location.origin}/api/direct-download/{result.videoId}
              </code>
              <button
                onClick={copyDownloadLink}
                style={{
                  padding: '6px 12px',
                  background: linkCopied ? '#28a745' : '#25D366',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {linkCopied ? '✅ Copied!' : '💬 Copy for WhatsApp'}
              </button>
            </div>
            <p
              style={{ marginTop: '10px', fontSize: '14px', color: '#6c757d' }}
            >
              ✨ This link is permanent - share it anytime! Your client can
              click it to download the video directly.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
