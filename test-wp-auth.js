#!/usr/bin/env node

/**
 * WordPress authentication test script.
 * Verifies WP REST API credentials and displays user information.
 *
 * Usage:
 *   node test-wp-auth.js
 */

require('dotenv').config();
const { verifyAuth, wpRequest } = require('./lib/wordpress-api');

async function main() {
  console.log('=== WordPress Authentication Test ===\n');
  console.log(`Site URL: ${process.env.WP_SITE_URL || '(not set)'}`);
  console.log(`Username: ${process.env.WP_USERNAME || '(not set)'}\n`);

  try {
    // Verify authentication and get user info
    console.log('Connecting to WordPress...');
    const user = await verifyAuth();

    console.log('\nAuthentication successful!\n');
    console.log('User Information:');
    console.log(`  ID:       ${user.id}`);
    console.log(`  Username: ${user.username}`);
    console.log(`  Name:     ${user.name}`);
    console.log(`  Roles:    ${user.roles.join(', ')}`);

    // Display capabilities summary
    const caps = user.capabilities || {};
    const capKeys = Object.keys(caps).filter((k) => caps[k]);
    if (capKeys.length > 0) {
      console.log(`\nCapabilities (${capKeys.length} active):`);
      const relevantCaps = [
        'publish_posts',
        'edit_posts',
        'delete_posts',
        'upload_files',
        'edit_others_posts',
        'manage_categories',
      ];
      for (const cap of relevantCaps) {
        const status = caps[cap] ? 'YES' : 'NO';
        console.log(`  ${cap}: ${status}`);
      }
    }

    // Fetch post count for the user
    try {
      const posts = await wpRequest(
        'GET',
        `/wp/v2/posts?author=${user.id}&per_page=1&status=any`
      );
      // WP REST API returns X-WP-Total header, but via JSON array we just check
      // if any posts exist. For a count, we query with minimal data.
      if (Array.isArray(posts)) {
        // Try to get total count by querying statuses
        const draftPosts = await wpRequest(
          'GET',
          `/wp/v2/posts?author=${user.id}&per_page=1&status=draft`
        );
        const publishedPosts = await wpRequest(
          'GET',
          `/wp/v2/posts?author=${user.id}&per_page=1&status=publish`
        );

        console.log('\nPost Summary:');
        console.log(`  Published: ${Array.isArray(publishedPosts) ? publishedPosts.length + '+' : 'unknown'}`);
        console.log(`  Drafts:    ${Array.isArray(draftPosts) ? draftPosts.length + '+' : 'unknown'}`);
        console.log('  (Counts show at least this many; actual totals may be higher.)');
      }
    } catch (postErr) {
      console.log(`\nCould not retrieve post count: ${postErr.message}`);
    }

    console.log('\nResult: PASS - Authentication is working correctly.');
  } catch (err) {
    console.error(`\nAuthentication FAILED: ${err.message}`);
    console.error('\nTroubleshooting:');
    console.error('  1. Check that WP_SITE_URL is correct in .env');
    console.error('  2. Check that WP_USERNAME is correct in .env');
    console.error('  3. Check that WP_APP_PASSWORD is a valid Application Password');
    console.error('     (WordPress Admin -> Users -> Profile -> Application Passwords)');
    console.error('  4. Ensure the WordPress REST API is accessible');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
