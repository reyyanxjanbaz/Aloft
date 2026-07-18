import { Suspense, useEffect, useRef, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { PlaneModel } from "./PlaneModel";
import { accentColor } from "./liveries";
import { resolveModel, type ResolvedModel } from "./modelRegistry";

/** Renders a real GLB from the library, tinted with the airline accent. */
function GltfModel({ resolved, callsign }: { resolved: ResolvedModel; callsign: string }) {
  const group = useRef<Group>(null);
  const { scene } = useGLTF(resolved.url);

  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.35;
  });

  // Materials named for the livery accent get the airline's brand color.
  useEffect(() => {
    const color = accentColor(callsign);
    scene.traverse((obj) => {
      const mesh = obj as { material?: { name?: string; color?: { set(c: string): void } } };
      const name = mesh.material?.name?.toLowerCase() ?? "";
      if (mesh.material?.color && (name.includes("accent") || name.includes("livery"))) {
        mesh.material.color.set(color);
      }
    });
  }, [scene, callsign]);

  return (
    <group ref={group} rotation={[0, resolved.entry.yaw ?? 0, 0]} scale={resolved.entry.scale ?? 1}>
      <primitive object={scene.clone()} />
    </group>
  );
}

/**
 * The single mount point for aircraft geometry: a real GLB when the library
 * has one for this type, otherwise the procedural stylized model. Adding
 * models to public/models/manifest.json upgrades reveals with no code change.
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
    return <PlaneModel typeIcao={typeIcao} callsign={callsign} />;
  }

  return (
    <Suspense fallback={<PlaneModel typeIcao={typeIcao} callsign={callsign} />}>
      <GltfModel resolved={resolved} callsign={callsign} />
    </Suspense>
  );
}
