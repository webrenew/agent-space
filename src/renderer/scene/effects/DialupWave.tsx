import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'

interface DialupWaveProps {
  position: [number, number, number]
  onComplete: () => void
}

const DURATION = 3.4

export function DialupWave({ position, onComplete }: DialupWaveProps) {
  const groupRef = useRef<Group>(null)
  const ringRefs = useRef<Array<Group | null>>([])
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

    group.position.set(position[0], position[1] + 1.05 + Math.sin(elapsed * 4) * 0.05, position[2])
    group.rotation.y = elapsed * 0.45

    for (let i = 0; i < ringRefs.current.length; i++) {
      const ring = ringRefs.current[i]
      if (!ring) continue
      const phase = (elapsed * 2.2 + i * 0.55) % 2.4
      const scale = 0.2 + phase * 0.85
      ring.scale.set(scale, scale, 1)
      ring.position.y = i * 0.08
      ring.rotation.z = elapsed * (0.5 + i * 0.2)
      ring.visible = phase < 2.2
    }
  })

  if (done) return null

  return (
    <group ref={groupRef} position={[position[0], position[1] + 1.05, position[2]]}>
      {[0, 1, 2, 3].map((index) => (
        <group key={`ring-${index}`} ref={(node) => { ringRefs.current[index] = node }}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.32, 0.018, 12, 28]} />
            <meshStandardMaterial
              color={index % 2 === 0 ? '#22d3ee' : '#a78bfa'}
              emissive={index % 2 === 0 ? '#22d3ee' : '#a78bfa'}
              emissiveIntensity={0.65}
              metalness={0.2}
              roughness={0.2}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
      <mesh>
        <sphereGeometry args={[0.05, 12, 12]} />
        <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.8} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 0.15, 0]} color="#22d3ee" intensity={0.65} distance={2.2} />
    </group>
  )
}

