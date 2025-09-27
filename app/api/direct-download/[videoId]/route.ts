import { NextRequest, NextResponse } from 'next/server';
import { MetadataManager } from '@/lib/metadata';
import { isS3Enabled, loadS3Config } from '@/lib/s3-config';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getFileExtension, getVideoContentTypeByExt } from '@/lib/mime';
import { HybridStorage } from '@/lib/hybrid-storage';

export async function GET(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  try {
    const { videoId } = params;

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    const metadataManager = new MetadataManager();
    const meta = await metadataManager.loadMetadata(videoId);

    if (!meta) {
      return NextResponse.json(
        { error: 'Video metadata not found' },
        { status: 404 }
      );
    }

    if (!meta.isActive) {
      return NextResponse.json(
        { error: 'Video access has been disabled' },
        { status: 403 }
      );
    }

    // Get the filename for Content-Disposition header
    const filename = meta.filename || `video_${videoId}.mp4`;
    const ext = getFileExtension(filename);

    // If S3/B2 mode, stream from cloud
    if (isS3Enabled()) {
      // Use r2Path from metadata if available, otherwise construct path
      let key = meta.r2Path;
      if (!key) {
        key = `videos/${videoId}/${filename}`;
      }

      const cfg = loadS3Config();
      const client = new S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
      });

      let s3Obj;
      try {
        s3Obj = await client.send(
          new GetObjectCommand({ Bucket: cfg.bucket, Key: key })
        );
        console.log(`Streaming video for direct download: ${key}`);
      } catch (e) {
        console.error(`Video file not found at: ${key}`, e);
        return NextResponse.json(
          { error: 'Video file not found' },
          { status: 404 }
        );
      }

      const headers = new Headers();
      const contentType = s3Obj.ContentType || getVideoContentTypeByExt(ext);
      const size = s3Obj.ContentLength || 0;

      // Force download with attachment disposition
      headers.set('Content-Type', contentType);
      if (size) headers.set('Content-Length', String(size));
      headers.set('Content-Disposition', `attachment; filename="${filename}"`);

      // Add cache headers for performance
      headers.set('Cache-Control', 'public, max-age=31536000'); // 1 year cache
      headers.set('X-Video-Source', 'cloud-direct');

      const body = s3Obj.Body as unknown as {
        transformToWebStream?: () => ReadableStream;
      };
      const webStream = body?.transformToWebStream?.();

      if (!webStream) {
        return NextResponse.json(
          { error: 'Unable to stream from cloud storage' },
          { status: 500 }
        );
      }

      return new NextResponse(webStream, { status: 200, headers });
    }

    // Fallback to hybrid storage for local mode
    const hybridStorage = new HybridStorage();
    const { stream, size, source } =
      await hybridStorage.getVideoStream(videoId);

    // Set headers to force download
    const headers = new Headers();
    headers.set('Content-Type', getVideoContentTypeByExt(ext));
    headers.set('Content-Length', size.toString());
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);

    // Cache control based on source
    if (source === 'r2') {
      headers.set('Cache-Control', 'public, max-age=31536000');
    } else {
      headers.set('Cache-Control', 'no-store');
    }
    headers.set('X-Video-Source', source);

    // Create readable stream for the response
    const readableStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });

        stream.on('end', () => {
          controller.close();
        });

        stream.on('error', (error) => {
          controller.error(error);
        });
      },
    });

    return new NextResponse(readableStream, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Direct download error:', error);
    return NextResponse.json(
      { error: 'Failed to download video' },
      { status: 500 }
    );
  }
}
