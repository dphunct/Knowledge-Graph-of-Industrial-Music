const HTML_ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (character) => HTML_ENTITIES[character],
  );
}

// Provenance links are external data. Only allow normal web links in the
// rendered interface; malformed or non-web schemes remain harmless text.
export function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
