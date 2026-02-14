import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'

interface PizzaPartyProps {
  position: [number, number, number]
  onComplete: () => void
}

const DURATION = 4.2

export function PizzaParty({ position, onComplete }: PizzaPartyProps) {
  const groupRef = useRef<Group>(null)
  const startTime = useRef<number | null>(null)
  const completedRef = useRef(false)
  const [done, setDone] = useState(false)

  useFrame((state) => {
    const group = groupRef.current
    if (!group || completedRef.current) return

    if (startTime.current === null) {
      startTime.current = state.clock.elapsedTime
    }

    const elapsed = state.clock.elapsedTime - startTime.current
    if (elapsed > DURATION) {
      completedRef.current = true
      setDone(true)
      onComplete()
      return
    }

    const t = elapsed
    group.position.set(
      position[0],
      position[1] + 1.35 + Math.sin(t * 2.4) * 0.08,
      position[2]
    )
    group.rotation.y = t * 1.9

    const pulse = 1 + Math.sin(t * 5.2) * 0.06
    group.scale.setScalar(pulse)
  })

  if (done) return null

  return (
    <group ref={groupRef} position={[position[0], position[1] + 1.35, position[2]]}>
      {/* Pizza box */}
      <mesh position={[0, -0.18, 0]} castShadow>
        <boxGeometry args={[0.56, 0.06, 0.56]} />
        <meshStandardMaterial color="#c87830" roughness={0.8} />
      </mesh>
      <mesh position={[0, -0.14, -0.02]} castShadow>
        <boxGeometry args={[0.54, 0.02, 0.52]} />
        <meshStandardMaterial color="#f4d9b7" roughness={0.95} />
      </mesh>

      {/* Orbiting slices */}
      {Array.from({ length: 8 }, (_, index) => {
        const angle = (index / 8) * Math.PI * 2
        const radius = 0.34
        return (
          <group
            key={`slice-${index}`}
            position={[Math.cos(angle) * radius, 0.12 + (index % 2 === 0 ? 0.03 : -0.02), Math.sin(angle) * radius]}
            rotation={[0, -angle + Math.PI / 2, 0.18]}
          >
            <mesh castShadow>
              <coneGeometry args={[0.11, 0.18, 3, 1, false, Math.PI / 2]} />
              <meshStandardMaterial color="#f4d03f" roughness={0.7} metalness={0.05} />
            </mesh>
            <mesh position={[0, 0.012, -0.045]}>
              <boxGeometry args={[0.07, 0.01, 0.018]} />
              <meshStandardMaterial color="#c45050" />
            </mesh>
          </group>
        )
      })}

      <pointLight position={[0, 0.35, 0]} color="#fbbf24" intensity={0.8} distance={2.4} />
    </group>
  )
}

