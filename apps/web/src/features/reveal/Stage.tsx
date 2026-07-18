import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { AircraftModel } from "./AircraftModel";

/**
 * The inspection stage. Lighting comes from a procedural studio environment
 * built out of Lightformers rather than a downloaded HDRI — it renders in the
 * first frame, works offline, and costs nothing to ship. Physically based
 * paint plus a real contact shadow is what makes the aircraft read as an
 * object rather than a diagram.
 */
export function Stage({
  typeIcao,
  callsign,
  interactive = true,
}: {
  typeIcao?: string;
  callsign: string;
  interactive?: boolean;
}) {
  return (
    /* A three-quarter view from above: the planform fills a portrait frame far
       better than a side-on view, and the wings are what identify an aircraft. */
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [5, 4.4, 7], fov: 40 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
    >
      <color attach="background" args={["#080d0b"]} />

      <Suspense fallback={null}>
        {/*
         * Bounds fits the camera to the aircraft's actual extents. This matters
         * most in portrait, where the horizontal field of view is roughly half
         * the vertical — a fixed camera distance framed a widebody's engines
         * and nothing else.
         */}
        <Bounds fit clip observe margin={1.08}>
          <group position={[0, 0.35, 0]}>
            <AircraftModel typeIcao={typeIcao} callsign={callsign} />
          </group>
        </Bounds>

        <ContactShadows
          position={[0, -1.35, 0]}
          opacity={0.55}
          scale={16}
          blur={2.6}
          far={5}
          color="#000000"
        />

        {/* Procedural studio: key above, cool fill left, phosphor rim right. */}
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={5} position={[0, 6, 1]} scale={[12, 5, 1]} rotation={[Math.PI / 2, 0, 0]} color="#ffffff" />
          <Lightformer form="rect" intensity={2.2} position={[-6, 1, 2]} scale={[10, 6, 1]} rotation={[0, Math.PI / 2, 0]} color="#cfe6ff" />
          <Lightformer form="rect" intensity={2.6} position={[6, 0.5, -1]} scale={[10, 6, 1]} rotation={[0, -Math.PI / 2, 0]} color="#00e08a" />
          <Lightformer form="ring" intensity={1.4} position={[0, -4, 3]} scale={8} color="#0c8c59" />
        </Environment>
      </Suspense>

      {/* One shadow-casting light so the contact shadow has a direction. */}
      <directionalLight position={[4, 8, 3]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]}>
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 24]} />
      </directionalLight>

      {/* makeDefault lets Bounds drive the same controls it fits. */}
      <OrbitControls
        makeDefault
        enabled={interactive}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={Math.PI * 0.14}
        maxPolarAngle={Math.PI * 0.66}
      />
    </Canvas>
  );
}
