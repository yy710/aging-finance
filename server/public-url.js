'use strict';

const EXTERNAL_REFERENCE_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu;

function splitReference(value) {
  const input = String(value);
  const hashIndex = input.indexOf('#');
  const fragment = hashIndex >= 0 ? input.slice(hashIndex) : '';
  const withoutFragment = hashIndex >= 0 ? input.slice(0, hashIndex) : input;
  const queryIndex = withoutFragment.indexOf('?');
  return {
    pathname: queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment,
    query: queryIndex >= 0 ? withoutFragment.slice(queryIndex) : '',
    fragment,
  };
}

function normalizePublicBasePath(value = '') {
  const input = String(value ?? '').trim();
  if (!input || input === '/') return '';
  if (!input.startsWith('/')) {
    throw new TypeError('PUBLIC_BASE_PATH must be empty or start with /');
  }
  if (input.includes('?') || input.includes('#') || input.includes('\\') || input.includes('\u0000')) {
    throw new TypeError('PUBLIC_BASE_PATH must contain only URL path segments');
  }

  let decoded;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    throw new TypeError('PUBLIC_BASE_PATH contains invalid percent encoding');
  }
  if (decoded.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new TypeError('PUBLIC_BASE_PATH cannot contain . or .. segments');
  }

  const normalized = input.replace(/\/{2,}/gu, '/').replace(/\/+$/u, '');
  return normalized === '/' ? '' : normalized;
}

function isExternalReference(value) {
  return EXTERNAL_REFERENCE_PATTERN.test(String(value || '').trim());
}

function createPublicUrl(publicBasePath = '') {
  const basePath = normalizePublicBasePath(publicBasePath);
  return function publicUrl(reference = '/') {
    if (reference === null || reference === undefined || reference === '') return '';
    const input = String(reference).trim();
    if (!input || isExternalReference(input)) return input;

    const { pathname: rawPathname, query, fragment } = splitReference(input);
    const pathname = rawPathname.startsWith('/') ? rawPathname : `/${rawPathname}`;
    if (!basePath) return `${pathname}${query}${fragment}`;
    if (pathname === basePath || pathname.startsWith(`${basePath}/`)) {
      return `${pathname}${query}${fragment}`;
    }
    if (pathname === '/') return `${basePath}/${query}${fragment}`;
    return `${basePath}${pathname}${query}${fragment}`;
  };
}

function stripPublicBasePath(reference, publicBasePath = '') {
  if (reference === null || reference === undefined || reference === '') return '';
  const input = String(reference).trim();
  if (!input || isExternalReference(input)) return input;
  const basePath = normalizePublicBasePath(publicBasePath);
  const { pathname, query, fragment } = splitReference(input);
  if (!basePath) return input;
  if (pathname === basePath) return `/${query}${fragment}`;
  if (pathname.startsWith(`${basePath}/`)) {
    return `${pathname.slice(basePath.length)}${query}${fragment}`;
  }
  return input;
}

function createPageUrl(publicBasePath = '', resolvePage) {
  const publicUrl = createPublicUrl(publicBasePath);
  return function pageUrl(pageOrId) {
    const page = typeof resolvePage === 'function' && !(pageOrId && typeof pageOrId === 'object')
      ? resolvePage(pageOrId)
      : pageOrId;
    const value = page && typeof page === 'object' ? page.url : page;
    if (typeof value !== 'string' || !value) {
      throw new TypeError(`Cannot resolve public URL for page ${String(pageOrId)}`);
    }
    return publicUrl(value);
  };
}

function cookiePathForBase(publicBasePath = '') {
  return normalizePublicBasePath(publicBasePath) || '/';
}

module.exports = {
  cookiePathForBase,
  createPageUrl,
  createPublicUrl,
  isExternalReference,
  normalizePublicBasePath,
  splitReference,
  stripPublicBasePath,
};
