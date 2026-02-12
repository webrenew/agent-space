import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import type { InstancedMesh } from 'three'
import { Object3D, Color } from 'three'

interface DeskFireProps {
  position: [number, number, number]
}

const PARTICLE_COUNT = 24
const dummy = new Object3D()

export function DeskFire({ position }: DeskFireProps) {
  const meshRef = useRef<InstancedMesh>(null)

  const particles = useMemo(() => {
    return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      x: (Math.random() - 0.5) * 0.6,
      z: (Math.random() - 0.5) * 0.3,
      speed: 0.5 + Math.random() * 1.5,
      phase: (i / PARTICLE_COUNT) * Math.PI * 2,
      size: 0.03 + Math.random() * 0.04
    }))
  }, [])

  useFrame((state) => {
    if (!meshRef.current) return
    const t = state.clock.elapsedTime

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i]
      const life = ((t * p.speed + p.phase) % 1)

      dummy.position.set(
        position[0] + p.x + Math.sin(t * 3 + p.phase) * 0.05,
        position[1] + life * 0.8,
        position[2] + p.z + Math.cos(t * 2 + p.phase) * 0.03
      )

      const s = p.size * (1 - life * 0.7)
      dummy.scale.setScalar(s)
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)

      // Color: orange → red → dark as it rises
      const color = new Color().setHSL(
        0.05 + life * 0.02,
        1,
        0.6 - life * 0.4
      )
      meshRef.current.setColorAt(i, color)
    }

    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true
    }
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PARTICLE_COUNT]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial emissive="#ff4400" emissiveIntensity={2} transparent opacity={0.9} />
    </instancedMesh>
  )
}
