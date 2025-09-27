'use client';

import { useEffect, useState } from 'react';

type Video = {
  id: string;
  filename: string;
  clientName: string;
  projectName: string;
  uploadDate: string;
  fileSize: number;
  status: 'local' | 'backed-up' | 'cloud-only';
  isActive: boolean;
};

export default function VideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [busyId, setBusyId] = useState<string>('');
  type SystemHealth = {
    systemStatus: string;
    activeUploads: number;
    orphanedFiles: number;
    lastOrphanScan: string | null;
  } | null;
  const [health, setHealth] = useState<SystemHealth>(null);
  const [running, setRunning] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string>('');
  const [linkLoading, setLinkLoading] = useState<string>('');

  const loadVideos = async () => {
    setLoading(true);
    setError('');
    try {
      // Add timestamp to bust cache completely
      const timestamp = new Date().getTime();
      const res = await fetch(`/api/video?_t=${timestamp}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (errorData.rateLimited) {
          throw new Error(
            errorData.error || 'Daily limit reached. Please try again later.'
          );
        }
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setVideos(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load videos';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const loadHealth = async () => {
    try {
      const res = await fetch('/api/system/health', { cache: 'no-store' });
      const data = await res.json();
      if (data.success) setHealth(data.health);
      else setHealth(data.health);
    } catch {}
  };

  useEffect(() => {
    loadVideos();
    loadHealth();
  }, []);

  const deleteVideo = async (id: string) => {
    if (!confirm('Delete this video and its metadata?')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/video/${id}`, {
        method: 'DELETE',
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      // Optimistically remove from UI first for immediate feedback
      setVideos((prevVideos) => prevVideos.filter((video) => video.id !== id));

      // Then refresh to ensure consistency with server state
      setTimeout(async () => {
        await loadVideos();
      }, 100);

      // Show success message
      const message = data.warning
        ? `Video deleted successfully, but: ${data.warning}`
        : 'Video deleted successfully!';

      // Use a non-blocking notification instead of alert
      console.log(message);

      // Optionally show a toast notification if you prefer
      // You could replace this with a proper toast system
      if (data.warning) {
        alert(message); // Only show alert for warnings
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);

      // If video not found (404), don't restore it - keep it removed from UI
      // since backend has invalidated cache and video shouldn't exist
      if (msg.includes('not found') || msg.includes('404')) {
        // Video was correctly removed from UI, show info message instead of error
        console.log(`Video was already deleted or doesn't exist: ${msg}`);
      } else {
        // For other errors, restore the video in UI
        await loadVideos();
        alert(`Delete failed: ${msg}`);
      }
    } finally {
      setBusyId('');
    }
  };

  const runStartup = async () => {
    setRunning(true);
    try {
      await fetch('/api/system/startup', { method: 'POST' });
      await Promise.all([loadVideos(), loadHealth()]);
    } finally {
      setRunning(false);
    }
  };

  const runRecovery = async () => {
    setRunning(true);
    try {
      await fetch('/api/system/recovery', { method: 'POST' });
      await Promise.all([loadVideos(), loadHealth()]);
    } finally {
      setRunning(false);
    }
  };

  const fmtSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024)
      return `${Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100} GB`;
    return `${Math.round((bytes / 1024 / 1024) * 100) / 100} MB`;
  };

  const copyDownloadLink = async (videoId: string) => {
    setLinkLoading(videoId);
    try {
      const response = await fetch(`/api/download-link/${videoId}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error('Failed to get download link');
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to get download link');
      }

      // Copy the direct download URL to clipboard
      const downloadUrl = `${window.location.origin}/api/download/${videoId}?presigned=1`;
      await navigator.clipboard.writeText(downloadUrl);

      setCopiedId(videoId);
      setTimeout(() => setCopiedId(''), 2000);

      console.log(
        `Download link copied (${data.isFromCache ? 'cached' : 'new'}). Access count: ${data.accessCount}`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to copy link';
      alert(`Failed to copy download link: ${message}`);
    } finally {
      setLinkLoading('');
    }
  };

  return (
    <main style={{ maxWidth: '900px', margin: '0 auto', padding: '20px' }}>
      <h1>Videos</h1>

      <div
        className="nav-buttons"
        style={{ display: 'flex', gap: '10px', margin: '15px 0' }}
      >
        <a
          href="/upload"
          style={{
            padding: '8px 12px',
            background: '#007bff',
            color: 'white',
            borderRadius: 4,
            textDecoration: 'none',
          }}
        >
          Upload
        </a>
        <button
          onClick={loadVideos}
          disabled={loading}
          style={{ padding: '8px 12px' }}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        <button
          onClick={runStartup}
          disabled={running}
          style={{ padding: '8px 12px' }}
        >
          {running ? 'Working...' : 'Run Startup Tasks'}
        </button>
        <button
          onClick={runRecovery}
          disabled={running}
          style={{ padding: '8px 12px' }}
        >
          {running ? 'Working...' : 'Run Recovery'}
        </button>
      </div>

      {health && (
        <div
          style={{
            background: '#f8f9fa',
            border: '1px solid #dee2e6',
            borderRadius: 4,
            padding: 12,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          <strong>System Health:</strong> {health.systemStatus} | Active
          uploads: {health.activeUploads} | Orphans: {health.orphanedFiles}
        </div>
      )}

      {error && (
        <div
          style={{
            background: '#f8d7da',
            color: '#721c24',
            padding: 10,
            borderRadius: 4,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {videos.length === 0 && !loading && (
        <div style={{ color: '#666' }}>
          No videos yet. Upload one to get started.
        </div>
      )}

      <div>
        {videos.map((v) => (
          <div
            key={v.id}
            className="video-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 0',
              borderBottom: '1px solid #eee',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{v.filename}</div>
              <div
                className="video-info"
                style={{ fontSize: 13, color: '#666' }}
              >
                {v.clientName} • {v.projectName} • {fmtSize(v.fileSize)} •{' '}
                {new Date(v.uploadDate).toLocaleString()} • {v.status}
              </div>
            </div>
            <div
              className="video-actions"
              style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}
            >
              <a
                href={`/api/download/${v.id}`}
                style={{
                  padding: '6px 10px',
                  background: '#17a2b8',
                  color: 'white',
                  borderRadius: 4,
                  textDecoration: 'none',
                  fontSize: '14px',
                }}
              >
                Download
              </a>
              <button
                onClick={() => copyDownloadLink(v.id)}
                disabled={linkLoading === v.id}
                style={{
                  padding: '6px 10px',
                  background: copiedId === v.id ? '#28a745' : '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                {linkLoading === v.id
                  ? '⏳'
                  : copiedId === v.id
                    ? '✅ Copied!'
                    : '🔗 Copy Link'}
              </button>
              <a
                href={`/api/video/${v.id}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  padding: '6px 10px',
                  background: '#6c757d',
                  color: 'white',
                  borderRadius: 4,
                  textDecoration: 'none',
                  fontSize: '14px',
                }}
              >
                Details
              </a>
              <button
                onClick={() => deleteVideo(v.id)}
                disabled={busyId === v.id}
                style={{
                  padding: '6px 10px',
                  background: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  fontSize: '14px',
                }}
              >
                {busyId === v.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
