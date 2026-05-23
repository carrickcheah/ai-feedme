# 010 — Evaluation / Feedback

> Harness sub-domain #10 (Tier B, operational). Question it owns: **"How do I know the AI's answers are correct?"**
> Demo tenant: Awesome Healthcare (synthetic data).

## What it is

**Evaluation = testing if the AI's answers are correct, like giving a student an exam.**

## Two stages: staging (offline) → production (online)

| Stage | Eval category | Question it answers | Method | Tool | Data source |
|---|---|---|---|---|---|
| **Staging** (offline) | Golden test set | Does it answer known questions correctly? | fixed Q→expected pairs, run in CI | promptfoo | frozen test set (you write it) |
| **Staging** (offline) | Regression | Did this code change make answers worse? | re-run golden set, compare scores vs last run | promptfoo | same frozen set |
| **Staging** (offline) | Red-team / safety | Can it be tricked, jailbroken, or leak data? | adversarial prompts (injection, PII probes) | promptfoo (red-team) | attack prompt library |
| **Staging** (offline) | Model comparison | Which model is best/cheapest for the task? | run same tests across deepseek vs claude | promptfoo | frozen set |
| **Production** (online) | Live reply sampling | Are real replies actually good? | grade a % of live replies (AI-judge or human) | custom + LLM-judge | real traffic |
| **Production** (online) | CSAT / feedback | Did the patient like the answer? | thumbs up/down, survey score | CSAT pipeline | real users |
| **Production** (online) | Inline verifier | Catch a bad answer before sending | in-loop check → regenerate if fail | code (Step 5 design) | live, per-reply |

## Grading methods — the 3 ways to score a fuzzy answer

| Method | How | Speed | Best for |
|---|---|---|---|
| 📏 Exact / keyword | does output contain "RM120"? | instant | hard facts, numbers |
| 🧠 LLM-as-judge | a 2nd model rates correctness/tone | fast | meaning, helpfulness |
| 👤 Human grade | a person reviews & rates | slow | gold standard, edge cases |
