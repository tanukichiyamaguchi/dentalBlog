/**
 * Markdown to HTML converter with frontmatter parser.
 * Uses marked + sanitize-html.
 */

const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

/**
 * Parse YAML-like frontmatter from a Markdown string.
 * Frontmatter is delimited by --- on its own line at the start of the file.
 *
 * Supported value formats:
 *   key: value            -> string
 *   key: [a, b, c]        -> array
 *   key:                   -> array (following lines starting with "- ")
 *     - item1
 *     - item2
 *
 * @param {string} markdown - Raw Markdown with optional frontmatter
 * @returns {object} Parsed frontmatter key-value pairs
 */
function parseFrontmatter(markdown) {
  const result = {};

  if (!markdown || !markdown.trimStart().startsWith('---')) {
    return result;
  }

  const lines = markdown.split('\n');
  let startIdx = -1;
  let endIdx = -1;

  // Find opening ---
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (startIdx === -1) {
        startIdx = i;
      } else {
        endIdx = i;
        break;
      }
    }
  }

  if (startIdx === -1 || endIdx === -1) {
    return result;
  }

  const frontmatterLines = lines.slice(startIdx + 1, endIdx);

  let currentKey = null;
  let collectingList = false;
  let listItems = [];

  for (let i = 0; i < frontmatterLines.length; i++) {
    const line = frontmatterLines[i];

    // List item continuation (indented "- value")
    if (collectingList && /^\s+-\s+/.test(line)) {
      listItems.push(line.replace(/^\s+-\s+/, '').trim());
      continue;
    }

    // If we were collecting a list, flush it
    if (collectingList && currentKey) {
      result[currentKey] = listItems;
      collectingList = false;
      listItems = [];
      currentKey = null;
    }

    // Key: value line
    const kvMatch = line.match(/^(\w[\w\s-]*?):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const rawValue = kvMatch[2].trim();

      if (!rawValue) {
        // Value might be a list on the following lines
        currentKey = key;
        collectingList = true;
        listItems = [];
        continue;
      }

      // Inline array: [a, b, c]
      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        const inner = rawValue.slice(1, -1);
        result[key] = inner
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      } else {
        // Scalar value - strip quotes
        result[key] = rawValue.replace(/^['"]|['"]$/g, '');
      }

      currentKey = key;
      collectingList = false;
    }
  }

  // Flush remaining list
  if (collectingList && currentKey) {
    result[currentKey] = listItems;
  }

  return result;
}

/**
 * Extract body content from Markdown (everything after frontmatter).
 * @param {string} markdown - Raw Markdown with optional frontmatter
 * @returns {string} Body content without frontmatter
 */
function extractBody(markdown) {
  if (!markdown) return '';

  if (!markdown.trimStart().startsWith('---')) {
    return markdown;
  }

  const lines = markdown.split('\n');
  let delimCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      delimCount++;
      if (delimCount === 2) {
        return lines.slice(i + 1).join('\n').replace(/^\n+/, '');
      }
    }
  }

  // If no closing ---, return as-is
  return markdown;
}

/**
 * Convert Markdown to sanitised HTML.
 * @param {string} markdown - Markdown string (body only, no frontmatter)
 * @returns {string} Sanitised HTML
 */
function convertMarkdownToHtml(markdown) {
  if (!markdown) return '';

  // Configure marked
  marked.setOptions({
    gfm: true,
    breaks: true,
  });

  const rawHtml = marked.parse(markdown);

  // Sanitise HTML
  const cleanHtml = sanitizeHtml(rawHtml, {
    allowedTags: [
      'h2',
      'h3',
      'p',
      'ul',
      'ol',
      'li',
      'a',
      'strong',
      'em',
      'blockquote',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'img',
      'br',
      'hr',
    ],
    // Note: <figcaption> is intentionally excluded from allowedTags
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'style'],
      th: ['align'],
      td: ['align'],
    },
    transformTags: {
      img: (tagName, attribs) => {
        return {
          tagName,
          attribs: {
            ...attribs,
            style: 'max-width:100%',
          },
        };
      },
    },
  });

  return cleanHtml;
}

module.exports = {
  convertMarkdownToHtml,
  parseFrontmatter,
  extractBody,
};
