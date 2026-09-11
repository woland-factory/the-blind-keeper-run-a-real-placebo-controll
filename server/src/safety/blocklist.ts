// Server-side safety heuristic: refuse to pre-register a run against a common
// prescription or controlled drug. This is not a medical database. The
// acknowledgement checkbox and the always-visible not-medical-advice line carry
// the rest. The list lives only on the server so it never ships in the bundle.

const BLOCKLIST: string[] = [
  // Statins
  "atorvastatin", "simvastatin", "rosuvastatin", "lipitor", "crestor",
  // SSRIs / SNRIs
  "sertraline", "fluoxetine", "escitalopram", "venlafaxine", "zoloft", "prozac", "lexapro",
  // Benzodiazepines
  "alprazolam", "diazepam", "clonazepam", "xanax", "valium",
  // Stimulants
  "adderall", "amphetamine", "methylphenidate", "ritalin", "vyvanse",
  // Opioids
  "oxycodone", "hydrocodone", "tramadol", "codeine",
  // Anticoagulants
  "warfarin", "coumadin", "apixaban", "eliquis",
  // Other common prescriptions
  "metformin", "insulin", "levothyroxine", "synthroid", "prednisone",
  "lisinopril", "gabapentin", "sildenafil", "viagra",
];

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalize the input (trim, lowercase, collapse internal whitespace) and match
 * any blocklist term as a whole word. Returns the matched term, or null. A
 * whole-word match means "vitamin" never trips a term that is only a substring.
 */
export function blocklistMatch(substanceName: string): string | null {
  const normalized = substanceName.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return null;
  for (const term of BLOCKLIST) {
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`);
    if (re.test(normalized)) return term;
  }
  return null;
}
