#!/usr/bin/env node

const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: '.env.local' });

// Load S3 config from environment (same logic as lib/s3-config.ts)
function loadS3Config() {
  const endpoint = process.env.B2_S3_ENDPOINT || process.env.S3_ENDPOINT;
  const bucket = process.env.B2_BUCKET || process.env.S3_BUCKET;
  const region = process.env.B2_S3_REGION || process.env.S3_REGION || 'us-east-1';
  const accessKeyId = process.env.B2_KEY_ID || process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY || process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing S3/B2 configuration in .env.local');
  }

  return { endpoint, bucket, region, accessKeyId, secretAccessKey };
}

async function setupCORS() {
  try {
    console.log('🔧 Setting up CORS for Backblaze B2 bucket...');

    // Load configuration from environment
    const config = loadS3Config();
    console.log(`📦 Bucket: ${config.bucket}`);
    console.log(`🌐 Endpoint: ${config.endpoint}`);

    // Create S3 client
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });

    // Define CORS configuration
    const corsConfiguration = {
      CORSRules: [
        {
          ID: 'video-platform-uploads',
          AllowedHeaders: [
            'Content-Type',
            'Content-Length',
            'Authorization',
            'x-amz-date',
            'x-amz-algorithm',
            'x-amz-credential',
            'x-amz-signature',
            'x-amz-signed-headers',
            'Policy'
          ],
          AllowedMethods: ['POST', 'GET'],
          AllowedOrigins: [
            'http://localhost:3000',
            'http://localhost:3001',
            'https://your-production-domain.com'
          ],
          MaxAgeSeconds: 3600
        }
      ]
    };

    // Apply CORS configuration
    console.log('⚙️  Applying CORS configuration...');
    await client.send(new PutBucketCorsCommand({
      Bucket: config.bucket,
      CORSConfiguration: corsConfiguration
    }));

    console.log('✅ CORS configuration applied successfully!');

    // Verify configuration
    console.log('🔍 Verifying CORS configuration...');
    const result = await client.send(new GetBucketCorsCommand({
      Bucket: config.bucket
    }));

    console.log('📋 Current CORS Rules:');
    console.log(JSON.stringify(result.CORSRules, null, 2));

    console.log('\n🎉 CORS setup complete!');
    console.log('📝 You can now test uploads at: http://localhost:3001/upload');
    console.log('💡 Remember to update AllowedOrigins with your production domain');

  } catch (error) {
    console.error('❌ Error setting up CORS:', error.message);

    if (error.name === 'InvalidAccessKeyId') {
      console.error('🔑 Check your B2 credentials in .env.local');
    } else if (error.name === 'NoSuchBucket') {
      console.error('📦 Check your bucket name in .env.local');
    } else {
      console.error('🔍 Full error:', error);
    }

    process.exit(1);
  }
}

// Run the setup
setupCORS();