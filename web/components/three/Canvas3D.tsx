"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Edges, OrbitControls } from "@react-three/drei";
import { Component, ReactNode, Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { Part } from "../data/types";
import { geometryFor, paintHeatmap, roundedBox } from "./shapes";

export type Mode = "sketch" | "model" | "fit" | "train";
export type Gait = "walk" | "trot" | "rollover" | "play dead";

const CLAY = "#D9D6CF";
const SIGNAL = "#FF5A1F";

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() { return this.state.err ? this.props.fallback : this.props.children; }
}

function prepSTL(g: THREE.BufferGeometry) {
  const c = g.clone();
  c.rotateX(-Math.PI / 2);
  c.computeBoundingBox();
  const b = c.boundingBox!;
  c.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  c.computeVertexNormals();
  return c;
}

type PartProps = {
  part: Part; params: Record<string, number>; mode: Mode; hovered: string | null; failing: boolean;
  onHover: (id: string | null) => void; url?: string | null; position: [number, number, number];
};

function PartMesh({ geometry, part, mode, hovered, failing, onHover, position, scale = [1, 1, 1] }: Omit<PartProps, "params" | "url"> & { geometry: THREE.BufferGeometry; scale?: [number, number, number] }) {
  const geo = useMemo(() => {
    if (mode !== "fit") return geometry;
    const g = geometry.clone();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const size = new THREE.Vector3(); b.getSize(size);
    // contact = the highest point (hook tip / mating face), where the part meets its context
    const pos = g.attributes.position as THREE.BufferAttribute;
    const contact = new THREE.Vector3(); let best = -Infinity; const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const score = v.y - Math.abs(v.z) * 0.01 - v.x * 0.02; if (score > best) { best = score; contact.copy(v); } }
    contact.z = 0;
    paintHeatmap(g, contact, Math.max(size.x, size.y, size.z) * 0.6, failing);
    return g;
  }, [geometry, mode, failing]);
  const isHover = hovered === part.id;
  const dim = hovered && !isHover;
  const target = useRef(new THREE.Vector3(...position));
  const ref = useRef<THREE.Mesh>(null);
  target.current.set(...position);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.position.lerp(target.current, 1 - Math.exp(-dt * 10));
    const s = ref.current.scale;
    s.x += (scale[0] - s.x) * (1 - Math.exp(-dt * 14));
    s.y += (scale[1] - s.y) * (1 - Math.exp(-dt * 14));
    s.z += (scale[2] - s.z) * (1 - Math.exp(-dt * 14));
  });
  return (
    <mesh ref={ref} geometry={geo} castShadow receiveShadow position={position}
      onPointerOver={(e) => { e.stopPropagation(); onHover(part.id); }} onPointerOut={() => onHover(null)}>
      {mode === "sketch" ? (
        <meshBasicMaterial color="#9A9AA1" wireframe transparent opacity={0.25} />
      ) : (
        <meshStandardMaterial key={mode} color={mode === "fit" ? "#ffffff" : CLAY} vertexColors={mode === "fit"} roughness={0.82} metalness={0}
          transparent opacity={dim ? 0.4 : 1} />
      )}
      {isHover && mode !== "sketch" && <Edges threshold={20} color={SIGNAL} transparent opacity={0.6} />}
    </mesh>
  );
}

function STLPart(props: PartProps) {
  const raw = useLoader(STLLoader, props.url!);
  const geo = useMemo(() => prepSTL(raw), [raw]);
  const base = props.part.params;
  const scale = useMemo<[number, number, number]>(() => {
    const s: [number, number, number] = [1, 1, 1];
    if (!base) return s;
    for (const [k, v0] of Object.entries(base)) {
      const v = props.params[k]; if (!v || !v0) continue;
      const r = v / v0;
      if (/length/i.test(k)) s[0] = r; else if (/width/i.test(k)) s[2] = r; else if (/height|hook|thick|base/i.test(k)) s[1] = Math.max(s[1] === 1 ? r : s[1], r);
    }
    return s;
  }, [base, props.params]);
  return <PartMesh {...props} geometry={geo} scale={scale} />;
}

function ProcPart(props: PartProps) {
  const geo = useMemo(() => geometryFor(props.part, props.params), [props.part, props.params]);
  return <PartMesh {...props} geometry={geo} />;
}

/** Ghost of the context the part lives in: the surface it mounts to + the pin it catches. */
function Context({ x, dims }: { x: number; dims: [number, number, number] }) {
  const [w, d, h] = [dims[0], dims[1], dims[2]];
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, h * 0.7, -d / 2 - 2.5]}>
        <boxGeometry args={[w * 1.3, h * 1.25, 3]} />
        <meshBasicMaterial color="#9A9AA1" transparent opacity={0.05} depthWrite={false} />
        <Edges color="#9A9AA1" transparent opacity={0.22} />
      </mesh>
      <mesh position={[-w * 0.05, h * 0.9, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[Math.max(2, h * 0.2), Math.max(2, h * 0.2), d * 1.3, 32]} />
        <meshBasicMaterial color="#9A9AA1" transparent opacity={0.08} depthWrite={false} />
        <Edges color="#9A9AA1" transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

function Dog({ gait, paused, hovered, onHover, mode, explode, chassis }: { gait: Gait; paused: boolean; hovered: string | null; onHover: (id: string | null) => void; mode: Mode; explode: number; chassis?: Record<string, number> }) {
  const cs: [number, number, number] = [(chassis?.length_mm ?? 140) / 140, (chassis?.height_mm ?? 40) / 40, (chassis?.width_mm ?? 70) / 70];
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const legs = useRef<(THREE.Group | null)[]>([]);
  const knees = useRef<(THREE.Group | null)[]>([]);
  const time = useRef(0);
  const g = useMemo(() => {
    const o = {
      chassis: roundedBox(140, 34, 70, 10), head: roundedBox(50, 36, 44, 10), deck: roundedBox(126, 3, 62, 1.5),
      thigh: roundedBox(16, 56, 16, 5), shin: roundedBox(10, 60, 10, 3),
    };
    // legs hang from the hip pivot
    o.thigh.translate(0, -50, 0); o.shin.translate(0, -56, 0);
    return o;
  }, []);
  const hips: [number, number, number][] = [[52, 0, 40], [52, 0, -40], [-52, 0, 40], [-52, 0, -40]];
  const phases = gait === "trot" ? [0, Math.PI, Math.PI, 0] : [0, Math.PI, Math.PI * 1.5, Math.PI * 0.5];

  useFrame((_, dt) => {
    if (!paused && mode === "train") time.current += dt;
    const t = time.current;
    const speed = gait === "trot" ? 9 : 5.5;
    legs.current.forEach((l, i) => {
      if (!l) return;
      let a = 0, k = 0;
      if (mode === "train" && (gait === "walk" || gait === "trot")) { a = Math.sin(t * speed + phases[i]) * 0.42; k = Math.max(0, Math.sin(t * speed + phases[i] + 1.2)) * 0.7; }
      if (mode === "train" && gait === "play dead") { a = 0.25 + Math.sin(t * 2 + i) * 0.03; k = 0.9; }
      if (mode === "train" && gait === "rollover") { a = 0.5; k = 1.2; }
      l.rotation.z += (a - l.rotation.z) * Math.min(1, dt * 12);
      const kn = knees.current[i]; if (kn) kn.rotation.z += (-k - kn.rotation.z) * Math.min(1, dt * 12);
    });
    if (body.current && root.current) {
      let roll = 0, lift = 112, bob = 0;
      if (mode === "train" && (gait === "walk" || gait === "trot")) bob = Math.abs(Math.sin(t * speed)) * 3;
      if (mode === "train" && gait === "play dead") { roll = Math.PI; lift = 40; }
      if (mode === "train" && gait === "rollover") { roll = (t * 1.6) % (Math.PI * 2); lift = 70; }
      body.current.rotation.x += (roll - body.current.rotation.x) * Math.min(1, dt * (gait === "rollover" ? 30 : 4));
      body.current.position.y += (lift + bob - body.current.position.y) * Math.min(1, dt * 6);
      if (mode === "train" && (gait === "walk" || gait === "trot")) root.current.position.x = ((t * (gait === "trot" ? 60 : 32)) % 400) - 200;
      else root.current.position.x += (0 - root.current.position.x) * Math.min(1, dt * 3);
    }
  });
  const mat = (id: string) => (
    <>
      {mode === "sketch" ? <meshBasicMaterial color="#9A9AA1" wireframe transparent opacity={0.25} /> :
        <meshStandardMaterial color={id === "shin" ? "#B9BCC0" : id === "deck" ? "#CDB892" : CLAY} roughness={id === "shin" ? 0.45 : 0.82} metalness={id === "shin" ? 0.5 : 0} transparent opacity={hovered && hovered !== id ? 0.4 : 1} />}
      {hovered === id && <Edges threshold={20} color={SIGNAL} transparent opacity={0.6} />}
    </>
  );
  const hov = (id: string) => ({ onPointerOver: (e: any) => { e.stopPropagation(); onHover(id); }, onPointerOut: () => onHover(null) });
  const ex = explode;
  return (
    <group ref={root}>
      <group ref={body} position={[0, 112, 0]}>
        <mesh geometry={g.chassis} position={[0, -17, 0]} scale={cs} castShadow {...hov("chassis")}>{mat("chassis")}</mesh>
        <mesh geometry={g.deck} scale={[cs[0], 1, cs[2]]} position={[0, -17 + 34 * cs[1] + 1 + ex * 40, 0]} castShadow {...hov("deck")}>{mat("deck")}</mesh>
        <mesh geometry={g.head} position={[96 * cs[0] + ex * 40, 4, 0]} castShadow {...hov("head")}>{mat("head")}</mesh>
        {hips.map((h, i) => (
          <group key={i} position={[h[0] * cs[0] * (1 + ex * 0.4), -10 - ex * 10, h[2] * cs[2] * (1 + ex * 0.8)]} ref={(el) => { legs.current[i] = el; }}>
            <mesh geometry={g.thigh} castShadow {...hov("thigh")}>{mat("thigh")}</mesh>
            <group position={[0, -50 - ex * 20, 0]} ref={(el) => { knees.current[i] = el; }}>
              <mesh geometry={g.shin} castShadow {...hov("shin")}>{mat("shin")}</mesh>
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}

function SketchBox() {
  const ref = useRef<THREE.LineSegments>(null);
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(30, 14, 20)), []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const m = ref.current.material as THREE.LineDashedMaterial;
    m.opacity = 0.18 + Math.sin(clock.elapsedTime * 2) * 0.08;
    ref.current.rotation.y = clock.elapsedTime * 0.25;
  });
  return (
    <lineSegments ref={ref} geometry={geo} position={[0, 7, 0]}>
      <lineBasicMaterial color="#9A9AA1" transparent opacity={0.2} />
    </lineSegments>
  );
}

function Rig({ size, mode, locked }: { size: number; mode: Mode; locked: boolean }) {
  const { camera } = useThree();
  const goal = useRef(new THREE.Vector3());
  const t0 = useRef(0);
  useEffect(() => {
    const d = size * (mode === "train" ? 2.3 : 1.9);
    const presets: Record<Mode, [number, number, number]> = {
      sketch: [d * 0.8, d * 0.55, d * 0.9], model: [d * 0.75, d * 0.5, d * 0.95], fit: [d * 0.2, d * 0.45, d * 1.15], train: [d * 0.35, d * 0.35, d * 1.1],
    };
    goal.current.set(...presets[mode]);
    t0.current = 0;
  }, [size, mode]);
  useFrame((_, dt) => {
    if (locked || t0.current > 0.9) return;
    t0.current += dt / 0.6;
    camera.position.lerp(goal.current, 1 - Math.exp(-dt * 6));
    camera.lookAt(0, size * 0.18, 0);
  });
  return null;
}

export type Canvas3DProps = {
  parts: Part[]; kind?: string; mode: Mode; params: Record<string, Record<string, number>>; explode: boolean;
  hovered: string | null; onHover: (id: string | null) => void; failing?: boolean; urlFor?: (p: Part) => string | null;
  gait?: Gait; paused?: boolean; locked: boolean; hideRobot?: boolean; onUserOrbit: () => void; showContext?: boolean;
};

export default function Canvas3D(p: Canvas3DProps) {
  const robot = p.kind === "robot";
  const sizes = p.parts.map((x) => Math.max(...x.dims_mm));
  const gap = 12;
  const total = robot ? 300 : sizes.reduce((a, b) => a + b, 0) + gap * Math.max(0, sizes.length - 1) || 40;
  const size = robot ? 300 : Math.max(40, total);
  let cursor = -total / 2;
  const ex = p.explode ? 1 : 0;
  const placed = p.parts.map((part, i) => {
    const w = sizes[i];
    const x = cursor + w / 2;
    cursor += w + gap;
    return { part, pos: [x * (1 + ex * 0.6), 0, 0] as [number, number, number] };
  });
  const showCtx = !robot && p.showContext && placed.length > 0;
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [size * 1.4, size * 1.0, size * 1.6], fov: 32, near: 0.5, far: size * 40 }} gl={{ antialias: true }}>
      <color attach="background" args={["#0B0B0C"]} />
      <fog attach="fog" args={["#0B0B0C", size * 3, size * 7]} />
      <hemisphereLight args={["#ffffff", "#2a2622", 0.55]} />
      <directionalLight position={[size, size * 2, size * 0.8]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-size} shadow-camera-right={size} shadow-camera-top={size} shadow-camera-bottom={-size} />
      <directionalLight position={[-size, size * 0.6, -size]} intensity={0.35} color="#ffd9c4" />
      <gridHelper args={[size * 6, 36, "#ffffff", "#ffffff"]} position={[0, -0.01, 0]}>
        <meshBasicMaterial attach="material" color="#ffffff" transparent opacity={0.06} />
      </gridHelper>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[size * 8, size * 8]} />
        <shadowMaterial transparent opacity={0.35} />
      </mesh>
      {p.mode === "sketch" && !p.parts.length && <SketchBox />}
      {robot && p.parts.length > 0 && !p.hideRobot && (
        <Dog gait={p.gait ?? "walk"} paused={!!p.paused} hovered={p.hovered} onHover={p.onHover} mode={p.mode} explode={ex} chassis={p.params["chassis"]} />
      )}
      {!robot && placed.map(({ part, pos }) => {
        const url = p.urlFor?.(part) ?? null;
        const common = { part, params: p.params[part.id] || part.params || {}, mode: p.mode, hovered: p.hovered, failing: !!p.failing, onHover: p.onHover, position: pos };
        const proc = <ProcPart {...common} />;
        return (
          <Boundary key={part.id + (url || "")} fallback={proc}>
            {url ? <Suspense fallback={proc}><STLPart {...common} url={url} /></Suspense> : proc}
          </Boundary>
        );
      })}
      {showCtx && p.mode === "fit" && <Context x={placed[0].pos[0]} dims={placed[0].part.dims_mm} />}
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={size * 0.4} maxDistance={size * 6} maxPolarAngle={Math.PI * 0.49}
        target={[0, size * 0.18, 0]} onStart={p.onUserOrbit} />
      <Rig size={size} mode={p.mode} locked={p.locked} />
    </Canvas>
  );
}
