/**
 * Article quality checker for dental clinic blog posts.
 * Validates content against clinic-specific rules before publishing.
 */

/**
 * Strip HTML tags from a string.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Run all quality checks on Markdown content.
 *
 * @param {string} markdownContent - Full Markdown content (including frontmatter)
 * @param {object} clinicConfig - Clinic configuration object
 * @param {string[]} [clinicConfig.ngWords] - Prohibited words list
 * @param {string[]} [clinicConfig.servicePages] - Valid service page URLs
 * @returns {{ passed: boolean, errors: string[], warnings: string[] }}
 */
function runQualityCheck(markdownContent, clinicConfig = {}) {
  const errors = [];
  const warnings = [];

  if (!markdownContent || markdownContent.trim().length === 0) {
    errors.push('Article content is empty.');
    return { passed: false, errors, warnings };
  }

  const content = markdownContent;
  const plainText = stripHtml(content);
  const ngWords = clinicConfig.ngWords || [];
  const servicePagesRaw = clinicConfig.servicePages || {};
  const servicePages = Array.isArray(servicePagesRaw)
    ? servicePagesRaw
    : Object.values(servicePagesRaw);

  // 1. NG words detection
  for (const word of ngWords) {
    if (content.toLowerCase().includes(word.toLowerCase())) {
      errors.push(`NG word detected: "${word}"`);
    }
  }

  // 2. Placeholder [[...]] detection
  const placeholderMatches = content.match(/\[\[[^\]]*\]\]/g);
  if (placeholderMatches) {
    for (const match of placeholderMatches) {
      errors.push(`Placeholder remaining: ${match}`);
    }
  }

  // 3. Dummy URL detection (example.com, dummy, placeholder in URLs)
  const urlPattern = /https?:\/\/[^\s)"'>]+/g;
  const urls = content.match(urlPattern) || [];
  for (const url of urls) {
    const lowerUrl = url.toLowerCase();
    if (
      lowerUrl.includes('example.com') ||
      lowerUrl.includes('dummy') ||
      lowerUrl.includes('placeholder')
    ) {
      errors.push(`Dummy URL detected: ${url}`);
    }
  }

  // 4. Mojibake (U+FFFD replacement character) detection
  if (content.includes('\uFFFD')) {
    errors.push(
      'Mojibake detected: replacement character (U+FFFD) found in content.'
    );
  }

  // 5. <figcaption> tag detection
  if (/<figcaption[\s>]/i.test(content)) {
    errors.push(
      '<figcaption> tag detected in content. This tag should not be used.'
    );
  }

  // 6. AI-style CTA detection (">>...はこちら" pattern)
  const ctaPattern = />>.*?はこちら/g;
  const ctaMatches = content.match(ctaPattern);
  if (ctaMatches) {
    for (const match of ctaMatches) {
      errors.push(`AI CTA pattern detected: "${match}"`);
    }
  }

  // 7. Character count check (minimum 6,000 characters after stripping HTML)
  const charCount = plainText.replace(/\s/g, '').length;
  if (charCount < 8000) {
    errors.push(
      `Character count insufficient: ${charCount} characters (minimum 8,000 required).`
    );
  }

  // 8. Fictitious internal link detection
  const clinicDomain = 'dentalclinic-sasaki.com';
  const internalUrls = urls.filter((url) =>
    url.toLowerCase().includes(clinicDomain)
  );
  const normalizeUrl = (u) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  if (internalUrls.length > 0 && servicePages.length > 0) {
    for (const url of internalUrls) {
      const normUrl = normalizeUrl(url);
      const isValid = servicePages.some(
        (page) => normUrl === normalizeUrl(page) || normUrl.startsWith(normalizeUrl(page))
      );
      if (!isValid) {
        warnings.push(
          `Possibly fictitious internal link: ${url} (not found in servicePages)`
        );
      }
    }
  } else if (internalUrls.length > 0 && servicePages.length === 0) {
    for (const url of internalUrls) {
      warnings.push(
        `Internal link found but no servicePages defined to validate: ${url}`
      );
    }
  }

  // 9. Prohibited proprietary term detection (case-insensitive)
  const prohibitedTermPattern = /meaw/i;
  if (prohibitedTermPattern.test(content)) {
    errors.push(
      'Prohibited proprietary term detected in content (case-insensitive match).'
    );
  }

  // 10. Required disclaimer block check
  // Must contain all three: "リスク", "副作用", "自由診療"
  const hasRisk = content.includes('リスク');
  const hasSideEffect = content.includes('副作用');
  const hasSelfPay = content.includes('自由診療');

  if (!hasRisk || !hasSideEffect || !hasSelfPay) {
    const missing = [];
    if (!hasRisk) missing.push('リスク');
    if (!hasSideEffect) missing.push('副作用');
    if (!hasSelfPay) missing.push('自由診療');
    errors.push(
      `Required disclaimer terms missing: ${missing.join(', ')}. All three ("リスク", "副作用", "自由診療") must be present.`
    );
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

module.exports = {
  runQualityCheck,
};
