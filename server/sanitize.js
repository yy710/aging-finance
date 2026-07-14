const sanitizeHtml = require('sanitize-html');

function sanitizeContent(value) {
  return sanitizeHtml(String(value || ''), {
    allowedTags: [
      'p', 'br', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'u',
      'a', 'img', 'figure', 'figcaption', 'blockquote', 'hr', 'table', 'thead',
      'tbody', 'tr', 'th', 'td', 'div', 'span',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      th: ['scope', 'colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      '*': ['class'],
    },
    allowedClasses: {
      '*': [
        'content-lead', 'content-note', 'content-image', 'content-grid',
        'content-callout', 'text-center',
      ],
    },
    allowedSchemes: ['http', 'https'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    transformTags: {
      a(tagName, attributes) {
        const transformed = { ...attributes };
        if (transformed.target === '_blank') {
          transformed.rel = 'noopener noreferrer';
        } else {
          delete transformed.target;
          delete transformed.rel;
        }
        return { tagName, attribs: transformed };
      },
      img(tagName, attributes) {
        return {
          tagName,
          attribs: { loading: 'lazy', ...attributes },
        };
      },
    },
    exclusiveFilter(frame) {
      if (frame.tag === 'a') {
        const href = String(frame.attribs.href || '');
        return href.trim().toLowerCase().startsWith('javascript:');
      }
      return false;
    },
  });
}

module.exports = { sanitizeContent };
