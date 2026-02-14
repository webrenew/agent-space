# Renderer Plugin SDK

Agent Space can load renderer plugins from the `pluginDirs` configured in **Settings > General > Claude Profiles**.

## Discovery

Each directory is scanned for plugin manifests in this order:

1. `agent-space.plugin.json`
2. `openclaw.plugin.json`
3. `package.json` (with plugin hints like `agentSpace.rendererEntry`, `openclaw.rendererEntry`, `openclaw.extensions`, or plugin keywords)

## Minimal Manifest

```json
{
  "id": "hello-plugin",
  "name": "Hello Plugin",
  "version": "0.1.0",
  "rendererEntry": "./index.mjs"
}
```

## Plugin Entry API

Your `rendererEntry` module must export `default register(api)` (or named `register(api)`).

```js
export default function register(api) {
  const disposeHook = api.registerHook('session_start', (payload) => {
    api.log('info', 'session_start', payload)
  })

  const disposeCommand = api.registerCommand({
    name: 'hello',
    description: 'Reply from plugin',
    execute: (context) => `hello from ${context.workspaceDirectory ?? 'no-dir'}`,
  })

  const disposeTransform = api.registerPromptTransformer({
    transform: (context) => {
      if (context.workspaceDirectory?.includes('/demo')) {
        return { prompt: `${context.prompt}\n\n[plugin note: demo workspace]` }
      }
    },
  })

  return () => {
    disposeHook()
    disposeCommand()
    disposeTransform()
  }
}
```

### `api.registerHook(event, handler, options?)`

Supported events:
- `before_agent_start`
- `agent_end`
- `session_start`
- `session_end`
- `message_received`
- `message_sending`
- `message_sent`
- `before_tool_call`
- `after_tool_call`
- `tool_result_persist`

`session_start` and `session_end` are kept for backwards compatibility with earlier Agent Space plugins.

### `api.registerCommand({ name, description?, execute })`

Registers slash commands in chat input, for example `/hello`.

### `api.registerPromptTransformer({ transform }, options?)`

Runs before Claude execution. The transformer can:
- return a new prompt string,
- return `{ prompt }` to replace prompt,
- return `{ cancel: true, error?: string }` to block the run.

### `api.log(level, event, payload?)`

Writes plugin-scoped renderer diagnostics.

## Built-in Runtime Commands

- `/plugins` shows loaded plugins and commands.
- `/plugins reload` rescans plugin dirs.
- `/plugins-reload` rescans plugin dirs.
