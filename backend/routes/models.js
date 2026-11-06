const express = require("express");
const {
  getDefaultModel,
  getPublicModelListWithStatus
} = require("../ai/modelRegistry");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const models = await getPublicModelListWithStatus();
    const configuredDefault = getDefaultModel();
    const effectiveDefault =
      models.find(item => item.id === configuredDefault && item.available)?.id ||
      models.find(item => item.available)?.id ||
      configuredDefault;

    res.json({
      success: true,
      configuredDefaultModel: configuredDefault,
      defaultModel: effectiveDefault,
      models
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
