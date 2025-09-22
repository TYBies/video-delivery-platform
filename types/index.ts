export interface VideoMetadata {
  id: string;
  filename: string;
  clientName: string;
  projectName: string;
  uploadDate: Date;
  fileSize: number;
  downloadCount: number;
  status: 'local' | 'backed-up' | 'cloud-only';
  localPath?: string;
  r2Path?: string;
  downloadUrl: string;
  isActive: boolean;
  checksumMD5?: string;
  compression?: {
    enabled: boolean;
    status: 'processing' | 'completed' | 'failed' | 'disabled';
    originalSize?: number;
    compressedSize?: number;
    compressionRatio?: number;
    quality?: 'professional' | 'high' | 'medium' | 'web';
    startTime?: Date;
    completedTime?: Date;
  };
}

export interface UploadResponse {
  success: boolean;
  videoId: string;
  downloadUrl: string;
  error?: string;
}

export interface StorageConfig {
  maxFileSize: number;
  allowedTypes: string[];
  storagePath: string;
  r2Config: {
    accountId: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
  };
}

export interface UploadState {
  uploadId: string;
  videoId: string;
  filename: string;
  clientName: string;
  projectName: string;
  totalSize: number;
  uploadedSize: number;
  chunkSize: number;
  lastChunkIndex: number;
  checksumMD5?: string;
  startTime: Date;
  lastActivity: Date;
  status: 'active' | 'paused' | 'failed' | 'completed';
  retryCount: number;
  maxRetries: number;
}

export interface ChunkInfo {
  index: number;
  size: number;
  offset: number;
  checksum: string;
  uploaded: boolean;
}

export interface UploadStateFile {
  uploadId: string;
  videoId: string;
  metadata: {
    filename: string;
    clientName: string;
    projectName: string;
    totalSize: number;
  };
  progress: {
    uploadedSize: number;
    chunkSize: number;
    lastChunkIndex: number;
    completedChunks: number[];
  };
  integrity: {
    expectedChecksum?: string;
    chunkChecksums: { [index: number]: string };
  };
  timing: {
    startTime: Date;
    lastActivity: Date;
    estimatedCompletion?: Date;
  };
  status: {
    current: 'active' | 'paused' | 'failed' | 'completed';
    retryCount: number;
    maxRetries: number;
    lastError?: string;
  };
}

export interface OrphanFile {
  path: string;
  size: number;
  createdDate: Date;
  videoId: string;
}

export interface OrphanRegistry {
  lastScan: Date;
  orphans: {
    [videoId: string]: {
      discoveredDate: Date;
      filePath: string;
      fileSize: number;
      recoveryAttempts: number;
      lastRecoveryAttempt?: Date;
      recoveryStatus: 'pending' | 'recovered' | 'failed' | 'invalid';
      reconstructedMetadata?: Partial<VideoMetadata>;
    };
  };
}