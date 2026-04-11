/**
 * OGP image generator using sharp.
 * Creates 1200x630 images with gradient background and title text overlay.
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OGP_WIDTH = 1200;
const OGP_HEIGHT = 630;
const MAX_CHARS_PER_LINE = 20;
const MAX_LINES = 3;

/**
 * Split title text into lines of up to maxChars characters.
 * @param {string} title
 * @param {number} maxChars
 * @param {number} maxLines
 * @returns {string[]}
 */
function wrapTitle(title, maxChars = MAX_CHARS_PER_LINE, maxLines = MAX_LINES) {
  const lines = [];
  let remaining = title;

  while (remaining.length > 0 && lines.length < maxLines) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      remaining = '';
    } else {
      lines.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
    }
  }

  // If text was truncated, add ellipsis to last line
  if (remaining.length > 0 && lines.length === maxLines) {
    const lastLine = lines[maxLines - 1];
    lines[maxLines - 1] = lastLine.slice(0, maxChars - 1) + '\u2026';
  }

  return lines;
}

/**
 * Build SVG text overlay with title and clinic credit.
 * @param {string[]} titleLines
 * @returns {string} SVG markup
 */
function buildSvgOverlay(titleLines) {
  const fontSize = 48;
  const lineHeight = 68;
  const totalTextHeight = titleLines.length * lineHeight;
  const startY = (OGP_HEIGHT - totalTextHeight) / 2 + fontSize * 0.35;

  const titleElements = titleLines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      return `<text x="${OGP_WIDTH / 2}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="bold" fill="white">${escapeXml(line)}</text>`;
    })
    .join('\n    ');

  const svg = `<svg width="${OGP_WIDTH}" height="${OGP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    ${titleElements}
    <text x="${OGP_WIDTH - 40}" y="${OGP_HEIGHT - 30}" text-anchor="end" font-family="sans-serif" font-size="22" fill="white" opacity="0.85">\u4F50\u3005\u6728\u6B6F\u79D1\u533B\u9662</text>
  </svg>`;

  return svg;
}

/**
 * Build SVG gradient background.
 * Gradient from #1e3a8a (top-left) to #0ea5e9 (bottom-right).
 * @returns {string} SVG markup
 */
function buildGradientSvg() {
  return `<svg width="${OGP_WIDTH}" height="${OGP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1e3a8a;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#0ea5e9;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${OGP_WIDTH}" height="${OGP_HEIGHT}" fill="url(#grad)" />
</svg>`;
}

/**
 * Escape special characters for XML/SVG.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate an OGP image (1200x630) with gradient background and title text.
 * @param {string} title - Post title to display
 * @param {string} outputPath - Path to save the generated PNG
 * @returns {Promise<string>} Absolute path to the generated image
 */
async function generateOgpImage(title, outputPath) {
  if (!title) {
    throw new Error('Title is required to generate OGP image.');
  }

  // Ensure output directory exists
  const outputDir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const titleLines = wrapTitle(title);
  const gradientSvg = Buffer.from(buildGradientSvg());
  const overlaySvg = Buffer.from(buildSvgOverlay(titleLines));

  await sharp(gradientSvg)
    .resize(OGP_WIDTH, OGP_HEIGHT)
    .composite([
      {
        input: overlaySvg,
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toFile(path.resolve(outputPath));

  const absolutePath = path.resolve(outputPath);
  console.log(`OGP image generated: ${absolutePath}`);
  return absolutePath;
}

module.exports = {
  generateOgpImage,
};
