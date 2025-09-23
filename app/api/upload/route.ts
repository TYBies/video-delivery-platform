import { NextRequest, NextResponse } from 'next/server';
import { HybridStorage } from '@/lib/hybrid-storage';

export async function POST(request: NextRequest) {
  console.log('Upload API called');

  try {
    // Initialize cloud-only storage
    console.log('Initializing cloud storage...');
    const hybridStorage = new HybridStorage();

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

    // Check file size before processing
    const fileSizeGB = Math.round(file.size / 1024 / 1024 / 1024 * 100) / 100;
    console.log(`File size: ${file.size} bytes (${fileSizeGB} GB)`);

    // Limit file size to 25GB for large movie files
    const maxSize = 25 * 1024 * 1024 * 1024; // 25GB
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: `File too large. Maximum size is 25GB, your file is ${fileSizeGB} GB` },
        { status: 413 }
      );
    }

    // Convert file to buffer
    console.log(`Converting file to buffer...`);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log(`Buffer created. Size: ${buffer.length} bytes`);

    // Save video directly to cloud storage
    console.log('Saving video to cloud storage...');
    const metadata = await hybridStorage.saveVideo(
      buffer,
      file.name,
      clientName,
      projectName
    );
    console.log('Video saved successfully to cloud:', metadata.id);

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
    console.error('Upload error:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Upload failed' 
      },
      { status: 500 }
    );
  }
}