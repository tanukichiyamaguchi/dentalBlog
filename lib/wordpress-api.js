/**
 * WordPress REST API v2 client with Basic Auth.
 * Uses native fetch (Node 18+).
 */

const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const WP_SITE_URL = (process.env.WP_SITE_URL || '').replace(/\/+$/, '');
const WP_USERNAME = process.env.WP_USERNAME || '';
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || '';

/**
 * Build the Basic Auth header value.
 */
function authHeader() {
  if (!WP_USERNAME || !WP_APP_PASSWORD) {
    throw new Error(
      'WP_USERNAME and WP_APP_PASSWORD must be set in .env file.'
    );
  }
  const token = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString(
    'base64'
  );
  return `Basic ${token}`;
}

/**
 * Generic WordPress REST API request.
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} endpoint - API endpoint path (e.g. "/wp/v2/posts")
 * @param {object|null} body - Request body (will be JSON-serialised)
 * @returns {Promise<object>} Parsed JSON response
 */
async function wpRequest(method, endpoint, body = null) {
  if (!WP_SITE_URL) {
    throw new Error('WP_SITE_URL must be set in .env file.');
  }

  const url = `${WP_SITE_URL}/wp-json${endpoint}`;

  const headers = {
    Authorization: authHeader(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const options = { method, headers };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    throw new Error(`Network error while requesting ${method} ${url}: ${err.message}`);
  }

  let data;
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `WordPress API error ${response.status}: ${text.slice(0, 500)}`
      );
    }
    return { raw: text, status: response.status };
  }

  if (!response.ok) {
    const code = data?.code || 'unknown';
    const message = data?.message || JSON.stringify(data);
    throw new Error(
      `WordPress API error ${response.status} [${code}]: ${message}`
    );
  }

  return data;
}

/**
 * Verify WordPress authentication and return user info.
 * @returns {Promise<object>} Current user data
 */
async function verifyAuth() {
  const user = await wpRequest('GET', '/wp/v2/users/me?context=edit');
  return {
    id: user.id,
    username: user.username || user.slug,
    name: user.name,
    roles: user.roles || [],
    capabilities: user.capabilities || {},
  };
}

/**
 * Create a WordPress post.
 * @param {object} params
 * @param {string} params.title - Post title
 * @param {string} params.content - Post HTML content
 * @param {string} [params.status='draft'] - Post status (draft, publish, future, pending)
 * @param {string} [params.date] - ISO8601 date for scheduling
 * @param {number[]} [params.categories] - Category IDs
 * @param {number[]} [params.tags] - Tag IDs
 * @param {number} [params.featuredMedia] - Featured image media ID
 * @returns {Promise<object>} Created post data
 */
async function createPost({
  title,
  content,
  status = 'draft',
  date,
  categories,
  tags,
  featuredMedia,
}) {
  if (!title || !content) {
    throw new Error('title and content are required to create a post.');
  }

  const body = {
    title,
    content,
    status,
  };

  if (date) {
    body.date = date;
    if (status === 'publish' && new Date(date) > new Date()) {
      body.status = 'future';
    }
  }

  if (categories && categories.length > 0) {
    body.categories = categories;
  }

  if (tags && tags.length > 0) {
    body.tags = tags;
  }

  if (featuredMedia) {
    body.featured_media = featuredMedia;
  }

  const post = await wpRequest('POST', '/wp/v2/posts', body);

  return {
    id: post.id,
    link: post.link,
    status: post.status,
    title: post.title?.rendered || title,
  };
}

/**
 * Upload a media file to WordPress.
 * @param {string} filePath - Absolute path to the file
 * @param {string} [altText=''] - Alt text for the media
 * @returns {Promise<object>} Uploaded media data
 */
async function uploadMedia(filePath, altText = '') {
  if (!WP_SITE_URL) {
    throw new Error('WP_SITE_URL must be set in .env file.');
  }

  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const fileBuffer = fs.readFileSync(absolutePath);
  const fileName = path.basename(absolutePath);

  const url = `${WP_SITE_URL}/wp-json/wp/v2/media`;

  const headers = {
    Authorization: authHeader(),
    'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    'Content-Type': getMimeType(fileName),
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: fileBuffer,
    });
  } catch (err) {
    throw new Error(`Network error uploading media: ${err.message}`);
  }

  const data = await response.json();

  if (!response.ok) {
    const code = data?.code || 'unknown';
    const message = data?.message || JSON.stringify(data);
    throw new Error(
      `Media upload error ${response.status} [${code}]: ${message}`
    );
  }

  // Set alt text if provided
  if (altText && data.id) {
    try {
      await wpRequest('POST', `/wp/v2/media/${data.id}`, {
        alt_text: altText,
      });
    } catch (_err) {
      // Alt text update is non-critical; continue
      console.warn(`Warning: Could not set alt text: ${_err.message}`);
    }
  }

  return {
    id: data.id,
    url: data.source_url || data.guid?.rendered,
    title: data.title?.rendered || fileName,
  };
}

/**
 * Find existing tag by name, or create one.
 * @param {string} tagName - Tag name to find or create
 * @returns {Promise<{ id: number, name: string }>}
 */
async function findOrCreateTag(tagName) {
  if (!tagName || !tagName.trim()) {
    throw new Error('tagName is required.');
  }

  const searchName = tagName.trim();

  // Search for existing tag
  const existing = await wpRequest(
    'GET',
    `/wp/v2/tags?search=${encodeURIComponent(searchName)}&per_page=100`
  );

  if (Array.isArray(existing)) {
    const exactMatch = existing.find(
      (t) => t.name.toLowerCase() === searchName.toLowerCase()
    );
    if (exactMatch) {
      return { id: exactMatch.id, name: exactMatch.name };
    }
  }

  // Create new tag
  const created = await wpRequest('POST', '/wp/v2/tags', {
    name: searchName,
  });

  return { id: created.id, name: created.name };
}

/**
 * Determine MIME type from file extension.
 */
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

module.exports = {
  verifyAuth,
  createPost,
  uploadMedia,
  findOrCreateTag,
  wpRequest,
};
