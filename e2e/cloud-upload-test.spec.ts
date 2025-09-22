import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';

test.describe('Cloud Upload and Download Link Verification', () => {

  // Create a very small test video file
  const createSmallTestVideo = async (): Promise<string> => {
    const testDataDir = path.join(process.cwd(), 'e2e', 'test-data');
    await fs.mkdir(testDataDir, { recursive: true });

    const filename = 'cloud-test-video.mp4';
    const filePath = path.join(testDataDir, filename);

    // Create a tiny mock video file (100KB)
    const sizeInBytes = 100 * 1024;
    const buffer = Buffer.alloc(sizeInBytes, 0);

    // Add minimal MP4 header to make it look like a video
    const mp4Header = Buffer.from([
      0x00, 0x00, 0x00, 0x20, // box size
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x69, 0x73, 0x6F, 0x6D, // isom
      0x00, 0x00, 0x02, 0x00, // version
      0x69, 0x73, 0x6F, 0x6D, // compatible brands
      0x69, 0x73, 0x6F, 0x32,
      0x61, 0x76, 0x63, 0x31,
      0x6D, 0x70, 0x34, 0x31
    ]);
    mp4Header.copy(buffer, 0);

    await fs.writeFile(filePath, buffer);
    return filePath;
  };

  test('should successfully upload to cloud and receive download link', async ({ page }) => {
    console.log('🧪 Testing complete cloud upload to download link flow...');

    // First verify cloud storage is working
    await page.goto('/videos');
    await page.click('button:has-text("Test Storage")');

    // Wait for the actual test result (OK or FAILED) to appear
    const storageResult = page.locator('text=Storage Self-Test: OK').or(page.locator('text=Storage Self-Test: FAILED'));
    await expect(storageResult).toBeVisible({ timeout: 15000 });

    const storageText = await storageResult.textContent();
    console.log('Storage test result:', storageText);

    if (!storageText?.includes('OK')) {
      console.log('❌ Storage test failed. Full text:', storageText);
      throw new Error('Cloud storage is not properly configured');
    }

    console.log('✅ Cloud storage connectivity confirmed');

    // Navigate to upload page
    await page.goto('/upload');
    await expect(page.locator('h1')).toContainText('Video Upload');

    // Verify we're in cloud upload mode
    const uploadMode = page.locator('text=Mode:');
    await expect(uploadMode).toBeVisible();
    const modeText = await uploadMode.textContent();
    console.log('Upload mode:', modeText);

    // Create and upload test video
    const testFilePath = await createSmallTestVideo();
    console.log('📁 Created test video file:', testFilePath);

    await page.fill('#clientName', 'E2E Test Client');
    await page.fill('#projectName', 'E2E Test Project');
    await page.setInputFiles('#video', testFilePath);

    // Verify file is selected
    await expect(page.locator('text=cloud-test-video.mp4')).toBeVisible();
    console.log('📋 Form filled and file selected');

    // Monitor for any error messages during upload
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('❌ Browser error during upload:', msg.text());
      }
    });

    // Submit the upload
    console.log('🚀 Starting upload...');
    await page.click('button[type="submit"]');

    // Wait for either success or error with extended timeout
    const successMessage = page.locator('h3:has-text("Upload Successful")');
    const errorMessage = page.locator('div:has-text("Error:")');

    try {
      // Wait for upload completion (cloud uploads can take time)
      await expect(successMessage).toBeVisible({ timeout: 60000 });
      console.log('✅ Upload completed successfully!');

      // Verify success details are shown
      await expect(page.locator('text=E2E Test Client')).toBeVisible();
      await expect(page.locator('text=E2E Test Project')).toBeVisible();
      console.log('✅ Upload details confirmed');

      // Most importantly: verify download link is generated
      const downloadLink = page.locator('a[href*="/api/download/"]');
      await expect(downloadLink).toBeVisible();

      const downloadUrl = await downloadLink.getAttribute('href');
      console.log('🔗 Download URL generated:', downloadUrl);

      // Test that the download URL actually works
      const response = await page.request.get(downloadUrl!);
      console.log('📥 Download URL status:', response.status());

      expect(response.status()).toBe(200);

      // Verify response has video content
      const contentType = response.headers()['content-type'];
      console.log('📄 Content type:', contentType);

      // Should be video content or octet-stream
      expect(contentType).toMatch(/video|octet-stream/);

      console.log('🎉 SUCCESS: Complete upload-to-download flow verified!');
      console.log('✅ User receives working download link after cloud upload');

    } catch (uploadError) {
      // Check if there's an error message visible
      const isErrorVisible = await errorMessage.isVisible();

      if (isErrorVisible) {
        const errorText = await errorMessage.textContent();
        console.log('❌ Upload failed with error:', errorText);

        // Take screenshot for debugging
        await page.screenshot({
          path: 'e2e/test-data/upload-error-debug.png',
          fullPage: true
        });
      } else {
        console.log('❌ Upload timed out without clear error message');

        // Take screenshot of current state
        await page.screenshot({
          path: 'e2e/test-data/upload-timeout-debug.png',
          fullPage: true
        });
      }

      throw uploadError;
    }

    // Cleanup
    await fs.unlink(testFilePath).catch(() => {});
  });

  test('should handle upload errors gracefully and show clear messages', async ({ page }) => {
    console.log('🧪 Testing error handling for upload failures...');

    await page.goto('/upload');

    // Try to upload without filling required fields
    await page.click('button[type="submit"]');

    // Should see validation error
    const errorMessage = page.locator('div:has-text("Please fill in all fields and select a video file")');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });

    console.log('✅ Form validation working correctly');
  });

  // Cleanup after all tests
  test.afterAll(async () => {
    const testDataDir = path.join(process.cwd(), 'e2e', 'test-data');
    await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
  });

});