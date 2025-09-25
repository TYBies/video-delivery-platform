import { NextResponse } from 'next/server';

export async function GET() {
  try {
    console.log('Test API called');

    // Test basic functionality
    const { HybridStorage } = await import('../../../lib/hybrid-storage');
    console.log('HybridStorage imported successfully');

    const hybridStorage = new HybridStorage();
    console.log('HybridStorage instantiated successfully');

    const config = hybridStorage.getConfig();
    console.log('Config retrieved:', config);

    return NextResponse.json({
      success: true,
      message: 'API is working',
      config: config,
    });
  } catch (error) {
    console.error('Test error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Test failed',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
