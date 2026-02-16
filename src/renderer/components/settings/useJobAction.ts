import { useCallback, type Dispatch, type SetStateAction } from 'react'

interface JobWithId {
  id: string
}

interface UseJobActionOptions {
  setBusyId: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
  reload: () => Promise<void>
}

export function useJobAction<T extends JobWithId>({
  setBusyId,
  setError,
  reload,
}: UseJobActionOptions): (entry: T, action: () => Promise<void>) => Promise<void> {
  return useCallback(async (entry: T, action: () => Promise<void>) => {
    try {
      setBusyId(entry.id)
      setError(null)
      await action()
      await reload()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setBusyId(null)
    }
  }, [reload, setBusyId, setError])
}
