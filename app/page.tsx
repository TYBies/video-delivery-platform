export default function Home() {
  return (
    <main>
      <div className="card">
        <h2>Welcome to Your Video Delivery Platform</h2>
        <p>This is your central hub for managing and sharing video content with your clients.</p>
      </div>

      <div className="card">
        <h3>Quick Actions</h3>
        <ul className="nav-buttons" style={{ listStyle: 'none', padding: 0, display: 'flex', gap: '10px' }}>
          <li>
            <a href="/upload" className="btn">
              Upload a New Video
            </a>
          </li>
          <li>
            <a href="/videos" className="btn btn-secondary">
              Manage Existing Videos
            </a>
          </li>
        </ul>
      </div>
      
      <div className="card">
        <h3>Platform Features</h3>
        <ul style={{ listStyle: 'none', padding: 0, color: '#666' }}>
          <li style={{ marginBottom: '10px' }}>✅  <strong>Hybrid Storage:</strong> Automatic failover from local to cloud (R2) storage.</li>
          <li style={{ marginBottom: '10px' }}>✅  <strong>Secure Links:</strong> Generate secure, shareable download links for your clients.</li>
          <li style={{ marginBottom: '10px' }}>✅  <strong>Broad Format Support:</strong> MP4, MOV, AVI, MKV, and WebM formats are supported.</li>
          <li style={{ marginBottom: '10px' }}>✅  <strong>Large File Handling:</strong> Optimized for large file uploads with progress tracking.</li>
        </ul>
      </div>
    </main>
  )
}
