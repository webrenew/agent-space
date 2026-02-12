import { useEffect } from 'react'
import { useAgentStore } from '../store/agents'

export function ToastStack() {
  const toasts = useAgentStore((s) => s.toasts)
  const removeToast = useAgentStore((s) => s.removeToast)

  return (
    <div className="absolute right-4 bottom-4 flex flex-col gap-2 pointer-events-auto">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} id={toast.id} message={toast.message} type={toast.type} onRemove={removeToast} />
      ))}
    </div>
  )
}

function ToastItem({
  id,
  message,
  type,
  onRemove
}: {
  id: string
  message: string
  type: 'info' | 'error' | 'success'
  onRemove: (id: string) => void
}) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(id), 4000)
    return () => clearTimeout(timer)
  }, [id, onRemove])

  const borderColor =
    type === 'error' ? 'border-red-500/40' : type === 'success' ? 'border-green-500/40' : 'border-blue-500/40'
  const iconColor =
    type === 'error' ? 'text-red-400' : type === 'success' ? 'text-green-400' : 'text-blue-400'

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 bg-black/80 backdrop-blur-md rounded-lg border ${borderColor} text-white text-sm min-w-[240px] animate-in`}
    >
      <span className={`text-xs ${iconColor}`}>
        {type === 'error' ? '!' : type === 'success' ? '+' : '>'}
      </span>
      <span className="text-white/90">{message}</span>
    </div>
  )
}
