import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'

export function OfficeCat() {
  const groupRef = useRef<Group>(null)
  const tailRef = useRef<Group>(null)

  useFrame((state) => {
    if (!groupRef.current) return
    const t = state.clock.elapsedTime

    // Wander in a figure-8 pattern
    groupRef.current.position.x = Math.sin(t * 0.15) * 3
    groupRef.current.position.z = Math.sin(t * 0.3) * 2

    // Face movement direction
    const dx = Math.cos(t * 0.15) * 0.15 * 3
    const dz = Math.cos(t * 0.3) * 0.3 * 2
    groupRef.current.rotation.y = Math.atan2(dx, dz)

    // Tail wag
    if (tailRef.current) {
      tailRef.current.rotation.z = Math.sin(t * 3) * 0.4
    }
  })

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* Body */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[0.15, 0.12, 0.3]} />
        <meshStandardMaterial color="#ff8c42" />
      </mesh>

      {/* Head */}
      <mesh position={[0, 0.2, 0.18]} castShadow>
        <boxGeometry args={[0.14, 0.12, 0.12]} />
        <meshStandardMaterial color="#ff8c42" />
      </mesh>

      {/* Ears */}
      <mesh position={[-0.05, 0.28, 0.2]}>
        <boxGeometry args={[0.04, 0.06, 0.03]} />
        <meshStandardMaterial color="#ff8c42" />
      </mesh>
      <mesh position={[0.05, 0.28, 0.2]}>
        <boxGeometry args={[0.04, 0.06, 0.03]} />
        <meshStandardMaterial color="#ff8c42" />
      </mesh>

      {/* Eyes */}
      <mesh position={[-0.03, 0.22, 0.245]}>
        <boxGeometry args={[0.025, 0.025, 0.01]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      <mesh position={[0.03, 0.22, 0.245]}>
        <boxGeometry args={[0.025, 0.025, 0.01]} />
        <meshStandardMaterial color="#222" />
      </mesh>

      {/* Legs */}
      {[
        [-0.05, 0.05, 0.1],
        [0.05, 0.05, 0.1],
        [-0.05, 0.05, -0.1],
        [0.05, 0.05, -0.1]
      ].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} castShadow>
          <boxGeometry args={[0.04, 0.1, 0.04]} />
          <meshStandardMaterial color="#e67e22" />
        </mesh>
      ))}

      {/* Tail */}
      <group ref={tailRef} position={[0, 0.2, -0.18]}>
        <mesh position={[0, 0.06, -0.06]}>
          <boxGeometry args={[0.03, 0.15, 0.03]} />
          <meshStandardMaterial color="#ff8c42" />
        </mesh>
      </group>
    </group>
  )
}
