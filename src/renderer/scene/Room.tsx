const WALL_COLOR = '#e8e0d8'
const FLOOR_COLOR = '#d4a574'
const BACK_WINDOW_POSITIONS = [-7.2, -2.4, 2.4, 7.2] as const
const SIDE_WINDOW_POSITIONS = [-10.2, -5.4] as const
const BACK_WINDOW_SIZE = { width: 2, height: 1.4 } as const
const SIDE_WINDOW_SIZE = { width: 1.8, height: 1.25 } as const
const WINDOW_OPENING_PADDING = 0.2

interface WallWindowProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  width?: number
  height?: number
}

interface WallOpening {
  center: number
  width: number
}

interface WallOpeningSegment {
  center: number
  length: number
}

function computeWallSegments(span: number, openings: WallOpening[]): WallOpeningSegment[] {
  const min = -span / 2
  const max = span / 2
  const sortedOpenings = [...openings].sort((a, b) => a.center - b.center)
  const segments: WallOpeningSegment[] = []

  let cursor = min

  for (const opening of sortedOpenings) {
    const openingMin = Math.max(min, opening.center - opening.width / 2)
    const openingMax = Math.min(max, opening.center + opening.width / 2)
    if (openingMin > cursor + 0.001) {
      segments.push({
        center: (cursor + openingMin) / 2,
        length: openingMin - cursor,
      })
    }
    cursor = Math.max(cursor, openingMax)
  }

  if (cursor < max - 0.001) {
    segments.push({
      center: (cursor + max) / 2,
      length: max - cursor,
    })
  }

  return segments
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
        <boxGeometry args={[width + 0.25, height + 0.25, 0.06]} />
        <meshStandardMaterial color="#6b5a48" />
      </mesh>
      <mesh position={[0, 0, 0.025]}>
        <boxGeometry args={[width, height, 0.02]} />
        <meshStandardMaterial
          color="#93c5fd"
          emissive="#7dd3fc"
          emissiveIntensity={0.35}
          transparent
          opacity={0.8}
        />
      </mesh>
      <mesh position={[0, 0, 0.035]}>
        <boxGeometry args={[0.08, height, 0.03]} />
        <meshStandardMaterial color="#5a4632" />
      </mesh>
      <mesh position={[0, 0, 0.035]}>
        <boxGeometry args={[width, 0.08, 0.03]} />
        <meshStandardMaterial color="#5a4632" />
      </mesh>
    </group>
  )
}

function WallWithWindowOpenings({
  position,
  span,
  spanAxis = 'x',
  openings,
  openingCenterY,
  openingHeight,
  wallHeight = 4,
  wallThickness = 0.2,
}: {
  position: [number, number, number]
  span: number
  spanAxis?: 'x' | 'z'
  openings: WallOpening[]
  openingCenterY: number
  openingHeight: number
  wallHeight?: number
  wallThickness?: number
}) {
  const minY = -wallHeight / 2
  const maxY = wallHeight / 2
  const openingBottom = Math.max(minY, openingCenterY - openingHeight / 2)
  const openingTop = Math.min(maxY, openingCenterY + openingHeight / 2)
  const lowerBandHeight = Math.max(0, openingBottom - minY)
  const upperBandHeight = Math.max(0, maxY - openingTop)
  const middleBandHeight = Math.max(0, openingTop - openingBottom)
  const middleSegments = middleBandHeight > 0 ? computeWallSegments(span, openings) : []

  return (
    <group position={position}>
      {lowerBandHeight > 0 && (
        <mesh position={[0, minY + lowerBandHeight / 2, 0]} receiveShadow>
          <boxGeometry
            args={
              spanAxis === 'x'
                ? [span, lowerBandHeight, wallThickness]
                : [wallThickness, lowerBandHeight, span]
            }
          />
          <meshStandardMaterial color={WALL_COLOR} />
        </mesh>
      )}
      {upperBandHeight > 0 && (
        <mesh position={[0, openingTop + upperBandHeight / 2, 0]} receiveShadow>
          <boxGeometry
            args={
              spanAxis === 'x'
                ? [span, upperBandHeight, wallThickness]
                : [wallThickness, upperBandHeight, span]
            }
          />
          <meshStandardMaterial color={WALL_COLOR} />
        </mesh>
      )}
      {middleSegments.map((segment, index) => (
        <mesh
          key={`wall-column-${spanAxis}-${index}`}
          position={
            spanAxis === 'x'
              ? [segment.center, openingBottom + middleBandHeight / 2, 0]
              : [0, openingBottom + middleBandHeight / 2, segment.center]
          }
          receiveShadow
        >
          <boxGeometry
            args={
              spanAxis === 'x'
                ? [segment.length, middleBandHeight, wallThickness]
                : [wallThickness, middleBandHeight, segment.length]
            }
          />
          <meshStandardMaterial color={WALL_COLOR} />
        </mesh>
      ))}
    </group>
  )
}

function ExteriorCampusBackdrop() {
  return (
    <group>
      <mesh position={[0, 3.2, -20]}>
        <planeGeometry args={[38, 8]} />
        <meshStandardMaterial color="#b8e0ff" emissive="#bfdbfe" emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[0, 0.9, -18.8]} receiveShadow>
        <boxGeometry args={[24, 1.8, 0.9]} />
        <meshStandardMaterial color="#9ca3af" />
      </mesh>
      {[-8.6, -5.2, -2.1, 1.4, 4.7, 8.1].map((x, index) => (
        <mesh
          key={`backdrop-building-${index}`}
          position={[x, 1.7 + (index % 3) * 0.32, -18.15 - (index % 2) * 0.22]}
          receiveShadow
        >
          <boxGeometry args={[1.75, 2.1 + (index % 3) * 0.58, 0.62]} />
          <meshStandardMaterial color={index % 2 === 0 ? '#7c8fa4' : '#64748b'} />
        </mesh>
      ))}
      <mesh position={[-18.7, 2.1, -5]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[24, 6]} />
        <meshStandardMaterial color="#b8e0ff" emissive="#bfdbfe" emissiveIntensity={0.09} />
      </mesh>
      <mesh position={[18.7, 2.1, -5]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[24, 6]} />
        <meshStandardMaterial color="#b8e0ff" emissive="#bfdbfe" emissiveIntensity={0.09} />
      </mesh>
    </group>
  )
}

function YardBorderShrubs() {
  const shrubPositions: [number, number, number][] = [
    [-10.4, 0, -15.9],
    [-6.8, 0, -16.1],
    [-3.1, 0, -16.2],
    [2.7, 0, -16.2],
    [6.2, 0, -16.05],
    [10.2, 0, -15.9],
    [-10.45, 0, 5.95],
    [10.45, 0, 5.95],
  ]

  return (
    <group>
      {shrubPositions.map((position, index) => (
        <mesh key={`yard-shrub-${index}`} position={position} castShadow>
          <sphereGeometry args={[0.38 + (index % 3) * 0.05, 14, 10]} />
          <meshStandardMaterial color={index % 2 === 0 ? '#2f855a' : '#3fa16e'} />
        </mesh>
      ))}
    </group>
  )
}

export function Room() {
  return (
    <group>
      {/* Little yard around the office */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -5]} receiveShadow>
        <planeGeometry args={[42, 36]} />
        <meshStandardMaterial color="#7fbd65" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, -5]} receiveShadow>
        <planeGeometry args={[28, 24]} />
        <meshStandardMaterial color="#d6c39a" transparent opacity={0.75} />
      </mesh>
      <YardBorderShrubs />
      <ExteriorCampusBackdrop />

      {/* Office floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -5]} receiveShadow>
        <planeGeometry args={[22, 18]} />
        <meshStandardMaterial color={FLOOR_COLOR} />
      </mesh>

      {/* Back wall with true window openings */}
      <WallWithWindowOpenings
        position={[0, 2, -14]}
        span={22}
        spanAxis="x"
        openings={BACK_WINDOW_POSITIONS.map((x) => ({
          center: x,
          width: BACK_WINDOW_SIZE.width + WINDOW_OPENING_PADDING,
        }))}
        openingCenterY={0.45}
        openingHeight={BACK_WINDOW_SIZE.height + WINDOW_OPENING_PADDING}
      />
      {BACK_WINDOW_POSITIONS.map((x) => (
        <WallWindow
          key={`back-window-${x}`}
          position={[x, 2.45, -13.88]}
          width={BACK_WINDOW_SIZE.width}
          height={BACK_WINDOW_SIZE.height}
        />
      ))}

      {/* Side walls with true window openings */}
      <WallWithWindowOpenings
        position={[-11, 2, -5]}
        span={18}
        spanAxis="z"
        openings={SIDE_WINDOW_POSITIONS.map((z) => ({
          center: z + 5,
          width: SIDE_WINDOW_SIZE.width + WINDOW_OPENING_PADDING,
        }))}
        openingCenterY={0.35}
        openingHeight={SIDE_WINDOW_SIZE.height + WINDOW_OPENING_PADDING}
      />
      <WallWithWindowOpenings
        position={[11, 2, -5]}
        span={18}
        spanAxis="z"
        openings={SIDE_WINDOW_POSITIONS.map((z) => ({
          center: z + 5,
          width: SIDE_WINDOW_SIZE.width + WINDOW_OPENING_PADDING,
        }))}
        openingCenterY={0.35}
        openingHeight={SIDE_WINDOW_SIZE.height + WINDOW_OPENING_PADDING}
      />
      {SIDE_WINDOW_POSITIONS.map((z) => (
        <WallWindow
          key={`left-window-${z}`}
          position={[-10.88, 2.35, z]}
          rotation={[0, Math.PI / 2, 0]}
          width={SIDE_WINDOW_SIZE.width}
          height={SIDE_WINDOW_SIZE.height}
        />
      ))}
      {SIDE_WINDOW_POSITIONS.map((z) => (
        <WallWindow
          key={`right-window-${z}`}
          position={[10.88, 2.35, z]}
          rotation={[0, -Math.PI / 2, 0]}
          width={SIDE_WINDOW_SIZE.width}
          height={SIDE_WINDOW_SIZE.height}
        />
      ))}

      {/* Area rug */}
      <mesh position={[0, 0.005, -5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[10, 8]} />
        <meshStandardMaterial color="#4a5568" roughness={0.95} />
      </mesh>
    </group>
  )
}
