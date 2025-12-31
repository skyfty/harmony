// Lightweight loader for the wasm package built by wasm-pack.
// It dynamically imports the generated JS wrapper and initializes
// optional debug helpers. Use `await loadWasm()` from your app code.

export async function loadWasm() {
  // wasm-pack outputs JS into editor/wasm/pkg/<crate_name>.js
  // Vite serves project-root files at '/'. Using an absolute path
  // ensures Vite will serve the generated files from /wasm/pkg.
  const modulePath = '/wasm/pkg/editor_wasm.js';
  const pkg = await import(modulePath);

  // If the crate provides an init function for debugging, call it.
  try {
    if (typeof pkg.init_panic_hook === 'function') pkg.init_panic_hook();
  } catch (e) {
    // ignore
  }

  return pkg;
}
