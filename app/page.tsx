export default function Home() {
  return (
    <main style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
      <h1>Videographer Platform</h1>
      <p>Welcome to your video delivery platform</p>
      
      <div style={{ marginTop: '30px' }}>
        <h2>Quick Actions</h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li style={{ marginBottom: '10px' }}>
            <a 
              href="/upload" 
              style={{ 
                display: 'inline-block',
                backgroundColor: '#007bff', 
                color: 'white', 
                padding: '10px 20px', 
                textDecoration: 'none', 
                borderRadius: '4px' 
              }}
            >
              Upload Video
            </a>
          </li>
          <li>
            <a 
              href="/videos" 
              style={{ 
                display: 'inline-block',
                backgroundColor: '#17a2b8', 
                color: 'white', 
                padding: '10px 20px', 
                textDecoration: 'none', 
                borderRadius: '4px' 
              }}
            >
              Manage Videos
            </a>
          </li>
        </ul>
      </div>
      
      <div style={{ marginTop: '30px', fontSize: '14px', color: '#666' }}>
        <h3>Features</h3>
        <ul>
          <li>✅ Local storage with automatic R2 backup</li>
          <li>✅ Secure download links for clients</li>
          <li>✅ Support for MP4, MOV, AVI, MKV, WebM formats</li>
          <li>✅ Automatic failover to cloud storage</li>
        </ul>
      </div>
    </main>
  )
}
