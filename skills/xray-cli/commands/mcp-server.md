# MCP server
Goal: xray commands as MCP tools over stdio (map, graph, query, impact, explore, strategy list/detect, `<strategy>_<noun>`).

```bash
xray -C <project> serve --stdio
claude mcp add xray -- xray -C <project> serve --stdio
```

Reference: `docs/user/mcp.md` in the xray repo.
