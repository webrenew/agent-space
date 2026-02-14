import { useRef, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { InstancedMesh } from 'three'
import { Object3D, Color } from 'three'

interface FaxBlastProps {
  position: [number, number, number]
  onComplete: () => void
}

const PARTICLE_COUNT = 24
const DURATION = 3.2
const GRAVITY = -2.2
const dummy = new Object3D()

interface FaxParticle {
  vx: number
  vy: number
  vz: number
  rot: number
  scale: number
  color: Color
}

export function FaxBlast({ position, onComplete }: FaxBlastProps) {
  const meshRef = useRef<InstancedMesh>(null)
  const startTime = useRef<number | null>(null)
  const completedRef = useRef(false)
  const [done, setDone] = useState(false)

  const particles = useMemo<FaxParticle[]>(() => {
    return Array.from({ length: PARTICLE_COUNT }, () => {
      const angle = Math.random() * Math.PI * 2
      const spread = 0.55 + Math.random() * 0.8
      return {
        vx: Math.cos(angle) * spread,
        vy: 1.8 + Math.random() * 1.8,
        vz: Math.sin(angle) * spread,
        rot: (Math.random() - 0.5) * 8,
        scale: 0.07 + Math.random() * 0.05,
        color: new Color(Math.random() > 0.3 ? '#f8fafc' : '#d4f4dd'),
      }
    })
  }, [])

  useFrame((state) => {
    const mesh = meshRef.current
    if (!mesh || completedRef.current) return

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

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i]
      const t = elapsed
      dummy.position.set(
        position[0] + p.vx * t,
        position[1] + 0.85 + p.vy * t + 0.5 * GRAVITY * t * t,
        position[2] + p.vz * t
      )
      dummy.rotation.set(t * p.rot, t * p.rot * 0.5, t * p.rot * 0.85)
      dummy.scale.set(p.scale * 0.72, p.scale, 0.012)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, p.color)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true
    }
  })

  if (done) return null

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PARTICLE_COUNT]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial vertexColors roughness={0.85} metalness={0.05} toneMapped={false} />
    </instancedMesh>
  )
}

