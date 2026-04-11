#!/usr/bin/env node

/**
 * WordPress authentication test script.
 * 1. Checks if the REST API Auth Fix plugin is active
 * 2. Verifies WP REST API credentials and displays user information
 *
 * Usage:
 *   node test-wp-auth.js
 */

require('dotenv').config();
const { verifyAuth, wpRequest, checkPluginStatus } = require('./lib/wordpress-api');

async function main() {
  console.log('=== WordPress Authentication Test ===\n');
  console.log(`Site URL:  ${process.env.WP_SITE_URL || '(not set)'}`);
  console.log(`Username:  ${process.env.WP_USERNAME || '(not set)'}`);
  console.log(`Password:  ${process.env.WP_APP_PASSWORD ? '(set)' : '(not set)'}\n`);

  // Step 1: Check if auth-fix plugin is active
  console.log('Step 1: Checking auth-fix plugin status...');
  const pluginStatus = await checkPluginStatus();

  if (pluginStatus && pluginStatus.active) {
    console.log(`  Plugin found: v${pluginStatus.version}`);
    console.log(`  PHP SAPI: ${pluginStatus.php_sapi}`);
    console.log(`  WP Version: ${pluginStatus.wp_version}\n`);
  } else {
    console.error('\n  WARNING: Auth-fix plugin NOT detected!');
    console.error('  The plugin "REST API Basic Auth Fix" must be installed and activated.');
    console.error('  Download: https://github.com/tanukichiyamaguchi/dentalBlog/raw/claude/dental-blog-automation-K3zP1/wp-plugin/rest-api-auth-fix.zip');
    console.error('  Install: WP Admin -> Plugins -> Add New -> Upload Plugin\n');
    console.error('  Attempting auth anyway...\n');
  }

  // Step 2: Call debug endpoint to diagnose auth environment
  console.log('Step 2: Running auth diagnostics...');
  try {
    const WP_SITE_URL = (process.env.WP_SITE_URL || '').replace(/\/+$/, '');
    const token = Buffer.from(`${process.env.WP_USERNAME}:${process.env.WP_APP_PASSWORD}`).toString('base64');
    const debugUrl = `${WP_SITE_URL}/?rest_route=/sasaki-dental/v1/debug&_wp_auth=${encodeURIComponent(token)}`;
    const debugRes = await fetch(debugUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'SasakiDentalBlogTools/1.0' },
    });
    if (debugRes.ok) {
      const debug = await debugRes.json();
      console.log(`  _wp_auth param present: ${debug.wp_auth_param_present}`);
      console.log(`  _wp_auth base64 decode OK: ${debug.base64_decode_ok}`);
      console.log(`  Username found: ${debug.username_found}`);
      console.log(`  User exists in WP: ${debug.user_exists_in_wp}`);
      console.log(`  App Passwords available: ${debug.app_passwords_available}`);
      console.log(`  App Passwords count: ${debug.app_passwords_count}`);
      console.log(`  PHP_AUTH_USER set: ${debug.php_auth_user_set}`);
      console.log(`  Current user ID: ${debug.current_user_id}`);
      console.log(`  Server vars: ${JSON.stringify(debug.server_vars)}`);
      console.log('');

      if (!debug.wp_auth_param_present) {
        console.error('  ERROR: _wp_auth parameter is not reaching WordPress.');
      }
      if (!debug.base64_decode_ok) {
        console.error('  ERROR: _wp_auth value could not be decoded.');
      }
      if (debug.username_found && !debug.user_exists_in_wp) {
        console.error(`  ERROR: Username "${debug.username_found}" does not exist in WordPress.`);
        console.error('  Check that WP_USERNAME matches your WordPress login username exactly.');
      }
      if (debug.app_passwords_available === false) {
        console.error('  ERROR: Application Passwords are not available on this site.');
      }
    }
  } catch (debugErr) {
    console.log(`  Debug endpoint not available: ${debugErr.message}\n`);
  }

  // Step 3: Verify authentication
  console.log('Step 3: Testing WordPress authentication...');
  try {
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

    // Fetch post count
    try {
      const publishedPosts = await wpRequest(
        'GET',
        `/wp/v2/posts?author=${user.id}&per_page=1&status=publish`
      );
      const draftPosts = await wpRequest(
        'GET',
        `/wp/v2/posts?author=${user.id}&per_page=1&status=draft`
      );

      console.log('\nPost Summary:');
      console.log(`  Published: ${Array.isArray(publishedPosts) ? publishedPosts.length + '+' : 'unknown'}`);
      console.log(`  Drafts:    ${Array.isArray(draftPosts) ? draftPosts.length + '+' : 'unknown'}`);
    } catch (postErr) {
      console.log(`\nCould not retrieve post count: ${postErr.message}`);
    }

    console.log('\nResult: PASS - Authentication is working correctly.');
  } catch (err) {
    console.error(`\nAuthentication FAILED: ${err.message}`);
    console.error('\nTroubleshooting:');
    if (!pluginStatus || !pluginStatus.active) {
      console.error('  >> Most likely cause: Auth-fix plugin is not installed or not activated.');
      console.error('     Install the plugin first, then retry.');
    }
    console.error('  1. Check that WP_SITE_URL is correct (no trailing slash)');
    console.error('  2. Check that WP_USERNAME matches your WordPress login username');
    console.error('  3. Check that WP_APP_PASSWORD is a valid Application Password');
    console.error('     (WordPress Admin -> Users -> Profile -> Application Passwords)');
    console.error('  4. Ensure the REST API Auth Fix plugin is installed and activated');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
