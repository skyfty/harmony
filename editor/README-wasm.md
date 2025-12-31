# WebAssembly (Rust) for Editor

快速上手：使用 Rust + wasm-bindgen (wasm-pack)

本仓库示例路径：
- Rust crate: `editor/src/wasm/rust-crate`
- wasm 打包输出（wasm-pack 默认）：`editor/src/wasm/pkg`

本地构建示例（在 `editor` 目录下运行）：

npm run wasm:build:rust    # 在 editor/package.json 中已注册脚本
```bash
# 在系统上先安装 rustup/cargo 与 wasm-pack（见下）
cd editor
npm run wasm:build:rust    # 在 editor/package.json 中已注册脚本
npm run build
```

必要的本地工具（示例安装命令）：

```bash
# 安装 Rust 工具链（若未安装）
curl https://sh.rustup.rs -sSf | sh -s -- -y
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --force
```

前端使用示例：参见 `editor/src/wasm_loader.ts`，用 `import('./wasm/pkg/harmony_wasm.js')` 并调用生成的初始化函数。

注意（仓库策略）：`editor/src/wasm/pkg` 为编译生成的产物，不会提交到版本控制。CI 工作流（`.github/workflows/ci-wasm.yml`）会在构建时生成该目录并包含到前端构建结果中。本地开发者如果需要运行项目，请先执行 `npm run wasm:build:rust` 在本地生成 `pkg`，或在没有 Rust 环境的情况下使用 CI/远程构建产物。
