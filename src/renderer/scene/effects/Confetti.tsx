import { useRef, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { InstancedMesh } from 'three'
import { Object3D, Color } from 'three'

interface ConfettiProps {
  position: [number, number, number]
  onComplete: () => void
}

const PARTICLE_COUNT = 48
const DURATION = 4
const GRAVITY = -2.5
const dummy = new Object3D()

const COLORS = [
  '#4ade80', '#60a5fa', '#f472b6', '#fbbf24',
  '#a78bfa', '#fb923c', '#22d3ee', '#f87171'
]

interface Particle {
  vx: number
  vy: number
  vz: number
  rotSpeed: number
  color: Color
  scale: number
}

export function Confetti({ position, onComplete }: ConfettiProps) {
  const meshRef = useRef<InstancedMesh>(null)
  const startTime = useRef<number | null>(null)
  const [done, setDone] = useState(false)

  const particles = useMemo<Particle[]>(() => {
    return Array.from({ length: PARTICLE_COUNT }, () => {
      const angle = Math.random() * Math.PI * 2
      const force = 1.5 + Math.random() * 2
      return {
        vx: Math.cos(angle) * force * (0.3 + Math.random() * 0.4),
        vy: 2 + Math.random() * 3,
        vz: Math.sin(angle) * force * (0.3 + Math.random() * 0.4),
        rotSpeed: (Math.random() - 0.5) * 10,
        color: new Color(COLORS[Math.floor(Math.random() * COLORS.length)]),
        scale: 0.03 + Math.random() * 0.04
      }
    })
  }, [])

  useFrame((state) => {
    if (!meshRef.current || done) return

    if (startTime.current === null) {
      startTime.current = state.clock.elapsedTime
    }

    const elapsed = state.clock.elapsedTime - startTime.current
    if (elapsed > DURATION) {
      setDone(true)
      onComplete()
      return
    }

    const progress = elapsed / DURATION
    const opacity = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i]
      const t = elapsed

      dummy.position.set(
        position[0] + p.vx * t,
        position[1] + p.vy * t + 0.5 * GRAVITY * t * t,
        position[2] + p.vz * t
      )

      dummy.rotation.set(
        t * p.rotSpeed,
        t * p.rotSpeed * 0.7,
        t * p.rotSpeed * 0.3
      )

      const s = p.scale * opacity
      dummy.scale.set(s * 2, s * 0.5, s)
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)

      // Per-instance color
      meshRef.current.setColorAt(i, p.color)
    }

    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true
    }
  })

  if (done) return null

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PARTICLE_COUNT]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  )
}
