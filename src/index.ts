/**
 * Agent Browser Agent for RabbitAI
 *
 * 独立的 Socket.IO 服务器，接收 SDK 的浏览器操作指令，通过可插拔引擎执行
 */

export { AgentBrowserAgent } from './agent';

export { EngineRegistry } from './engine-registry';

export { AgentBrowserEngine } from './engines/agent-browser-engine';
export type { AgentBrowserEngineOptions } from './engines/agent-browser-engine';

export type {
  AgentOptions,
  Engine,
  ExecutePayload,
  ResultPayload,
  ExecuteBatchPayload,
  BatchResultPayload,
  BatchCompletePayload,
  ConnectedPayload,
} from './types';
