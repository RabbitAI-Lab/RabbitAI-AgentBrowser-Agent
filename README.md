# @rabbitai-lab/agent-browser-agent

Agent Browser Agent for RabbitAI - a standalone Socket.IO server that receives browser commands from the SDK and executes them through pluggable engines.

## Installation

```bash
npm install @rabbitai-lab/agent-browser-agent
```

## Quick Start

### CLI Usage

```bash
# Install globally
npm install -g @rabbitai-lab/agent-browser-agent

# Local development mode (no auth)
agent-browser-agent --no-auth --debug

# Remote mode with token authentication
agent-browser-agent --port 3100 --rabbitai-url https://rabbitai.example.com

# Load custom engines
agent-browser-agent --no-auth --engine-dir ./my-engines

# Using environment variables
PORT=3200 RABBITAI_SERVER_URL=https://rabbitai.example.com agent-browser-agent
```

### CLI Options

| Option | Env Variable | Default | Description |
|--------|-------------|---------|-------------|
| `-p, --port <port>` | `PORT` | `3100` | Listen port |
| `--no-auth` | `NO_AUTH=true` | - | Skip authentication (local dev mode) |
| `--rabbitai-url <url>` | `RABBITAI_SERVER_URL` | - | RabbitAI server URL for token verification |
| `--engine-dir <dir>` | - | - | Custom engine directory to load |
| `-d, --debug` | - | `false` | Enable debug logging |
| `-h, --help` | - | - | Show help |
| `-v, --version` | - | - | Show version |

### Programmatic Usage

```typescript
import { AgentBrowserAgent } from '@rabbitai-lab/agent-browser-agent';

const agent = new AgentBrowserAgent({
  port: 3100,
  noAuth: true,       // Local mode - skip auth
  debug: true,
});

// Or with token auth (remote mode)
const agent = new AgentBrowserAgent({
  port: 3100,
  rabbitaiServerUrl: 'https://rabbitai.example.com',
});

await agent.start();

// Graceful shutdown
process.on('SIGINT', async () => {
  await agent.stop();
  process.exit(0);
});
```

## Custom Engines

You can create and register custom engines to handle different command types:

### Creating an Engine

```typescript
// my-engine.js
import { Engine } from '@rabbitai-lab/agent-browser-agent';

class MyCustomEngine {
  name = 'my-engine';

  async execute(command, onStream) {
    onStream('Processing...');
    // Your custom logic here
    return { data: `Result for: ${command}` };
  }

  async close() {
    // Cleanup resources
  }
}

export default MyCustomEngine;
```

### Loading Custom Engines via CLI

```bash
agent-browser-agent --no-auth --engine-dir ./engines
```

All `.js` and `.mjs` files in the directory will be loaded automatically. Each file must export an Engine class (default export or named `Engine` export).

### Registering Engines Programmatically

```typescript
import { AgentBrowserAgent } from '@rabbitai-lab/agent-browser-agent';
import type { Engine } from '@rabbitai-lab/agent-browser-agent';

class MyEngine implements Engine {
  name = 'my-engine';
  async execute(command: string, onStream: (data: string) => void) {
    return { data: 'result' };
  }
  async close() {}
}

const agent = new AgentBrowserAgent({ noAuth: true });
agent.registerEngine(new MyEngine());
await agent.start();
```

## API Reference

### `AgentBrowserAgent`

#### Constructor

```typescript
new AgentBrowserAgent(options?: AgentOptions)
```

#### `registerEngine(engine: Engine): void`

Register a custom engine.

#### `start(): Promise<void>`

Start the Socket.IO server.

#### `stop(): Promise<void>`

Stop the server and close all engines.

#### `isRunning(): boolean`

Check if the server is running.

### Types

```typescript
interface AgentOptions {
  port?: number;                // Listen port (default: 3100)
  rabbitaiServerUrl?: string;   // RabbitAI server URL for token verification
  noAuth?: boolean;             // Skip auth (default: false)
  debug?: boolean;              // Enable debug logging
}

interface Engine {
  name: string;
  execute(
    command: string,
    onStream: (data: string) => void,
  ): Promise<{ data: string; error?: string }>;
  close(): Promise<void>;
}
```

## Authentication

### Local Mode (`--no-auth`)

All connections are accepted without authentication. Use this for local development only.

### Remote Mode (`--rabbitai-url`)

Token-based authentication via RabbitAI server. The agent verifies tokens by calling `${rabbitaiServerUrl}/api/auth/profile` with the provided Bearer token. Connections with invalid or expired tokens are rejected.

## Related Packages

- [@rabbitai-lab/agent-browser-sdk](https://www.npmjs.com/package/@rabbitai-lab/agent-browser-sdk) - The SDK client that connects to this agent

## License

MIT
