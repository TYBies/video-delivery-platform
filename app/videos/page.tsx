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
  const [health, setHealth] = useState<any>(null);
  const [running, setRunning] = useState<boolean>(false);
  

  const loadVideos = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/video', { cache: 'no-store' });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (errorData.rateLimited) {
          throw new Error(errorData.error || 'Daily limit reached. Please try again later.');
        }
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setVideos(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message || 'Failed to load videos');
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
      const res = await fetch(`/api/video/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      // Always refresh the video list after a delete attempt
      await loadVideos();

      // Show warning if there were issues with index update
      if (data.warning) {
        alert(`Video deleted successfully, but: ${data.warning}`);
      }
    } catch (e: any) {
      alert(`Delete failed: ${e.message || e}`);
      // Still refresh the list in case the delete partially succeeded
      await loadVideos();
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
    if (bytes >= 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024 / 1024 * 100) / 100} GB`;
    return `${Math.round(bytes / 1024 / 1024 * 100) / 100} MB`;
  };

  return (
    <main style={{ maxWidth: '900px', margin: '0 auto', padding: '20px' }}>
      <h1>Videos</h1>

      <div className="nav-buttons" style={{ display: 'flex', gap: '10px', margin: '15px 0' }}>
        <a href="/upload" style={{ padding: '8px 12px', background: '#007bff', color: 'white', borderRadius: 4, textDecoration: 'none' }}>Upload</a>
        <button onClick={loadVideos} disabled={loading} style={{ padding: '8px 12px' }}>{loading ? 'Refreshing...' : 'Refresh'}</button>
        <button onClick={runStartup} disabled={running} style={{ padding: '8px 12px' }}>{running ? 'Working...' : 'Run Startup Tasks'}</button>
        <button onClick={runRecovery} disabled={running} style={{ padding: '8px 12px' }}>{running ? 'Working...' : 'Run Recovery'}</button>
      </div>

      {health && (
        <div style={{ background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: 4, padding: 12, marginBottom: 16, fontSize: 14 }}>
          <strong>System Health:</strong> {health.systemStatus} | Active uploads: {health.activeUploads} | Orphans: {health.orphanedFiles}
        </div>
      )}

      {error && (
        <div style={{ background: '#f8d7da', color: '#721c24', padding: 10, borderRadius: 4, marginBottom: 12 }}>{error}</div>
      )}
      

      {videos.length === 0 && !loading && (
        <div style={{ color: '#666' }}>No videos yet. Upload one to get started.</div>
      )}

      <div>
        {videos.map(v => (
          <div key={v.id} className="video-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #eee' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{v.filename}</div>
              <div className="video-info" style={{ fontSize: 13, color: '#666' }}>{v.clientName} • {v.projectName} • {fmtSize(v.fileSize)} • {new Date(v.uploadDate).toLocaleString()} • {v.status}</div>
            </div>
            <div className="video-actions" style={{ display: 'flex', gap: '8px' }}>
              <a href={`/api/download/${v.id}`} style={{ padding: '6px 10px', background: '#17a2b8', color: 'white', borderRadius: 4, textDecoration: 'none' }}>Download</a>
              <a href={`/api/video/${v.id}`} target="_blank" rel="noreferrer" style={{ padding: '6px 10px', background: '#6c757d', color: 'white', borderRadius: 4, textDecoration: 'none' }}>Details</a>
              <button onClick={() => deleteVideo(v.id)} disabled={busyId === v.id} style={{ padding: '6px 10px', background: '#dc3545', color: 'white', border: 'none', borderRadius: 4 }}>{busyId === v.id ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
