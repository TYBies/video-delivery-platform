export interface S3EnvConfig {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function isS3Enabled(): boolean {
  // Enabled if explicit or if any S3/B2 envs are present
  return !!(
    process.env.STORAGE_MODE === 's3' ||
    process.env.S3_ENDPOINT ||
    process.env.B2_S3_ENDPOINT
  )
}

function guessRegionFromEndpoint(endpoint: string): string {
  // e.g., s3.eu-central-003.backblazeb2.com -> eu-central-003
  const m = endpoint.match(/s3\.([^.]+)\./)
  return m ? m[1] : 'us-east-1'
}

export function loadS3Config(): S3EnvConfig {
  // Prefer Backblaze-style env names if present
  const endpoint = (process.env.B2_S3_ENDPOINT || process.env.S3_ENDPOINT || '').trim()
  const bucket = (process.env.B2_BUCKET || process.env.S3_BUCKET || '').trim()
  const region = (process.env.B2_S3_REGION || process.env.S3_REGION || '').trim()
  const accessKeyId = (process.env.B2_KEY_ID || process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = (process.env.B2_APPLICATION_KEY || process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '').trim()

  if (!endpoint) throw new Error('Storage endpoint missing: set B2_S3_ENDPOINT or S3_ENDPOINT')
  if (!bucket) throw new Error('Bucket missing: set B2_BUCKET or S3_BUCKET')
  if (!accessKeyId || !secretAccessKey) throw new Error('Access keys missing: set B2_KEY_ID/B2_APPLICATION_KEY (or S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY)')

  const finalRegion = region || guessRegionFromEndpoint(endpoint)
  return { endpoint, bucket, region: finalRegion, accessKeyId, secretAccessKey }
}

export function handleS3Error(error: any): { message: string; userFriendly: string; isRateLimited: boolean } {
  const errorMessage = error.message || '';
  const errorCode = error.Code || error.$metadata?.httpStatusCode;

  if (error.Code === 'AccessDenied' && errorMessage.includes('bandwidth or transaction')) {
    return {
      message: 'Daily bandwidth or transaction limit reached',
      userFriendly: 'Daily cloud storage limit reached. This will reset at midnight GMT. Please try again later or contact support to increase limits.',
      isRateLimited: true
    };
  }

  if (error.Code === 'AccessDenied' && errorMessage.includes('cap exceeded')) {
    return {
      message: 'Daily transaction cap exceeded',
      userFriendly: 'Daily cloud storage transaction limit reached. This will reset at midnight GMT. Please try again later.',
      isRateLimited: true
    };
  }

  if (error.Code === 'AccessDenied') {
    return {
      message: 'Access denied to cloud storage',
      userFriendly: 'Access to cloud storage was denied. This may be due to daily limits that reset at midnight GMT or configuration issues. Please try again later.',
      isRateLimited: true
    };
  }

  if (error.Code === 'NoSuchKey' || errorCode === 404) {
    return {
      message: 'Resource not found in cloud storage',
      userFriendly: 'The requested file was not found in cloud storage.',
      isRateLimited: false
    };
  }

  if (error.Code === 'InternalError' || errorCode >= 500) {
    return {
      message: 'Cloud storage server error',
      userFriendly: 'Cloud storage is experiencing technical difficulties. Please try again in a few minutes.',
      isRateLimited: false
    };
  }

  return {
    message: errorMessage || 'Unknown cloud storage error',
    userFriendly: 'Cloud storage is temporarily unavailable. Please try again later.',
    isRateLimited: false
  };
}
