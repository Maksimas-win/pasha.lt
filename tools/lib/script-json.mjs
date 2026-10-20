/** Keep JSON data inside its HTML script element, including untrusted titles. */
export function scriptJSON(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}
