
  const stores = globalThis.__cph_test_backfill_stores__;
  module.exports = {
    connectLambda: () => {},
    getStore: (name) => stores[name],
  };
  