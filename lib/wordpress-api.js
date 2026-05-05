/**
 * WordPress REST API v2 client with Basic Auth.
 * Uses native fetch (Node 18+).
 *
 * Authentication is sent via:
 *   1. Query parameter _wp_auth (primary - bypasses XSERVER header stripping)
 *   2. X-WP-Authorization custom header (fallback)
 *   3. Standard Authorization header (fallback)
 */

const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const WP_SITE_URL = (process.env.WP_SITE_URL || '').replace(/\/+$/, '');
const WP_USERNAME = process.env.WP_USERNAME || '';
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || '';

/**
 * Build the base64-encoded auth token.
 * @returns {string} Base64 encoded "username:password"
 */
function authToken() {
  if (!WP_USERNAME || !WP_APP_PASSWORD) {
    throw new Error(
      'WP_USERNAME and WP_APP_PASSWORD must be set in .env file.'
    );
  }
  return Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64');
}

/**
 * Build the REST API URL using ?rest_route= to bypass XSERVER /wp-json/ block.
 * Auth token is included as _wp_auth query parameter.
 *
 * @param {string} endpoint - e.g. "/wp/v2/posts" or "/wp/v2/users/me?context=edit"
 * @returns {string} Full URL
 */
function buildUrl(endpoint) {
  const [epPath, epQuery] = endpoint.split('?');
  const token = authToken();
  let url = `${WP_SITE_URL}/?rest_route=${epPath}&_wp_auth=${encodeURIComponent(token)}`;
  if (epQuery) {
    url += `&${epQuery}`;
  }
  return url;
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

  const url = buildUrl(endpoint);
  const token = authToken();

  const headers = {
    Authorization: `Basic ${token}`,
    'X-WP-Authorization': `Basic ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'SasakiDentalBlogTools/1.0',
  };

  const options = { method, headers };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    throw new Error(`Network error while requesting ${method} ${endpoint}: ${err.message}`);
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
 * Check if the auth-fix plugin is installed and active.
 * Calls the diagnostic endpoint (no auth required).
 * @returns {Promise<object|null>} Plugin status or null if not found
 */
async function checkPluginStatus() {
  if (!WP_SITE_URL) return null;

  const url = `${WP_SITE_URL}/?rest_route=/sasaki-dental/v1/status`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SasakiDentalBlogTools/1.0',
      },
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;

    return await response.json();
  } catch (_err) {
    return null;
  }
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

  const token = authToken();
  const url = `${WP_SITE_URL}/?rest_route=/wp/v2/media&_wp_auth=${encodeURIComponent(token)}`;

  const headers = {
    Authorization: `Basic ${token}`,
    'X-WP-Authorization': `Basic ${token}`,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    'Content-Type': getMimeType(fileName),
    'User-Agent': 'SasakiDentalBlogTools/1.0',
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

  let data;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    throw new Error(
      `Media upload error ${response.status}: unexpected response: ${text.slice(0, 500)}`
    );
  }

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

  const created = await wpRequest('POST', '/wp/v2/tags', {
    name: searchName,
  });

  return { id: created.id, name: created.name };
}

/**
 * Find existing category by name or slug.
 * Returns null if not found (does NOT create new categories).
 * @param {string} nameOrSlug - Category name or slug to search
 * @returns {Promise<{ id: number, name: string, slug: string } | null>}
 */
async function findCategory(nameOrSlug) {
  if (!nameOrSlug || !nameOrSlug.trim()) return null;

  const search = nameOrSlug.trim();

  // First try by slug (faster and more reliable)
  try {
    const bySlug = await wpRequest(
      'GET',
      `/wp/v2/categories?slug=${encodeURIComponent(search)}`
    );
    if (Array.isArray(bySlug) && bySlug.length > 0) {
      return { id: bySlug[0].id, name: bySlug[0].name, slug: bySlug[0].slug };
    }
  } catch (_) {}

  // Then try by name search
  try {
    const byName = await wpRequest(
      'GET',
      `/wp/v2/categories?search=${encodeURIComponent(search)}&per_page=100`
    );
    if (Array.isArray(byName)) {
      const exactMatch = byName.find(
        (c) => c.name === search || c.slug === search
      );
      if (exactMatch) {
        return { id: exactMatch.id, name: exactMatch.name, slug: exactMatch.slug };
      }
    }
  } catch (_) {}

  return null;
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
  findCategory,
  wpRequest,
  checkPluginStatus,
};
