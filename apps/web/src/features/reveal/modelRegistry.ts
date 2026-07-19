import { familyOf } from "@aloft/shared";

export interface ModelEntry {
  /** File name relative to the manifest baseUrl, e.g. "a320.glb". */
  file: string;
  /** Credit shown on the in-app attribution screen. Required for CC-BY assets. */
  author?: string;
  license?: string;
  sourceUrl?: string;
  /** Uniform scale applied so every model reads at a consistent size on stage. */
  scale?: number;
  /** Extra Y rotation (radians) when the source model doesn't face +Z. */
  yaw?: number;
}

interface Manifest {
  version: number;
  baseUrl: string;
  /** Keys are ICAO type designators (A320) or family names (widebody). */
  models: Record<string, ModelEntry>;
}

let manifestPromise: Promise<Manifest | null> | null = null;

function loadManifest(): Promise<Manifest | null> {
  if (!manifestPromise) {
    manifestPromise = fetch("/models/manifest.json")
      .then((res) => {
        // A 404 is a permanent answer — this deployment ships no manifest —
        // so cache it. Retrying meant every reveal and every credits screen
        // re-requested a file that will never exist.
        if (!res.ok) return null;
        return res.json() as Promise<Manifest>;
      })
      .catch(() => {
        // A network error, by contrast, may well succeed later: clear the
        // cache so the next call retries rather than falling back all session.
        manifestPromise = null;
        return null;
      });
  }
  return manifestPromise;
}

export interface ResolvedModel {
  url: string;
  entry: ModelEntry;
}

/**
 * Resolves an aircraft type to a GLB, preferring an exact type match and
 * falling back to a family-wide model. Returns null when the library has
 * nothing for it — the caller then renders the procedural stand-in.
 */
export async function resolveModel(typeIcao: string | undefined): Promise<ResolvedModel | null> {
  const manifest = await loadManifest();
  if (!manifest) return null;

  const type = (typeIcao ?? "").toUpperCase();
  const entry = manifest.models[type] ?? manifest.models[familyOf(typeIcao)];
  if (!entry) return null;

  return { url: `${manifest.baseUrl}${entry.file}`, entry };
}

/** Every credited model in the library, for the attribution screen. */
export async function listAttributions(): Promise<Array<ModelEntry & { key: string }>> {
  const manifest = await loadManifest();
  if (!manifest) return [];
  return Object.entries(manifest.models)
    .map(([key, entry]) => ({ key, ...entry }))
    .filter((e) => e.author || e.license);
}
