import { NextRequest, NextResponse } from 'next/server';
import { DiskSpaceManager } from '@/lib/disk-space';

export async function GET(request: NextRequest) {
  try {
    const diskSpace = DiskSpaceManager.getReadableDiskSpace();
    const warning = DiskSpaceManager.getDiskSpaceWarning();

    return NextResponse.json({
      success: true,
      diskSpace,
      warning
    });

  } catch (error) {
    console.error('Disk space check error:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to check disk space' 
      },
      { status: 500 }
    );
  }
}