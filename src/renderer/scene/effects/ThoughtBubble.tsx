import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Mesh } from 'three'

interface ThoughtBubbleProps {
  position: [number, number, number]
}

export function ThoughtBubble({ position }: ThoughtBubbleProps) {
  const groupRef = useRef<Group>(null)

  useFrame((state) => {
    if (!groupRef.current) return
    const t = state.clock.elapsedTime
    groupRef.current.position.y = position[1] + Math.sin(t * 2) * 0.05
  })

  return (
    <group ref={groupRef} position={position}>
      {/* Main bubble */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.18, 8, 8]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.85} />
      </mesh>

      {/* Dot trail */}
      <mesh position={[-0.15, -0.2, 0]}>
        <sphereGeometry args={[0.06, 6, 6]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.7} />
      </mesh>
      <mesh position={[-0.08, -0.32, 0]}>
        <sphereGeometry args={[0.035, 6, 6]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.5} />
      </mesh>

      {/* Animated dots inside bubble */}
      {[0, 1, 2].map((i) => (
        <AnimatedDot key={i} index={i} />
      ))}
    </group>
  )
}

function AnimatedDot({ index }: { index: number }) {
  const ref = useRef<Mesh>(null)

  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.elapsedTime
    const phase = t * 3 + index * 1.2
    ref.current.position.y = Math.sin(phase) * 0.04
    ref.current.scale.setScalar(0.6 + Math.sin(phase) * 0.4)
  })

  return (
    <mesh ref={ref} position={[(index - 1) * 0.08, 0, 0.15]}>
      <sphereGeometry args={[0.025, 6, 6]} />
      <meshStandardMaterial color="#666" />
    </mesh>
  )
}
