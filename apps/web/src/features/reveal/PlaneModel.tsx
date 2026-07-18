import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { familyOf, type Family } from "@aloft/shared";
import { accentColor } from "./liveries";

interface Dims {
  bodyLen: number;
  bodyR: number;
  span: number;
  engines: number;
  highWing: boolean;
  props: boolean;
}

const DIMS: Record<Family, Dims> = {
  quad: { bodyLen: 7.2, bodyR: 0.62, span: 7.6, engines: 4, highWing: false, props: false },
  widebody: { bodyLen: 6.6, bodyR: 0.56, span: 6.8, engines: 2, highWing: false, props: false },
  narrowbody: { bodyLen: 5.2, bodyR: 0.42, span: 5.0, engines: 2, highWing: false, props: false },
  turboprop: { bodyLen: 4.0, bodyR: 0.38, span: 4.6, engines: 2, highWing: true, props: true },
  ga: { bodyLen: 2.6, bodyR: 0.3, span: 3.4, engines: 1, highWing: true, props: true },
};

/**
 * Stylized low-poly aircraft built from primitives — the MVP stand-in for the
 * curated GLB library. Same mount point and scale as future GLBs, so swapping
 * in real models later is a loader change, not a scene change.
 */
export function PlaneModel({
  typeIcao,
  callsign,
  spin = true,
}: {
  typeIcao?: string;
  callsign: string;
  spin?: boolean;
}) {
  const group = useRef<Group>(null);
  const dims = DIMS[familyOf(typeIcao)];
  const accent = useMemo(() => accentColor(callsign), [callsign]);
  const fuselage = "#e8edf4";

  useFrame((_, dt) => {
    if (spin && group.current) group.current.rotation.y += dt * 0.35;
  });

  const wingY = dims.highWing ? dims.bodyR * 0.7 : -dims.bodyR * 0.35;
  const engineXs =
    dims.engines === 4
      ? [-dims.span * 0.34, -dims.span * 0.18, dims.span * 0.18, dims.span * 0.34]
      : dims.engines === 2
        ? [-dims.span * 0.22, dims.span * 0.22]
        : [0];

  return (
    <group ref={group}>
      {/* Fuselage: capsule laid along Z (nose toward +Z) */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[dims.bodyR, dims.bodyLen, 6, 12]} />
        <meshStandardMaterial color={fuselage} flatShading />
      </mesh>
      {/* Cockpit band */}
      <mesh position={[0, dims.bodyR * 0.35, dims.bodyLen * 0.42]} rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[dims.bodyR * 0.55, dims.bodyR * 0.9, 4, 8]} />
        <meshStandardMaterial color="#1e293b" flatShading />
      </mesh>
      {/* Main wings */}
      <mesh position={[0, wingY, dims.bodyLen * 0.02]} rotation={[0, 0, 0]}>
        <boxGeometry args={[dims.span, 0.08, dims.bodyLen * 0.22]} />
        <meshStandardMaterial color={fuselage} flatShading />
      </mesh>
      {/* Wingtips */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * dims.span) / 2, wingY + 0.12, dims.bodyLen * 0.02]}>
          <boxGeometry args={[0.06, 0.28, dims.bodyLen * 0.14]} />
          <meshStandardMaterial color={accent} flatShading />
        </mesh>
      ))}
      {/* Tail fin */}
      <mesh position={[0, dims.bodyR + 0.5, -dims.bodyLen * 0.46]}>
        <boxGeometry args={[0.08, 1.1, dims.bodyLen * 0.14]} />
        <meshStandardMaterial color={accent} flatShading />
      </mesh>
      {/* Horizontal stabilizer */}
      <mesh position={[0, dims.bodyR * 0.5, -dims.bodyLen * 0.46]}>
        <boxGeometry args={[dims.span * 0.38, 0.06, dims.bodyLen * 0.1]} />
        <meshStandardMaterial color={fuselage} flatShading />
      </mesh>
      {/* Engines / props */}
      {engineXs.map((x) => (
        <group key={x} position={[x, dims.props ? wingY : wingY - 0.22, dims.props ? dims.bodyLen * 0.1 : dims.bodyLen * 0.08]}>
          {dims.props ? (
            <>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.09, 0.12, 0.5, 8]} />
                <meshStandardMaterial color={accent} flatShading />
              </mesh>
              <mesh position={[0, 0, 0.28]}>
                <boxGeometry args={[0.75, 0.06, 0.03]} />
                <meshStandardMaterial color="#334155" flatShading />
              </mesh>
            </>
          ) : (
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.18, 0.2, 0.7, 10]} />
              <meshStandardMaterial color={accent} flatShading />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
