#!/usr/bin/env node

/**
 * Auto-publish script for scheduled daily posting.
 * Picks the next unpublished article from articles/ and publishes it as draft.
 *
 * Usage:
 *   node auto-publish.js [--status draft|publish]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { parseFrontmatter, extractBody, convertMarkdownToHtml } = require('./lib/markdown-html');
const { runQualityCheck } = require('./lib/quality-check');
const { verifyAuth, createPost, uploadMedia, findOrCreateTag, findCategory } = require('./lib/wordpress-api');
const { generateOgpImage } = require('./lib/image-overlay');

const TRACKER_PATH = path.resolve(__dirname, 'config/publish-tracker.json');
const ARTICLES_DIR = path.resolve(__dirname, 'articles');
const CLINIC_CONFIG_PATH = path.resolve(__dirname, 'clinic.json');

function loadTracker() {
  try {
    return JSON.parse(fs.readFileSync(TRACKER_PATH, 'utf-8'));
  } catch (_) {
    return { published: [], lastPublishedDate: null };
  }
}

function saveTracker(tracker) {
  fs.writeFileSync(TRACKER_PATH, JSON.stringify(tracker, null, 2) + '\n', 'utf-8');
}

function getUnpublishedArticles(tracker) {
  if (!fs.existsSync(ARTICLES_DIR)) return [];

  const files = fs.readdirSync(ARTICLES_DIR)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'))
    .sort();

  return files.filter(f => !tracker.published.includes(f));
}

function detectTheme(tags) {
  const tagStr = (tags || []).join(' ').toLowerCase();
  if (tagStr.includes('矯正') || tagStr.includes('歯並び')) return 'orthodontics';
  if (tagStr.includes('インプラント')) return 'implant';
  if (tagStr.includes('噛み合わせ') || tagStr.includes('顎関節')) return 'tmj';
  if (tagStr.includes('メタルフリー') || tagStr.includes('セラミック')) return 'metalfree';
  if (tagStr.includes('予防') || tagStr.includes('メンテナンス')) return 'preventive';
  return 'default';
}

async function resolveTagIds(tagNames) {
  const ids = [];
  for (const name of tagNames) {
    try {
      const tag = await findOrCreateTag(name);
      ids.push(tag.id);
    } catch (_) {}
  }
  return ids;
}

async function main() {
  const status = process.argv.includes('--status')
    ? process.argv[process.argv.indexOf('--status') + 1] || 'draft'
    : 'draft';

  console.log('=== Auto-Publish: Daily Article Scheduler ===\n');

  const tracker = loadTracker();
  const today = new Date().toISOString().split('T')[0];

  if (tracker.lastPublishedDate === today) {
    console.log(`Already published today (${today}). Skipping.`);
    return;
  }

  const unpublished = getUnpublishedArticles(tracker);
  if (unpublished.length === 0) {
    console.log('No unpublished articles found in articles/ directory.');
    console.log('Generate more articles to continue auto-publishing.');
    return;
  }

  const nextFile = unpublished[0];
  const mdPath = path.join(ARTICLES_DIR, nextFile);
  console.log(`Next article: ${nextFile}`);
  console.log(`Remaining after this: ${unpublished.length - 1} articles\n`);

  const markdown = fs.readFileSync(mdPath, 'utf-8');
  const frontmatter = parseFrontmatter(markdown);
  const title = frontmatter.title || path.basename(nextFile, '.md');
  const slug = frontmatter.slug || '';
  const categoryNames = Array.isArray(frontmatter.categories)
    ? frontmatter.categories
    : frontmatter.categories ? [frontmatter.categories] : [];
  const tagNames = Array.isArray(frontmatter.tags)
    ? frontmatter.tags
    : frontmatter.tags ? [frontmatter.tags] : [];

  console.log(`Title: ${title}`);
  console.log(`Slug: ${slug}\n`);

  // Quality check
  let clinicConfig = {};
  try {
    clinicConfig = JSON.parse(fs.readFileSync(CLINIC_CONFIG_PATH, 'utf-8'));
  } catch (_) {}

  const qcResult = runQualityCheck(markdown, clinicConfig);
  if (!qcResult.passed) {
    console.error('Quality check FAILED:');
    qcResult.errors.forEach(e => console.error(`  [ERROR] ${e}`));
    console.error(`\nSkipping ${nextFile}. Fix errors before retrying.`);
    process.exit(1);
  }
  console.log('Quality check passed.\n');

  // Auth
  const user = await verifyAuth();
  console.log(`Authenticated as: ${user.name}\n`);

  // OGP image
  const theme = detectTheme(tagNames);
  const safeSlug = (slug || 'article').slice(0, 50);
  const ogpPath = path.resolve(__dirname, 'output', `ogp-${safeSlug}.png`);
  await generateOgpImage(title, ogpPath, theme);
  const ogpMedia = await uploadMedia(ogpPath, title);
  console.log(`Featured image: ID ${ogpMedia.id}\n`);

  // Section images
  const body = extractBody(markdown);
  let bodyWithImages = body;
  const h2Regex = /^## (.+)$/gm;
  const h2Matches = [...body.matchAll(h2Regex)];

  if (h2Matches.length > 0) {
    console.log(`Generating ${h2Matches.length} section images...`);
    const sectionImages = [];

    for (let i = 0; i < h2Matches.length; i++) {
      const h2Title = h2Matches[i][1].replace(/——.+$/, '').trim();
      const sectionFilename = `section-${safeSlug}-${i + 1}.png`;
      const sectionPath = path.resolve(__dirname, 'output', sectionFilename);
      try {
        await generateOgpImage(h2Title, sectionPath, theme);
        const sectionMedia = await uploadMedia(sectionPath, h2Title);
        sectionImages.push({ title: h2Title, url: sectionMedia.url });
        console.log(`  Section ${i + 1}: uploaded`);
      } catch (err) {
        console.warn(`  Section ${i + 1}: failed (${err.message})`);
        sectionImages.push(null);
      }
    }

    const lines = bodyWithImages.split('\n');
    for (let i = h2Matches.length - 1; i >= 0; i--) {
      if (!sectionImages[i]) continue;
      const h2Line = body.substring(0, h2Matches[i].index).split('\n').length - 1;
      const imgMarkdown = `\n![${sectionImages[i].title}](${sectionImages[i].url})\n`;
      lines.splice(h2Line + 1, 0, imgMarkdown);
    }
    bodyWithImages = lines.join('\n');
    console.log('');
  }

  // Convert and post
  const htmlContent = convertMarkdownToHtml(bodyWithImages);
  const tagIds = await resolveTagIds(tagNames);

  // Resolve category names by querying WordPress dynamically
  console.log('Resolving categories...');
  const existingCategories = clinicConfig.existingCategories || {};
  const categoryIds = [];
  for (const c of categoryNames) {
    const asNum = parseInt(c, 10);
    if (!isNaN(asNum) && asNum > 0) {
      categoryIds.push(asNum);
      continue;
    }
    const mapped = existingCategories[c];
    if (mapped && mapped > 0) {
      categoryIds.push(mapped);
      continue;
    }
    // Dynamic lookup via WP API
    try {
      const cat = await findCategory(c);
      if (cat) {
        categoryIds.push(cat.id);
        console.log(`  Category resolved: "${c}" -> ID ${cat.id} (${cat.name})`);
      } else {
        console.warn(`  Warning: Category "${c}" not found in WordPress.`);
      }
    } catch (err) {
      console.warn(`  Warning: Could not lookup category "${c}": ${err.message}`);
    }
  }

  const postParams = {
    title,
    content: htmlContent,
    status,
    featuredMedia: ogpMedia.id,
  };
  if (categoryIds.length > 0) postParams.categories = categoryIds;
  if (tagIds.length > 0) postParams.tags = tagIds;

  const post = await createPost(postParams);

  console.log('\n=== Post Created ===');
  console.log(`  ID:     ${post.id}`);
  console.log(`  Status: ${post.status}`);
  console.log(`  URL:    ${post.link}`);

  // Update tracker
  tracker.published.push(nextFile);
  tracker.lastPublishedDate = today;
  saveTracker(tracker);
  console.log(`\nTracker updated. Published: ${tracker.published.length} total.`);
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
