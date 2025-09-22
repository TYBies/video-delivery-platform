import { NextRequest, NextResponse } from 'next/server';
import { isS3Enabled, loadS3Config } from '@/lib/s3-config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';

function generateUUID(): string {
  return crypto.randomBytes(16).toString('hex');
}

function getFileExtension(filename: string): string {
  const match = filename.toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : '.mp4';
}

export async function POST(request: NextRequest) {
  console.log('Cloud-only upload API called');

  try {
    // Check if S3 is enabled
    if (!isS3Enabled()) {
      return NextResponse.json(
        { success: false, error: 'Cloud storage not configured' },
        { status: 400 }
      );
    }

    // Parse form data
    console.log('Parsing form data...');
    const formData = await request.formData();
    const file = formData.get('video') as File;
    const clientName = formData.get('clientName') as string;
    const projectName = formData.get('projectName') as string;

    // Validate required fields
    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No video file provided' },
        { status: 400 }
      );
    }

    if (!clientName || !projectName) {
      return NextResponse.json(
        { success: false, error: 'Client name and project name are required' },
        { status: 400 }
      );
    }

    const videoId = generateUUID();
    const fileExtension = getFileExtension(file.name);
    const key = `videos/${videoId}/video${fileExtension}`;

    console.log(`File size: ${file.size} bytes`);
    console.log(`Video ID: ${videoId}`);
    console.log(`S3 Key: ${key}`);

    // Convert file to buffer
    console.log('Converting file to buffer...');
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Initialize S3 client
    const cfg = loadS3Config();
    const client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey
      }
    });

    // Upload to S3
    console.log('Uploading to cloud storage...');
    await client.send(new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: buffer,
      ContentType: 'video/mp4'
    }));
    console.log('Upload to cloud successful');

    // Create metadata
    const metadata = {
      id: videoId,
      filename: file.name,
      clientName,
      projectName,
      uploadDate: new Date().toISOString(),
      fileSize: file.size,
      downloadCount: 0,
      status: 'cloud-only',
      r2Path: key,
      downloadUrl: `/download/${videoId}`,
      isActive: true
    };

    // Save metadata to cloud
    console.log('Saving metadata...');
    const metadataKey = `videos/${videoId}/metadata.json`;
    await client.send(new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: metadataKey,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json'
    }));

    // Update index
    console.log('Updating index...');
    let index = { videos: [] as any[] };
    try {
      const indexResponse = await client.send(new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: 'metadata/videos-index.json'
      }));
      const indexText = await (indexResponse.Body as any).transformToString();
      index = JSON.parse(indexText);
    } catch {
      // Index doesn't exist yet, create new one
    }

    // Add this video to index
    index.videos = (index.videos || []).filter((v: any) => v.id !== videoId);
    index.videos.push(metadata);
    index.videos.sort((a: any, b: any) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());

    await client.send(new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: 'metadata/videos-index.json',
      Body: JSON.stringify(index, null, 2),
      ContentType: 'application/json'
    }));

    console.log('Cloud upload completed successfully:', videoId);

    return NextResponse.json({
      success: true,
      videoId: metadata.id,
      downloadUrl: metadata.downloadUrl,
      metadata: {
        filename: metadata.filename,
        clientName: metadata.clientName,
        projectName: metadata.projectName,
        fileSize: metadata.fileSize,
        uploadDate: metadata.uploadDate,
        status: metadata.status
      }
    });

  } catch (error) {
    console.error('Cloud upload error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Cloud upload failed'
      },
      { status: 500 }
    );
  }
}