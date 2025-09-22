# Design Document

## Overview

The videographer platform is built as a Next.js application with a hybrid storage architecture combining local file system storage for immediate access and Cloudflare R2 for backup and failover. The system provides secure video upload, automatic backup, and reliable client download capabilities.

## Architecture

### Technology Stack
- **Frontend:** Next.js 14+ with React
- **Backend:** Next.js API Routes
- **Primary Storage:** Local file system (`./uploads/videos/`)
- **Backup Storage:** Cloudflare R2 (S3-compatible)
- **Database:** JSON files for metadata (upgradeable to SQLite/PostgreSQL)
- **Authentication:** Simple token-based system for videographer access
- **File Upload:** Multer for handling multipart uploads

### System Architecture
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Next.js App   │    │   API Routes     │    │ Local Storage   │
│                 │────│                  │────│                 │
│ - Upload UI     │    │ - /api/upload    │    │ ./uploads/      │
│ - Dashboard     │    │ - /api/download  │    │   videos/       │
│ - Download Page │    │ - /api/videos    │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                │ Backup Process
                                ▼
                       ┌─────────────────┐
                       │  Cloudflare R2  │
                       │                 │
                       │ - Backup Store  │
                       │ - Failover CDN  │
                       └─────────────────┘
```

## Components and Interfaces

### 1. Upload Component (`/components/VideoUpload.tsx`)
```typescript
interface VideoUploadProps {
  onUploadComplete: (videoId: string) => void;
  onUploadProgress: (progress: number) => void;
}

interface UploadResponse {
  success: boolean;
  videoId: string;
  downloadUrl: string;
  error?: string;
}
```

### 2. Video Dashboard (`/pages/dashboard.tsx`)
```typescript
interface VideoMetadata {
  id: string;
  filename: string;
  clientName: string;
  projectName: string;
  uploadDate: Date;
  fileSize: number;
  downloadCount: number;
  status: 'local' | 'backed-up' | 'cloud-only';
  downloadUrl: string;
  isActive: boolean;
}
```

### 3. Storage Service (`/lib/storage.ts`)
```typescript
interface StorageService {
  uploadLocal(file: Buffer, metadata: VideoMetadata): Promise<string>;
  backupToR2(localPath: string, videoId: string): Promise<boolean>;
  getDownloadStream(videoId: string): Promise<ReadableStream>;
  deleteVideo(videoId: string): Promise<boolean>;
  getVideoMetadata(videoId: string): Promise<VideoMetadata>;
}
```

### 4. API Routes Structure
- `POST /api/upload` - Handle video uploads
- `GET /api/download/[videoId]` - Serve video downloads
- `GET /api/videos` - List all videos for dashboard
- `PUT /api/videos/[videoId]` - Update video metadata
- `DELETE /api/videos/[videoId]` - Disable/delete video access

## Data Models

### Video Metadata Schema
```json
{
  "id": "uuid-v4-string",
  "filename": "original-filename.mp4",
  "clientName": "Client Name",
  "projectName": "Project Description",
  "uploadDate": "2024-01-15T10:30:00Z",
  "fileSize": 1048576000,
  "downloadCount": 3,
  "status": "backed-up",
  "localPath": "./uploads/videos/uuid/video.mp4",
  "r2Path": "videos/uuid/video.mp4",
  "downloadUrl": "/download/uuid",
  "isActive": true,
  "checksumMD5": "abc123def456"
}
```

### Directory Structure
```
uploads/
├── videos/
│   ├── [video-uuid]/
│   │   ├── video.mp4
│   │   ├── metadata.json
│   │   └── thumbnail.jpg (optional)
├── temp/
└── metadata/
    └── videos-index.json
```

## Error Handling

### Upload Error Scenarios
1. **File too large:** Return 413 with clear message
2. **Invalid file type:** Return 400 with supported formats
3. **Storage full:** Attempt R2 direct upload, alert admin
4. **R2 backup fails:** Log error, retry with exponential backoff
5. **Metadata corruption:** Regenerate from file system scan

### Download Error Scenarios
1. **Video not found locally:** Attempt R2 retrieval
2. **R2 unavailable:** Return cached error page with retry option
3. **Invalid video ID:** Return 404 with helpful message
4. **Disabled access:** Return 403 with contact information

### Failover Logic
```typescript
async function getVideoStream(videoId: string): Promise<ReadableStream> {
  try {
    // Try local first
    return await getLocalStream(videoId);
  } catch (localError) {
    console.log('Local failed, trying R2:', localError);
    try {
      return await getR2Stream(videoId);
    } catch (r2Error) {
      throw new Error('Video unavailable from all sources');
    }
  }
}
```

## Testing Strategy

### Unit Tests
- Storage service functions (upload, backup, retrieval)
- Metadata validation and serialization
- Error handling for various failure scenarios
- File type and size validation

### Integration Tests
- Complete upload workflow (local + R2 backup)
- Download failover scenarios
- API route responses and error codes
- File cleanup and storage management

### End-to-End Tests
- Videographer upload flow
- Client download experience
- Dashboard functionality
- Storage quota and cleanup processes

### Performance Tests
- Large file upload handling
- Concurrent download performance
- R2 backup speed and reliability
- Storage space monitoring

## Security Considerations

### Upload Security
- File type validation (whitelist: .mp4, .mov, .avi, .mkv)
- File size limits (configurable, default 2GB)
- Virus scanning integration (optional)
- Rate limiting on upload endpoints

### Download Security
- UUID-based video IDs (non-guessable)
- Optional expiration dates for download links
- Download attempt logging
- IP-based rate limiting

### Access Control
- Simple admin authentication for videographer dashboard
- No client authentication required (link-based access)
- Secure token generation for admin sessions
- Environment variable configuration for sensitive data

## Deployment Configuration

### Environment Variables
```env
CLOUDFLARE_R2_ACCOUNT_ID=your-account-id
CLOUDFLARE_R2_ACCESS_KEY=your-access-key
CLOUDFLARE_R2_SECRET_KEY=your-secret-key
CLOUDFLARE_R2_BUCKET=videographer-platform
UPLOAD_MAX_SIZE=2147483648  # 2GB in bytes
ADMIN_PASSWORD=secure-password-hash
STORAGE_PATH=./uploads
```

### Next.js Configuration
```javascript
// next.config.js
module.exports = {
  api: {
    bodyParser: {
      sizeLimit: '2gb',
    },
  },
  experimental: {
    serverComponentsExternalPackages: ['@aws-sdk/client-s3'],
  },
}
```