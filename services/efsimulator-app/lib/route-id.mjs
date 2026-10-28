/** Normalize one URL path segment across routers that return encoded or decoded params. */
export function decodeRouteId(value) {
  if (typeof value !== 'string' || value.length > 1536) return '';
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return ''; }
  if (!decoded || decoded.length > 512 || /[%/\\\u0000-\u001f]/.test(decoded)) return '';
  return decoded;
}
