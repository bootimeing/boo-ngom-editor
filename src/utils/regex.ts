/**
 * 转义正则表达式元字符，防止注入和误匹配
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
