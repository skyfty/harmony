export function createJiti() {
  return function createJitiShim() {
    return {
      import: async () => {
        throw new Error('jiti is not available in the browser build environment');
      },
    };
  };
}

export default { createJiti };
