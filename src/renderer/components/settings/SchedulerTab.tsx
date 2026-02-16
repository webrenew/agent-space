import { Row, Section, Toggle } from './common'
import { formatDateTime, formatDuration, runStatusColor } from './utils'
import type { SchedulerTaskDraft } from './types'

const DEFAULT_CRON_EXAMPLES = ['*/15 * * * *', '0 * * * *', '0 9 * * 1-5', '30 18 * * *']

interface SchedulerTabProps {
  schedulerError: string | null
  schedulerLoading: boolean
  schedulerBusyId: string | null
  scheduleDrafts: SchedulerTaskDraft[]
  updateScheduleDraft: (taskId: string, updates: Partial<SchedulerTaskDraft>) => void
  browseScheduleDirectory: (taskId: string) => Promise<void>
  runScheduleNow: (task: SchedulerTaskDraft) => Promise<void>
  saveSchedule: (task: SchedulerTaskDraft) => Promise<void>
  removeSchedule: (task: SchedulerTaskDraft) => Promise<void>
  addScheduleDraft: () => void
}

export function SchedulerTab({
  schedulerError,
  schedulerLoading,
  schedulerBusyId,
  scheduleDrafts,
  updateScheduleDraft,
  browseScheduleDirectory,
  runScheduleNow,
  saveSchedule,
  removeSchedule,
  addScheduleDraft,
}: SchedulerTabProps) {
  return (
    <Section title="CRON TASKS">
      <div style={{ fontSize: 12, color: '#74747C', marginBottom: 8, lineHeight: 1.5 }}>
        Run Claude prompts on a cron schedule in a selected directory.
        Use five cron fields: minute hour day month weekday.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {DEFAULT_CRON_EXAMPLES.map((example) => (
          <span
            key={example}
            style={{
              fontSize: 11,
              color: '#595653',
              border: '1px solid rgba(89,86,83,0.25)',
              borderRadius: 999,
              padding: '2px 8px',
            }}
          >
            {example}
          </span>
        ))}
      </div>

      {schedulerError && (
        <div
          style={{
            marginBottom: 10,
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid rgba(196,80,80,0.4)',
            background: 'rgba(196,80,80,0.1)',
            color: '#c45050',
            fontSize: 12,
          }}
        >
          {schedulerError}
        </div>
      )}

      {schedulerLoading && (
        <div style={{ fontSize: 12, color: '#595653', marginBottom: 10 }}>
          Loading schedules...
        </div>
      )}

      {scheduleDrafts.length === 0 && !schedulerLoading && (
        <div style={{ fontSize: 12, color: '#595653', marginBottom: 10 }}>
          No schedules yet.
        </div>
      )}

      {scheduleDrafts.map((task) => {
        const busy = schedulerBusyId === task.id
        const statusColor = runStatusColor(task.lastStatus, task.isRunning)

        return (
          <div
            key={task.id}
            style={{
              border: '1px solid rgba(89,86,83,0.25)',
              borderRadius: 8,
              padding: 10,
              marginBottom: 10,
              background: 'rgba(14,14,13,0.35)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                value={task.name}
                onChange={(e) => updateScheduleDraft(task.id, { name: e.target.value })}
                placeholder="Task name"
                style={{
                  flex: 1,
                  background: 'rgba(89,86,83,0.15)',
                  border: '1px solid rgba(89,86,83,0.3)',
                  borderRadius: 6,
                  padding: '5px 8px',
                  fontSize: 13,
                  color: '#9A9692',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
              <Toggle
                checked={task.enabled}
                onChange={(enabled) => updateScheduleDraft(task.id, { enabled })}
              />
            </div>

            <Row label="Cron">
              <input
                type="text"
                value={task.cron}
                onChange={(e) => updateScheduleDraft(task.id, { cron: e.target.value })}
                placeholder="0 9 * * 1-5"
                style={{
                  width: 170,
                  background: 'rgba(89,86,83,0.15)',
                  border: '1px solid rgba(89,86,83,0.3)',
                  borderRadius: 6,
                  padding: '5px 8px',
                  fontSize: 13,
                  color: '#9A9692',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </Row>

            <Row label="Directory">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="text"
                  value={task.workingDirectory}
                  onChange={(e) => updateScheduleDraft(task.id, { workingDirectory: e.target.value })}
                  placeholder="/path/to/project"
                  style={{
                    width: 220,
                    background: 'rgba(89,86,83,0.15)',
                    border: '1px solid rgba(89,86,83,0.3)',
                    borderRadius: 6,
                    padding: '5px 8px',
                    fontSize: 13,
                    color: '#9A9692',
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
                <button
                  onClick={() => void browseScheduleDirectory(task.id)}
                  style={{
                    padding: '5px 10px',
                    fontSize: 12,
                    fontWeight: 500,
                    background: 'rgba(89,86,83,0.15)',
                    border: '1px solid rgba(89,86,83,0.3)',
                    borderRadius: 6,
                    color: '#9A9692',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Browse...
                </button>
              </div>
            </Row>

            <Row label="YOLO mode">
              <Toggle
                checked={task.yoloMode}
                onChange={(yoloMode) => updateScheduleDraft(task.id, { yoloMode })}
              />
            </Row>

            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: '#74747C', marginBottom: 4, letterSpacing: 0.8 }}>
                PROMPT
              </div>
              <textarea
                value={task.prompt}
                onChange={(e) => updateScheduleDraft(task.id, { prompt: e.target.value })}
                placeholder="What should Claude do on each run?"
                rows={4}
                style={{
                  width: '100%',
                  background: 'rgba(89,86,83,0.15)',
                  border: '1px solid rgba(89,86,83,0.3)',
                  borderRadius: 6,
                  padding: '7px 8px',
                  fontSize: 12,
                  color: '#9A9692',
                  outline: 'none',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  lineHeight: 1.45,
                }}
              />
            </div>

            <div style={{ marginTop: 8, fontSize: 11, color: '#74747C', lineHeight: 1.5 }}>
              <div>
                Status:{' '}
                <span style={{ color: statusColor, fontWeight: 600 }}>
                  {task.isRunning ? 'running' : task.lastStatus}
                </span>
              </div>
              <div>Next run: {formatDateTime(task.nextRunAt)}</div>
              <div>
                Last run: {formatDateTime(task.lastRunAt)}
                {task.lastDurationMs != null ? ` (${formatDuration(task.lastDurationMs)})` : ''}
              </div>
              {task.lastError && (
                <div style={{ color: '#c45050' }}>Last error: {task.lastError}</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
              {!task.isDraft && (
                <button
                  onClick={() => void runScheduleNow(task)}
                  disabled={busy}
                  style={{
                    padding: '5px 10px',
                    fontSize: 12,
                    fontWeight: 500,
                    background: 'rgba(84,140,90,0.14)',
                    border: '1px solid rgba(84,140,90,0.35)',
                    borderRadius: 6,
                    color: '#7fb887',
                    cursor: busy ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  Run now
                </button>
              )}
              <button
                onClick={() => void saveSchedule(task)}
                disabled={busy}
                style={{
                  padding: '5px 10px',
                  fontSize: 12,
                  fontWeight: 500,
                  background: 'rgba(89,86,83,0.15)',
                  border: '1px solid rgba(89,86,83,0.3)',
                  borderRadius: 6,
                  color: '#9A9692',
                  cursor: busy ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  opacity: busy ? 0.5 : 1,
                }}
              >
                Save task
              </button>
              <button
                onClick={() => void removeSchedule(task)}
                disabled={busy}
                style={{
                  padding: '5px 10px',
                  fontSize: 12,
                  fontWeight: 500,
                  background: 'rgba(196,80,80,0.12)',
                  border: '1px solid rgba(196,80,80,0.32)',
                  borderRadius: 6,
                  color: '#c45050',
                  cursor: busy ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  opacity: busy ? 0.5 : 1,
                }}
              >
                {task.isDraft ? 'Discard' : 'Delete'}
              </button>
            </div>
          </div>
        )
      })}

      <button
        onClick={addScheduleDraft}
        style={{
          marginTop: 4,
          padding: '5px 12px',
          fontSize: 12,
          fontWeight: 500,
          background: 'rgba(89,86,83,0.15)',
          border: '1px solid rgba(89,86,83,0.3)',
          borderRadius: 6,
          color: '#9A9692',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        + Add Schedule
      </button>
    </Section>
  )
}
