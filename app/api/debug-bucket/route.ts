import { NextResponse } from 'next/server';
import { isS3Enabled, loadS3Config } from '@/lib/s3-config'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

export async function GET() {
  try {
    if (!isS3Enabled()) {
      return NextResponse.json({ error: 'S3 not enabled' }, { status: 400 });
    }

    const cfg = loadS3Config()
    const client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey
      }
    })

    console.log(`Debug: Scanning bucket "${cfg.bucket}" at endpoint "${cfg.endpoint}"`)

    // List all objects in bucket
    const allObjects = await client.send(new ListObjectsV2Command({
      Bucket: cfg.bucket,
      MaxKeys: 1000
    }))

    // List root-level folders
    const rootFolders = await client.send(new ListObjectsV2Command({
      Bucket: cfg.bucket,
      Prefix: '',
      Delimiter: '/'
    }))

    // Also specifically check videos/ subfolder
    const videosFolders = await client.send(new ListObjectsV2Command({
      Bucket: cfg.bucket,
      Prefix: 'videos/',
      Delimiter: '/'
    }))

    // List all objects in videos/ folder
    const videosObjects = await client.send(new ListObjectsV2Command({
      Bucket: cfg.bucket,
      Prefix: 'videos/'
    }))

    const response = {
      bucketName: cfg.bucket,
      endpoint: cfg.endpoint,
      region: cfg.region,
      totalObjects: allObjects.Contents?.length || 0,
      allObjects: allObjects.Contents?.map(obj => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified
      })) || [],
      rootFolders: rootFolders.CommonPrefixes?.map(p => p.Prefix) || [],
      videosFolders: videosFolders.CommonPrefixes?.map(p => p.Prefix) || [],
      videosObjects: videosObjects.Contents?.map(obj => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified
      })) || []
    }

    console.log('Debug response:', JSON.stringify(response, null, 2))
    return NextResponse.json(response)

  } catch (error) {
    console.error('Debug bucket error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: 'Failed to debug bucket',
      details: errorMessage,
      bucketConfig: {
        bucket: loadS3Config().bucket,
        endpoint: loadS3Config().endpoint,
        region: loadS3Config().region
      }
    }, { status: 500 });
  }
}