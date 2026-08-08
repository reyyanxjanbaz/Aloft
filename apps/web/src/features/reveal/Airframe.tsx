import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { accentColor } from "./liveries";
import { specFor, type AircraftSpec, type Winglet } from "./airframeSpec";

/**
 * A parametric aircraft lofted from real aerofoil sections rather than stacked
 * boxes: the fuselage is a revolved profile with a family-specific nose, the
 * lifting surfaces are NACA sections swept, tapered and — for blended/sharklet
 * tips — curled upward as one continuous skin, and engines are placed by the
 * type's configuration. Every shape decision comes from the AircraftSpec, so an
 * A320, a 747 and a Challenger read as different aircraft from the same code.
 *
 * The finished model is measured, recentred on the origin and scaled to a
 * constant size (see the layout effect), so it spins and orbits about its own
 * centre — the camera never drifts off it.
 */

/**
 * Every model is normalised to this max extent. Exported because Stage frames
 * the camera from it — the fit is only guaranteed while the two agree.
 */
export const TARGET_SIZE = 4;

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = THREE.MathUtils.lerp;

/** Closed NACA-style aerofoil loop, chord 0→1, thickness scaled by t/c. */
function aerofoilLoop(tc: number): [number, number][] {
  const n = 16;
  const half = (x: number) =>
    5 * tc * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
  const upper: [number, number][] = [];
  const lower: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    upper.push([x, half(x)]);
    lower.push([x, -half(x)]);
  }
  // LE → TE along the top, TE → LE along the bottom (drop shared endpoints).
  return upper.concat(lower.reverse().slice(1, -1));
}

interface WingParams {
  rootChord: number;
  tipChord: number;
  span: number;
  sweep: number; // aft shift of the tip, scene units
  dihedralDeg: number;
  thickness: number; // t/c
  winglet: Winglet;
}

/**
 * Loft a lifting surface. Built with span along +X, chord along −Z (aft) and
 * thickness along Y (up); dihedral raises the tip, and a winglet curls the
 * outboard sections upward by rolling each aerofoil section about the chord.
 */
function buildWing(p: WingParams): THREE.BufferGeometry {
  const af = aerofoilLoop(p.thickness);
  const L = af.length;
  const N = 30;
  const wStart = p.winglet === "sharklet" ? 0.85 : p.winglet === "blended" ? 0.84 : p.winglet === "fence" ? 0.9 : 1.01;
  const rollMax = ((p.winglet === "sharklet" ? 84 : p.winglet === "blended" ? 66 : p.winglet === "fence" ? 52 : 0) * Math.PI) / 180;
  const rake = p.winglet === "raked" ? 0.16 : 0;
  const dih = (p.dihedralDeg * Math.PI) / 180;
  const step = p.span / N;

  const stations: { x: number; y: number; z: number; roll: number; chord: number }[] = [];
  let x = 0;
  let y = 0;
  let z = 0;
  let phi = dih;
  for (let k = 0; k <= N; k++) {
    const u = k / N;
    let chord = lerp(p.rootChord, p.tipChord, smooth(u));
    if (u > 0.9) chord *= lerp(1, 0.5, (u - 0.9) / 0.1); // draw the tip to a point
    stations.push({ x, y, z, roll: phi, chord });
    let next = dih;
    if (u >= wStart) {
      const w = (u - wStart) / (1 - wStart);
      next = dih + (rollMax - dih) * smooth(w);
    }
    phi = next;
    x += Math.cos(phi) * step * (1 + rake);
    y += Math.sin(phi) * step;
    z -= (p.sweep / N) * (u >= wStart ? 1.6 : 1);
  }

  const pos: number[] = [];
  for (const st of stations) {
    const cs = Math.cos(st.roll);
    const sn = Math.sin(st.roll);
    for (const [cx, ty] of af) {
      const ly = ty * st.chord; // thickness
      const lz = -cx * st.chord; // chord, aft
      pos.push(st.x - ly * sn, st.y + ly * cs, st.z + lz);
    }
  }

  const idx: number[] = [];
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < L; i++) {
      const a = k * L + i;
      const b = k * L + ((i + 1) % L);
      const c = (k + 1) * L + i;
      const d = (k + 1) * L + ((i + 1) % L);
      idx.push(a, c, b, b, c, d);
    }
  }
  // Cap the root and tip with a fan to a ring centroid.
  const capRing = (k: number, flip: boolean) => {
    const base = k * L;
    let cxp = 0;
    let cyp = 0;
    let czp = 0;
    for (let i = 0; i < L; i++) {
      cxp += pos[(base + i) * 3] ?? 0;
      cyp += pos[(base + i) * 3 + 1] ?? 0;
      czp += pos[(base + i) * 3 + 2] ?? 0;
    }
    const center = pos.length / 3;
    pos.push(cxp / L, cyp / L, czp / L);
    for (let i = 0; i < L; i++) {
      const a = base + i;
      const b = base + ((i + 1) % L);
      if (flip) idx.push(center, b, a);
      else idx.push(center, a, b);
    }
  };
  capRing(0, true);
  capRing(N, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const NOSE_START: Record<AircraftSpec["noseShape"], number> = {
  pointed: 0.68,
  rounded: 0.8,
  blunt: 0.87,
  drooped: 0.74,
};

function noseRadiusFactor(u: number, shape: AircraftSpec["noseShape"]): number {
  const c = THREE.MathUtils.clamp;
  switch (shape) {
    case "pointed":
      return c(Math.pow(Math.max(0, 1 - u), 0.6), 0, 1);
    case "blunt":
      return c(Math.sqrt(Math.max(0, 1 - u * u * 0.55)), 0, 1);
    case "drooped":
      return c(Math.pow(Math.max(0, 1 - u * u * 0.95), 1.15), 0, 1);
    default:
      return c(Math.sqrt(Math.max(0, 1 - u * u * 0.92)), 0, 1);
  }
}

/** Revolved fuselage: tail cone, parallel mid-section, family nose. */
function fuselageGeometry(spec: AircraftSpec): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const seg = 64;
  const noseStart = NOSE_START[spec.noseShape];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg; // 0 = tail, 1 = nose
    const y = (t - 0.5) * spec.length;
    let r: number;
    if (t < 0.14) r = spec.radius * Math.pow(t / 0.14, 0.62);
    else if (t > noseStart) r = spec.radius * noseRadiusFactor((t - noseStart) / (1 - noseStart), spec.noseShape);
    else r = spec.radius;
    pts.push(new THREE.Vector2(Math.max(r, 0.01), y));
  }
  return new THREE.LatheGeometry(pts, 56);
}

/** Nacelle cowling: revolved, with a flared inlet lip. */
function nacelleGeometry(r: number, len: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const seg = 22;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const y = (t - 0.5) * len;
    let rad = r;
    if (t < 0.12) rad = r * (0.82 + t * 1.4);
    else if (t > 0.7) rad = r * (1 - (t - 0.7) * 0.85);
    pts.push(new THREE.Vector2(Math.max(rad, 0.02), y));
  }
  return new THREE.LatheGeometry(pts, 28);
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
  const outer = useRef<THREE.Group>(null); // spins
  const norm = useRef<THREE.Group>(null); // centred + normalised
  const raw = useRef<THREE.Group>(null); // authored geometry
  const props = useRef<THREE.Group[]>([]);
  const spec = useMemo(() => specFor(typeIcao), [typeIcao]);
  const accent = useMemo(() => accentColor(callsign), [callsign]);
  const isProp = spec.engineType !== "turbofan";

  const geo = useMemo(() => {
    const tc = 0.13;
    const wing = buildWing({
      rootChord: spec.rootChord,
      tipChord: spec.tipChord,
      span: spec.span / 2,
      sweep: spec.sweep,
      dihedralDeg: spec.wingMount === "high" ? -2 : 5,
      thickness: tc,
      winglet: spec.winglet,
    });
    const stab = buildWing({
      rootChord: spec.finChord * 0.6,
      tipChord: spec.finChord * 0.26,
      span: spec.stabSpan / 2,
      sweep: spec.finChord * 0.4,
      dihedralDeg: 4,
      thickness: 0.1,
      winglet: "none",
    });
    const fin = buildWing({
      rootChord: spec.finChord,
      tipChord: spec.finChord * 0.5,
      span: spec.finHeight,
      sweep: spec.finSweep,
      dihedralDeg: 0,
      thickness: 0.12,
      winglet: "none",
    });
    return {
      fuselage: fuselageGeometry(spec),
      wing,
      stab,
      fin,
      nacelle: nacelleGeometry(spec.radius * (isProp ? 0.34 : 0.5), spec.radius * (isProp ? 1.9 : 2.2)),
    };
  }, [spec, isProp]);

  useEffect(() => {
    return () => Object.values(geo).forEach((g) => g.dispose());
  }, [geo]);

  // Recentre + normalise: measure the assembled model in its own local frame,
  // then set the wrapper so the centroid sits on the origin (the spin axis) and
  // the largest extent is a constant size. This is what keeps every aircraft
  // framed and pivoting about its true centre.
  useLayoutEffect(() => {
    const g = raw.current;
    const nm = norm.current;
    if (!g || !nm) return;
    g.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    const m = new THREE.Matrix4();
    g.traverse((o) => {
      const me = o as THREE.Mesh;
      if (me.isMesh && me.geometry) {
        if (!me.geometry.boundingBox) me.geometry.computeBoundingBox();
        tmp.copy(me.geometry.boundingBox as THREE.Box3);
        m.multiplyMatrices(inv, me.matrixWorld);
        tmp.applyMatrix4(m);
        box.union(tmp);
      }
    });
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const s = TARGET_SIZE / (Math.max(size.x, size.y, size.z) || 1);
    nm.scale.setScalar(s);
    nm.position.set(-c.x * s, -c.y * s, -c.z * s);
  }, [geo]);

  useFrame((_, dt) => {
    if (spin && outer.current) outer.current.rotation.y += dt * 0.26;
    for (const prop of props.current) prop.rotation.z += dt * 20;
  });

  const paint = {
    color: "#eef2f6", metalness: 0.5, roughness: 0.28,
    clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 1.0,
  } as const;
  const liveryPaint = { color: accent, metalness: 0.4, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.3 } as const;
  const glass = { color: "#0a0f16", metalness: 0.9, roughness: 0.08, emissive: "#0b1622", emissiveIntensity: 0.55 } as const;
  const metal = { color: "#c8ced6", metalness: 0.95, roughness: 0.2 } as const;
  const darkMetal = { color: "#14181d", metalness: 0.9, roughness: 0.32 } as const;
  const OFFSET = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } as const;

  const half = spec.span / 2;
  const wingMountY = spec.wingMount === "high" ? spec.radius * 0.78 : spec.wingMount === "mid" ? spec.radius * 0.05 : -spec.radius * 0.5;
  const wingY = wingMountY;
  const wingZ = spec.length * 0.03;
  const dihRad = ((spec.wingMount === "high" ? -2 : 5) * Math.PI) / 180;
  // Where the wing skin sits at a given spanwise station — engines hang from it.
  const wingSurfaceY = (x: number) => wingY + Math.sin(dihRad) * Math.abs(x);
  const wingLeZ = (x: number) => wingZ - (spec.sweep / half) * Math.abs(x);
  const fuselageScaleY = spec.upperDeck === "full" ? 1.2 : 1;

  const finBaseY = spec.radius * 0.55;
  const finZ = -spec.length * 0.34;
  const stabPos =
    spec.tail === "ttail"
      ? { y: finBaseY + spec.finHeight * 0.95, z: finZ - spec.finSweep }
      : spec.tail === "cruciform"
        ? { y: finBaseY + spec.finHeight * 0.5, z: finZ - spec.finSweep * 0.5 }
        : { y: spec.radius * 0.3, z: -spec.length * 0.44 };

  /** Three-blade prop disc + spinner, spun via props ref. Faces +Z. */
  const propDisc = (i: number, r: number, z: number) => (
    <group ref={(n) => { if (n) props.current[i] = n; }} position={[0, 0, z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, r * 0.35]}>
        <coneGeometry args={[r * 0.55, r * 0.9, 16]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      {[0, 1, 2].map((b) => {
        const a = (b * Math.PI * 2) / 3;
        const len = r * 3.2;
        return (
          <mesh key={b} rotation={[0, 0, a]} position={[Math.sin(a) * -len * 0.5, Math.cos(a) * len * 0.5, 0]}>
            <boxGeometry args={[r * 0.36, len, 0.02]} />
            <meshStandardMaterial {...darkMetal} />
          </mesh>
        );
      })}
    </group>
  );

  /** A turbofan or turboprop nacelle, nose toward +Z. */
  const nacelle = (i: number, at: [number, number, number]) => (
    <group key={`eng-${i}`} position={at}>
      <mesh geometry={geo.nacelle} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial {...paint} />
      </mesh>
      {isProp ? (
        propDisc(i, spec.radius * 0.34, spec.radius * 1.05)
      ) : (
        <>
          {/* chrome inlet lip */}
          <mesh position={[0, 0, spec.radius * 0.92]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[spec.radius * 0.5, spec.radius * 0.06, 12, 28]} />
            <meshStandardMaterial {...metal} />
          </mesh>
          {/* recessed dark fan */}
          <mesh position={[0, 0, spec.radius * 0.86]}>
            <circleGeometry args={[spec.radius * 0.46, 24]} />
            <meshStandardMaterial {...darkMetal} {...OFFSET} />
          </mesh>
          <mesh position={[0, 0, spec.radius * 0.9]}>
            <coneGeometry args={[spec.radius * 0.12, spec.radius * 0.22, 16]} />
            <meshStandardMaterial {...metal} />
          </mesh>
          {/* exhaust cone */}
          <mesh position={[0, 0, -spec.radius * 1.05]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[spec.radius * 0.34, spec.radius * 0.5, 20]} />
            <meshStandardMaterial {...darkMetal} />
          </mesh>
        </>
      )}
    </group>
  );

  const underwingX = spec.engines >= 4 ? [-half * 0.6, -half * 0.34, half * 0.34, half * 0.6] : [-half * 0.38, half * 0.38];

  return (
    <group ref={outer} rotation={[0, Math.PI * 0.14, 0]}>
      <group ref={norm}>
        <group ref={raw}>
          {/* Fuselage */}
          <mesh geometry={geo.fuselage} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, fuselageScaleY]} castShadow receiveShadow>
            <meshPhysicalMaterial {...paint} />
          </mesh>

          {/* 747 forward hump */}
          {spec.upperDeck === "hump" && (
            <mesh position={[0, spec.radius * 0.72, spec.length * 0.2]} scale={[spec.radius * 0.8, spec.radius * 0.62, spec.length * 0.17]} castShadow>
              <sphereGeometry args={[1, 24, 18]} />
              <meshPhysicalMaterial {...paint} />
            </mesh>
          )}

          {/* Window band + cheatline (offset out of the skin to avoid z-fighting) */}
          {spec.windows &&
            [-1, 1].map((side) => (
              <group key={`side-${side}`}>
                <mesh position={[side * spec.radius * 0.95, spec.radius * 0.26, spec.length * 0.05]}>
                  <boxGeometry args={[0.02, spec.radius * 0.16, spec.length * 0.6]} />
                  <meshStandardMaterial {...glass} {...OFFSET} />
                </mesh>
                {spec.upperDeck === "full" && (
                  <mesh position={[side * spec.radius * 0.95, spec.radius * 0.56, spec.length * 0.05]}>
                    <boxGeometry args={[0.02, spec.radius * 0.15, spec.length * 0.48]} />
                    <meshStandardMaterial {...glass} {...OFFSET} />
                  </mesh>
                )}
                <mesh position={[side * spec.radius * 0.96, -spec.radius * 0.02, spec.length * 0.02]}>
                  <boxGeometry args={[0.02, spec.radius * 0.14, spec.length * 0.7]} />
                  <meshStandardMaterial {...liveryPaint} polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} />
                </mesh>
              </group>
            ))}

          {/* Flight-deck glazing */}
          {spec.windows && (
            <mesh position={[0, spec.radius * 0.4, spec.length * (spec.noseShape === "pointed" ? 0.42 : 0.38)]}>
              <boxGeometry args={[spec.radius * 0.86, spec.radius * 0.3, spec.radius * 0.75]} />
              <meshStandardMaterial {...glass} {...OFFSET} />
            </mesh>
          )}

          {/* Wings (span already runs along +X; mirror for the other side) */}
          {[1, -1].map((side) => (
            <mesh key={`wing-${side}`} geometry={geo.wing} position={[0, wingY, wingZ]} scale={[side, 1, 1]} castShadow receiveShadow>
              <meshPhysicalMaterial {...paint} side={THREE.DoubleSide} />
            </mesh>
          ))}

          {/* Underwing engines — hung from a pylon at the real wing surface */}
          {spec.engineMount === "underwing" &&
            underwingX.map((x, i) => {
              const sy = wingSurfaceY(x);
              const leZ = wingLeZ(x);
              if (isProp) {
                return <group key={`eng-${i}`}>{nacelle(i, [x, sy - spec.radius * 0.05, leZ + spec.radius * 0.25])}</group>;
              }
              const engY = sy - spec.radius * 1.05;
              const engZ = leZ + spec.radius * 0.85;
              return (
                <group key={`eng-${i}`}>
                  <mesh position={[x, (sy + engY) / 2, (leZ + engZ) / 2 - spec.radius * 0.15]} castShadow>
                    <boxGeometry args={[spec.radius * 0.13, sy - engY, spec.radius * 0.7]} />
                    <meshPhysicalMaterial {...paint} />
                  </mesh>
                  {nacelle(i, [x, engY, engZ])}
                </group>
              );
            })}
          {spec.engineMount === "underwing" && spec.engines === 3 &&
            nacelle(2, [0, finBaseY + spec.radius * 0.25, -spec.length * 0.36])}
          {/* Aft-fuselage engines on short horizontal pylons */}
          {spec.engineMount === "aft" &&
            [-1, 1].map((s, i) => (
              <group key={`eng-${i}`}>
                <mesh position={[s * spec.radius * 0.95, spec.radius * 0.5, -spec.length * 0.24]} castShadow>
                  <boxGeometry args={[spec.radius * 0.9, spec.radius * 0.26, spec.radius * 0.5]} />
                  <meshPhysicalMaterial {...paint} />
                </mesh>
                {nacelle(i, [s * spec.radius * 1.32, spec.radius * 0.55, -spec.length * 0.24])}
              </group>
            ))}
          {spec.engineMount === "nose" && (
            <group position={[0, 0, spec.length * 0.48]}>
              <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                <cylinderGeometry args={[spec.radius * 0.68, spec.radius * 0.92, spec.radius * 0.55, 24]} />
                <meshPhysicalMaterial {...paint} />
              </mesh>
              {propDisc(0, spec.radius * 0.42, spec.radius * 0.4)}
            </group>
          )}
          {spec.engineMount === "buried" && (
            <mesh position={[0, 0, -spec.length * 0.5]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[spec.radius * 0.5, spec.radius * 0.62, spec.radius * 0.8, 20]} />
              <meshStandardMaterial {...darkMetal} />
            </mesh>
          )}

          {/* Vertical fin — span(X) rotated up to +Y, chord stays aft */}
          <mesh geometry={geo.fin} position={[0, finBaseY, finZ]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <meshPhysicalMaterial {...liveryPaint} side={THREE.DoubleSide} />
          </mesh>

          {/* Horizontal stabilisers */}
          {[1, -1].map((side) => (
            <mesh key={`stab-${side}`} geometry={geo.stab} position={[0, stabPos.y, stabPos.z]} scale={[side, 1, 1]} castShadow>
              <meshPhysicalMaterial {...paint} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}
