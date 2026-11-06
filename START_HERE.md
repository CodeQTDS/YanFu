# Start YanFu v1.0

Use [README.md](README.md) for the complete Windows-first setup guide.

1. Install Node 24, Git, VS Code/Live Server and MetaMask in a development profile.
2. Extract this package to a new directory and open the directory containing package.json.
3. Run `npm ci`, `npm run setup`, then `npm run compile`.
4. Put only the selected provider's credentials in the generated `.env`; restart the backend after edits.
5. Keep `npm run node` running in Terminal A; run `npm run deploy` in Terminal B.
6. Keep `npm run server` running in Terminal C.
7. Serve `frontend/index.html` through Live Server on port 5500, not file://.
8. Configure MetaMask for local RPC 127.0.0.1:8545 and the generated chain ID (default 31337). Use disposable test accounts only.
9. Follow Generate → Analyze → AI Review → Human Confirm → Submit.

v1.0 is the product label; 1.0.0 is its npm form. Label changes preserve runtime behavior and do not certify production readiness. The full verification scope is in [docs/VALIDATION.md](docs/VALIDATION.md).
