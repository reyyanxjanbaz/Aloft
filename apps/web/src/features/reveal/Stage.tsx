import { Suspense, useEffect, useLayoutEffect, type MutableRefObject } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { AircraftModel } from "./AircraftModel";
import { TARGET_SIZE } from "./Airframe";

/**
 * The radius the aircraft sweeps through as it turns.
 *
 * Airframe normalises every model so its largest extent is TARGET_SIZE, and an
 * aeroplane is a cross: the wingtips and the nose/tail each sit about half that
 * from the centre. The margin is not decoration — the fin tip is offset in two
 * axes at once (aft *and* up), so it reaches further from the centre than any
 * single half-extent, and without the allowance a rotating aircraft would clip
 * its own tail on the frame edge.
 */
const MODEL_RADIUS = (TARGET_SIZE / 2) * 1.12;

/**
 * Pulls the camera back until the aircraft fits the frame it is actually in.
 *
 * The camera was a fixed position tuned on a wide viewport, and `fov` is the
 * *vertical* field of view — so on a portrait phone (390×844, aspect 0.46) the
 * horizontal half-angle collapsed to a quarter of the model's radius and the
 * wings were simply cut off the sides of the screen. Every hangar reveal on a
 * phone showed a cropped aeroplane.
 *
 * Solved on the narrower axis, so the fit holds in portrait and landscape
 * alike, and re-run whenever the canvas is resized. Only the distance is
 * touched: the viewing direction stays exactly as authored, and after the
 * first fit the player's own zoom is left alone.
 */
function FitCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const { width, height } = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as { update?: () => void } | null;

  useLayoutEffect(() => {
    if (!width || !height) return;
    const aspect = width / height;
    const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const distance = MODEL_RADIUS / Math.sin(Math.min(vHalf, hHalf));

    camera.position.setLength(distance);
    // The far plane has to clear the new distance or the aircraft is culled
    // the moment the frame gets narrow enough to need a real pull-back.
    camera.far = Math.max(camera.far, distance * 4);
    camera.updateProjectionMatrix();
    controls?.update?.();
  }, [camera, controls, width, height]);

  return null;
}

/**
 * The inspection stage. Lighting comes from a procedural studio environment
 * built out of Lightformers rather than a downloaded HDRI — it renders in the
 * first frame, works offline, and costs nothing to ship. Physically based
 * paint plus a real contact shadow is what makes the aircraft read as an
 * object rather than a diagram.
 */
/**
 * Hands the parent a function that grabs the current frame.
 *
 * The canvas is created without preserveDrawingBuffer, so its buffer is
 * cleared after compositing — reading it later gives a blank image. Drawing
 * and reading inside the same task is what makes this work without paying
 * the memory cost of that flag for every frame.
 */
function SnapshotBridge({ snapshotRef }: { snapshotRef: SnapshotRef }) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    snapshotRef.current = () => {
      try {
        gl.render(scene, camera);
        return gl.domElement.toDataURL("image/png");
      } catch {
        return null; // context lost, or a tainted canvas
      }
    };
    return () => {
      snapshotRef.current = null;
    };
  }, [gl, scene, camera, snapshotRef]);

  return null;
}

export type SnapshotRef = MutableRefObject<(() => string | null) | null>;

export function Stage({
  typeIcao,
  callsign,
  interactive = true,
  snapshotRef,
}: {
  typeIcao?: string;
  callsign: string;
  interactive?: boolean;
  snapshotRef?: SnapshotRef;
}) {
  return (
    /* A three-quarter view from above: the planform fills a portrait frame far
       better than a side-on view, and the wings are what identify an aircraft. */
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [3.1, 3.5, 5.4], fov: 42 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
    >
      <color attach="background" args={["#080d0b"]} />
      <FitCamera />
      {snapshotRef && <SnapshotBridge snapshotRef={snapshotRef} />}

      <Suspense fallback={null}>
        {/*
         * The model self-centres and normalises to a constant size (see
         * Airframe's layout effect), so it always sits on the origin. That lets
         * us use a fixed camera and orbit about [0,0,0] — the aircraft can never
         * drift off-centre as it spins or when the user drags it around, which a
         * bounding-box auto-fit could not guarantee for a rotating asymmetric
         * shape.
         */}
        <AircraftModel typeIcao={typeIcao} callsign={callsign} />

        <ContactShadows
          position={[0, -1.7, 0]}
          opacity={0.5}
          scale={14}
          blur={2.8}
          far={5}
          color="#000000"
        />

        {/* Procedural studio: key above, cool fill left, phosphor rim right. */}
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={5} position={[0, 6, 1]} scale={[12, 5, 1]} rotation={[Math.PI / 2, 0, 0]} color="#ffffff" />
          <Lightformer form="rect" intensity={2.2} position={[-6, 1, 2]} scale={[10, 6, 1]} rotation={[0, Math.PI / 2, 0]} color="#cfe6ff" />
          <Lightformer form="rect" intensity={1.8} position={[6, 0.5, -1]} scale={[10, 6, 1]} rotation={[0, -Math.PI / 2, 0]} color="#4be0a0" />
          <Lightformer form="ring" intensity={0.9} position={[0, -4, 3]} scale={8} color="#0c8c59" />
        </Environment>
      </Suspense>

      {/* One shadow-casting light so the contact shadow has a direction. */}
      <directionalLight position={[4, 8, 3]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]}>
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 24]} />
      </directionalLight>

      {/* Orbit about the origin — where the normalised model is centred. */}
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
