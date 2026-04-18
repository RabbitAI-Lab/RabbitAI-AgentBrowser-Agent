/**
 * Agent Browser Agent - 接收 SDK 指令并通过可插拔引擎执行
 */

import http from 'http';
import https from 'https';
import { Server as HttpServer, createServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { EngineRegistry } from './engine-registry';
import { AgentBrowserEngine } from './engines/agent-browser-engine';
import type {
  AgentOptions,
  Engine,
  ExecutePayload,
  ResultPayload,
  ExecuteBatchPayload,
  BatchResultPayload,
  BatchCompletePayload,
  ConnectedPayload,
} from './types';

export class AgentBrowserAgent {
  private options: AgentOptions;
  private httpServer: HttpServer;
  private io: SocketIOServer;
  private engineRegistry: EngineRegistry;
  private running = false;

  constructor(options: AgentOptions = {}) {
    this.options = options;
    this.httpServer = createServer();
    this.io = new SocketIOServer(this.httpServer, {
      cors: { origin: '*' },
      transports: ['websocket'],
    });
    this.engineRegistry = new EngineRegistry();

    // 注册默认引擎
    this.engineRegistry.register(new AgentBrowserEngine());
  }

  /**
   * 注册自定义引擎
   */
  registerEngine(engine: Engine): void {
    this.engineRegistry.register(engine);
  }

  /**
   * 启动 Agent 服务器
   */
  async start(): Promise<void> {
    if (this.running) return;

    const port = this.options.port || 3100;

    this.setupConnectionHandler();

    await new Promise<void>((resolve, reject) => {
      this.httpServer.listen(port, () => {
        this.running = true;
        this.log(`Agent started on port ${port}`);
        this.log(`Registered engines: ${this.engineRegistry.list().join(', ')}`);
        resolve();
      });

      this.httpServer.on('error', (err: Error) => {
        reject(err);
      });
    });
  }

  /**
   * 停止 Agent 服务器
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    await this.engineRegistry.closeAll();
    this.io.disconnectSockets();
    this.io.close();

    await new Promise<void>((resolve) => {
      this.httpServer.close(() => {
        this.running = false;
        this.log('Agent stopped');
        resolve();
      });
    });
  }

  /**
   * 服务器是否运行中
   */
  isRunning(): boolean {
    return this.running;
  }

  // ========== 私有方法 ==========

  private setupConnectionHandler(): void {
    const namespace = this.io.of('/agent-browser');

    namespace.on('connection', async (socket: Socket) => {
      // 认证检查（异步，可能需要调用远程 API）
      if (!(await this.authenticate(socket))) {
        return;
      }

      const connectionId = uuidv4();
      const engines = this.engineRegistry.list();

      this.log(`Client connected: ${connectionId} from ${socket.handshake.address}`);

      // 发送连接确认
      const connectedPayload: ConnectedPayload = {
        connectionId,
        browserReady: engines.length > 0,
      };
      socket.emit('connected', connectedPayload);

      // 处理单条指令执行
      socket.on('execute', async (payload: ExecutePayload) => {
        await this.handleExecute(socket, payload);
      });

      // 处理批量指令执行
      socket.on('execute_batch', async (payload: ExecuteBatchPayload) => {
        await this.handleExecuteBatch(socket, payload);
      });

      // 处理心跳
      socket.on('ping', (data: { timestamp: number }) => {
        socket.emit('pong', {
          timestamp: data.timestamp,
          browserReady: this.engineRegistry.list().length > 0,
        });
      });

      // 处理断开连接
      socket.on('disconnect', (reason: string) => {
        this.log(`Client disconnected: ${connectionId}, reason: ${reason}`);
      });
    });
  }

  /**
   * 认证检查
   * - noAuth: true → 跳过认证，允许所有连接
   * - noAuth: false → 调用 RabbitAI 服务器的 /api/auth/profile 验证 Token
   */
  private async authenticate(socket: Socket): Promise<boolean> {
    // noAuth 模式允许所有连接
    if (this.options.noAuth) {
      return true;
    }

    // 需要 Token 认证
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.emit('error', { message: 'Authentication required' });
      socket.disconnect();
      return false;
    }

    if (!this.options.rabbitaiServerUrl) {
      socket.emit('error', { message: 'RabbitAI server URL not configured' });
      socket.disconnect();
      return false;
    }

    try {
      const isValid = await this.verifyTokenWithRabbitAI(token);
      if (!isValid) {
        socket.emit('error', { message: 'Invalid or expired token' });
        socket.disconnect();
        return false;
      }
      return true;
    } catch {
      socket.emit('error', { message: 'Token verification failed' });
      socket.disconnect();
      return false;
    }
  }

  /**
   * 调用 RabbitAI 服务器的 /api/auth/profile 验证 Token 有效性
   * 返回 true 表示 Token 有效（HTTP 200），false 表示无效
   */
  private verifyTokenWithRabbitAI(token: string): Promise<boolean> {
    const baseUrl = this.options.rabbitaiServerUrl!.replace(/\/+$/, '');
    const url = `${baseUrl}/api/auth/profile`;
    const parsedUrl = new URL(url);

    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? '443' : '80'),
      path: parsedUrl.pathname,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };

    return new Promise((resolve) => {
      const req = transport.request(options, (res) => {
        // 消费响应体以释放连接
        res.resume();
        resolve(res.statusCode === 200);
      });

      req.on('error', () => {
        resolve(false);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  /**
   * 处理单条指令执行
   */
  private async handleExecute(socket: Socket, payload: ExecutePayload): Promise<void> {
    const { requestId, type, command } = payload;
    this.log(`Execute [${type}]: ${command}`);

    const engine = this.engineRegistry.get(type);
    if (!engine) {
      const result: ResultPayload = {
        requestId,
        data: '',
        done: true,
        error: `Unknown engine type: ${type}`,
      };
      socket.emit('result', result);
      return;
    }

    try {
      const result = await engine.execute(command, (streamData: string) => {
        const streamPayload: ResultPayload = {
          requestId,
          data: streamData,
          done: false,
        };
        socket.emit('result', streamPayload);
      });

      const finalPayload: ResultPayload = {
        requestId,
        data: result.data,
        done: true,
        error: result.error,
      };
      socket.emit('result', finalPayload);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Execution failed';
      const errorPayload: ResultPayload = {
        requestId,
        data: '',
        done: true,
        error: errorMessage,
      };
      socket.emit('result', errorPayload);
    }
  }

  /**
   * 处理批量指令执行
   */
  private async handleExecuteBatch(
    socket: Socket,
    payload: ExecuteBatchPayload,
  ): Promise<void> {
    const { batchId, type, commands } = payload;
    this.log(`Batch [${type}]: ${commands.length} commands`);

    const engine = this.engineRegistry.get(type);
    if (!engine) {
      // 引擎不存在，每条指令都报错
      for (let i = 0; i < commands.length; i++) {
        const requestId = uuidv4();
        const batchResult: BatchResultPayload = {
          batchId,
          index: i,
          requestId,
          data: '',
          done: true,
          error: `Unknown engine type: ${type}`,
        };
        socket.emit('batch_result', batchResult);
      }

      const completePayload: BatchCompletePayload = {
        batchId,
        totalCommands: commands.length,
        successCount: 0,
        failedCount: commands.length,
      };
      socket.emit('batch_complete', completePayload);
      return;
    }

    let successCount = 0;
    let failedCount = 0;

    // 顺序执行每条指令
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const requestId = uuidv4();

      try {
        const result = await engine.execute(command, (streamData: string) => {
          // 批量模式不发送中间流，仅在完成时发送
          void streamData;
        });

        const batchResult: BatchResultPayload = {
          batchId,
          index: i,
          requestId,
          data: result.data,
          done: true,
          error: result.error,
        };
        socket.emit('batch_result', batchResult);

        if (result.error) {
          failedCount++;
        } else {
          successCount++;
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Execution failed';
        const batchResult: BatchResultPayload = {
          batchId,
          index: i,
          requestId,
          data: '',
          done: true,
          error: errorMessage,
        };
        socket.emit('batch_result', batchResult);
        failedCount++;
      }
    }

    // 发送批量完成
    const completePayload: BatchCompletePayload = {
      batchId,
      totalCommands: commands.length,
      successCount,
      failedCount,
    };
    socket.emit('batch_complete', completePayload);
  }

  private log(...args: unknown[]): void {
    if (this.options.debug) {
      console.log('[AgentBrowserAgent]', ...args);
    }
  }
}
