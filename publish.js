#!/usr/bin/env node

/**
 * Main publishing script.
 * Reads a Markdown file, validates quality, generates OGP image,
 * and publishes to WordPress.
 *
 * Usage:
 *   node publish.js path/to/article.md [--status draft|publish] [--schedule "2025-01-01T09:00:00"]
 */

const fs = require('fs');
const path = require('path');

const { parseFrontmatter, extractBody, convertMarkdownToHtml } = require('./lib/markdown-html');
const { runQualityCheck } = require('./lib/quality-check');
const { verifyAuth, createPost, uploadMedia, findOrCreateTag } = require('./lib/wordpress-api');
const { generateOgpImage } = require('./lib/image-overlay');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { mdPath: null, status: 'draft', schedule: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status' && args[i + 1]) {
      result.status = args[i + 1];
      i++;
    } else if (args[i] === '--schedule' && args[i + 1]) {
      result.schedule = args[i + 1];
      i++;
    } else if (!args[i].startsWith('--')) {
      result.mdPath = args[i];
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Load clinic.json (optional)
// ---------------------------------------------------------------------------

function loadClinicConfig() {
  const candidates = [
    path.resolve(__dirname, 'clinic.json'),
    path.resolve(process.cwd(), 'clinic.json'),
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        console.log(`Loaded clinic config: ${filePath}`);
        return JSON.parse(raw);
      } catch (err) {
        console.warn(`Warning: Failed to parse clinic.json: ${err.message}`);
        return {};
      }
    }
  }

  console.warn('Warning: clinic.json not found. Quality checks will use defaults.');
  return {};
}

// ---------------------------------------------------------------------------
// Resolve tag names to IDs via WP REST API
// ---------------------------------------------------------------------------

async function resolveTagIds(tagNames) {
  if (!tagNames || tagNames.length === 0) return [];

  const ids = [];
  for (const name of tagNames) {
    try {
      const tag = await findOrCreateTag(name);
      ids.push(tag.id);
      console.log(`  Tag resolved: "${name}" -> ID ${tag.id}`);
    } catch (err) {
      console.warn(`  Warning: Could not resolve tag "${name}": ${err.message}`);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv);

  // 1. Validate arguments
  if (!opts.mdPath) {
    console.error('Usage: node publish.js <path/to/article.md> [--status draft|publish] [--schedule "YYYY-MM-DDTHH:MM:SS"]');
    process.exit(1);
  }

  const mdFilePath = path.resolve(opts.mdPath);

  if (!fs.existsSync(mdFilePath)) {
    console.error(`Error: File not found: ${mdFilePath}`);
    process.exit(1);
  }

  console.log('=== Sasaki Dental Blog Publisher ===\n');

  // 2. Read Markdown file
  console.log(`Reading: ${mdFilePath}`);
  const markdown = fs.readFileSync(mdFilePath, 'utf-8');

  // 3. Parse frontmatter
  const frontmatter = parseFrontmatter(markdown);
  const title = frontmatter.title || path.basename(mdFilePath, '.md');
  const slug = frontmatter.slug || '';
  const categoryNames = Array.isArray(frontmatter.categories)
    ? frontmatter.categories
    : frontmatter.categories
      ? [frontmatter.categories]
      : [];
  const tagNames = Array.isArray(frontmatter.tags)
    ? frontmatter.tags
    : frontmatter.tags
      ? [frontmatter.tags]
      : [];

  console.log(`Title: ${title}`);
  if (slug) console.log(`Slug: ${slug}`);
  if (categoryNames.length) console.log(`Categories: ${categoryNames.join(', ')}`);
  if (tagNames.length) console.log(`Tags: ${tagNames.join(', ')}`);
  console.log('');

  // 4. Load clinic config
  const clinicConfig = loadClinicConfig();

  // 5. Quality check
  console.log('Running quality checks...');
  const qcResult = runQualityCheck(markdown, clinicConfig);

  if (qcResult.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of qcResult.warnings) {
      console.log(`  [WARN] ${w}`);
    }
  }

  if (!qcResult.passed) {
    console.error('\nQuality check FAILED. Errors:');
    for (const e of qcResult.errors) {
      console.error(`  [ERROR] ${e}`);
    }
    console.error('\nPlease fix the errors above before publishing.');
    process.exit(1);
  }

  console.log('Quality check passed.\n');

  // 6. Verify WordPress authentication
  console.log('Verifying WordPress authentication...');
  let user;
  try {
    user = await verifyAuth();
    console.log(`Authenticated as: ${user.name} (@${user.username})`);
    console.log(`Roles: ${user.roles.join(', ')}\n`);
  } catch (err) {
    console.error(`Authentication failed: ${err.message}`);
    process.exit(1);
  }

  // 7. Generate OGP / featured image
  const safeTitle = title.replace(/[^a-zA-Z0-9\u3000-\u9FFF\u4E00-\u9FFF-]/g, '_').slice(0, 50);
  const ogpOutputPath = path.resolve(__dirname, 'output', `ogp-${safeTitle}.png`);
  console.log('Generating OGP image...');
  let ogpPath;
  try {
    ogpPath = await generateOgpImage(title, ogpOutputPath);
  } catch (err) {
    console.error(`Failed to generate OGP image: ${err.message}`);
    process.exit(1);
  }

  // 8. Upload featured image
  console.log('Uploading featured image...');
  let media;
  try {
    media = await uploadMedia(ogpPath, title);
    console.log(`Featured image uploaded: ID ${media.id}, URL ${media.url}\n`);
  } catch (err) {
    console.error(`Failed to upload featured image: ${err.message}`);
    process.exit(1);
  }

  // 9. Convert Markdown body to HTML
  const body = extractBody(markdown);
  const htmlContent = convertMarkdownToHtml(body);
  console.log(`HTML content generated (${htmlContent.length} characters).\n`);

  // 10. Resolve tags
  let tagIds = [];
  if (tagNames.length > 0) {
    console.log('Resolving tags...');
    tagIds = await resolveTagIds(tagNames);
    console.log('');
  }

  // 11. Create post
  console.log('Creating WordPress post...');

  const postParams = {
    title,
    content: htmlContent,
    status: opts.status,
    featuredMedia: media.id,
  };

  if (opts.schedule) {
    postParams.date = opts.schedule;
  }

  // Category IDs would need to be resolved from names in a full implementation.
  // For now we pass category names as-is if they are numeric IDs.
  const categoryIds = categoryNames
    .map((c) => parseInt(c, 10))
    .filter((n) => !isNaN(n));
  if (categoryIds.length > 0) {
    postParams.categories = categoryIds;
  }

  if (tagIds.length > 0) {
    postParams.tags = tagIds;
  }

  try {
    const post = await createPost(postParams);
    console.log('\n=== Post Created Successfully ===');
    console.log(`  ID:     ${post.id}`);
    console.log(`  Title:  ${post.title}`);
    console.log(`  Status: ${post.status}`);
    console.log(`  URL:    ${post.link}`);
  } catch (err) {
    console.error(`Failed to create post: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
