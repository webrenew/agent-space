import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import type { InstancedMesh } from 'three'
import { Object3D } from 'three'

interface PapersProps {
  position: [number, number, number]
}

const PAPER_COUNT = 8
const dummy = new Object3D()

export function Papers({ position }: PapersProps) {
  const meshRef = useRef<InstancedMesh>(null)

  const papers = useMemo(() => {
    return Array.from({ length: PAPER_COUNT }, (_, i) => ({
      xDir: (Math.random() - 0.5) * 2,
      zDir: (Math.random() - 0.5) * 2,
      speed: 0.3 + Math.random() * 0.8,
      rotSpeed: (Math.random() - 0.5) * 4,
      phase: (i / PAPER_COUNT) * Math.PI * 2,
      ySpeed: 0.2 + Math.random() * 0.5
    }))
  }, [])

  useFrame((state) => {
    if (!meshRef.current) return
    const t = state.clock.elapsedTime

    for (let i = 0; i < PAPER_COUNT; i++) {
      const p = papers[i]
      const life = ((t * p.speed * 0.3 + p.phase) % 1)

      dummy.position.set(
        position[0] + p.xDir * life * 0.8,
        position[1] + life * 0.6 + Math.sin(t * 2 + p.phase) * 0.1,
        position[2] + p.zDir * life * 0.8
      )

      dummy.rotation.set(
        t * p.rotSpeed,
        t * p.rotSpeed * 0.7,
        t * p.rotSpeed * 0.5
      )

      const s = 0.06 * (1 - life * 0.5)
      dummy.scale.set(s * 1.4, s * 0.1, s)
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)
    }

    meshRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PAPER_COUNT]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#f5f0e8" />
    </instancedMesh>
  )
}
