import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

export interface CompressionOptions {
    quality: 'professional' | 'high' | 'medium' | 'web';
    preset: 'ultrafast' | 'fast' | 'medium' | 'slow' | 'veryslow';
    audioBitrate: '96k' | '128k' | '192k' | '256k' | '320k';
}

export interface CompressionResult {
    success: boolean;
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
    outputPath: string;
    error?: string;
}

export class VideoProcessor {
    /**
     * Compress video using FFmpeg
     */
    static async compressVideo(
        inputPath: string,
        outputPath: string,
        options: CompressionOptions = {
            quality: 'high',
            preset: 'medium',
            audioBitrate: '128k'
        },
        onProgress?: (progress: number) => void
    ): Promise<CompressionResult> {
        try {
            // Get original file size
            const originalStats = await fs.stat(inputPath);
            const originalSize = originalStats.size;

            // Determine CRF (quality) based on options
            const crfValues = {
                professional: '14',  // Visually lossless (master/archive)
                high: '18',          // Near-lossless (client delivery)
                medium: '22',        // Excellent quality (standard delivery)
                web: '26'            // High quality (web/streaming)
            };

            const crf = crfValues[options.quality];

            // Build FFmpeg command
            const ffmpegArgs = [
                '-i', inputPath,
                '-c:v', 'libx264',
                '-crf', crf,
                '-preset', options.preset,
                '-c:a', 'aac',
                '-b:a', options.audioBitrate,
                '-movflags', '+faststart', // Optimize for web streaming
                '-y', // Overwrite output file
                outputPath
            ];

            console.log(`Starting video compression: ${path.basename(inputPath)}`);
            console.log(`FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`);

            // Execute FFmpeg
            await new Promise<void>((resolve, reject) => {
                const ffmpeg = spawn('ffmpeg', ffmpegArgs);

                let duration = 0;
                let currentTime = 0;

                // Parse FFmpeg output for progress
                ffmpeg.stderr.on('data', (data: Buffer) => {
                    const output = data.toString();

                    // Extract duration
                    const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})/);
                    if (durationMatch) {
                        const hours = parseInt(durationMatch[1]);
                        const minutes = parseInt(durationMatch[2]);
                        const seconds = parseInt(durationMatch[3]);
                        duration = hours * 3600 + minutes * 60 + seconds;
                    }

                    // Extract current time
                    const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})/);
                    if (timeMatch && duration > 0) {
                        const hours = parseInt(timeMatch[1]);
                        const minutes = parseInt(timeMatch[2]);
                        const seconds = parseInt(timeMatch[3]);
                        currentTime = hours * 3600 + minutes * 60 + seconds;

                        const progress = Math.min((currentTime / duration) * 100, 100);
                        if (onProgress) {
                            onProgress(Math.round(progress));
                        }
                    }
                });

                ffmpeg.on('close', (code) => {
                    if (code === 0) {
                        console.log('Video compression completed successfully');
                        resolve();
                    } else {
                        reject(new Error(`FFmpeg exited with code ${code}`));
                    }
                });

                ffmpeg.on('error', (error) => {
                    reject(error);
                });
            });

            // Get compressed file size
            const compressedStats = await fs.stat(outputPath);
            const compressedSize = compressedStats.size;
            const compressionRatio = ((originalSize - compressedSize) / originalSize) * 100;

            console.log(`Compression complete:`);
            console.log(`  Original: ${Math.round(originalSize / 1024 / 1024)} MB`);
            console.log(`  Compressed: ${Math.round(compressedSize / 1024 / 1024)} MB`);
            console.log(`  Saved: ${compressionRatio.toFixed(1)}%`);

            return {
                success: true,
                originalSize,
                compressedSize,
                compressionRatio,
                outputPath
            };

        } catch (error) {
            console.error('Video compression failed:', error);
            return {
                success: false,
                originalSize: 0,
                compressedSize: 0,
                compressionRatio: 0,
                outputPath: '',
                error: error instanceof Error ? error.message : 'Unknown compression error'
            };
        }
    }

    /**
     * Check if FFmpeg is available
     */
    static async checkFFmpegAvailable(): Promise<boolean> {
        try {
            await new Promise<void>((resolve, reject) => {
                const ffmpeg = spawn('ffmpeg', ['-version']);

                ffmpeg.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error('FFmpeg not found'));
                    }
                });

                ffmpeg.on('error', (error) => {
                    reject(error);
                });
            });

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get video information using FFprobe
     */
    static async getVideoInfo(filePath: string): Promise<{
        duration: number;
        width: number;
        height: number;
        bitrate: number;
        codec: string;
    } | null> {
        try {
            const result = await new Promise<string>((resolve, reject) => {
                const ffprobe = spawn('ffprobe', [
                    '-v', 'quiet',
                    '-print_format', 'json',
                    '-show_format',
                    '-show_streams',
                    filePath
                ]);

                let output = '';
                ffprobe.stdout.on('data', (data) => {
                    output += data.toString();
                });

                ffprobe.on('close', (code) => {
                    if (code === 0) {
                        resolve(output);
                    } else {
                        reject(new Error('FFprobe failed'));
                    }
                });

                ffprobe.on('error', reject);
            });

            const info = JSON.parse(result);
            const videoStream = info.streams.find((s: any) => s.codec_type === 'video');

            if (!videoStream) {
                return null;
            }

            return {
                duration: parseFloat(info.format.duration || '0'),
                width: videoStream.width || 0,
                height: videoStream.height || 0,
                bitrate: parseInt(info.format.bit_rate || '0'),
                codec: videoStream.codec_name || 'unknown'
            };

        } catch (error) {
            console.error('Failed to get video info:', error);
            return null;
        }
    }
}