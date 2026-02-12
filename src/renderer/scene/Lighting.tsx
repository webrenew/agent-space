export function Lighting() {
  return (
    <>
      <ambientLight intensity={0.4} color="#ffeedd" />
      <directionalLight
        position={[8, 12, 5]}
        intensity={0.8}
        color="#fff5e6"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={30}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      {/* Ceiling fluorescent lights */}
      <pointLight position={[-2, 4.5, -2]} intensity={0.3} color="#f0f0ff" distance={10} />
      <pointLight position={[2, 4.5, 2]} intensity={0.3} color="#f0f0ff" distance={10} />
      <pointLight position={[-2, 4.5, 2]} intensity={0.2} color="#f0f0ff" distance={10} />
      <pointLight position={[2, 4.5, -2]} intensity={0.2} color="#f0f0ff" distance={10} />
    </>
  )
}
