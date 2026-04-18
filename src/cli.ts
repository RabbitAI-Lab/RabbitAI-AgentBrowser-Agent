#!/usr/bin/env node
/**
 * Agent Browser Agent CLI
 *
 * 用法:
 *   agent-browser-agent [options]
 *
 * 选项:
 *   -p, --port <port>              监听端口 (默认: 3100)
 *   --no-auth                      跳过认证 (本地模式)
 *   --rabbitai-url <url>           RabbitAI 服务器地址，用于远程模式验证 Token
 *   --engine-dir <dir>             自定义引擎目录，自动加载 .js 文件作为引擎
 *   -d, --debug                    启用调试日志
 *   -h, --help                     显示帮助信息
 *   -v, --version                  显示版本号
 */

import { AgentBrowserAgent } from './agent';
import type { Engine } from './types';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

// ========== 参数解析 ==========

interface CliArgs {
  port?: number;
  noAuth?: boolean;
  rabbitaiUrl?: string;
  engineDir?: string;
  debug?: boolean;
  help?: boolean;
  version?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  let i = 2; // 跳过 node 和脚本路径

  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case '-p':
      case '--port':
        args.port = parseInt(argv[++i], 10);
        if (isNaN(args.port)) {
          console.error('Error: --port requires a number');
          process.exit(1);
        }
        break;
      case '--no-auth':
        args.noAuth = true;
        break;
      case '--rabbitai-url':
        args.rabbitaiUrl = argv[++i];
        if (!args.rabbitaiUrl) {
          console.error('Error: --rabbitai-url requires a URL');
          process.exit(1);
        }
        break;
      case '--engine-dir':
        args.engineDir = argv[++i];
        if (!args.engineDir) {
          console.error('Error: --engine-dir requires a directory path');
          process.exit(1);
        }
        break;
      case '-d':
      case '--debug':
        args.debug = true;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '-v':
      case '--version':
        args.version = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        console.error('Use --help for usage information');
        process.exit(1);
    }
    i++;
  }

  return args;
}

// ========== 帮助 & 版本 ==========

function showHelp(): void {
  console.log(`
Agent Browser Agent - RabbitAI 浏览器自动化代理服务器

用法:
  agent-browser-agent [options]

选项:
  -p, --port <port>              监听端口 (默认: 3100)
  --no-auth                      跳过认证，允许所有连接 (本地开发模式)
  --rabbitai-url <url>           RabbitAI 服务器地址，用于远程模式验证 Token
                                 例如: https://rabbitai.example.com
  --engine-dir <dir>             自定义引擎目录，自动加载目录下所有 .js 文件
  -d, --debug                    启用调试日志
  -h, --help                     显示帮助信息
  -v, --version                  显示版本号

示例:
  # 本地开发模式 (无认证)
  agent-browser-agent --no-auth --debug

  # 指定端口
  agent-browser-agent --port 3200 --no-auth

  # 远程模式 (需要 Token 认证)
  agent-browser-agent --port 3100 --rabbitai-url https://rabbitai.example.com

  # 加载自定义引擎
  agent-browser-agent --no-auth --engine-dir ./my-engines

环境变量:
  PORT                           监听端口 (可被 --port 覆盖)
  RABBITAI_SERVER_URL            RabbitAI 服务器地址 (可被 --rabbitai-url 覆盖)
  NO_AUTH                        设置为 "true" 启用无认证模式
`);
}

function showVersion(): void {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    console.log(`agent-browser-agent v${pkg.version}`);
  } catch {
    console.log('agent-browser-agent v1.0.0');
  }
}

// ========== 自定义引擎加载 ==========

async function loadEngines(engineDir: string, agent: AgentBrowserAgent): Promise<void> {
  const absDir = resolve(engineDir);

  let files: string[];
  try {
    files = readdirSync(absDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
  } catch (err) {
    console.error(`Error: Cannot read engine directory: ${absDir}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.warn(`Warning: No engine files found in ${absDir}`);
    return;
  }

  for (const file of files) {
    const filePath = join(absDir, file);
    try {
      const module = await import(filePath);
      // 支持默认导出或命名导出
      const engineClass = module.default || module.Engine || module.engine;
      if (!engineClass) {
        console.warn(`Warning: ${file} does not export an Engine class, skipping`);
        continue;
      }

      const engine: Engine = new engineClass();
      if (!engine.name || typeof engine.execute !== 'function' || typeof engine.close !== 'function') {
        console.warn(`Warning: ${file} does not implement the Engine interface, skipping`);
        continue;
      }

      agent.registerEngine(engine);
      console.log(`Loaded engine: ${engine.name} from ${file}`);
    } catch (err) {
      console.error(`Error loading engine from ${file}:`, err);
    }
  }
}

// ========== 主入口 ==========

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (args.version) {
    showVersion();
    process.exit(0);
  }

  // 合并环境变量和命令行参数
  const port = args.port || parseInt(process.env.PORT || '3100', 10);
  const noAuth = args.noAuth || process.env.NO_AUTH === 'true';
  const rabbitaiUrl = args.rabbitaiUrl || process.env.RABBITAI_SERVER_URL;

  // 参数校验
  if (!noAuth && !rabbitaiUrl) {
    console.error('Error: Remote mode requires --rabbitai-url or RABBITAI_SERVER_URL env');
    console.error('       Use --no-auth for local development mode');
    process.exit(1);
  }

  const agent = new AgentBrowserAgent({
    port,
    noAuth,
    rabbitaiServerUrl: rabbitaiUrl,
    debug: args.debug,
  });

  // 加载自定义引擎
  if (args.engineDir) {
    await loadEngines(args.engineDir, agent);
  }

  // 优雅关闭
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await agent.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 启动服务器
  try {
    await agent.start();
    console.log(`\n  Agent Browser Agent running:`);
    console.log(`    Port:              ${port}`);
    console.log(`    Mode:              ${noAuth ? 'Local (no auth)' : 'Remote (Token auth)'}`);
    if (rabbitaiUrl) {
      console.log(`    RabbitAI Server:   ${rabbitaiUrl}`);
    }
    console.log(`    Debug:             ${args.debug ? 'Enabled' : 'Disabled'}`);
    console.log(`    Engines:           agent-browser`);
    console.log();
    console.log('  Press Ctrl+C to stop');
    console.log();
  } catch (err) {
    console.error('Failed to start agent:', err);
    process.exit(1);
  }
}

main();
