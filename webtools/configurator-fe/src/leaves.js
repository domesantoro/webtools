// What a leaf of a configuration document is, in one place.
//
// The rule comes from how the configuration is built, not from how it is shown:
// `load_configuration.sh` descends only where both sides hold a plain object and
// replaces everything else whole — a string, a number, a list. So a leaf is
// anything that is not a plain object, lists included.
//
// Both users of this need the same notion of leaf: whoever reads the secrets'
// files (which paths come from there) and whoever compares the documents (which
// values are the same in several subsystems). Written twice, it would drift.

export function isBranch(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// → [[dotted path, value], …], in the document's own order.
export function leafEntries(document, prefix = "") {
  const entries = [];
  for (const [key, value] of Object.entries(document)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isBranch(value)) entries.push(...leafEntries(value, path));
    else entries.push([path, value]);
  }
  return entries;
}
