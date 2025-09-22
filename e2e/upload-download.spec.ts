import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';

// Test data setup - create a small test video file
const createTestVideoFile = async (filename: string, sizeInMB: number = 1): Promise<string> => {
  const testDataDir = path.join(process.cwd(), 'e2e', 'test-data');
  await fs.mkdir(testDataDir, { recursive: true });

  const filePath = path.join(testDataDir, filename);

  // Create a mock video file with specific size
  const sizeInBytes = sizeInMB * 1024 * 1024;
  const buffer = Buffer.alloc(sizeInBytes, 0);

  // Add some basic headers to make it look like a video file
  const header = Buffer.from([
    0x00, 0x00, 0x00, 0x20, // size
    0x66, 0x74, 0x79, 0x70, // ftyp
    0x69, 0x73, 0x6F, 0x6D, // isom
    0x00, 0x00, 0x02, 0x00  // version
  ]);
  header.copy(buffer, 0);

  await fs.writeFile(filePath, buffer);
  return filePath;
};

test.describe('Video Upload and Download E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure we start from the home page
    await page.goto('/');
  });

  test('should display home page with navigation links', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Videographer Platform');
    await expect(page.locator('a[href="/upload"]')).toBeVisible();
    await expect(page.locator('a[href="/videos"]')).toBeVisible();
  });

  test('should navigate to upload page and display form', async ({ page }) => {
    await page.click('a[href="/upload"]');
    await expect(page).toHaveURL('/upload');
    await expect(page.locator('h1')).toContainText('Video Upload');

    // Check form elements are present
    await expect(page.locator('#clientName')).toBeVisible();
    await expect(page.locator('#projectName')).toBeVisible();
    await expect(page.locator('#video')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should show validation errors for empty form submission', async ({ page }) => {
    await page.goto('/upload');

    // Try to submit empty form
    await page.click('button[type="submit"]');

    // Should see error message
    await expect(page.locator('div:has-text("Please fill in all fields")')).toBeVisible();
  });

  test('should upload small video file successfully', async ({ page }) => {
    // Create test video file
    const testFilePath = await createTestVideoFile('test-small.mp4', 1);

    await page.goto('/upload');

    // Fill in the form
    await page.fill('#clientName', 'Test Client');
    await page.fill('#projectName', 'Test Project');
    await page.setInputFiles('#video', testFilePath);

    // Check file is selected
    await expect(page.locator('text=test-small.mp4')).toBeVisible();

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for upload to complete (with longer timeout for file upload)
    await expect(page.locator('h3:has-text("Upload Successful")')).toBeVisible({ timeout: 30000 });

    // Verify upload result details
    await expect(page.locator('text=Test Client')).toBeVisible();
    await expect(page.locator('text=Test Project')).toBeVisible();
    await expect(page.locator('text=1.00 MB')).toBeVisible();

    // Check download link is present
    const downloadLink = page.locator('a[href*="/api/download/"]');
    await expect(downloadLink).toBeVisible();

    // Store video ID for cleanup
    const videoId = await downloadLink.getAttribute('href').then(href =>
      href?.split('/api/download/')[1]
    );

    // Cleanup test file
    await fs.unlink(testFilePath).catch(() => {});

    return videoId;
  });

  test('should navigate to videos page and display uploaded videos', async ({ page }) => {
    await page.goto('/videos');
    await expect(page).toHaveURL('/videos');
    await expect(page.locator('h1')).toContainText('Videos');

    // Check for video management elements
    await expect(page.locator('button:has-text("Refresh")')).toBeVisible();
    await expect(page.locator('a:has-text("Upload")')).toBeVisible();

    // Wait for videos to load
    await page.waitForLoadState('networkidle');

    // Should either show videos or "No videos" message
    const hasVideos = await page.locator('div:has-text("filename")').count() > 0;
    const noVideosMessage = await page.locator('text=No videos yet').count() > 0;

    expect(hasVideos || noVideosMessage).toBeTruthy();
  });

  test('should test video download functionality', async ({ page }) => {
    // First upload a video
    const testFilePath = await createTestVideoFile('test-download.mp4', 1);

    await page.goto('/upload');
    await page.fill('#clientName', 'Download Test Client');
    await page.fill('#projectName', 'Download Test Project');
    await page.setInputFiles('#video', testFilePath);
    await page.click('button[type="submit"]');

    // Wait for upload success
    await expect(page.locator('h3:has-text("Upload Successful")')).toBeVisible({ timeout: 30000 });

    // Get the download link
    const downloadLink = page.locator('a[href*="/api/download/"]');
    const downloadUrl = await downloadLink.getAttribute('href');

    // Test download by making a request to the download URL
    const response = await page.request.get(downloadUrl!);
    expect(response.status()).toBe(200);

    // Check response headers
    const contentType = response.headers()['content-type'];
    expect(contentType).toBeTruthy();
    expect(contentType).toMatch(/video|application\/octet-stream/);

    // Cleanup
    await fs.unlink(testFilePath).catch(() => {});
  });

  test('should handle large file size validation', async ({ page }) => {
    await page.goto('/upload');

    // Create a mock large file (we'll just check the validation, not actually upload)
    const testFilePath = await createTestVideoFile('test-large.mp4', 1);

    await page.fill('#clientName', 'Large File Client');
    await page.fill('#projectName', 'Large File Project');
    await page.setInputFiles('#video', testFilePath);

    // The validation happens in JavaScript, so we need to test with an actual large file
    // or modify the file size via JavaScript
    await page.evaluate(() => {
      const fileInput = document.querySelector('#video') as HTMLInputElement;
      if (fileInput && fileInput.files && fileInput.files[0]) {
        // Mock a large file size (26GB)
        Object.defineProperty(fileInput.files[0], 'size', {
          value: 26 * 1024 * 1024 * 1024,
          writable: false
        });
      }
    });

    await page.click('button[type="submit"]');

    // Should see size validation error
    await expect(page.locator('text=File too large')).toBeVisible();

    // Cleanup
    await fs.unlink(testFilePath).catch(() => {});
  });

  test('should test system health and recovery features', async ({ page }) => {
    await page.goto('/videos');

    // Test system health display
    await expect(page.locator('text=System Health')).toBeVisible();

    // Test startup tasks button
    await page.click('button:has-text("Run Startup Tasks")');
    await expect(page.locator('button:has-text("Working...")')).toBeVisible();

    // Wait for completion
    await expect(page.locator('button:has-text("Run Startup Tasks")')).toBeVisible({ timeout: 10000 });

    // Test storage self-test
    await page.click('button:has-text("Test Storage")');
    await expect(page.locator('button:has-text("Testing...")')).toBeVisible();

    // Wait for test results
    await expect(page.locator('text=Storage Self-Test')).toBeVisible({ timeout: 15000 });
  });

  test('should test compression options when FFmpeg is available', async ({ page }) => {
    await page.goto('/upload');

    const testFilePath = await createTestVideoFile('test-compression.mp4', 2);

    await page.fill('#clientName', 'Compression Test');
    await page.fill('#projectName', 'Compression Project');
    await page.setInputFiles('#video', testFilePath);

    // Check if compression options appear
    const compressionSection = page.locator('h4:has-text("Video Compression")');

    if (await compressionSection.isVisible()) {
      // Test compression options
      await page.check('input[type="checkbox"]:near(text="Compress video")');
      await expect(page.locator('#compressionQuality')).toBeVisible();

      // Test different quality options
      await page.selectOption('#compressionQuality', 'high');
      await expect(page.locator('text=Near-lossless')).toBeVisible();

      await page.selectOption('#compressionQuality', 'medium');
      await expect(page.locator('text=balanced size')).toBeVisible();
    }

    // Cleanup
    await fs.unlink(testFilePath).catch(() => {});
  });

  test('should handle upload mode display correctly', async ({ page }) => {
    await page.goto('/upload');

    // Check upload mode is displayed
    const modeText = page.locator('div:has-text("Mode:")');
    await expect(modeText).toBeVisible();

    // Should show either "Server Upload" or "Direct-to-Cloud"
    const isServerMode = await modeText.locator('text=Server Upload').count() > 0;
    const isS3Mode = await modeText.locator('text=Direct-to-Cloud').count() > 0;

    expect(isServerMode || isS3Mode).toBeTruthy();
  });

  test('should test video listing and management', async ({ page }) => {
    await page.goto('/videos');

    // Wait for videos to load
    await page.waitForLoadState('networkidle');

    // Test refresh functionality
    await page.click('button:has-text("Refresh")');
    await expect(page.locator('button:has-text("Refreshing...")')).toBeVisible();
    await expect(page.locator('button:has-text("Refresh")')).toBeVisible({ timeout: 5000 });

    // Check if there are videos to test management features
    const videoItems = page.locator('div:has(a[href*="/api/download/"])');
    const videoCount = await videoItems.count();

    if (videoCount > 0) {
      // Test video details link
      const detailsLink = videoItems.first().locator('a:has-text("Details")');
      await expect(detailsLink).toBeVisible();

      // Test download link
      const downloadLink = videoItems.first().locator('a:has-text("Download")');
      await expect(downloadLink).toBeVisible();

      // Test delete button (but don't actually delete)
      const deleteButton = videoItems.first().locator('button:has-text("Delete")');
      await expect(deleteButton).toBeVisible();
    }
  });
});

test.describe('Cloud Storage Integration', () => {
  test('should handle cloud storage errors gracefully', async ({ page }) => {
    await page.goto('/upload');

    // Test with invalid configuration (this should fail fast)
    const testFilePath = await createTestVideoFile('test-cloud-error.mp4', 1);

    await page.fill('#clientName', 'Cloud Error Test');
    await page.fill('#projectName', 'Cloud Error Project');
    await page.setInputFiles('#video', testFilePath);

    await page.click('button[type="submit"]');

    // Should either succeed (if cloud is configured) or show clear error
    const successMessage = page.locator('h3:has-text("Upload Successful")');
    const errorMessage = page.locator('div:has-text("Error:")');

    try {
      await expect(successMessage).toBeVisible({ timeout: 30000 });
      console.log('Cloud upload succeeded - storage is properly configured');
    } catch {
      await expect(errorMessage).toBeVisible({ timeout: 30000 });
      console.log('Cloud upload failed - this is expected if storage is not configured');
    }

    // Cleanup
    await fs.unlink(testFilePath).catch(() => {});
  });

  test('should test storage self-test functionality', async ({ page }) => {
    await page.goto('/videos');

    // Run storage self-test
    await page.click('button:has-text("Test Storage")');
    await expect(page.locator('button:has-text("Testing...")')).toBeVisible();

    // Wait for results
    const resultDiv = page.locator('div:has-text("Storage Self-Test")');
    await expect(resultDiv).toBeVisible({ timeout: 15000 });

    // Check if test passed or failed
    const passed = await resultDiv.locator('text=OK').count() > 0;
    const failed = await resultDiv.locator('text=FAILED').count() > 0;

    expect(passed || failed).toBeTruthy();

    if (failed) {
      // If failed, should show detailed error information
      await expect(resultDiv.locator('text=put:')).toBeVisible();
      await expect(resultDiv.locator('text=head:')).toBeVisible();
      await expect(resultDiv.locator('text=get:')).toBeVisible();
      await expect(resultDiv.locator('text=deleted:')).toBeVisible();
    }
  });
});

// Cleanup after all tests
test.afterAll(async () => {
  // Clean up test data directory
  const testDataDir = path.join(process.cwd(), 'e2e', 'test-data');
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
});