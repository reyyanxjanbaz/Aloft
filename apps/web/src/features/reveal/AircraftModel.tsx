import { Suspense, useEffect, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import { Airframe } from "./Airframe";
import { accentColor } from "./liveries";
import { resolveModel, type ResolvedModel } from "./modelRegistry";

/** A real GLB from the curated library, tinted with the operator's colour. */
function GltfModel({ resolved, callsign }: { resolved: ResolvedModel; callsign: string }) {
  const group = useRef<Group>(null);
  const { scene } = useGLTF(resolved.url);

  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.28;
  });

  useEffect(() => {
    const color = accentColor(callsign);
    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const material = mesh.material as { name?: string; color?: { set(c: string): void } };
      const name = material?.name?.toLowerCase() ?? "";
      if (material?.color && (name.includes("accent") || name.includes("livery"))) {
        material.color.set(color);
      }
    });
  }, [scene, callsign]);

  return (
    <group ref={group} rotation={[0, resolved.entry.yaw ?? 0, 0]} scale={resolved.entry.scale ?? 1}>
      <primitive object={scene} />
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
