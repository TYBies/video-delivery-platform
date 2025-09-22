# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js-based video delivery platform for videographers to upload videos and share download links with clients. It supports hybrid storage (local + cloud backup) with Cloudflare R2 and S3-compatible services.

## Development Commands

### Core Development
- `npm run dev` - Start development server on localhost:3000
- `npm run build` - Build production version
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm test` - Run Jest tests

### Script Commands
Scripts in `/scripts` directory, run with `npx tsx`:
- `npx tsx scripts/startup.ts` - Initialize system and run startup checks
- `npx tsx scripts/recover-orphans.ts` - Recover orphaned video files
- `npx tsx scripts/test-automatic-recovery.ts` - Test recovery functionality

### Testing
- Single test: `npm test -- --testNamePattern="test name"`
- Specific file: `npm test -- <pattern>` (e.g., `npm test -- upload-state-manager`)
- Watch mode: `npm test -- --watch`

## Architecture Overview

### Storage System
The platform uses a cloud-first storage architecture with strict error handling:

**Core Components:**
- `lib/storage.ts` - Local filesystem storage with UUID-based organization (`LocalStorage` class)
- `lib/r2-storage.ts` - Cloudflare R2 cloud storage client (`R2Storage` class)
- `lib/r2-client.ts` - R2 connection and configuration management
- `lib/streaming-upload.ts` - Chunked upload handling with state persistence
- `lib/directory.ts` - Directory and file management utilities

**Video Organization:**
- Videos stored primarily in cloud storage (R2/S3-compatible)
- Cloud storage path: `videos/{videoId}/video.{ext}` format
- Local storage used only for temporary processing during upload
- Metadata tracking via `VideoMetadata` interface with download URLs
- Automatic MD5 checksums for integrity verification
- Support for MP4, MOV, AVI, MKV, WebM formats with configurable size limits

### API Structure
Key API routes in `app/api/`:
- **Upload**: `/api/video/route.ts`, `/api/upload-with-compression/route.ts`, `/api/uploads/presign/route.ts`
- **Video Management**: `/api/video/[videoId]/route.ts`, `/api/video/[videoId]/status/route.ts`
- **Downloads**: `/api/download/[videoId]/route.ts`, `/download/[videoId]/route.ts`
- **System**: `/api/system/health/route.ts`, `/api/system/startup/route.ts`, `/api/disk-space/route.ts`
- **Upload Progress**: `/api/upload-progress/[uploadId]/route.ts`

### Key Services
- `lib/orphan-recovery-service.ts` - Recovers videos missing metadata
- `lib/background-recovery-service.ts` - Automated cleanup and recovery
- `lib/startup-service.ts` - Application initialization and health checks
- `lib/app-initializer.ts` - System initialization and startup coordination
- `lib/s3-presign-post.ts` - S3 presigned URL generation for direct uploads

### Configuration
Environment variables are defined in `.env.local.example`:
- Storage paths and upload limits
- Cloudflare R2 or S3-compatible credentials
- Upload mode: `server` (via Next.js) or `s3` (direct-to-cloud)

### Type Definitions
All interfaces defined in `types/index.ts`:
- `VideoMetadata` - Complete video information with storage status and compression details
- `UploadState` & `UploadStateFile` - Chunked upload progress tracking with resume capability
- `OrphanFile` & `OrphanRegistry` - System for tracking and recovering orphaned files
- `StorageConfig` - Configuration for storage backends and limits
- `ChunkInfo` - Individual chunk tracking for uploads

## File Structure Patterns
- `/app/api/*` - Next.js API routes
- `/app/*` - Next.js pages and layouts
- `/lib/*` - Core business logic and services
- `/types/*` - TypeScript type definitions
- `/__tests__/*` - Jest test files

## Important Notes
- **Cloud-First Architecture**: All videos must be stored to cloud storage (R2/S3-compatible)
- **Strict Error Handling**: If cloud upload fails, throw exceptions immediately - no local fallback
- **User Experience**: Users receive download links only after successful cloud upload
- **Configuration Required**: Cloud storage credentials must be properly configured for operation
- Upload resilience through chunked uploads with pause/resume capability
- Automatic UUID generation and video directory creation
- All uploads validate file types (mp4, mov, avi, mkv, webm) and configurable size limits