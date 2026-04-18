/**
 * Agent Browser Agent 类型定义
 */

/**
 * Agent 服务器选项
 */
export interface AgentOptions {
  /** 监听端口，默认 3100 */
  port?: number;
  /**
   * RabbitAI 服务器地址，用于远程模式下验证 Token
   * 例如: https://rabbitai.example.com
   * 当 noAuth=false 时必填，Agent 会调用 ${rabbitaiServerUrl}/api/auth/profile 验证 Token
   */
  rabbitaiServerUrl?: string;
  /** 是否跳过认证（本地模式），默认 false */
  noAuth?: boolean;
  /** 调试模式 */
  debug?: boolean;
}

/**
 * 引擎接口 - 所有执行引擎必须实现此接口
 */
export interface Engine {
  /** 引擎名称标识符，如 'agent-browser' */
  name: string;
  /**
   * 执行单条指令
   * @param command 原始指令文本
   * @param onStream 流式结果回调，用于实时推送中间输出
   * @returns 最终执行结果
   */
  execute(
    command: string,
    onStream: (data: string) => void,
  ): Promise<{ data: string; error?: string }>;
  /** 关闭引擎，释放资源 */
  close(): Promise<void>;
}

/**
 * 单条指令 payload（SDK → Agent）
 */
export interface ExecutePayload {
  requestId: string;
  type: string;
  command: string;
}

/**
 * 结果 payload（Agent → SDK，流式）
 */
export interface ResultPayload {
  requestId: string;
  data: string;
  done: boolean;
  error?: string;
}

/**
 * 批量执行 payload（SDK → Agent）
 */
export interface ExecuteBatchPayload {
  batchId: string;
  type: string;
  commands: string[];
}

/**
 * 批量结果 payload（Agent → SDK，每条指令完成时发送）
 */
export interface BatchResultPayload {
  batchId: string;
  index: number;
  requestId: string;
  data: string;
  done: boolean;
  error?: string;
}

/**
 * 批量完成 payload（Agent → SDK）
 */
export interface BatchCompletePayload {
  batchId: string;
  totalCommands: number;
  successCount: number;
  failedCount: number;
}

/**
 * 连接确认 payload（Agent → SDK）
 */
export interface ConnectedPayload {
  connectionId: string;
  browserReady: boolean;
}
