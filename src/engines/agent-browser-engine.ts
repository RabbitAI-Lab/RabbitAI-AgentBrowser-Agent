/**
 * 默认引擎 - 通过 CLI 调用 agent-browser 命令执行浏览器操作
 */

import { spawn, ChildProcess } from 'child_process';
import type { Engine } from '../types';

export interface AgentBrowserEngineOptions {
  /** agent-browser CLI 路径，默认 'agent-browser' */
  cliPath?: string;
  /** CLI 执行超时 ms，默认 300000 (5分钟) */
  timeout?: number;
}

const DEFAULT_OPTIONS: Partial<AgentBrowserEngineOptions> = {
  cliPath: 'agent-browser',
  timeout: 300000,
};

export class AgentBrowserEngine implements Engine {
  name = 'agent-browser';
  private options: AgentBrowserEngineOptions;
  private activeProcesses = new Set<ChildProcess>();

  constructor(options?: AgentBrowserEngineOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * 通过 CLI 执行 agent-browser 命令
   */
  async execute(
    command: string,
    onStream: (data: string) => void,
  ): Promise<{ data: string; error?: string }> {
    const cliPath = this.options.cliPath || 'agent-browser';
    const timeout = this.options.timeout || 300000;

    return new Promise((resolve) => {
      const proc = spawn(cliPath, [command], {
        shell: true,
        env: { ...process.env },
      });

      this.activeProcesses.add(proc);

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (error?: string) => {
        if (settled) return;
        settled = true;
        this.activeProcesses.delete(proc);
        resolve({ data: stdout, error });
      };

      proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        onStream(text);
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          finish();
        } else {
          finish(stderr || `Process exited with code ${code}`);
        }
      });

      proc.on('error', (err) => {
        finish(err.message);
      });

      // 超时处理
      setTimeout(() => {
        if (!settled) {
          proc.kill('SIGTERM');
          finish('Execution timed out');
        }
      }, timeout);
    });
  }

  /**
   * 关闭引擎，杀掉所有活跃进程
   */
  async close(): Promise<void> {
    for (const proc of this.activeProcesses) {
      proc.kill('SIGTERM');
    }
    this.activeProcesses.clear();
  }
}
