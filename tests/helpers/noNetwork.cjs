// Tests supply response fixtures explicitly; an unmocked request must fail locally.
globalThis.fetch = async () => {
  throw new Error("Unmocked network requests are forbidden in the automated test suite.");
};
