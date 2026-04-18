/**
 * 集成测试 - 验证 Agent + SDK 的完整流程
 *
 * 运行: npx tsx packages/agent-browser-agent/src/test/integration-test.ts
 */

import { createServer } from 'http';
import { AgentBrowserAgent } from '../agent';
import type { Engine } from '../types';

// 动态导入 SDK（通过构建产物）
// @ts-expect-error 跨包引用
import { AgentBrowserSdk } from '../../../agent-browser-sdk/dist/index.mjs';

// ========== 自定义 Mock 引擎 ==========

class MockEngine implements Engine {
  name = 'mock';

  async execute(
    command: string,
    onStream: (data: string) => void,
  ): Promise<{ data: string; error?: string }> {
    onStream(`[mock] 开始执行: ${command}\n`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    onStream(`[mock] 执行中...\n`);
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (command.startsWith('error:')) {
      return { data: '', error: `Mock error: ${command}` };
    }

    return { data: `[mock] 完成: ${command}`, error: undefined };
  }

  async close(): Promise<void> {}
}

// ========== 模拟 RabbitAI Token 验证服务器 ==========

function createMockRabbitAIServer(validToken: string, port: number): Promise<ReturnType<typeof createServer>> {
  const server = createServer((req, res) => {
    if (req.url === '/api/auth/profile' && req.method === 'GET') {
      const authHeader = req.headers.authorization;
      if (authHeader === `Bearer ${validToken}`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ userId: 'test-user', email: 'test@example.com' }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Unauthorized' }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

// ========== 测试工具 ==========

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  PASS ${testName}`);
    passed++;
  } else {
    console.log(`  FAIL ${testName}${detail ? ` - ${detail}` : ''}`);
    failed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, testName: string) {
  if (actual === expected) {
    console.log(`  PASS ${testName}`);
    passed++;
  } else {
    console.log(`  FAIL ${testName} - expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ========== 测试用例 ==========

async function testLocalAgent() {
  console.log('\n=== Test 1: Agent local start (noAuth) ===');

  const agent = new AgentBrowserAgent({
    port: 13100,
    noAuth: true,
    debug: true,
  });

  agent.registerEngine(new MockEngine());

  await agent.start();
  assert(agent.isRunning(), 'Agent started');
  assertEqual(agent.isRunning(), true, 'isRunning() returns true');

  return agent;
}

async function testSdkConnect() {
  console.log('\n=== Test 2: SDK connect ===');

  const sdk = new AgentBrowserSdk({
    serverUrl: 'http://localhost:13100',
    debug: true,
  });

  const result = await sdk.connect();
  assert(!!result.connectionId, 'Connected, got connectionId');
  assert(typeof result.connectionId === 'string', 'connectionId is string');
  assert(sdk.isConnected(), 'isConnected() returns true');

  return sdk;
}

async function testSingleExecute(sdk: InstanceType<typeof AgentBrowserSdk>) {
  console.log('\n=== Test 3: Single execute ===');

  const streamResults: string[] = [];

  const result = await sdk.execute({
    type: 'mock',
    command: 'navigate https://example.com',
    onResult: (data) => {
      streamResults.push(data);
    },
  });

  assert(!result.error, `No error: ${result.error || 'OK'}`);
  assert(result.data.includes('完成'), `Result includes done: ${result.data}`);
  assert(streamResults.length >= 2, `Stream callback triggered ${streamResults.length} times (>=2)`);
  assert(streamResults[0].includes('开始执行'), `First stream includes start text`);
}

async function testSingleExecuteError(sdk: InstanceType<typeof AgentBrowserSdk>) {
  console.log('\n=== Test 4: Single execute error ===');

  const result = await sdk.execute({
    type: 'mock',
    command: 'error:something went wrong',
  });

  assert(!!result.error, `Got error: ${result.error}`);
  assert(result.error!.includes('Mock error'), `Error includes "Mock error"`);
}

async function testBatchExecute(sdk: InstanceType<typeof AgentBrowserSdk>) {
  console.log('\n=== Test 5: Batch execute ===');

  const commandResults: Array<{ index: number; data: string; error?: string }> = [];
  let completeCalled = false;
  let completeSuccess = 0;
  let completeFailed = 0;

  const result = await sdk.executeBatch({
    type: 'mock',
    commands: [
      'navigate https://example.com',
      'click #button',
      'error:fail-this',
      'fill #input hello',
    ],
    onCommandResult: (index, data, error) => {
      commandResults.push({ index, data, error });
    },
    onComplete: (successCount, failedCount) => {
      completeCalled = true;
      completeSuccess = successCount;
      completeFailed = failedCount;
    },
  });

  assertEqual(result.results.length, 4, 'Batch result count = 4');
  assertEqual(result.successCount, 3, 'Success count = 3');
  assertEqual(result.failedCount, 1, 'Failed count = 1');
  assert(completeCalled, 'onComplete callback called');
  assertEqual(completeSuccess, 3, 'onComplete successCount = 3');
  assertEqual(completeFailed, 1, 'onComplete failedCount = 1');

  const errorResult = result.results.find((r) => r.index === 2);
  assert(!!errorResult?.error, 'index 2 has error');
}

async function testUnknownEngine(sdk: InstanceType<typeof AgentBrowserSdk>) {
  console.log('\n=== Test 6: Unknown engine type ===');

  const result = await sdk.execute({
    type: 'nonexistent-engine',
    command: 'do something',
  });

  assert(!!result.error, `Got error: ${result.error}`);
  assert(result.error!.includes('Unknown engine type'), `Error includes "Unknown engine type"`);
}

async function testDisconnect(sdk: InstanceType<typeof AgentBrowserSdk>) {
  console.log('\n=== Test 7: Disconnect ===');

  await sdk.disconnect();
  assert(!sdk.isConnected(), 'isConnected() = false after disconnect');
}

async function testAgentStop(agent: AgentBrowserAgent) {
  console.log('\n=== Test 8: Agent stop ===');

  await agent.stop();
  assert(!agent.isRunning(), 'isRunning() = false after stop');
}

async function testTokenAuth() {
  console.log('\n=== Test 9: Token auth via RabbitAI API ===');

  const validToken = 'test-rabbitai-token-12345';
  const mockServerPort = 13198;
  const agentPort = 13101;

  // 启动模拟 RabbitAI 服务器
  const mockServer = await createMockRabbitAIServer(validToken, mockServerPort);

  const authAgent = new AgentBrowserAgent({
    port: agentPort,
    rabbitaiServerUrl: `http://localhost:${mockServerPort}`,
    debug: true,
  });
  authAgent.registerEngine(new MockEngine());
  await authAgent.start();

  // 测试 1: noAuth 模式不需要 Token
  const noAuthAgent = new AgentBrowserAgent({
    port: 13102,
    noAuth: true,
    debug: true,
  });
  noAuthAgent.registerEngine(new MockEngine());
  await noAuthAgent.start();

  const sdkNoAuth = new AgentBrowserSdk({
    serverUrl: 'http://localhost:13102',
    debug: true,
  });

  try {
    const result = await sdkNoAuth.connect();
    assert(!!result.connectionId, 'noAuth mode: connection without token succeeds');
    await sdkNoAuth.disconnect();
  } catch (err) {
    assert(false, 'noAuth mode: should succeed', String(err));
  }

  await noAuthAgent.stop();

  // 测试 2: 有效 Token 可以连接
  const sdkWithToken = new AgentBrowserSdk({
    serverUrl: `http://localhost:${agentPort}`,
    token: validToken,
    debug: true,
  });

  try {
    const result = await sdkWithToken.connect();
    assert(!!result.connectionId, 'Valid token: connection succeeds');
    await sdkWithToken.disconnect();
  } catch (err) {
    assert(false, 'Valid token: should succeed', String(err));
  }

  // 测试 3: 无效 Token 被拒绝
  const sdkBadToken = new AgentBrowserSdk({
    serverUrl: `http://localhost:${agentPort}`,
    token: 'invalid-token-xxx',
    debug: true,
  });

  try {
    await sdkBadToken.connect();
    assert(false, 'Invalid token: should have been rejected');
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    assert(errMsg.length > 0, `Invalid token: rejected with error`);
  }

  // 测试 4: 没有 Token 被拒绝
  const sdkNoToken = new AgentBrowserSdk({
    serverUrl: `http://localhost:${agentPort}`,
    debug: true,
  });

  try {
    await sdkNoToken.connect();
    assert(false, 'No token: should have been rejected');
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    assert(errMsg.length > 0, `No token: rejected with error`);
  }

  await authAgent.stop();

  // 关闭模拟 RabbitAI 服务器
  await new Promise<void>((resolve) => {
    mockServer.close(() => resolve());
  });
}

// ========== Main ==========

async function main() {
  console.log('========================================');
  console.log(' Agent-Browser SDK & Agent Integration');
  console.log('========================================');

  let agent: AgentBrowserAgent | undefined;
  let sdk: InstanceType<typeof AgentBrowserSdk> | undefined;

  try {
    agent = await testLocalAgent();
    sdk = await testSdkConnect();
    await testSingleExecute(sdk);
    await testSingleExecuteError(sdk);
    await testBatchExecute(sdk);
    await testUnknownEngine(sdk);
    await testDisconnect(sdk);
    await testAgentStop(agent);
    await testTokenAuth();
  } catch (err) {
    console.error('\nTest exception:', err);
    failed++;
  } finally {
    if (sdk?.isConnected()) await sdk.disconnect();
    if (agent?.isRunning()) await agent.stop();
  }

  console.log('\n========================================');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');

  process.exit(failed > 0 ? 1 : 0);
}

main();
