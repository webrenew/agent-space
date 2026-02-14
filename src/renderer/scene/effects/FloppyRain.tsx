import { useRef, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { InstancedMesh } from 'three'
import { Object3D, Color } from 'three'

interface FloppyRainProps {
  position: [number, number, number]
  onComplete: () => void
}

const PARTICLE_COUNT = 28
const DURATION = 3.8
const dummy = new Object3D()

interface FloppyParticle {
  x: number
  y: number
  z: number
  fall: number
  spin: number
  sway: number
  color: Color
}

const FLOPPY_COLORS = ['#1f3b8c', '#223a5f', '#303f9f', '#111827', '#2d3748']

export function FloppyRain({ position, onComplete }: FloppyRainProps) {
  const meshRef = useRef<InstancedMesh>(null)
  const startTime = useRef<number | null>(null)
  const completedRef = useRef(false)
  const [done, setDone] = useState(false)

  const particles = useMemo<FloppyParticle[]>(() => {
    return Array.from({ length: PARTICLE_COUNT }, () => ({
      x: (Math.random() - 0.5) * 1.8,
      y: 1.2 + Math.random() * 2.1,
      z: (Math.random() - 0.5) * 1.8,
      fall: 0.85 + Math.random() * 0.95,
      spin: (Math.random() - 0.5) * 8,
      sway: 0.06 + Math.random() * 0.1,
      color: new Color(FLOPPY_COLORS[Math.floor(Math.random() * FLOPPY_COLORS.length)]),
    }))
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
      const y = p.y - elapsed * p.fall * 1.35
      const wobble = Math.sin(elapsed * 3.1 + i * 0.8) * p.sway

      dummy.position.set(
        position[0] + p.x + wobble,
        position[1] + y,
        position[2] + p.z + Math.cos(elapsed * 2.4 + i) * p.sway
      )
      dummy.rotation.set(elapsed * p.spin * 0.3, elapsed * p.spin, elapsed * p.spin * 0.5)
      dummy.scale.set(0.11, 0.11, 0.02)
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
    <group>
      <instancedMesh ref={meshRef} args={[undefined, undefined, PARTICLE_COUNT]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial vertexColors metalness={0.2} roughness={0.6} toneMapped={false} />
      </instancedMesh>
      <pointLight position={[position[0], position[1] + 1.4, position[2]]} color="#60a5fa" intensity={0.4} distance={1.7} />
    </group>
  )
}

