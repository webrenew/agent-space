import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'

interface OfficePlantProps {
  position: [number, number, number]
  index: number
}

const PLANT_SPACING = 0.35

export function OfficePlant({ position, index }: OfficePlantProps) {
  const groupRef = useRef<Group>(null)

  // Offset plants along the desk edge
  const offsetX = (index - 2) * PLANT_SPACING

  useFrame((state) => {
    if (!groupRef.current) return
    const t = state.clock.elapsedTime
    // Gentle sway — each plant has a unique phase from index
    groupRef.current.rotation.z = Math.sin(t * 0.8 + index * 1.5) * 0.04
    groupRef.current.rotation.x = Math.sin(t * 0.6 + index * 2.1) * 0.03
  })

  return (
    <group
      ref={groupRef}
      position={[position[0] + offsetX, position[1], position[2] + 0.5]}
    >
      {/* Pot */}
      <mesh position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.05, 0.08, 8]} />
        <meshStandardMaterial color="#8B4513" />
      </mesh>

      {/* Soil */}
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.055, 0.055, 0.01, 8]} />
        <meshStandardMaterial color="#3d2b1f" />
      </mesh>

      {/* Main stem */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <cylinderGeometry args={[0.008, 0.01, 0.12, 4]} />
        <meshStandardMaterial color="#2d5a27" />
      </mesh>

      {/* Leaves */}
      <mesh position={[-0.04, 0.14, 0]} rotation={[0, 0, 0.5]} castShadow>
        <boxGeometry args={[0.07, 0.02, 0.03]} />
        <meshStandardMaterial color="#4ade80" />
      </mesh>
      <mesh position={[0.04, 0.12, 0.01]} rotation={[0, 0, -0.4]} castShadow>
        <boxGeometry args={[0.06, 0.02, 0.03]} />
        <meshStandardMaterial color="#22c55e" />
      </mesh>
      <mesh position={[0.01, 0.16, -0.03]} rotation={[0.3, 0, 0.2]} castShadow>
        <boxGeometry args={[0.05, 0.02, 0.03]} />
        <meshStandardMaterial color="#34d399" />
      </mesh>
      <mesh position={[-0.02, 0.11, 0.03]} rotation={[-0.2, 0, -0.3]} castShadow>
        <boxGeometry args={[0.05, 0.02, 0.025]} />
        <meshStandardMaterial color="#4ade80" />
      </mesh>
    </group>
  )
}
