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
  manifestPromise ??= fetch("/models/manifest.json")
    .then((res) => (res.ok ? (res.json() as Promise<Manifest>) : null))
    .catch(() => null);
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
