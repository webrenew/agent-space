interface WallWindowProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  width?: number
  height?: number
}

function WallWindow({
  position,
  rotation = [0, 0, 0],
  width = 2,
  height = 1.35,
}: WallWindowProps) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow>
        <boxGeometry args={[width + 0.26, height + 0.24, 0.06]} />
        <meshStandardMaterial color="#6c5842" roughness={0.72} />
      </mesh>
      <mesh position={[0, 0, 0.024]}>
        <boxGeometry args={[width, height, 0.02]} />
        <meshStandardMaterial
          color="#8bc8ff"
          emissive="#7dd3fc"
          emissiveIntensity={0.4}
          roughness={0.08}
          transparent
          opacity={0.8}
        />
      </mesh>
      <mesh position={[0, 0, 0.034]}>
        <boxGeometry args={[0.08, height, 0.03]} />
        <meshStandardMaterial color="#5f4a34" />
      </mesh>
      <mesh position={[0, 0, 0.034]}>
        <boxGeometry args={[width, 0.08, 0.03]} />
        <meshStandardMaterial color="#5f4a34" />
      </mesh>
    </group>
  )
}

export function Room() {
  const floorSize = 14
  const wallHeight = 5
  const wallThickness = 0.15
  const half = floorSize / 2

  return (
    <group>
      {/* Floor - warm wood color */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[floorSize, floorSize]} />
        <meshStandardMaterial color="#8B7355" roughness={0.8} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, wallHeight / 2, -half]} receiveShadow>
        <boxGeometry args={[floorSize, wallHeight, wallThickness]} />
        <meshStandardMaterial color="#e8dcc8" />
      </mesh>

      {/* Side walls */}
      <mesh position={[-half, wallHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[wallThickness, wallHeight, floorSize]} />
        <meshStandardMaterial color="#ddd0bc" />
      </mesh>
      <mesh position={[half, wallHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[wallThickness, wallHeight, floorSize]} />
        <meshStandardMaterial color="#ddd0bc" />
      </mesh>

      {/* Exterior city glow behind the windows */}
      <mesh position={[0, 2.55, -half - 0.55]}>
        <boxGeometry args={[11.6, 2.2, 0.08]} />
        <meshStandardMaterial color="#1d4a72" emissive="#38bdf8" emissiveIntensity={0.26} />
      </mesh>

      {[-4.6, -1.6, 1.6, 4.6].map((x) => (
        <WallWindow
          key={`back-window-${x}`}
          position={[x, 2.45, -half + wallThickness / 2 + 0.035]}
          width={1.95}
          height={1.3}
        />
      ))}

      {[-4.2, -0.8].map((z) => (
        <WallWindow
          key={`left-window-${z}`}
          position={[-half + wallThickness / 2 + 0.035, 2.35, z]}
          rotation={[0, Math.PI / 2, 0]}
          width={1.72}
          height={1.22}
        />
      ))}

      {[-4.2, -0.8].map((z) => (
        <WallWindow
          key={`right-window-${z}`}
          position={[half - wallThickness / 2 - 0.035, 2.35, z]}
          rotation={[0, -Math.PI / 2, 0]}
          width={1.72}
          height={1.22}
        />
      ))}

      {/* Baseboard trim - back */}
      <mesh position={[0, 0.1, -half + 0.06]}>
        <boxGeometry args={[floorSize, 0.2, 0.12]} />
        <meshStandardMaterial color="#5a4a3a" />
      </mesh>

      {/* Baseboard trim - left */}
      <mesh position={[-half + 0.06, 0.1, 0]}>
        <boxGeometry args={[0.12, 0.2, floorSize]} />
        <meshStandardMaterial color="#5a4a3a" />
      </mesh>

      {/* Baseboard trim - right */}
      <mesh position={[half - 0.06, 0.1, 0]}>
        <boxGeometry args={[0.12, 0.2, floorSize]} />
        <meshStandardMaterial color="#5a4a3a" />
      </mesh>

      {/* Carpet area rug */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[10, 8]} />
        <meshStandardMaterial color="#4a5568" roughness={0.95} />
      </mesh>
    </group>
  )
}
