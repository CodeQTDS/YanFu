function extractJson(text) {
  if (text && typeof text === "object") {
    return text;
  }

  const raw = String(text || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {}

  const cleaned = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  const startObject = cleaned.indexOf("{");
  const endObject = cleaned.lastIndexOf("}");
  if (startObject !== -1 && endObject > startObject) {
    try {
      return JSON.parse(cleaned.slice(startObject, endObject + 1));
    } catch (_) {}
  }

  return null;
}

function safeJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_, item) =>
      typeof item === "bigint" ? item.toString() : item
    )
  );
}

module.exports = {
  extractJson,
  safeJson
};
