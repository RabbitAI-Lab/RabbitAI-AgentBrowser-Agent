/**
 * 引擎注册表 - 可插拔的 type → Engine 映射
 */

import type { Engine } from './types';

export class EngineRegistry {
  private engines = new Map<string, Engine>();

  /**
   * 注册引擎
   */
  register(engine: Engine): void {
    this.engines.set(engine.name, engine);
  }

  /**
   * 获取引擎（按 type 查找）
   */
  get(type: string): Engine | undefined {
    return this.engines.get(type);
  }

  /**
   * 关闭所有引擎
   */
  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.engines.values()).map((engine) =>
      engine.close().catch((err) => {
        console.error(`[EngineRegistry] Error closing engine "${engine.name}":`, err);
      }),
    );
    await Promise.all(closePromises);
    this.engines.clear();
  }

  /**
   * 列出已注册的引擎名称
   */
  list(): string[] {
    return Array.from(this.engines.keys());
  }
}
