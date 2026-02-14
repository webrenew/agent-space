import { useCallback, useMemo } from 'react'
import { useAgentStore } from '../store/agents'
import type { CelebrationType } from '../types'

interface ActionButton {
  id: CelebrationType
  label: string
  note: string
  accent: string
}

const ACTIONS: ActionButton[] = [
  {
    id: 'pizza_party',
    label: 'Pizza Party',
    note: 'Late-night deploy fuel',
    accent: '#fbbf24',
  },
  {
    id: 'floppy_rain',
    label: 'Floppy Rain',
    note: '3.5-inch victory storm',
    accent: '#60a5fa',
  },
  {
    id: 'dialup_wave',
    label: 'Dial-Up Wave',
    note: 'Handshake complete',
    accent: '#a78bfa',
  },
  {
    id: 'fax_blast',
    label: 'Fax Blast',
    note: 'Paper tray overclocked',
    accent: '#34d399',
  },
]

export function CelebrationDeck() {
  const agents = useAgentStore((s) => s.agents)
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId)
  const updateAgent = useAgentStore((s) => s.updateAgent)
  const addToast = useAgentStore((s) => s.addToast)
  const addEvent = useAgentStore((s) => s.addEvent)

  const primaryAgents = useMemo(
    () => agents.filter((agent) => !agent.isSubagent),
    [agents]
  )
  const selectedPrimaryAgent = primaryAgents.find((agent) => agent.id === selectedAgentId) ?? null

  const triggerAction = useCallback((action: ActionButton) => {
    const targets = selectedPrimaryAgent ? [selectedPrimaryAgent] : primaryAgents
    if (targets.length === 0) {
      addToast({ type: 'info', message: 'No active agents in the office yet.' })
      return
    }

    const baseTs = Date.now()
    for (let index = 0; index < targets.length; index += 1) {
      const agent = targets[index]
      updateAgent(agent.id, {
        activeCelebration: action.id,
        celebrationStartedAt: baseTs + index * 60,
      })
      addEvent({
        agentId: agent.id,
        agentName: agent.name,
        type: 'status_change',
        description: `Manual celebration: ${action.label}`,
      })
    }

    addToast({
      type: 'success',
      message: selectedPrimaryAgent
        ? `${selectedPrimaryAgent.name}: ${action.label}`
        : `${action.label} launched for ${targets.length} agents`,
    })
  }, [addEvent, addToast, primaryAgents, selectedPrimaryAgent, updateAgent])

  return (
    <div
      className="celebration-deck"
      style={{
        position: 'absolute',
        top: 44,
        right: 12,
        width: 230,
        borderRadius: 10,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
          fontSize: 10,
          letterSpacing: 1,
          color: '#9A9692',
          textTransform: 'uppercase',
        }}
      >
        <span>Party Deck</span>
        <span style={{ color: '#595653' }}>
          {selectedPrimaryAgent ? `target ${selectedPrimaryAgent.name}` : 'target all'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => triggerAction(action)}
            className="celebration-btn"
            style={{
              border: `1px solid ${action.accent}55`,
              borderRadius: 7,
              background: 'rgba(10, 14, 12, 0.7)',
              color: '#9A9692',
              padding: '7px 9px',
              textAlign: 'left',
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
            title={action.note}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 1,
                  background: action.accent,
                  boxShadow: `0 0 8px ${action.accent}88`,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#d6d2cd' }}>{action.label}</span>
            </div>
            <div style={{ marginTop: 2, fontSize: 10, color: '#7f7a74' }}>{action.note}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

