export function Room() {
  const floorSize = 14
  const wallHeight = 5
  const wallThickness = 0.15

  return (
    <group>
      {/* Floor — warm wood color */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[floorSize, floorSize]} />
        <meshStandardMaterial color="#8B7355" roughness={0.8} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, wallHeight / 2, -floorSize / 2]} receiveShadow>
        <boxGeometry args={[floorSize, wallHeight, wallThickness]} />
        <meshStandardMaterial color="#e8dcc8" />
      </mesh>

      {/* Left wall */}
      <mesh position={[-floorSize / 2, wallHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[wallThickness, wallHeight, floorSize]} />
        <meshStandardMaterial color="#ddd0bc" />
      </mesh>

      {/* Right wall */}
      <mesh position={[floorSize / 2, wallHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[wallThickness, wallHeight, floorSize]} />
        <meshStandardMaterial color="#ddd0bc" />
      </mesh>

      {/* Baseboard trim — back */}
      <mesh position={[0, 0.1, -floorSize / 2 + 0.06]}>
        <boxGeometry args={[floorSize, 0.2, 0.12]} />
        <meshStandardMaterial color="#5a4a3a" />
      </mesh>

      {/* Baseboard trim — left */}
      <mesh position={[-floorSize / 2 + 0.06, 0.1, 0]}>
        <boxGeometry args={[0.12, 0.2, floorSize]} />
        <meshStandardMaterial color="#5a4a3a" />
      </mesh>

      {/* Baseboard trim — right */}
      <mesh position={[floorSize / 2 - 0.06, 0.1, 0]}>
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
