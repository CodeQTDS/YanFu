function unique(values) {
  return [...new Set(values)];
}

function extractFacts(text) {
  const source = String(text || "");

  const addresses = unique(
    Array.from(source.matchAll(/0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g)).map(match => match[0])
  );

  const bytes32 = unique(
    Array.from(source.matchAll(/0x[a-fA-F0-9]{64}(?![a-fA-F0-9])/g)).map(match => match[0])
  );

  const hexBlobs = unique(
    Array.from(source.matchAll(/0x[a-fA-F0-9]{4,}/g))
      .map(match => match[0])
      .filter(value => value.length > 66)
  );

  const hexTokens = unique(
    Array.from(source.matchAll(/0x[a-fA-F0-9]+/g)).map(match => match[0])
  );

  const addressLike = hexTokens.filter(value => value.length <= 42);
  const numbers = Array.from(source.matchAll(/\b\d+(?:\.\d+)?\b/g)).map(match => match[0]);

  return {
    addresses,
    addressLike,
    bytes32,
    hexBlobs,
    hexTokens,
    numbers
  };
}

module.exports = {
  extractFacts
};
