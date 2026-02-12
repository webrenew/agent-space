import { useAgentStore } from '../store/agents'

export function StatsBar() {
  const agents = useAgentStore((s) => s.agents)

  const activeCount = agents.filter(
    (a) => a.status !== 'idle' && a.status !== 'done'
  ).length
  const totalTokensIn = agents.reduce((s, a) => s + a.tokens_input, 0)
  const totalTokensOut = agents.reduce((s, a) => s + a.tokens_output, 0)
  const totalFiles = agents.reduce((s, a) => s + a.files_modified, 0)

  // Rough cost estimate: $3/M input, $15/M output (Claude Sonnet range)
  const cost = (totalTokensIn * 3 + totalTokensOut * 15) / 1_000_000

  return (
    <div className="flex items-center gap-6 px-5 py-2.5 bg-black/60 backdrop-blur-sm rounded-b-xl border border-white/10 border-t-0 text-white text-sm">
      <Stat label="Active" value={activeCount} color="#4ade80" />
      <Stat label="Tokens In" value={formatNum(totalTokensIn)} />
      <Stat label="Tokens Out" value={formatNum(totalTokensOut)} />
      <Stat label="Files" value={totalFiles} />
      <Stat label="Est. Cost" value={`$${cost.toFixed(3)}`} color="#fbbf24" />
    </div>
  )
}

function Stat({
  label,
  value,
  color
}: {
  label: string
  value: string | number
  color?: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-white/50 text-xs uppercase tracking-wider">{label}</span>
      <span className="font-mono font-semibold" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  )
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
