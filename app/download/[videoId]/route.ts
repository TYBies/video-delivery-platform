import { NextRequest, NextResponse } from 'next/server';
import { MetadataManager } from '@/lib/metadata';
import { isS3Enabled, loadS3Config } from '@/lib/s3-config';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import fs from 'fs';
import type { VideoMetadata } from '@/types';

export async function GET(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  try {
    const { videoId } = params;

    // First try to get metadata from cloud if S3 is enabled
    type BasicMeta = Pick<VideoMetadata, 'filename' | 'fileSize'> & {
      status?: 'local' | 'backed-up' | 'cloud-only';
      r2Path?: string;
      localPath?: string;
      downloadCount?: number;
    };
    let metadata: BasicMeta | null = null;

    if (isS3Enabled()) {
      const cfg = loadS3Config();
      const client = new S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
      });

      try {
        // Get metadata from cloud
        const metadataResponse = await client.send(
          new GetObjectCommand({
            Bucket: cfg.bucket,
            Key: `videos/${videoId}/metadata.json`,
          })
        );
        const metadataText = await (
          metadataResponse.Body as unknown as {
            transformToString: () => Promise<string>;
          }
        ).transformToString();
        metadata = JSON.parse(metadataText) as BasicMeta;

        // For cloud-only videos, stream directly from cloud
        if (metadata.status === 'cloud-only' && metadata.r2Path) {
          console.log(`Streaming cloud video: ${metadata.r2Path}`);

          const videoResponse = await client.send(
            new GetObjectCommand({
              Bucket: cfg.bucket,
              Key: metadata.r2Path,
            })
          );

          // Set appropriate headers
          const headers = new Headers();
          headers.set('Content-Type', 'video/mp4');
          headers.set('Content-Length', metadata.fileSize.toString());
          headers.set(
            'Content-Disposition',
            `attachment; filename="${metadata.filename}"`
          );
          headers.set('Accept-Ranges', 'bytes');

          // Update download count in cloud metadata
          metadata.downloadCount = (metadata.downloadCount || 0) + 1;
          await client.send(
            new PutObjectCommand({
              Bucket: cfg.bucket,
              Key: `videos/${videoId}/metadata.json`,
              Body: JSON.stringify(metadata, null, 2),
              ContentType: 'application/json',
            })
          );

          const body = videoResponse.Body as unknown as
            | ReadableStream
            | { transformToWebStream?: () => ReadableStream };
          const hasTransform =
            typeof (body as { transformToWebStream?: unknown })
              .transformToWebStream === 'function';
          const webBody = hasTransform
            ? (
                body as { transformToWebStream: () => ReadableStream }
              ).transformToWebStream()
            : (body as ReadableStream);
          return new NextResponse(webBody, {
            status: 200,
            headers,
          });
        }
      } catch {
        console.log(`Cloud metadata not found for ${videoId}, trying local...`);
      }
    }

    // Fall back to local metadata if cloud not found
    if (!metadata) {
      const metadataManager = new MetadataManager();
      metadata = await metadataManager.loadMetadata(videoId);
    }

    if (!metadata) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Handle local file download
    if (!metadata.localPath || !fs.existsSync(metadata.localPath)) {
      return NextResponse.json(
        { error: 'Video file not found' },
        { status: 404 }
      );
    }

    // Increment download count for local files
    const metadataManager = new MetadataManager();
    await metadataManager.incrementDownloadCount(videoId);

    // Get file stats
    const stats = fs.statSync(metadata.localPath);
    const fileSize = stats.size;

    // Create readable stream
    const stream = fs.createReadStream(metadata.localPath);

    // Set appropriate headers
    const headers = new Headers();
    headers.set('Content-Type', 'video/mp4');
    headers.set('Content-Length', fileSize.toString());
    headers.set(
      'Content-Disposition',
      `attachment; filename="${metadata.filename}"`
    );
    headers.set('Accept-Ranges', 'bytes');

    // Handle range requests for video streaming
    const range = request.headers.get('range');
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const rangeStream = fs.createReadStream(metadata.localPath, {
        start,
        end,
      });

      headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      headers.set('Content-Length', chunkSize.toString());

      return new NextResponse(rangeStream as unknown as ReadableStream, {
        status: 206,
        headers,
      });
    }

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Download error:', error);

    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
