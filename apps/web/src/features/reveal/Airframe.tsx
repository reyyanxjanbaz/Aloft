import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { accentColor } from "./liveries";
import { specFor, type AirframeSpec } from "./airframeSpec";

/**
 * A parametric airliner built from lathed and extruded surfaces rather than
 * stacked primitives: the fuselage is a revolved profile with a real nose dome
 * and tail cone, wings are swept and tapered planforms, and engines hang from
 * pylons. It is generated rather than downloaded, so it always exists offline,
 * and it is replaced by a real GLB the moment one is registered for the type.
 */

/** Revolved fuselage: pointed tail, parallel mid-section, rounded nose. */
function fuselageGeometry(spec: AirframeSpec): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const seg = 36;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg; // 0 = tail, 1 = nose
    const y = (t - 0.5) * spec.length;
    let r: number;
    if (t < 0.16) {
      // Tail cone sweeping up to the fin.
      r = spec.radius * Math.pow(t / 0.16, 0.6);
    } else if (t > 0.78) {
      // Nose: quarter-ellipse dome.
      const u = (t - 0.78) / 0.22;
      r = spec.radius * Math.sqrt(Math.max(0, 1 - u * u * 0.92));
    } else {
      r = spec.radius;
    }
    pts.push(new THREE.Vector2(Math.max(r, 0.012), y));
  }
  return new THREE.LatheGeometry(pts, 40);
}

/** Swept, tapered wing planform extruded to a thin aerofoil slab. */
function wingGeometry(spec: AirframeSpec, thickness: number): THREE.ExtrudeGeometry {
  const half = spec.span / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0, -spec.rootChord);
  shape.lineTo(half, -spec.sweep - spec.tipChord);
  shape.lineTo(half, -spec.sweep);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness / 2);
  return geo;
}

/**
 * Vertical fin. Built with chord along local X (aft is negative) and height
 * along local Y, so a single -90° yaw puts chord on Z, height on Y and
 * thickness on X — the plane a fin actually lives in.
 */
function finGeometry(spec: AirframeSpec, thickness: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(-spec.finChord, 0);
  shape.lineTo(-spec.finChord * 0.92, spec.finHeight);
  shape.lineTo(-spec.finChord * 0.42, spec.finHeight);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness / 2);
  return geo;
}

/** Nacelle: revolved cowling with a flared inlet lip. */
function nacelleGeometry(r: number, len: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const seg = 16;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const y = (t - 0.5) * len;
    let rad = r;
    if (t < 0.12) rad = r * (0.86 + t * 1.1);
    else if (t > 0.72) rad = r * (1 - (t - 0.72) * 0.9);
    pts.push(new THREE.Vector2(Math.max(rad, 0.02), y));
  }
  return new THREE.LatheGeometry(pts, 24);
}

export function Airframe({
  typeIcao,
  callsign,
  spin = true,
}: {
  typeIcao?: string;
  callsign: string;
  spin?: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const props = useRef<THREE.Group[]>([]);
  const spec = useMemo(() => specFor(typeIcao), [typeIcao]);
  const accent = useMemo(() => accentColor(callsign), [callsign]);

  const geo = useMemo(() => {
    const wingThickness = spec.radius * 0.16;
    return {
      fuselage: fuselageGeometry(spec),
      wing: wingGeometry(spec, wingThickness),
      fin: finGeometry(spec, wingThickness * 0.8),
      stab: wingGeometry(
        { ...spec, span: spec.stabSpan, rootChord: spec.finChord * 0.5, tipChord: spec.finChord * 0.24, sweep: spec.finChord * 0.3 },
        wingThickness * 0.7
      ),
      nacelle: nacelleGeometry(spec.radius * (spec.propeller ? 0.34 : 0.52), spec.radius * (spec.propeller ? 1.9 : 2.1)),
    };
  }, [spec]);

  useMemo(() => {
    // Dispose the previous generation's buffers when the spec changes.
    return () => Object.values(geo).forEach((g) => g.dispose());
  }, [geo]);

  useFrame((_, dt) => {
    if (spin && group.current) group.current.rotation.y += dt * 0.28;
    for (const prop of props.current) prop.rotation.z += dt * 18;
  });

  const paint = { color: "#eef1f4", metalness: 0.5, roughness: 0.34 } as const;
  const liveryPaint = { color: accent, metalness: 0.3, roughness: 0.42 } as const;
  const glass = { color: "#080d12", metalness: 0.95, roughness: 0.08 } as const;
  const metal = { color: "#c8ced6", metalness: 0.92, roughness: 0.22 } as const;

  const half = spec.span / 2;
  const wingY = spec.highWing ? spec.radius * 0.72 : -spec.radius * 0.42;
  const wingZ = spec.length * 0.04;
  const enginePositions =
    spec.engines === 4
      ? [-half * 0.62, -half * 0.36, half * 0.36, half * 0.62]
      : spec.engines === 2
        ? [-half * 0.4, half * 0.4]
        : [0];

  return (
    <group ref={group} rotation={[0, Math.PI * 0.12, 0]}>
      {/* Fuselage — lathe revolves around Y, so lay it down nose toward +Z */}
      <mesh geometry={geo.fuselage} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <meshStandardMaterial {...paint} />
      </mesh>

      {/* Window line and cheatline, one per side */}
      {spec.windows &&
        [-1, 1].map((side) => (
          <group key={`side-${side}`}>
            <mesh
              position={[side * spec.radius * 0.93, spec.radius * 0.22, spec.length * 0.06]}
              castShadow
            >
              <boxGeometry args={[0.02, spec.radius * 0.2, spec.length * 0.62]} />
              <meshStandardMaterial {...glass} />
            </mesh>
            <mesh position={[side * spec.radius * 0.95, -spec.radius * 0.1, spec.length * 0.02]}>
              <boxGeometry args={[0.02, spec.radius * 0.16, spec.length * 0.72]} />
              <meshStandardMaterial {...liveryPaint} />
            </mesh>
          </group>
        ))}

      {/* Flight deck glazing */}
      <mesh position={[0, spec.radius * 0.42, spec.length * 0.4]} castShadow>
        <boxGeometry args={[spec.radius * 0.9, spec.radius * 0.34, spec.radius * 0.7]} />
        <meshStandardMaterial {...glass} />
      </mesh>

      {/* Wings — mirrored halves so sweep runs the correct way on both sides */}
      {[-1, 1].map((side) => (
        <group
          key={`wing-${side}`}
          position={[0, wingY, wingZ]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[side, 1, 1]}
        >
          <group rotation={[0, 0, -spec.dihedral]}>
            <mesh geometry={geo.wing} castShadow receiveShadow>
              <meshStandardMaterial {...paint} />
            </mesh>
            {spec.winglets && (
              <mesh
                position={[half, -spec.sweep - spec.tipChord * 0.5, 0]}
                rotation={[0, 0, 0]}
                castShadow
              >
                <boxGeometry args={[0.04, spec.tipChord * 0.9, spec.radius * 1.5]} />
                <meshStandardMaterial {...liveryPaint} />
              </mesh>
            )}
          </group>
        </group>
      ))}

      {/* Engines on pylons */}
      {enginePositions.map((x, i) => {
        const underWing = spec.engines > 1;
        const y = underWing ? wingY - spec.radius * (spec.propeller ? 0.1 : 0.55) : wingY;
        const z = wingZ + (underWing ? spec.rootChord * 0.28 : spec.length * 0.42);
        return (
          <group key={`eng-${i}`} position={[x, y, z]}>
            {underWing && !spec.propeller && (
              <mesh position={[0, spec.radius * 0.32, -spec.radius * 0.15]} castShadow>
                <boxGeometry args={[0.06, spec.radius * 0.6, spec.radius * 0.9]} />
                <meshStandardMaterial {...paint} />
              </mesh>
            )}
            {/* Nacelles wear the airframe's paint, not the livery — a solid
                block of brand colour on the engines reads as a toy. */}
            <mesh geometry={geo.nacelle} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <meshStandardMaterial {...paint} />
            </mesh>
            {!spec.propeller && (
              <mesh position={[0, 0, spec.radius * 0.78]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[spec.radius * 0.52, spec.radius * 0.05, 8, 24]} />
                <meshStandardMaterial {...liveryPaint} />
              </mesh>
            )}
            {/* Fan face / spinner */}
            <mesh position={[0, 0, spec.radius * (spec.propeller ? 0.95 : 1.0)]}>
              <circleGeometry args={[spec.radius * (spec.propeller ? 0.3 : 0.46), 20]} />
              <meshStandardMaterial color="#12171c" metalness={0.9} roughness={0.3} />
            </mesh>
            {spec.propeller && (
              <group
                ref={(node) => {
                  if (node) props.current[i] = node;
                }}
                position={[0, 0, spec.radius * 1.05]}
              >
                {[0, 1, 2].map((b) => {
                  const bladeLen = spec.span * 0.17;
                  return (
                    /* Each blade radiates outward from the hub — a blade centred
                       on the hub would read as six blades, not three. */
                    <mesh
                      key={b}
                      rotation={[0, 0, (b * Math.PI * 2) / 3]}
                      position={[
                        Math.sin((b * Math.PI * 2) / 3) * -bladeLen * 0.5,
                        Math.cos((b * Math.PI * 2) / 3) * bladeLen * 0.5,
                        0,
                      ]}
                      castShadow
                    >
                      <boxGeometry args={[spec.span * 0.022, bladeLen, 0.018]} />
                      <meshStandardMaterial {...metal} />
                    </mesh>
                  );
                })}
              </group>
            )}
          </group>
        );
      })}

      {/* Vertical fin — the airline's identity surface */}
      <mesh
        geometry={geo.fin}
        position={[0, spec.radius * 0.62, -spec.length * 0.3]}
        rotation={[0, -Math.PI / 2, 0]}
        castShadow
      >
        <meshStandardMaterial {...liveryPaint} />
      </mesh>

      {/* Horizontal stabilisers */}
      {[-1, 1].map((side) => (
        <group
          key={`stab-${side}`}
          position={[0, spec.radius * 0.34, -spec.length * 0.42]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[side, 1, 1]}
        >
          <mesh geometry={geo.stab} castShadow>
            <meshStandardMaterial {...paint} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
