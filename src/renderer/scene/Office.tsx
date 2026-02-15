import { useMemo } from 'react'
import { OrbitControls } from '@react-three/drei'
import { Room } from './Room'
import { Lighting } from './Lighting'
import { Desk } from './Desk'
import { AgentCharacter } from './AgentCharacter'
import { OfficeCat } from './OfficeCat'
import { useAgentStore } from '../store/agents'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspaceIntelligenceStore } from '../store/workspaceIntelligence'
import { OfficeSignals } from './OfficeSignals'
import { PizzaParty } from './effects/PizzaParty'

const COLS = 2
const X_SPACING = 3.0
const Z_SPACING = 3.5
const X_OFFSET = -1.0
const Z_OFFSET = -2.0
const DESK_FACING_Y = Math.PI
const PARTY_CENTER: [number, number, number] = [4.2, 0, 2.2]
const PARTY_RADIUS = 1.25

function computeDeskPosition(index: number): [number, number, number] {
  const col = index % COLS
  const row = Math.floor(index / COLS)
  return [X_OFFSET + col * X_SPACING, 0, Z_OFFSET + row * Z_SPACING]
}

function computePartySeatPosition(index: number, total: number): [number, number, number] {
  const count = Math.max(3, total)
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2
  return [
    PARTY_CENTER[0] + Math.cos(angle) * PARTY_RADIUS,
    0,
    PARTY_CENTER[2] + Math.sin(angle) * PARTY_RADIUS,
  ]
}

export function Office() {
  const agents = useAgentStore((s) => s.agents)
  const chatSessions = useAgentStore((s) => s.chatSessions)
  const activeChatSessionId = useAgentStore((s) => s.activeChatSessionId)
  const workspaceRoot = useWorkspaceStore((s) => s.rootPath)
  const snapshots = useWorkspaceIntelligenceStore((s) => s.snapshots)
  const rewards = useWorkspaceIntelligenceStore((s) => s.rewards)

  // Show only primary chat/terminal agents in Office.
  const deskAgents = useMemo(() => agents.filter((a) => !a.isSubagent), [agents])

  const activeWorkspaceDirectory = useMemo(() => {
    const activeChat = chatSessions.find((session) => session.id === activeChatSessionId) ?? null
    return activeChat?.workingDirectory ?? workspaceRoot ?? null
  }, [activeChatSessionId, chatSessions, workspaceRoot])

  const scopedRewards = useMemo(() => {
    if (!activeWorkspaceDirectory) return rewards
    return rewards.filter((reward) => reward.workspaceDirectory === activeWorkspaceDirectory)
  }, [activeWorkspaceDirectory, rewards])

  const latestReward = scopedRewards[scopedRewards.length - 1] ?? null
  const recentRewards = scopedRewards.slice(-10)
  const successCount = recentRewards.filter((reward) => reward.status === 'success').length
  const successRate = recentRewards.length > 0 ? successCount / recentRewards.length : 0
  const activeSnapshot = activeWorkspaceDirectory ? snapshots[activeWorkspaceDirectory] : undefined
  const contextCoverage = latestReward
    ? latestReward.contextScore
    : Math.min(1, (activeSnapshot?.keyFiles.length ?? 0) / 8)
  const contextFiles = latestReward?.contextFiles ?? activeSnapshot?.keyFiles.length ?? 0
  const dirtyFiles = activeSnapshot?.gitDirtyFiles ?? 0

  // Only show desks for active desk agents — no empty desks
  const maxIndex = deskAgents.length > 0 ? Math.max(...deskAgents.map((a) => a.deskIndex)) : -1
  const deskCount = deskAgents.length > 0 ? Math.max(deskAgents.length, maxIndex + 1) : 0

  const deskSlots = useMemo(() => {
    return Array.from({ length: deskCount }, (_, i) => ({
      index: i,
      position: computeDeskPosition(i)
    }))
  }, [deskCount])
  const partyAgents = useMemo(
    () => deskAgents
      .filter((agent) => agent.activeCelebration === 'pizza_party')
      .sort((a, b) => a.deskIndex - b.deskIndex),
    [deskAgents]
  )
  const partySeatByAgentId = useMemo(() => {
    const map = new Map<string, [number, number, number]>()
    for (let index = 0; index < partyAgents.length; index += 1) {
      map.set(
        partyAgents[index].id,
        computePartySeatPosition(index, partyAgents.length)
      )
    }
    return map
  }, [partyAgents])
  const partyWaveKey = partyAgents.reduce(
    (latest, agent) => Math.max(latest, agent.celebrationStartedAt ?? 0),
    0
  )

  return (
    <>
      <Lighting />
      <Room />

      {deskSlots.map(({ index, position }) => {
        const agent = deskAgents.find((a) => a.deskIndex === index)
        return (
          <group key={index}>
            <Desk
              position={position}
              status={agent?.status ?? 'idle'}
              tokensUsed={(agent?.tokens_input ?? 0) + (agent?.tokens_output ?? 0)}
            />
            {agent && (
              <AgentCharacter
                agent={agent}
                position={position}
                facingY={DESK_FACING_Y}
                partySeatPosition={partySeatByAgentId.get(agent.id) ?? null}
                partyLookAtPosition={PARTY_CENTER}
              />
            )}
          </group>
        )
      })}

      {partyAgents.length > 0 && (
        <group>
          {/* Pizza table where agents gather during a party */}
          <mesh position={[PARTY_CENTER[0], 0.72, PARTY_CENTER[2]]} castShadow receiveShadow>
            <cylinderGeometry args={[0.95, 0.95, 0.06, 24]} />
            <meshStandardMaterial color="#6b4a35" roughness={0.55} />
          </mesh>
          <mesh position={[PARTY_CENTER[0], 0.38, PARTY_CENTER[2]]} castShadow>
            <cylinderGeometry args={[0.11, 0.16, 0.72, 10]} />
            <meshStandardMaterial color="#4a3728" />
          </mesh>
          <mesh position={[PARTY_CENTER[0], 0.02, PARTY_CENTER[2]]}>
            <cylinderGeometry args={[0.45, 0.45, 0.04, 14]} />
            <meshStandardMaterial color="#4a3728" />
          </mesh>

          {/* Party spread */}
          <mesh position={[PARTY_CENTER[0] - 0.2, 0.77, PARTY_CENTER[2] - 0.06]} castShadow>
            <boxGeometry args={[0.46, 0.035, 0.46]} />
            <meshStandardMaterial color="#c87830" roughness={0.8} />
          </mesh>
          <mesh position={[PARTY_CENTER[0] + 0.16, 0.79, PARTY_CENTER[2] + 0.03]} castShadow>
            <cylinderGeometry args={[0.19, 0.19, 0.02, 24]} />
            <meshStandardMaterial color="#f4d03f" roughness={0.58} />
          </mesh>
          {Array.from({ length: 6 }, (_, index) => {
            const angle = (index / 6) * Math.PI * 2
            return (
              <mesh
                key={`party-slice-${index}`}
                position={[
                  PARTY_CENTER[0] + 0.16 + Math.cos(angle) * 0.09,
                  0.805,
                  PARTY_CENTER[2] + 0.03 + Math.sin(angle) * 0.09,
                ]}
                rotation={[0, -angle, 0]}
              >
                <boxGeometry args={[0.075, 0.008, 0.03]} />
                <meshStandardMaterial color="#c45050" />
              </mesh>
            )
          })}

          {/* Party accent lights */}
          <pointLight
            position={[PARTY_CENTER[0] - 1.1, 2.4, PARTY_CENTER[2] - 0.7]}
            color="#fbbf24"
            intensity={0.45}
            distance={5.2}
          />
          <pointLight
            position={[PARTY_CENTER[0] + 1.2, 2.2, PARTY_CENTER[2] + 0.8]}
            color="#fb7185"
            intensity={0.32}
            distance={4.8}
          />

          <PizzaParty
            key={`pizza-party-${partyWaveKey}`}
            position={[PARTY_CENTER[0], -0.55, PARTY_CENTER[2]]}
            onComplete={() => undefined}
          />
        </group>
      )}

      <OfficeCat />

      {/* Filing cabinet near back wall */}
      <mesh position={[4.5, 0.5, -5.5]} castShadow>
        <boxGeometry args={[0.8, 1, 0.5]} />
        <meshStandardMaterial color="#6b7280" metalness={0.3} roughness={0.7} />
      </mesh>
      <mesh position={[4.5, 0.25, -5.25]}>
        <boxGeometry args={[0.6, 0.08, 0.02]} />
        <meshStandardMaterial color="#9ca3af" />
      </mesh>
      <mesh position={[4.5, 0.75, -5.25]}>
        <boxGeometry args={[0.6, 0.08, 0.02]} />
        <meshStandardMaterial color="#9ca3af" />
      </mesh>

      {/* Water cooler */}
      <group position={[-5.5, 0, 3]}>
        <mesh position={[0, 0.4, 0]} castShadow>
          <boxGeometry args={[0.3, 0.8, 0.3]} />
          <meshStandardMaterial color="#e5e7eb" />
        </mesh>
        <mesh position={[0, 0.9, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.3, 8]} />
          <meshStandardMaterial color="#93c5fd" transparent opacity={0.7} />
        </mesh>
      </group>

      {/* Whiteboard on back wall */}
      <mesh position={[3, 2.8, -6.85]}>
        <boxGeometry args={[2.5, 1.5, 0.05]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[3, 2.8, -6.82]}>
        <boxGeometry args={[2.3, 1.3, 0.02]} />
        <meshStandardMaterial color="#fff" />
      </mesh>

      <OfficeSignals
        contextCoverage={contextCoverage}
        rewardScore={latestReward?.rewardScore ?? null}
        successRate={successRate}
        contextFiles={contextFiles}
        dirtyFiles={dirtyFiles}
      />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minDistance={3}
        maxDistance={20}
        maxPolarAngle={Math.PI / 2.1}
        target={[0, 1, 0]}
      />
    </>
  )
}
