/** 极简响应式“store”：Vue reactive 单例 + 事件订阅，避免引入 Pinia。 */
import { reactive, computed } from 'vue';

export function defineStore(factory) {
  const value = factory();
  return value;
}

export { reactive, computed };
