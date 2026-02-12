import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import type { AgentStatus } from '../types'

interface DeskProps {
  position: [number, number, number]
  status: AgentStatus
  tokensUsed: number
}

export function Desk({ position, status, tokensUsed }: DeskProps) {
  const monitorRef = useRef<Mesh>(null)

  // Monitor glow intensity based on status
  useFrame((_state, delta) => {
    if (!monitorRef.current) return
    const mat = monitorRef.current.material as unknown as { emissiveIntensity: number }
    const target = status === 'streaming' ? 1.2 : status === 'error' ? 0.8 : 0.3
    mat.emissiveIntensity += (target - mat.emissiveIntensity) * delta * 3
  })

  const paperHeight = Math.min(0.02 + (tokensUsed / 50000) * 0.15, 0.2)

  return (
    <group position={position}>
      {/* Desk surface */}
      <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.08, 0.8]} />
        <meshStandardMaterial color="#a0845c" roughness={0.6} />
      </mesh>

      {/* Legs */}
      {[
        [-0.7, 0.375, -0.3],
        [0.7, 0.375, -0.3],
        [-0.7, 0.375, 0.3],
        [0.7, 0.375, 0.3]
      ].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} castShadow>
          <boxGeometry args={[0.06, 0.75, 0.06]} />
          <meshStandardMaterial color="#7a6548" />
        </mesh>
      ))}

      {/* Monitor stand */}
      <mesh position={[0, 0.85, -0.2]} castShadow>
        <boxGeometry args={[0.1, 0.12, 0.06]} />
        <meshStandardMaterial color="#333" />
      </mesh>

      {/* Monitor screen */}
      <mesh ref={monitorRef} position={[0, 1.1, -0.25]} castShadow>
        <boxGeometry args={[0.7, 0.45, 0.04]} />
        <meshStandardMaterial
          color="#1a1a2e"
          emissive={status === 'error' ? '#ff3333' : '#4488ff'}
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* Monitor bezel */}
      <mesh position={[0, 1.1, -0.24]}>
        <boxGeometry args={[0.74, 0.49, 0.02]} />
        <meshStandardMaterial color="#222" />
      </mesh>

      {/* Keyboard */}
      <mesh position={[0, 0.8, 0.1]}>
        <boxGeometry args={[0.4, 0.02, 0.15]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>

      {/* Coffee mug */}
      <mesh position={[0.55, 0.84, 0.15]} castShadow>
        <cylinderGeometry args={[0.04, 0.035, 0.08, 8]} />
        <meshStandardMaterial color="#c0392b" />
      </mesh>

      {/* Paper stack */}
      {paperHeight > 0.03 && (
        <mesh position={[-0.55, 0.79 + paperHeight / 2, 0.1]}>
          <boxGeometry args={[0.2, paperHeight, 0.28]} />
          <meshStandardMaterial color="#f5f0e8" />
        </mesh>
      )}

      {/* Chair */}
      <group position={[0, 0, 0.7]}>
        {/* Seat */}
        <mesh position={[0, 0.45, 0]} castShadow>
          <boxGeometry args={[0.45, 0.06, 0.45]} />
          <meshStandardMaterial color="#2d3748" />
        </mesh>
        {/* Back rest */}
        <mesh position={[0, 0.7, -0.2]} castShadow>
          <boxGeometry args={[0.45, 0.45, 0.06]} />
          <meshStandardMaterial color="#2d3748" />
        </mesh>
        {/* Chair base */}
        <mesh position={[0, 0.22, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.44, 6]} />
          <meshStandardMaterial color="#555" />
        </mesh>
        {/* Chair wheels base */}
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.2, 0.2, 0.04, 5]} />
          <meshStandardMaterial color="#555" />
        </mesh>
      </group>
    </group>
  )
}
