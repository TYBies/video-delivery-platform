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
