import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const qualityInfo = {
    professional: {
      crf: 14,
      description: "Visually lossless quality",
      useCase: "Master copies, archival, color grading",
      compressionRatio: "30-40%",
      audioBitrate: "320k",
      preset: "slow",
      pros: ["Indistinguishable from original", "Perfect for editing", "Future-proof"],
      cons: ["Larger file size", "Slower compression"]
    },
    high: {
      crf: 18,
      description: "Near-lossless quality",
      useCase: "Client delivery, final presentations",
      compressionRatio: "40-60%",
      audioBitrate: "256k",
      preset: "medium",
      pros: ["Excellent quality", "Good compression", "Professional standard"],
      cons: ["Slightly larger than standard"]
    },
    medium: {
      crf: 22,
      description: "Excellent quality",
      useCase: "Standard delivery, most use cases",
      compressionRatio: "60-75%",
      audioBitrate: "192k",
      preset: "medium",
      pros: ["Great balance", "Good file size", "Fast compression"],
      cons: ["Minor quality loss in complex scenes"]
    },
    web: {
      crf: 26,
      description: "High quality, optimized for streaming",
      useCase: "Web uploads, social media, previews",
      compressionRatio: "75-85%",
      audioBitrate: "128k",
      preset: "medium",
      pros: ["Small file size", "Fast streaming", "Quick uploads"],
      cons: ["Noticeable quality loss in detailed scenes"]
    }
  };

  return NextResponse.json({
    success: true,
    qualityInfo,
    recommendations: {
      "20GB+ files": "Use 'High Quality' for best balance of quality and size",
      "Client delivery": "Use 'Professional' or 'High Quality'",
      "Web sharing": "Use 'Web Optimized' for fastest uploads",
      "Archive/Master": "Use 'Professional' quality"
    },
    technicalDetails: {
      codec: "H.264 (libx264)",
      audioCodec: "AAC",
      crfScale: "Lower CRF = Better Quality (0-51 scale)",
      webOptimization: "All outputs include faststart flag for web streaming"
    }
  });
}