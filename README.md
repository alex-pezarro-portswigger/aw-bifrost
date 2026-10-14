# aw-bifrost

An [Agent Wrangler](https://github.com/topics/agent-wrangler-extension) extension that runs Claude Code sessions on OpenAI models through a local [Bifrost](https://github.com/maximhq/bifrost) gateway.

It adds:

- a **Bifrost (OpenAI)** runtime in the dispatch dialog. Pick it, pick an OpenAI model, and the session's Claude Code talks to Bifrost's Anthropic-compatible endpoint, which routes to OpenAI;
- Bifrost's own per-request cost on the card's cost chip and in `get_session_cost`;
- a **Bifrost** view: gateway and logs.db status, totals by model, and the latest 200 requests with a link to the card that made each one.

**It is connect-only.** The extension never starts or stops Bifrost; you run it yourself (below).

**Other sessions are untouched.** Only cards dispatched with Runtime = Bifrost get the gateway environment (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, the model slots). Every other session, including Claude-model sessions on your claude.ai login, launches exactly as before.

Requires Agent Wrangler host API 1.30.0 or later and Node 22.5 or later.

## Install

In Agent Wrangler, open **Settings → Extensions → + Add extension** and paste `https://github.com/alex-pezarro-portswigger/aw-bifrost`. It asks for one capability, `board:broadcast`, which it uses to answer its own dialog and view.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Bifrost URL | `http://127.0.0.1:8080` | Where the gateway listens. |
| Bifrost logs.db | none | Path to `logs.db` in Bifrost's app dir (`~` allowed). Needed for card cost and the view; opened read-only. |
| Background model | `gpt-5.4-mini` | The OpenAI model for Claude Code's small background calls (the haiku slot). |
| Disable 1M context | off | Off tags the main model with `[1m]` so Claude Code uses a 1M-token context window instead of 200k. Turn on for models without 1M support. |
| Allow experimental betas | off | Off sets `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`, because Anthropic-only beta headers can break OpenAI requests. |
| Ask Bifrost not to log content | off | Sends `x-bf-disable-content-logging: true`. Bifrost v2.2.6 ignored this header in testing. |

## How it works

- The dialog's model select lists Bifrost's `gpt-*` chat models (from `/anthropic/v1/models`). The card's core model is stored as `opus`, and the launch maps every model slot to the chosen OpenAI model: `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL` are `openai/<model>`, and `ANTHROPIC_DEFAULT_HAIKU_MODEL` is `openai/<background model>`.
- The chosen model is kept per card (`<AW_DATA_DIR>/bifrost/cards.json`), so resume and fork relaunch on the same one. A card with no record refuses to relaunch rather than silently reaching Anthropic.
- Every request carries `x-bf-session-id: <card id>`, which Bifrost stores as the row's `session_id`. Card cost is the sum of `cost` over the card's rows (falling back to its Claude conversation ids for rows without the header). Sub-agent and background traffic is included, so the chip shows the card's total; the transcript's per-sub-agent breakdown is not adjusted.
- A dispatch is refused up front if the agent isn't Claude Code, no OpenAI model is picked, or the gateway doesn't answer within 2 s.

## Limitations

- claude.ai connectors are disabled in these sessions.
- Claude Code assumes a 200K context window and 32K output for the model.
- `/model` inside the session cannot pick OpenAI models.
- `spawn_session` and schedules saved without a model can't target this runtime, because there is no default model; the dispatch is refused.
- The wrangler's usage scan (`usage:read`) and the `cost-report` skill price transcripts and won't see Bifrost's figure.
- **logs.db holds prompt and response content by default.** The extension never reads those columns, but anyone who can read the file can. Treat it like the transcripts themselves.

## Development

```sh
npm test
```

No runtime dependencies, so there is no lockfile. For a hand-placed copy, symlink or copy the repo to `<AW_DATA_DIR>/extensions/bifrost/` on an isolated dev instance and restart it.
