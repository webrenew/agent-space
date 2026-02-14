import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { Agent, AgentAppearance } from '../types'
import { useAgentStore } from '../store/agents'
import { ThoughtBubble } from './effects/ThoughtBubble'
import { DeskFire } from './effects/DeskFire'
import { Papers } from './effects/Papers'
import { Confetti } from './effects/Confetti'
import { Rocket } from './effects/Rocket'
import { Sparkles } from './effects/Sparkles'
import { Explosion } from './effects/Explosion'
import { Trophy } from './effects/Trophy'
import { PizzaParty } from './effects/PizzaParty'
import { FloppyRain } from './effects/FloppyRain'
import { DialupWave } from './effects/DialupWave'
import { FaxBlast } from './effects/FaxBlast'
import { OfficePlant } from './effects/OfficePlant'

interface AgentCharacterProps {
  agent: Agent
  position: [number, number, number]
}

function Hair({ appearance }: { appearance: AgentAppearance }) {
  const { hairColor, hairStyle } = appearance

  switch (hairStyle) {
    case 'buzz':
      return (
        <mesh position={[0, 0.18, 0]} castShadow>
          <boxGeometry args={[0.42, 0.1, 0.37]} />
          <meshStandardMaterial color={hairColor} />
        </mesh>
      )
    case 'short':
      return (
        <group>
          {/* Top */}
          <mesh position={[0, 0.22, -0.02]} castShadow>
            <boxGeometry args={[0.42, 0.15, 0.38]} />
            <meshStandardMaterial color={hairColor} />
          </mesh>
          {/* Sides */}
          <mesh position={[-0.2, 0.05, -0.02]} castShadow>
            <boxGeometry args={[0.06, 0.2, 0.36]} />
            <meshStandardMaterial color={hairColor} />
          </mesh>
          <mesh position={[0.2, 0.05, -0.02]} castShadow>
            <boxGeometry args={[0.06, 0.2, 0.36]} />
            <meshStandardMaterial color={hairColor} />
          </mesh>
        </group>
      )
    case 'long':
      return (
        <group>
          {/* Top */}
          <mesh position={[0, 0.22, -0.02]} castShadow>
            <boxGeometry args={[0.44, 0.14, 0.4]} />
            <meshStandardMaterial color={hairColor} />
          </mesh>
          {/* Sides hanging down */}
          <mesh position={[-0.21, -0.05, -0.02]} castShadow>
            <boxGeometry args={[0.07, 0.45, 0.38]} />
            <meshStandardMaterial color={hairColor} />
          </mesh>
          <mesh position={[0.21, -0.05, -0.02]} castShadow>
            <boxGeometry args={[0.07, 0.45, 0.38]} />
            <meshStandardMaterial color={hairColor} />
          </mesh>
          {/* Back */}
          <mesh position={[0, -0.05, -0.18]} castShadow>
            <boxGeometry args={[0.44, 0.45, 0.06]} />
            <meshStandardMaterial color={hairColor} />
          </mesh>
        </group>
      )
    case 'ponytail':
      return (
        <group>
          {/* Top */}
          <mesh position={[0, 0.22, -0.02]} castShadow>
            <boxGeometry args={[0.44, 0.14, 0.4]} />
            <meshStandardMaterial color={hairColor} />
          </mesh>
          {/* Ponytail */}
          <mesh position={[0, 0.1, -0.25]} castShadow>
            <boxGeometry args={[0.12, 0.12, 0.15]} />
            <meshStandardMaterial color={hairColor} />
          </mesh>
          <mesh position={[0, -0.1, -0.28]} castShadow>
            <boxGeometry args={[0.1, 0.25, 0.1]} />
            <meshStandardMaterial color={hairColor} />
          </mesh>
        </group>
      )
    case 'mohawk':
      return (
        <group>
          {/* Mohawk strip */}
          <mesh position={[0, 0.3, 0]} castShadow>
            <boxGeometry args={[0.08, 0.22, 0.32]} />
            <meshStandardMaterial color={hairColor} />
          </mesh>
          {/* Shaved sides */}
          <mesh position={[-0.19, 0.15, 0]} castShadow>
            <boxGeometry args={[0.04, 0.06, 0.34]} />
            <meshStandardMaterial color={hairColor} roughness={0.9} />
          </mesh>
          <mesh position={[0.19, 0.15, 0]} castShadow>
            <boxGeometry args={[0.04, 0.06, 0.34]} />
            <meshStandardMaterial color={hairColor} roughness={0.9} />
          </mesh>
        </group>
      )
  }
}

export function AgentCharacter({ agent, position }: AgentCharacterProps) {
  const groupRef = useRef<Group>(null)
  const headRef = useRef<Group>(null)
  const leftArmRef = useRef<Group>(null)
  const rightArmRef = useRef<Group>(null)
  const bodyRef = useRef<Group>(null)
  const selectAgent = useAgentStore((s) => s.selectAgent)

  const { shirtColor, skinTone, pantsColor, gender } = agent.appearance

  // Body proportions based on gender
  const torsoWidth = gender === 'feminine' ? 0.26 : 0.3
  const torsoHeight = gender === 'feminine' ? 0.38 : 0.4
  const hipWidth = gender === 'feminine' ? 0.14 : 0.12

  const charPos = useMemo((): [number, number, number] => {
    return [position[0], position[1], position[2] + 0.7]
  }, [position])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (!groupRef.current || !headRef.current) return

    const head = headRef.current
    const leftArm = leftArmRef.current
    const rightArm = rightArmRef.current
    const body = bodyRef.current

    switch (agent.status) {
      case 'idle': {
        groupRef.current.position.y = charPos[1] + Math.sin(t * 1.5) * 0.02
        head.rotation.z = Math.sin(t * 0.8) * 0.05
        if (leftArm) leftArm.rotation.x = 0
        if (rightArm) rightArm.rotation.x = 0
        if (body) body.rotation.x = 0
        groupRef.current.rotation.y = Math.sin(t * 0.3) * 0.1
        break
      }
      case 'thinking': {
        groupRef.current.position.y = charPos[1] + 0.15 + Math.abs(Math.sin(t * 3)) * 0.05
        groupRef.current.position.x = charPos[0] + Math.sin(t * 1.2) * 0.3
        groupRef.current.position.z = charPos[2] + Math.cos(t * 1.2) * 0.2
        head.rotation.z = Math.sin(t * 2) * 0.1
        if (leftArm) leftArm.rotation.x = -0.3 + Math.sin(t * 3) * 0.2
        if (rightArm) rightArm.rotation.x = -0.3 + Math.cos(t * 3) * 0.2
        if (body) body.rotation.x = 0
        break
      }
      case 'streaming': {
        groupRef.current.position.y = charPos[1]
        groupRef.current.position.x = charPos[0]
        groupRef.current.position.z = charPos[2]
        groupRef.current.rotation.y = 0
        head.rotation.z = Math.sin(t * 4) * 0.03
        if (leftArm) leftArm.rotation.x = -0.8 + Math.sin(t * 12) * 0.15
        if (rightArm) rightArm.rotation.x = -0.8 + Math.cos(t * 12) * 0.15
        if (body) body.rotation.x = -0.1
        break
      }
      case 'tool_calling': {
        const cycle = (t * 0.8) % (Math.PI * 2)
        groupRef.current.position.y = charPos[1] + 0.1 + Math.abs(Math.sin(t * 4)) * 0.03
        groupRef.current.position.x = charPos[0] + Math.sin(cycle) * 0.6
        groupRef.current.position.z = charPos[2] - 0.3
        groupRef.current.rotation.y = Math.sin(cycle) * 0.5
        if (leftArm) leftArm.rotation.x = Math.sin(t * 4) * 0.4
        if (rightArm) rightArm.rotation.x = Math.cos(t * 4) * 0.4
        if (body) body.rotation.x = 0
        break
      }
      case 'waiting': {
        groupRef.current.position.y = charPos[1] - 0.02
        groupRef.current.position.x = charPos[0]
        groupRef.current.position.z = charPos[2]
        groupRef.current.rotation.y = 0
        head.rotation.z = Math.sin(t * 0.5) * 0.08
        if (leftArm) leftArm.rotation.x = 0
        if (rightArm) rightArm.rotation.x = -0.6 + Math.sin(t * 6) * 0.08
        if (body) body.rotation.x = 0.1
        break
      }
      case 'error': {
        groupRef.current.position.y = charPos[1] + 0.05 + Math.sin(t * 8) * 0.02
        groupRef.current.position.x = charPos[0]
        groupRef.current.position.z = charPos[2]
        groupRef.current.rotation.y = Math.sin(t * 10) * 0.08
        head.rotation.z = Math.sin(t * 6) * 0.15
        if (leftArm) leftArm.rotation.x = -2.5 + Math.sin(t * 8) * 0.2
        if (rightArm) rightArm.rotation.x = -2.5 + Math.cos(t * 8) * 0.2
        if (body) body.rotation.x = 0
        break
      }
      case 'done': {
        groupRef.current.position.y = charPos[1]
        groupRef.current.position.x = charPos[0]
        groupRef.current.position.z = charPos[2]
        groupRef.current.rotation.y = 0
        head.rotation.z = 0
        if (leftArm) leftArm.rotation.x = -2.8
        if (rightArm) rightArm.rotation.x = -2.8
        if (body) body.rotation.x = 0.25
        break
      }
    }
  })

  return (
    <>
      <group
        ref={groupRef}
        position={charPos}
        onClick={(e) => {
          e.stopPropagation()
          selectAgent(agent.id)
        }}
      >
        {/* Body */}
        <group ref={bodyRef}>
          {/* Torso */}
          <mesh position={[0, 0.75, 0]} castShadow>
            <boxGeometry args={[torsoWidth, torsoHeight, 0.25]} />
            <meshStandardMaterial color={shirtColor} />
          </mesh>

          {/* Head */}
          <group ref={headRef} position={[0, 1.2, 0]}>
            <mesh castShadow>
              <boxGeometry args={[0.4, 0.4, 0.35]} />
              <meshStandardMaterial color={skinTone} />
            </mesh>

            {/* Hair */}
            <Hair appearance={agent.appearance} />

            {/* Eyes */}
            <mesh position={[-0.1, 0.04, 0.18]}>
              <boxGeometry args={[0.07, 0.07, 0.02]} />
              <meshStandardMaterial color="#222" />
            </mesh>
            <mesh position={[0.1, 0.04, 0.18]}>
              <boxGeometry args={[0.07, 0.07, 0.02]} />
              <meshStandardMaterial color="#222" />
            </mesh>

            {/* Mouth */}
            {agent.status === 'error' ? (
              <mesh position={[0, -0.1, 0.18]}>
                <boxGeometry args={[0.12, 0.03, 0.02]} />
                <meshStandardMaterial color="#c0392b" />
              </mesh>
            ) : agent.status === 'done' ? (
              <mesh position={[0, -0.1, 0.18]}>
                <boxGeometry args={[0.15, 0.03, 0.02]} />
                <meshStandardMaterial color="#e74c3c" />
              </mesh>
            ) : null}
          </group>

          {/* Left Arm */}
          <group ref={leftArmRef} position={[-(torsoWidth / 2 + 0.06), 0.85, 0]}>
            {/* Sleeve */}
            <mesh position={[0, -0.1, 0]} castShadow>
              <boxGeometry args={[0.1, 0.18, 0.1]} />
              <meshStandardMaterial color={shirtColor} />
            </mesh>
            {/* Forearm (skin) */}
            <mesh position={[0, -0.28, 0]} castShadow>
              <boxGeometry args={[0.09, 0.18, 0.09]} />
              <meshStandardMaterial color={skinTone} />
            </mesh>
          </group>

          {/* Right Arm */}
          <group ref={rightArmRef} position={[torsoWidth / 2 + 0.06, 0.85, 0]}>
            {/* Sleeve */}
            <mesh position={[0, -0.1, 0]} castShadow>
              <boxGeometry args={[0.1, 0.18, 0.1]} />
              <meshStandardMaterial color={shirtColor} />
            </mesh>
            {/* Forearm (skin) */}
            <mesh position={[0, -0.28, 0]} castShadow>
              <boxGeometry args={[0.09, 0.18, 0.09]} />
              <meshStandardMaterial color={skinTone} />
            </mesh>
          </group>

          {/* Left Leg */}
          <mesh position={[-0.08, 0.38, 0]} castShadow>
            <boxGeometry args={[hipWidth, 0.35, 0.12]} />
            <meshStandardMaterial color={pantsColor} />
          </mesh>

          {/* Right Leg */}
          <mesh position={[0.08, 0.38, 0]} castShadow>
            <boxGeometry args={[hipWidth, 0.35, 0.12]} />
            <meshStandardMaterial color={pantsColor} />
          </mesh>

          {/* Shoes */}
          <mesh position={[-0.08, 0.19, 0.03]} castShadow>
            <boxGeometry args={[hipWidth + 0.01, 0.06, 0.15]} />
            <meshStandardMaterial color="#1a1a2e" />
          </mesh>
          <mesh position={[0.08, 0.19, 0.03]} castShadow>
            <boxGeometry args={[hipWidth + 0.01, 0.06, 0.15]} />
            <meshStandardMaterial color="#1a1a2e" />
          </mesh>
        </group>

        {/* Status glow */}
        {agent.status === 'done' && (
          <pointLight position={[0, 1.5, 0]} color="#4ade80" intensity={0.5} distance={2} />
        )}
        {agent.status === 'error' && (
          <pointLight position={[0, 1.5, 0]} color="#ef4444" intensity={0.8} distance={2.5} />
        )}
      </group>

      {/* Effects rendered at desk position */}
      {agent.status === 'thinking' && <ThoughtBubble position={[charPos[0], charPos[1] + 1.7, charPos[2]]} />}
      {agent.status === 'error' && <DeskFire position={[position[0], position[1] + 0.8, position[2]]} />}
      {agent.status === 'streaming' && <Papers position={[position[0], position[1] + 0.9, position[2]]} />}

      {/* Celebration effects */}
      {agent.activeCelebration === 'confetti' && (
        <Confetti
          position={[charPos[0], charPos[1] + 1.8, charPos[2]]}
          onComplete={() => {
            useAgentStore.getState().updateAgent(agent.id, {
              activeCelebration: null,
              celebrationStartedAt: null
            })
          }}
        />
      )}
      {agent.activeCelebration === 'rocket' && (
        <Rocket
          position={[charPos[0], charPos[1] + 1.5, charPos[2]]}
          onComplete={() => {
            useAgentStore.getState().updateAgent(agent.id, {
              activeCelebration: null,
              celebrationStartedAt: null
            })
          }}
        />
      )}
      {agent.activeCelebration === 'sparkles' && (
        <Sparkles
          position={[charPos[0], charPos[1] + 1.6, charPos[2]]}
          onComplete={() => {
            useAgentStore.getState().updateAgent(agent.id, {
              activeCelebration: null,
              celebrationStartedAt: null
            })
          }}
        />
      )}
      {agent.activeCelebration === 'explosion' && (
        <Explosion
          position={[charPos[0], charPos[1] + 1.5, charPos[2]]}
          onComplete={() => {
            useAgentStore.getState().updateAgent(agent.id, {
              activeCelebration: null,
              celebrationStartedAt: null
            })
          }}
        />
      )}
      {agent.activeCelebration === 'trophy' && (
        <Trophy
          position={[charPos[0], charPos[1], charPos[2]]}
          onComplete={() => {
            useAgentStore.getState().updateAgent(agent.id, {
              activeCelebration: null,
              celebrationStartedAt: null
            })
          }}
        />
      )}
      {agent.activeCelebration === 'pizza_party' && (
        <PizzaParty
          position={[charPos[0], charPos[1], charPos[2]]}
          onComplete={() => {
            useAgentStore.getState().updateAgent(agent.id, {
              activeCelebration: null,
              celebrationStartedAt: null
            })
          }}
        />
      )}
      {agent.activeCelebration === 'floppy_rain' && (
        <FloppyRain
          position={[charPos[0], charPos[1], charPos[2]]}
          onComplete={() => {
            useAgentStore.getState().updateAgent(agent.id, {
              activeCelebration: null,
              celebrationStartedAt: null
            })
          }}
        />
      )}
      {agent.activeCelebration === 'dialup_wave' && (
        <DialupWave
          position={[charPos[0], charPos[1], charPos[2]]}
          onComplete={() => {
            useAgentStore.getState().updateAgent(agent.id, {
              activeCelebration: null,
              celebrationStartedAt: null
            })
          }}
        />
      )}
      {agent.activeCelebration === 'fax_blast' && (
        <FaxBlast
          position={[charPos[0], charPos[1], charPos[2]]}
          onComplete={() => {
            useAgentStore.getState().updateAgent(agent.id, {
              activeCelebration: null,
              celebrationStartedAt: null
            })
          }}
        />
      )}

      {/* Persistent office plants from commits (max 5) */}
      {Array.from({ length: Math.min(agent.commitCount, 5) }, (_, i) => (
        <OfficePlant
          key={`plant-${agent.id}-${i}`}
          position={[position[0], position[1] + 0.8, position[2]]}
          index={i}
        />
      ))}
    </>
  )
}
