# Claude CLI Orchestrator (Extraction)

Minimal orchestration layer for long-running Claude Code CLI tasks.

It provides:
- Persistent task queue in JSON
- Persistent runtime state across restarts
- Automatic retry/backoff
- Optional recurring runs
- Per-run JSONL logs from `--output-format stream-json`

## Files

- `orchestrator.mjs` - standalone runner
- `tasks.example.json` - example queue definitions

## Quick Start

1. Create a tasks file from the example:

```bash
cp examples/claude-cli-orchestrator/tasks.example.json ./tasks.json
```

2. Edit `./tasks.json` prompts and working directories.

3. Run one task attempt and exit:

```bash
node examples/claude-cli-orchestrator/orchestrator.mjs once --tasks ./tasks.json
```

4. Run continuously:

```bash
node examples/claude-cli-orchestrator/orchestrator.mjs run --tasks ./tasks.json
```

5. View status:

```bash
node examples/claude-cli-orchestrator/orchestrator.mjs status --tasks ./tasks.json
```

## Add Tasks from CLI

```bash
node examples/claude-cli-orchestrator/orchestrator.mjs add \
  --tasks ./tasks.json \
  --name "Implement settings migration" \
  --cwd /absolute/path/to/repo \
  --prompt-file /absolute/path/to/prompt.md \
  --max-attempts 4 \
  --retry-delay-ms 45000
```

## Task Schema

Each task supports:

- `id` (string, unique)
- `name` (string)
- `workingDirectory` (absolute path)
- `prompt` (string)
- `enabled` (boolean, default `true`)
- `model` (string, optional)
- `systemPrompt` (string, optional)
- `allowedTools` (string array, optional)
- `dangerouslySkipPermissions` (boolean, optional)
- `maxAttempts` (integer, default `3`)
- `retryDelayMs` (integer, default `30000`)
- `runTimeoutMs` (integer, optional, `0` disables timeout)
- `repeatDelayMs` (integer, optional, `0` means run once)
- `successRegex` (string, optional)

## State + Logs

Defaults:
- State file: `./.claude-orchestrator-state.json`
- Logs dir: `./.claude-orchestrator-logs/`

Override:

```bash
node examples/claude-cli-orchestrator/orchestrator.mjs run \
  --tasks ./tasks.json \
  --state ./ops/orchestrator-state.json \
  --logs ./ops/orchestrator-logs \
  --poll-ms 5000
```

