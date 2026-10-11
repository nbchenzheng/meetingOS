// scripts/ts-resolve-loader.mjs
// 测试专用 resolve 钩子：为相对路径且缺扩展名的说明符补上 .ts，
// 使 Node 原生 ESM 解析器能像 Vite 一样加载 extensionless 的 TS 导入。
// 仅用于 node --test 运行前端纯逻辑单测，不进入生产构建。
export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
  const hasExt = /\.[cm]?[jt]sx?$/.test(specifier)
  if (isRelative && !hasExt) {
    try {
      return await nextResolve(specifier + '.ts', context)
    } catch {
      // 回退到原始说明符
    }
  }
  return nextResolve(specifier, context)
}
