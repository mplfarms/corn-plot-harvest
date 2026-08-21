
  const stores = globalThis.__cph_test_stores__;
  module.exports = {
    connectLambda: () => {},
    getStore: (name) => stores[name],
  };
  