import { Row, Section, Toggle } from './common'
import { formatDateTime, formatDuration, runStatusColor } from './utils'
import type { TodoRunnerJobDraft } from './types'

interface TodoRunnerTabProps {
  todoRunnerError: string | null
  todoRunnerLoading: boolean
  todoRunnerBusyId: string | null
  todoRunnerDrafts: TodoRunnerJobDraft[]
  updateTodoRunnerDraft: (jobId: string, updates: Partial<TodoRunnerJobDraft>) => void
  browseTodoRunnerDirectory: (jobId: string) => Promise<void>
  startTodoRunnerJob: (job: TodoRunnerJobDraft) => Promise<void>
  pauseTodoRunnerJob: (job: TodoRunnerJobDraft) => Promise<void>
  resetTodoRunnerJob: (job: TodoRunnerJobDraft) => Promise<void>
  saveTodoRunnerJob: (job: TodoRunnerJobDraft) => Promise<void>
  removeTodoRunnerJob: (job: TodoRunnerJobDraft) => Promise<void>
  addTodoRunnerDraft: () => void
}

export function TodoRunnerTab({
  todoRunnerError,
  todoRunnerLoading,
  todoRunnerBusyId,
  todoRunnerDrafts,
  updateTodoRunnerDraft,
  browseTodoRunnerDirectory,
  startTodoRunnerJob,
  pauseTodoRunnerJob,
  resetTodoRunnerJob,
  saveTodoRunnerJob,
  removeTodoRunnerJob,
  addTodoRunnerDraft,
}: TodoRunnerTabProps) {
  return (
    <Section title="TODO RUNNER">
      <div style={{ fontSize: 12, color: '#74747C', marginBottom: 8, lineHeight: 1.5 }}>
        Run a large todo list sequentially until complete using an external runner command.
        This is designed for Agent SDK workers (without Claude Code CLI coupling).
      </div>
      <div style={{ fontSize: 11, color: '#595653', marginBottom: 10, lineHeight: 1.5 }}>
        Runner contract: receives JSON payload on <code>stdin</code> and env vars
        {' '}<code>AGENT_SPACE_TODO_PAYLOAD</code>, <code>AGENT_SPACE_TODO_TEXT</code>,
        {' '}<code>AGENT_SPACE_TODO_INDEX</code>, <code>AGENT_SPACE_TODO_TOTAL</code>.
      </div>

      {todoRunnerError && (
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
          {todoRunnerError}
        </div>
      )}

      {todoRunnerLoading && (
        <div style={{ fontSize: 12, color: '#595653', marginBottom: 10 }}>
          Loading todo runs...
        </div>
      )}

      {todoRunnerDrafts.length === 0 && !todoRunnerLoading && (
        <div style={{ fontSize: 12, color: '#595653', marginBottom: 10 }}>
          No todo runs yet.
        </div>
      )}

      {todoRunnerDrafts.map((job) => {
        const busy = todoRunnerBusyId === job.id
        const statusColor = runStatusColor(job.lastStatus, job.isRunning)

        return (
          <div
            key={job.id}
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
                value={job.name}
                onChange={(e) => updateTodoRunnerDraft(job.id, { name: e.target.value })}
                placeholder="Todo run name"
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
                checked={job.enabled}
                onChange={(enabled) => updateTodoRunnerDraft(job.id, { enabled })}
              />
            </div>

            <Row label="Directory">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="text"
                  value={job.workingDirectory}
                  onChange={(e) => updateTodoRunnerDraft(job.id, { workingDirectory: e.target.value })}
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
                  onClick={() => void browseTodoRunnerDirectory(job.id)}
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

            <Row label="Runner command">
              <input
                type="text"
                value={job.runnerCommand}
                onChange={(e) => updateTodoRunnerDraft(job.id, { runnerCommand: e.target.value })}
                placeholder="python3 /path/to/agent_sdk_worker.py"
                style={{
                  width: 320,
                  background: 'rgba(89,86,83,0.15)',
                  border: '1px solid rgba(89,86,83,0.3)',
                  borderRadius: 6,
                  padding: '5px 8px',
                  fontSize: 12,
                  color: '#9A9692',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </Row>

            <Row label="YOLO mode">
              <Toggle
                checked={job.yoloMode}
                onChange={(yoloMode) => updateTodoRunnerDraft(job.id, { yoloMode })}
              />
            </Row>

            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: '#74747C', marginBottom: 4, letterSpacing: 0.8 }}>
                GLOBAL PROMPT
              </div>
              <textarea
                value={job.prompt}
                onChange={(e) => updateTodoRunnerDraft(job.id, { prompt: e.target.value })}
                placeholder="Instructions applied to every todo item run"
                rows={3}
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

            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: '#74747C', marginBottom: 4, letterSpacing: 0.8 }}>
                TODO ITEMS (one per line)
              </div>
              <textarea
                value={job.todoItemsText}
                onChange={(e) => updateTodoRunnerDraft(job.id, { todoItemsText: e.target.value })}
                placeholder="Todo #1&#10;Todo #2&#10;Todo #3"
                rows={8}
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
                  {job.isRunning ? 'running' : job.lastStatus}
                </span>
              </div>
              <div>
                Progress: {job.completedTodos}/{job.totalTodos} complete
                {job.failedTodos > 0 ? `, ${job.failedTodos} failed` : ''}
                {job.blockedTodos > 0 ? `, ${job.blockedTodos} blocked` : ''}
              </div>
              <div>
                Current todo: {job.currentTodoIndex != null ? String(job.currentTodoIndex + 1) : 'None'}
              </div>
              <div>Next todo: {job.nextTodoText ?? 'None'}</div>
              <div>
                Last run: {formatDateTime(job.lastRunAt)}
                {job.lastDurationMs != null ? ` (${formatDuration(job.lastDurationMs)})` : ''}
              </div>
              {job.lastError && (
                <div style={{ color: '#c45050' }}>Last error: {job.lastError}</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
              {!job.isDraft && (
                <>
                  <button
                    onClick={() => void startTodoRunnerJob(job)}
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
                    Start
                  </button>
                  <button
                    onClick={() => void pauseTodoRunnerJob(job)}
                    disabled={busy}
                    style={{
                      padding: '5px 10px',
                      fontSize: 12,
                      fontWeight: 500,
                      background: 'rgba(212,160,64,0.12)',
                      border: '1px solid rgba(212,160,64,0.35)',
                      borderRadius: 6,
                      color: '#d4a040',
                      cursor: busy ? 'default' : 'pointer',
                      fontFamily: 'inherit',
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    Pause
                  </button>
                  <button
                    onClick={() => void resetTodoRunnerJob(job)}
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
                    Reset Progress
                  </button>
                </>
              )}
              <button
                onClick={() => void saveTodoRunnerJob(job)}
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
                Save
              </button>
              <button
                onClick={() => void removeTodoRunnerJob(job)}
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
                {job.isDraft ? 'Discard' : 'Delete'}
              </button>
            </div>
          </div>
        )
      })}

      <button
        onClick={addTodoRunnerDraft}
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
        + Add Todo Run
      </button>
    </Section>
  )
}
