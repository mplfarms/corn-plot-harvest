
  const stores = globalThis.__cph_test_hybridcatalog_stores__;
  module.exports = {
    connectLambda: () => {},
    getStore: (name) => stores[name],
  };
  