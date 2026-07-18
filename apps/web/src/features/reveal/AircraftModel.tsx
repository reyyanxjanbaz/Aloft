import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { Group, Material, Mesh } from "three";
import { Airframe } from "./Airframe";
import { accentColor } from "./liveries";
import { resolveModel, type ResolvedModel } from "./modelRegistry";

/** A real GLB from the curated library, tinted with the operator's colour. */
function GltfModel({ resolved, callsign }: { resolved: ResolvedModel; callsign: string }) {
  const group = useRef<Group>(null);
  const { scene } = useGLTF(resolved.url);
  // useGLTF caches and returns the SAME scene graph for every instance of
  // this URL — cloning here means mutating this instance's paint below can
  // never bleed into another aircraft of the same type rendered elsewhere.
  const instance = useMemo(() => scene.clone(true), [scene]);

  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.28;
  });

  useEffect(() => {
    const color = accentColor(callsign);
    instance.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const material = mesh.material as Material & { name?: string; color?: { set(c: string): void } };
      const name = material?.name?.toLowerCase() ?? "";
      if (material?.color && (name.includes("accent") || name.includes("livery"))) {
        // Object3D.clone() copies the hierarchy but intentionally shares
        // materials by reference (to avoid duplicating GPU resources when
        // no per-instance change is needed) — the accent material is still
        // the one shared object every clone points at unless cloned too.
        const owned = material.clone() as typeof material;
        owned.color?.set(color);
        mesh.material = owned;
      }
    });
  }, [instance, callsign]);

  return (
    <group ref={group} rotation={[0, resolved.entry.yaw ?? 0, 0]} scale={resolved.entry.scale ?? 1}>
      <primitive object={instance} />
    </group>
  );
}

/**
 * Single mount point for aircraft geometry: a curated GLB when the library has
 * one for this type, otherwise the generated airframe. Registering a model in
 * public/models/manifest.json upgrades every reveal with no code change.
 */
export function AircraftModel({ typeIcao, callsign }: { typeIcao?: string; callsign: string }) {
  const [resolved, setResolved] = useState<ResolvedModel | null | "pending">("pending");

  useEffect(() => {
    let cancelled = false;
    void resolveModel(typeIcao).then((r) => {
      if (!cancelled) setResolved(r);
    });
    return () => {
      cancelled = true;
    };
  }, [typeIcao]);

  if (resolved === "pending" || resolved === null) {
    return <Airframe typeIcao={typeIcao} callsign={callsign} />;
  }

  return (
    <Suspense fallback={<Airframe typeIcao={typeIcao} callsign={callsign} />}>
      <GltfModel resolved={resolved} callsign={callsign} />
    </Suspense>
  );
}
