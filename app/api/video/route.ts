
import { MetadataManager } from '@/lib/metadata';
import { NextResponse } from 'next/server';
import { isS3Enabled, loadS3Config } from '@/lib/s3-config'
import { S3Client, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3'

export async function GET() {
  try {
    if (isS3Enabled()) {
      const cfg = loadS3Config()
      const client = new S3Client({ region: cfg.region, endpoint: cfg.endpoint, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } })

      // First try to get existing metadata index
      let existingVideos: any[] = []
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: 'metadata/videos-index.json' }))
        const text = await (res.Body as any).transformToString()
        const index = JSON.parse(text)
        existingVideos = index.videos || []
      } catch {
        // Index doesn't exist, that's okay - we'll discover videos from bucket
      }

      // Scan entire bucket for all video files regardless of structure
      const allObjectsResult = await client.send(new ListObjectsV2Command({
        Bucket: cfg.bucket,
        MaxKeys: 1000 // Increase limit to ensure we get all objects
      }))

      // Also scan for root-level folders that might contain videos
      const rootFoldersResult = await client.send(new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: '',
        Delimiter: '/'
      }))

      // Find all video files regardless of their location
      const videoExtensions = ['.mov', '.mp4', '.avi', '.mkv', '.webm', '.m4v']
      const videoFiles = allObjectsResult.Contents?.filter(obj => {
        const key = obj.Key || ''
        return videoExtensions.some(ext => key.toLowerCase().endsWith(ext))
      }) || []

      console.log(`Found ${allObjectsResult.Contents?.length || 0} total objects in bucket:`)
      allObjectsResult.Contents?.forEach(obj => console.log(`  - ${obj.Key}`))

      console.log(`\nFound ${rootFoldersResult.CommonPrefixes?.length || 0} root-level folders:`)
      rootFoldersResult.CommonPrefixes?.forEach(prefix => console.log(`  - ${prefix.Prefix}`))

      // For each root-level UUID folder, scan for video files inside
      const additionalVideoFiles = []
      for (const prefix of rootFoldersResult.CommonPrefixes || []) {
        const folderName = prefix.Prefix?.replace('/', '') || ''
        // Check if it looks like a UUID
        if (folderName.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)) {
          console.log(`Scanning UUID folder: ${folderName}`)

          // Scan this folder for video files
          const folderResult = await client.send(new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: `${folderName}/`
          }))

          const folderVideoFiles = folderResult.Contents?.filter(obj => {
            const key = obj.Key || ''
            return videoExtensions.some(ext => key.toLowerCase().endsWith(ext))
          }) || []

          console.log(`  Found ${folderVideoFiles.length} video files in ${folderName}`)
          folderVideoFiles.forEach(file => console.log(`    - ${file.Key}`))

          additionalVideoFiles.push(...folderVideoFiles)
        }
      }

      // Combine video files from direct scan and folder scans
      const allVideoFiles = [...videoFiles, ...additionalVideoFiles]

      console.log(`\nTotal video files found: ${allVideoFiles.length}`)
      allVideoFiles.forEach(file => console.log(`  - ${file.Key}`))

      // Extract video IDs from file paths using various patterns
      const allVideoIds = new Set<string>()

      allVideoFiles.forEach(file => {
        const key = file.Key || ''
        const pathParts = key.split('/')

        // Pattern 1: videos/uuid/filename.mp4
        if (pathParts.length >= 3 && pathParts[0] === 'videos') {
          const videoId = pathParts[1]
          if (videoId.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)) {
            allVideoIds.add(videoId)
          }
        }

        // Pattern 2: uuid/filename.mp4 (root level folders)
        if (pathParts.length >= 2) {
          const potentialId = pathParts[0]
          if (potentialId.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)) {
            allVideoIds.add(potentialId)
          }
        }

        // Pattern 3: filename-uuid.mp4 (filename contains UUID)
        const filename = pathParts[pathParts.length - 1]
        const uuidMatch = filename.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i)
        if (uuidMatch) {
          allVideoIds.add(uuidMatch[1])
        }

        // Pattern 4: Use full file path as ID if no UUID patterns match
        // Only add this if no other patterns matched for this specific file
        let foundMatch = false

        // Check if this file already matched any pattern
        if (pathParts.length >= 3 && pathParts[0] === 'videos') {
          const videoId = pathParts[1]
          if (videoId.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)) {
            foundMatch = true
          }
        }

        if (!foundMatch && pathParts.length >= 2) {
          const potentialId = pathParts[0]
          if (potentialId.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)) {
            foundMatch = true
          }
        }

        if (!foundMatch && uuidMatch) {
          foundMatch = true
        }

        // If no UUID pattern matched, use a hash of the file path as ID
        if (!foundMatch) {
          // Create a unique ID based on the file path
          const pathBasedId = key.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
          allVideoIds.add(pathBasedId)
        }
      })

      console.log(`Discovered ${allVideoIds.size} unique video IDs from ${allVideoFiles.length} video files`)
      console.log(`Video IDs: ${Array.from(allVideoIds).join(', ')}`)

      // Create a map of video files by their derived IDs for easy lookup
      const videoFileMap = new Map<string, any>()
      allVideoFiles.forEach(file => {
        const key = file.Key || ''
        const pathParts = key.split('/')
        const filename = pathParts[pathParts.length - 1]

        // Determine the video ID for this file
        let videoId = ''

        // Pattern 1: videos/uuid/filename.mp4
        if (pathParts.length >= 3 && pathParts[0] === 'videos') {
          const candidateId = pathParts[1]
          if (candidateId.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)) {
            videoId = candidateId
          }
        }

        // Pattern 2: uuid/filename.mp4 (root level folders)
        if (!videoId && pathParts.length >= 2) {
          const potentialId = pathParts[0]
          if (potentialId.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)) {
            videoId = potentialId
          }
        }

        // Pattern 3: filename-uuid.mp4 (filename contains UUID)
        if (!videoId) {
          const uuidMatch = filename.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i)
          if (uuidMatch) {
            videoId = uuidMatch[1]
          }
        }

        // Pattern 4: Use file path as ID if no UUID found
        if (!videoId) {
          videoId = key.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
        }

        videoFileMap.set(videoId, file)
      })

      // For each discovered video ID, check if we have metadata or create basic metadata
      const allVideos = []
      for (const videoId of Array.from(allVideoIds)) {
        // Check if we already have metadata for this video
        let existingVideo = existingVideos.find(v => v.id === videoId)

        if (existingVideo) {
          allVideos.push(existingVideo)
        } else {
          // Get video file info from our map
          const videoFile = videoFileMap.get(videoId)

          if (videoFile && videoFile.Key) {
            try {
              // Get more details about the file
              const headResult = await client.send(new HeadObjectCommand({
                Bucket: cfg.bucket,
                Key: videoFile.Key
              }))

              // Extract filename from path
              const filename = videoFile.Key.split('/').pop() || 'unknown.mov'

              // Create basic metadata for discovered video
              const basicMetadata = {
                id: videoId,
                filename: filename,
                clientName: 'Unknown Client',
                projectName: 'Discovered Video',
                uploadDate: videoFile.LastModified?.toISOString() || new Date().toISOString(),
                fileSize: videoFile.Size || 0,
                downloadCount: 0,
                status: 'cloud-only' as const,
                r2Path: videoFile.Key,
                downloadUrl: `/api/download/${videoId}`,
                isActive: true
              }

              allVideos.push(basicMetadata)
              console.log(`Discovered unregistered video: ${videoId} at ${videoFile.Key}`)
            } catch (error) {
              console.error(`Error processing video file ${videoFile.Key}:`, error)
            }
          }
        }
      }

      console.log(`Returning ${allVideos.length} total videos`)
      return NextResponse.json(allVideos)
    } else {
      const metadataManager = new MetadataManager();
      const videos = await metadataManager.getAllMetadata();
      return NextResponse.json(videos);
    }
  } catch (error) {
    console.error('Error fetching videos:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to fetch videos', details: errorMessage }, { status: 500 });
  }
}
