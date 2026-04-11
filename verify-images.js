#!/usr/bin/env node

/**
 * Post image verification script.
 * Fetches a WordPress post by ID and checks all image URLs with HEAD requests.
 *
 * Usage:
 *   node verify-images.js <postId>
 */

const { wpRequest } = require('./lib/wordpress-api');

/**
 * Extract all img src URLs from HTML content.
 * @param {string} html
 * @returns {string[]}
 */
function extractImageUrls(html) {
  const urls = [];
  const imgPattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = imgPattern.exec(html)) !== null) {
    urls.push(match[1]);
  }

  return urls;
}

/**
 * Check a single URL with a HEAD request.
 * @param {string} url
 * @returns {Promise<{ url: string, status: number, contentType: string, ok: boolean, error?: string }>}
 */
async function checkUrl(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
    });

    return {
      url,
      status: response.status,
      contentType: response.headers.get('content-type') || 'unknown',
      ok: response.ok,
    };
  } catch (err) {
    return {
      url,
      status: 0,
      contentType: 'N/A',
      ok: false,
      error: err.message,
    };
  }
}

async function main() {
  const postId = process.argv[2];

  if (!postId || isNaN(parseInt(postId, 10))) {
    console.error('Usage: node verify-images.js <postId>');
    console.error('  postId: Numeric WordPress post ID');
    process.exit(1);
  }

  console.log(`=== Image Verification for Post #${postId} ===\n`);

  // Fetch the post
  let post;
  try {
    post = await wpRequest('GET', `/wp/v2/posts/${postId}?context=edit`);
  } catch (err) {
    console.error(`Failed to fetch post #${postId}: ${err.message}`);
    process.exit(1);
  }

  const title = post.title?.rendered || post.title?.raw || '(no title)';
  const content = post.content?.rendered || post.content?.raw || '';

  console.log(`Post title: ${title}`);
  console.log(`Post status: ${post.status}`);
  console.log('');

  // Extract image URLs
  const imageUrls = extractImageUrls(content);

  // Also check featured image if present
  if (post.featured_media && post.featured_media > 0) {
    try {
      const media = await wpRequest('GET', `/wp/v2/media/${post.featured_media}`);
      const featuredUrl = media.source_url || media.guid?.rendered;
      if (featuredUrl) {
        console.log(`Featured image: ${featuredUrl}`);
        imageUrls.unshift(featuredUrl);
      }
    } catch (err) {
      console.warn(`Warning: Could not fetch featured media #${post.featured_media}: ${err.message}`);
    }
  }

  if (imageUrls.length === 0) {
    console.log('No images found in this post.');
    return;
  }

  console.log(`Found ${imageUrls.length} image(s). Checking...\n`);

  // Check each URL
  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < imageUrls.length; i++) {
    const result = await checkUrl(imageUrls[i]);
    const statusIcon = result.ok ? 'OK' : 'FAIL';
    const idx = String(i + 1).padStart(2, ' ');

    console.log(`  [${idx}] ${statusIcon}`);
    console.log(`       URL:          ${result.url}`);
    console.log(`       Status:       ${result.status}`);
    console.log(`       Content-Type: ${result.contentType}`);

    if (result.error) {
      console.log(`       Error:        ${result.error}`);
    }

    console.log('');

    if (result.ok) {
      okCount++;
    } else {
      failCount++;
    }
  }

  // Summary
  console.log('---');
  if (failCount === 0) {
    console.log(`Result: ALL ${imageUrls.length} image(s) are accessible.`);
  } else {
    console.log(`Result: ${failCount} of ${imageUrls.length} image(s) returned errors. Please review the output above.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
