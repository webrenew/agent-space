import { StatsBar } from './StatsBar'
import { AgentCard } from './AgentCard'
import { ToastStack } from './Toast'
import { CelebrationDeck } from './CelebrationDeck'

export function HUD() {
  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {/* Top bar */}
      <div className="flex justify-center pt-0 pointer-events-auto">
        <StatsBar />
      </div>

      {/* Agent detail card */}
      <AgentCard />

      {/* Manual office celebrations */}
      <CelebrationDeck />

      {/* Toast notifications */}
      <ToastStack />
    </div>
  )
}
