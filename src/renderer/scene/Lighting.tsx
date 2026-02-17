import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { AmbientLight, DirectionalLight, MeshStandardMaterial, PointLight } from 'three'
import { Color, MathUtils, Object3D } from 'three'

const DAY_DURATION_SECONDS = 6 * 60 * 60
const CELESTIAL_ORBIT_RADIUS_X = 24
const CELESTIAL_ORBIT_RADIUS_Y = 13
const CELESTIAL_ORBIT_CENTER_Y = 5
const CELESTIAL_ORBIT_CENTER_Z = -18
const DAY_SKY_COLOR = new Color('#87CEEB')
const NIGHT_SKY_COLOR = new Color('#0B1226')
const DAY_SKY_EMISSIVE = new Color('#BFDBFE')
const NIGHT_SKY_EMISSIVE = new Color('#1E3A8A')

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function resolveCelestialState(elapsedSeconds: number) {
  const phase = (elapsedSeconds % DAY_DURATION_SECONDS) / DAY_DURATION_SECONDS
  const sunAngle = phase * Math.PI * 2 - Math.PI / 2
  const moonAngle = sunAngle + Math.PI
  const sunPosition: [number, number, number] = [
    Math.cos(sunAngle) * CELESTIAL_ORBIT_RADIUS_X,
    Math.sin(sunAngle) * CELESTIAL_ORBIT_RADIUS_Y + CELESTIAL_ORBIT_CENTER_Y,
    CELESTIAL_ORBIT_CENTER_Z + Math.sin(sunAngle) * 1.4,
  ]
  const moonPosition: [number, number, number] = [
    Math.cos(moonAngle) * CELESTIAL_ORBIT_RADIUS_X,
    Math.sin(moonAngle) * CELESTIAL_ORBIT_RADIUS_Y + CELESTIAL_ORBIT_CENTER_Y,
    CELESTIAL_ORBIT_CENTER_Z + Math.sin(moonAngle) * 1.4,
  ]
  const daylight = clamp01((sunPosition[1] + 1.2) / (CELESTIAL_ORBIT_RADIUS_Y + 1.2))
  const moonlight = clamp01((moonPosition[1] + 1.2) / (CELESTIAL_ORBIT_RADIUS_Y + 1.2))

  return { daylight, moonlight, sunPosition, moonPosition }
}

export function Lighting() {
  const skyMaterialRef = useRef<MeshStandardMaterial>(null)
  const sunMaterialRef = useRef<MeshStandardMaterial>(null)
  const moonMaterialRef = useRef<MeshStandardMaterial>(null)
  const ambientLightRef = useRef<AmbientLight>(null)
  const sunLightRef = useRef<DirectionalLight>(null)
  const moonLightRef = useRef<DirectionalLight>(null)
  const indoorFillARef = useRef<PointLight>(null)
  const indoorFillBRef = useRef<PointLight>(null)
  const indoorFillCRef = useRef<PointLight>(null)
  const indoorFillDRef = useRef<PointLight>(null)
  const sunOrbRef = useRef<Object3D>(null)
  const moonOrbRef = useRef<Object3D>(null)

  useFrame(({ clock }) => {
    const { daylight, moonlight, sunPosition, moonPosition } = resolveCelestialState(clock.getElapsedTime())

    if (sunOrbRef.current) {
      sunOrbRef.current.position.set(sunPosition[0], sunPosition[1], sunPosition[2])
    }
    if (moonOrbRef.current) {
      moonOrbRef.current.position.set(moonPosition[0], moonPosition[1], moonPosition[2])
    }
    if (sunLightRef.current) {
      sunLightRef.current.position.set(sunPosition[0], sunPosition[1], sunPosition[2])
      sunLightRef.current.intensity = MathUtils.lerp(0.05, 1.15, daylight)
      sunLightRef.current.color.setRGB(
        MathUtils.lerp(0.55, 1, daylight),
        MathUtils.lerp(0.62, 0.98, daylight),
        MathUtils.lerp(0.74, 0.9, daylight)
      )
    }
    if (moonLightRef.current) {
      moonLightRef.current.position.set(moonPosition[0], moonPosition[1], moonPosition[2])
      moonLightRef.current.intensity = MathUtils.lerp(0.06, 0.42, moonlight)
    }
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = MathUtils.lerp(0.2, 0.58, daylight)
      ambientLightRef.current.color.setRGB(
        MathUtils.lerp(0.3, 1, daylight),
        MathUtils.lerp(0.35, 0.98, daylight),
        MathUtils.lerp(0.5, 0.92, daylight)
      )
    }
    if (skyMaterialRef.current) {
      skyMaterialRef.current.color.copy(NIGHT_SKY_COLOR).lerp(DAY_SKY_COLOR, daylight)
      skyMaterialRef.current.emissive.copy(NIGHT_SKY_EMISSIVE).lerp(DAY_SKY_EMISSIVE, daylight)
      skyMaterialRef.current.emissiveIntensity = MathUtils.lerp(0.18, 0.22, daylight)
    }
    if (sunMaterialRef.current) {
      sunMaterialRef.current.emissiveIntensity = MathUtils.lerp(0.22, 1.35, daylight)
    }
    if (moonMaterialRef.current) {
      moonMaterialRef.current.emissiveIntensity = MathUtils.lerp(0.06, 0.7, moonlight)
    }

    const indoorNightBoost = MathUtils.lerp(0.52, 0.18, daylight)
    if (indoorFillARef.current) indoorFillARef.current.intensity = indoorNightBoost
    if (indoorFillBRef.current) indoorFillBRef.current.intensity = MathUtils.lerp(0.46, 0.18, daylight)
    if (indoorFillCRef.current) indoorFillCRef.current.intensity = MathUtils.lerp(0.1, 0.36, moonlight)
    if (indoorFillDRef.current) indoorFillDRef.current.intensity = MathUtils.lerp(0.1, 0.32, moonlight)
  })

  return (
    <>
      <mesh>
        <sphereGeometry args={[85, 48, 24]} />
        <meshStandardMaterial
          ref={skyMaterialRef}
          color="#87CEEB"
          emissive="#BFDBFE"
          emissiveIntensity={0.2}
          side={1}
        />
      </mesh>
      <mesh ref={sunOrbRef} position={[0, 10, CELESTIAL_ORBIT_CENTER_Z]}>
        <sphereGeometry args={[0.95, 22, 18]} />
        <meshStandardMaterial
          ref={sunMaterialRef}
          color="#FDE68A"
          emissive="#FDBA74"
          emissiveIntensity={1}
        />
      </mesh>
      <mesh ref={moonOrbRef} position={[0, -8, CELESTIAL_ORBIT_CENTER_Z]}>
        <sphereGeometry args={[0.72, 20, 16]} />
        <meshStandardMaterial
          ref={moonMaterialRef}
          color="#E2E8F0"
          emissive="#93C5FD"
          emissiveIntensity={0.2}
        />
      </mesh>

      <ambientLight ref={ambientLightRef} intensity={0.52} />
      <directionalLight
        ref={sunLightRef}
        position={[5, 8, 5]}
        intensity={1.05}
        color="#EFF6FF"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={50}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />
      <directionalLight
        ref={moonLightRef}
        position={[-8, 10, -12]}
        intensity={0.2}
        color="#93C5FD"
      />

      {/* Interior fixtures get brighter at night */}
      <pointLight ref={indoorFillARef} position={[-4, 3, -4]} intensity={0.3} color="#FFE4B5" />
      <pointLight ref={indoorFillBRef} position={[4, 3, -9]} intensity={0.3} color="#FFE4B5" />
      <pointLight ref={indoorFillCRef} position={[-2, 4.5, -2]} intensity={0.2} color="#f0f0ff" distance={10} />
      <pointLight ref={indoorFillDRef} position={[2, 4.5, 2]} intensity={0.2} color="#f0f0ff" distance={10} />
    </>
  )
}
