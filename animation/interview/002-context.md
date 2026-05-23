# 002 — Context

> Harness sub-domain #2. Question it owns: **"What does the agent see this step?"**
> Demo tenant: Awesome Healthcare (synthetic data).

<!-- WIP — brainstorm in progress -->

## Agent = Model + Context

```
Agent = Model + Context        |   multiple agents = multiple context bundles
                                   (prompt + tools + mcp + db-scope + skills)
```

- What distinguishes one agent from another is ~90% **context**: prompt, tools, MCP, db-scope, skills.
- The ONE thing that is NOT context is the **model** itself (the brain choice — deepseek vs anthropic,
  set in `providers.yaml`). Same context can run on either model; the context didn't change, the brain did.
- So: "multiple agents = multiple context bundles" 