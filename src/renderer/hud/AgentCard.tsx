import { useAgentStore } from '../store/agents'
import { AGENT_COLORS, STATUS_LABELS } from '../types'

export function AgentCard() {
  const selectedId = useAgentStore((s) => s.selectedAgentId)
  const agent = useAgentStore((s) => s.agents.find((a) => a.id === selectedId))
  const selectAgent = useAgentStore((s) => s.selectAgent)

  if (!agent) return null

  const color = AGENT_COLORS[agent.agent_type]
  const uptime = Math.floor((Date.now() - agent.started_at) / 1000)
  const uptimeStr =
    uptime >= 3600
      ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
      : uptime >= 60
        ? `${Math.floor(uptime / 60)}m ${uptime % 60}s`
        : `${uptime}s`

  return (
    <div className="absolute left-4 bottom-4 w-80 bg-black/80 backdrop-blur-md rounded-xl border border-white/15 p-4 text-white pointer-events-auto">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <h3 className="font-semibold text-base">{agent.name}</h3>
          </div>
          <span className="text-xs text-white/50 uppercase tracking-wider">
            {agent.agent_type}
          </span>
        </div>
        <button
          onClick={() => selectAgent(null)}
          className="text-white/40 hover:text-white transition-colors text-lg leading-none cursor-pointer"
        >
          x
        </button>
      </div>

      <div
        className="inline-flex px-2 py-0.5 rounded text-xs font-medium mb-3"
        style={{
          backgroundColor: statusColor(agent.status) + '22',
          color: statusColor(agent.status)
        }}
      >
        {STATUS_LABELS[agent.status]}
      </div>

      <div className="space-y-2 text-sm">
        <Row label="Task" value={agent.currentTask} />
        <Row label="Model" value={agent.model} />
        <Row label="Tokens In" value={agent.tokens_input.toLocaleString()} />
        <Row label="Tokens Out" value={agent.tokens_output.toLocaleString()} />
        <Row label="Files Modified" value={String(agent.files_modified)} />
        <Row label="Uptime" value={uptimeStr} />
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-white/50">{label}</span>
      <span className="font-mono text-white/90 text-right max-w-[60%] truncate">
        {value}
      </span>
    </div>
  )
}

function statusColor(status: string): string {
  switch (status) {
    case 'streaming':
      return '#60a5fa'
    case 'thinking':
      return '#c084fc'
    case 'tool_calling':
      return '#fbbf24'
    case 'error':
      return '#ef4444'
    case 'done':
      return '#4ade80'
    case 'waiting':
      return '#9ca3af'
    default:
      return '#6b7280'
  }
}
