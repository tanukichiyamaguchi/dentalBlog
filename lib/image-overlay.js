/**
 * OGP / section image generator using sharp.
 * Creates 1200x630 images with themed background and title text overlay.
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OGP_WIDTH = 1200;
const OGP_HEIGHT = 630;
const MAX_CHARS_PER_LINE = 20;
const MAX_LINES = 3;

/**
 * Theme-related SVG background patterns.
 * Each theme has decorative SVG elements related to the topic.
 */
const THEME_PATTERNS = {
  orthodontics: `
    <circle cx="150" cy="480" r="120" fill="white" opacity="0.06"/>
    <circle cx="1050" cy="150" r="90" fill="white" opacity="0.05"/>
    <path d="M180,520 Q200,480 220,520 Q230,550 210,560 Q190,560 180,520Z" fill="white" opacity="0.08" transform="scale(2) translate(-30,-180)"/>
    <path d="M950,100 Q960,80 970,100 Q975,115 965,118 Q955,118 950,100Z" fill="white" opacity="0.07" transform="scale(3) translate(-280,-10)"/>
    <rect x="80" y="200" width="60" height="8" rx="4" fill="white" opacity="0.04" transform="rotate(-15,110,204)"/>
    <rect x="1000" y="400" width="80" height="8" rx="4" fill="white" opacity="0.04" transform="rotate(20,1040,404)"/>
  `,
  implant: `
    <circle cx="1000" cy="500" r="140" fill="white" opacity="0.06"/>
    <circle cx="200" cy="130" r="100" fill="white" opacity="0.05"/>
    <rect x="130" cy="350" width="12" height="80" rx="6" fill="white" opacity="0.07" transform="rotate(-10,136,390)"/>
    <path d="M1060,180 L1070,160 L1080,180 L1075,240 Q1070,250 1065,240Z" fill="white" opacity="0.06" transform="scale(1.5) translate(-350,-50)"/>
    <circle cx="600" cy="580" r="30" fill="white" opacity="0.04"/>
    <circle cx="900" cy="80" r="20" fill="white" opacity="0.04"/>
  `,
  tmj: `
    <circle cx="180" cy="500" r="130" fill="white" opacity="0.06"/>
    <circle cx="1020" cy="130" r="110" fill="white" opacity="0.05"/>
    <path d="M900,450 Q930,420 960,450 Q940,480 920,480Z" fill="white" opacity="0.06" transform="scale(1.8) translate(-400,-200)"/>
    <ellipse cx="300" cy="200" rx="40" ry="25" fill="white" opacity="0.04" transform="rotate(30,300,200)"/>
    <rect x="700" y="500" width="100" height="6" rx="3" fill="white" opacity="0.04"/>
  `,
  metalfree: `
    <circle cx="1050" cy="480" r="120" fill="white" opacity="0.06"/>
    <circle cx="150" cy="150" r="80" fill="white" opacity="0.05"/>
    <path d="M200,400 L250,400 L240,450 L210,450Z" fill="white" opacity="0.05"/>
    <circle cx="800" cy="100" r="40" fill="white" opacity="0.04"/>
    <circle cx="500" cy="550" r="25" fill="white" opacity="0.04"/>
    <rect x="900" y="300" width="70" height="6" rx="3" fill="white" opacity="0.04" transform="rotate(-20,935,303)"/>
  `,
  preventive: `
    <circle cx="150" cy="130" r="100" fill="white" opacity="0.06"/>
    <circle cx="1050" cy="500" r="130" fill="white" opacity="0.05"/>
    <path d="M300,500 Q320,470 340,500 Q330,520 310,520Z" fill="white" opacity="0.06" transform="scale(1.5) translate(-100,-250)"/>
    <circle cx="700" cy="80" r="20" fill="white" opacity="0.04"/>
    <rect x="100" y="350" width="50" height="6" rx="3" fill="white" opacity="0.04"/>
  `,
  default: `
    <circle cx="150" cy="480" r="120" fill="white" opacity="0.06"/>
    <circle cx="1050" cy="150" r="90" fill="white" opacity="0.05"/>
    <circle cx="600" cy="580" r="30" fill="white" opacity="0.04"/>
  `,
};

/**
 * Split title text into lines of up to maxChars characters.
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

  if (remaining.length > 0 && lines.length === maxLines) {
    const lastLine = lines[maxLines - 1];
    lines[maxLines - 1] = lastLine.slice(0, maxChars - 1) + '\u2026';
  }

  return lines;
}

/**
 * Build SVG with gradient background, theme pattern, and title text.
 * @param {string[]} titleLines
 * @param {string} theme - Theme key for background pattern
 * @returns {string} Complete SVG markup
 */
function buildCompleteSvg(titleLines, theme = 'default') {
  const fontSize = 48;
  const lineHeight = 68;
  const totalTextHeight = titleLines.length * lineHeight;
  const startY = (OGP_HEIGHT - totalTextHeight) / 2 + fontSize * 0.35;

  const pattern = THEME_PATTERNS[theme] || THEME_PATTERNS.default;

  const titleElements = titleLines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      return `    <text x="${OGP_WIDTH / 2}" y="${y}" text-anchor="middle" font-family="'Noto Sans CJK JP', 'Meiryo', sans-serif" font-size="${fontSize}" font-weight="bold" fill="white" filter="url(#shadow)">${escapeXml(line)}</text>`;
    })
    .join('\n');

  return `<svg width="${OGP_WIDTH}" height="${OGP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#ea580c;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#f97316;stop-opacity:1" />
    </linearGradient>
    <filter id="shadow" x="-2%" y="-2%" width="104%" height="104%">
      <feDropShadow dx="1" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.3)"/>
    </filter>
  </defs>
  <rect width="${OGP_WIDTH}" height="${OGP_HEIGHT}" fill="url(#grad)"/>
  ${pattern}
${titleElements}
    <text x="${OGP_WIDTH - 40}" y="${OGP_HEIGHT - 30}" text-anchor="end" font-family="'Noto Sans CJK JP', 'Meiryo', sans-serif" font-size="22" fill="white" opacity="0.85">\u4F50\u3005\u6728\u6B6F\u79D1\u533B\u9662</text>
</svg>`;
}

/**
 * Escape special characters for XML/SVG.
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
 * Generate an OGP/section image (1200x630) with themed background and title.
 * @param {string} title - Title text to display
 * @param {string} outputPath - Path to save the generated PNG
 * @param {string} [theme='default'] - Theme key: orthodontics, implant, tmj, metalfree, preventive
 * @returns {Promise<string>} Absolute path to the generated image
 */
async function generateOgpImage(title, outputPath, theme = 'default') {
  if (!title) {
    throw new Error('Title is required to generate OGP image.');
  }

  const outputDir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const titleLines = wrapTitle(title);
  const svgBuffer = Buffer.from(buildCompleteSvg(titleLines, theme));

  await sharp(svgBuffer)
    .resize(OGP_WIDTH, OGP_HEIGHT)
    .png()
    .toFile(path.resolve(outputPath));

  const absolutePath = path.resolve(outputPath);
  console.log(`OGP image generated: ${absolutePath}`);
  return absolutePath;
}

module.exports = {
  generateOgpImage,
};
