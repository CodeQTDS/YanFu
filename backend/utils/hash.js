const crypto = require("crypto");

function sha256Json(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

module.exports = {
  sha256Json
};
