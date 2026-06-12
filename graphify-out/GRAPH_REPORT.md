# Graph Report - /home/ayan-de/Projects/freecode/apps/core/src (2026-05-30)

## Corpus Check

- Corpus is ~29,531 words - fits in a single context window. You may not need a graph.

## Summary

- 419 nodes · 718 edges · 30 communities detected
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 152 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)

- [[_COMMUNITY_Bus + Thread Store|Bus + Thread Store]]
- [[_COMMUNITY_Agent Loop + Memory|Agent Loop + Memory]]
- [[_COMMUNITY_Skills System|Skills System]]
- [[_COMMUNITY_Core Infrastructure|Core Infrastructure]]
- [[_COMMUNITY_Browser Controller|Browser Controller]]
- [[_COMMUNITY_Context + Applier|Context + Applier]]
- [[_COMMUNITY_RolloutEvent Sourcing|Rollout/Event Sourcing]]
- [[_COMMUNITY_Provider Implementations|Provider Implementations]]
- [[_COMMUNITY_Permission Profiles|Permission Profiles]]
- [[_COMMUNITY_JSON Thread Store|JSON Thread Store]]
- [[_COMMUNITY_Memory Tests + Services|Memory Tests + Services]]
- [[_COMMUNITY_Parser Extractors|Parser Extractors]]
- [[_COMMUNITY_Session + Agent Types|Session + Agent Types]]
- [[_COMMUNITY_Edit Tool|Edit Tool]]
- [[_COMMUNITY_Skill Injection|Skill Injection]]
- [[_COMMUNITY_Provider Prompts|Provider Prompts]]
- [[_COMMUNITY_Skill Tool|Skill Tool]]
- [[_COMMUNITY_Read Tool|Read Tool]]
- [[_COMMUNITY_Minimax Provider|Minimax Provider]]
- [[_COMMUNITY_Glob Tool|Glob Tool]]
- [[_COMMUNITY_Bash Tool|Bash Tool]]
- [[_COMMUNITY_Question Tool|Question Tool]]
- [[_COMMUNITY_Agent Index|Agent Index]]
- [[_COMMUNITY_Parser Index|Parser Index]]
- [[_COMMUNITY_Provider Types|Provider Types]]
- [[_COMMUNITY_Write Tool|Write Tool]]
- [[_COMMUNITY_Skills Index|Skills Index]]
- [[_COMMUNITY_Skills Types|Skills Types]]
- [[_COMMUNITY_Store Index|Store Index]]
- [[_COMMUNITY_Store Types|Store Types]]

## God Nodes (most connected - your core abstractions)

1. `AgentLoop` - 20 edges
2. `SqliteThreadStoreImpl` - 20 edges
3. `SkillRegistry` - 18 edges
4. `RolloutRecorder` - 17 edges
5. `SkillsManager` - 16 edges
6. `ThreadStoreService` - 16 edges
7. `JsonThreadStoreImpl` - 15 edges
8. `PermissionChecker` - 12 edges
9. `PlaywrightBrowserController` - 11 edges
10. `FileMemoryStorage` - 8 edges

## Surprising Connections (you probably didn't know these)

- `createAnthropicProvider()` --calls--> `getApiKey()` [INFERRED]
  /home/ayan-de/Projects/freecode/apps/core/src/providers/anthropic.ts → /home/ayan-de/Projects/freecode/apps/core/src/providers/config.ts
- `createGeminiProvider()` --calls--> `getApiKey()` [INFERRED]
  /home/ayan-de/Projects/freecode/apps/core/src/providers/gemini.ts → /home/ayan-de/Projects/freecode/apps/core/src/providers/config.ts
- `createOpenAIProvider()` --calls--> `getApiKey()` [INFERRED]
  /home/ayan-de/Projects/freecode/apps/core/src/providers/openai.ts → /home/ayan-de/Projects/freecode/apps/core/src/providers/config.ts
- `Anthropic Claude Prompt` --semantically_similar_to--> `Default Agent Prompt` [INFERRED] [semantically similar]
  apps/core/src/session/prompt/anthropic.txt → apps/core/src/session/prompt/default.txt
- `ChatGPT Web Variant Prompt` --semantically_similar_to--> `OpenAI/ChatGPT Variant Prompt` [INFERRED] [semantically similar]
  apps/core/src/session/prompt/chatgpt.txt → apps/core/src/session/prompt/openai.txt

## Hyperedges (group relationships)

- **All Provider Variants Share FreeCode Agent Identity** — anthropic_txt, chatgpt_txt, default_txt, gemini_txt, gpt_txt, openai_txt [EXTRACTED 1.00]
- **Workflow and Tool References** — workflow_concept, toolset, default_txt, anthropic_txt, chatgpt_txt, gemini_txt, gpt_txt, openai_txt [EXTRACTED 0.95]

## Communities

### Community 0 - "Bus + Thread Store"

Cohesion: 0.07
Nodes (11): answerQuestion(), FreeCodeBus, rejectQuestion(), createJsonThreadStore(), getProvider(), SqliteThreadStoreImpl, closeThreadStore(), createThreadStore() (+3 more)

### Community 1 - "Agent Loop + Memory"

Cohesion: 0.08
Nodes (7): executeSubagent(), countMatches(), listTools(), ConsoleLogger, AgentLoop, MemoryService, FileMemoryStorage

### Community 2 - "Skills System"

Cohesion: 0.08
Nodes (11): getSearchPaths(), loadAllSkills(), loadSkill(), parseFrontmatter(), parseSkillFile(), skillExists(), createSkillsManager(), getOrCreateGlobalSkillsManager() (+3 more)

### Community 3 - "Core Infrastructure"

Cohesion: 0.07
Nodes (13): ToolNotFoundError, ValidationError, getPromptPath(), getPromptsDir(), listAvailablePrompts(), loadProviderPrompt(), selectPromptFile(), initProviders() (+5 more)

### Community 4 - "Browser Controller"

Cohesion: 0.11
Nodes (5): ChatGPTAdapter, PlaywrightBrowserController, createDefaultProviders(), getProvider(), registerProvider()

### Community 5 - "Context + Applier"

Cohesion: 0.16
Nodes (9): collectContext(), FileTreeStrategy, applyChanges(), applyFileChange(), createDefaultStrategies(), getStrategy(), registerStrategy(), err() (+1 more)

### Community 6 - "Rollout/Event Sourcing"

Cohesion: 0.23
Nodes (2): generateULID(), RolloutRecorder

### Community 7 - "Provider Implementations"

Cohesion: 0.13
Nodes (10): createAnthropicProvider(), ensureConfigDir(), getApiKey(), readConfig(), writeConfig(), createGeminiProvider(), normalizeChatGPTResponse(), parseArgs() (+2 more)

### Community 8 - "Permission Profiles"

Cohesion: 0.12
Nodes (4): isToolAllowed(), isValidProfile(), PermissionChecker, validateProfile()

### Community 9 - "JSON Thread Store"

Cohesion: 0.17
Nodes (7): ensureDir(), getMetadataPath(), getStoreDir(), getThreadPath(), JsonThreadStoreImpl, readMetadata(), writeMetadata()

### Community 10 - "Memory Tests + Services"

Cohesion: 0.17
Nodes (6): countTokens(), countUserTurns(), renderPromptMemoryContext(), selectForCompaction(), clip(), summarizeMessages()

### Community 11 - "Parser Extractors"

Cohesion: 0.19
Nodes (8): createDefaultExtractors(), getExtractor(), registerExtractor(), JsonExtractor, MarkdownExtractor, parse(), parseWithChain(), parseWithStrategy()

### Community 12 - "Session + Agent Types"

Cohesion: 0.13
Nodes (4): createRecorder(), createHookRuntime(), SessionServiceImpl, createInitialSessionState()

### Community 13 - "Edit Tool"

Cohesion: 0.17
Nodes (2): blockAnchorReplacer(), levenshtein()

### Community 14 - "Skill Injection"

Cohesion: 0.22
Nodes (2): renderSkillMetadata(), renderSkillsList()

### Community 15 - "Provider Prompts"

Cohesion: 0.61
Nodes (9): Anthropic Claude Prompt, ChatGPT Web Variant Prompt, Default Agent Prompt, FreeCode Agent, Gemini Variant Prompt, GPT Variant Prompt, OpenAI/ChatGPT Variant Prompt, Agent Tool Set (+1 more)

### Community 16 - "Skill Tool"

Cohesion: 0.67
Nodes (2): getSkillsManager(), listSkills()

### Community 17 - "Read Tool"

Cohesion: 0.67
Nodes (0):

### Community 18 - "Minimax Provider"

Cohesion: 1.0
Nodes (0):

### Community 19 - "Glob Tool"

Cohesion: 1.0
Nodes (0):

### Community 20 - "Bash Tool"

Cohesion: 1.0
Nodes (0):

### Community 21 - "Question Tool"

Cohesion: 1.0
Nodes (0):

### Community 22 - "Agent Index"

Cohesion: 1.0
Nodes (0):

### Community 23 - "Parser Index"

Cohesion: 1.0
Nodes (0):

### Community 24 - "Provider Types"

Cohesion: 1.0
Nodes (0):

### Community 25 - "Write Tool"

Cohesion: 1.0
Nodes (0):

### Community 26 - "Skills Index"

Cohesion: 1.0
Nodes (0):

### Community 27 - "Skills Types"

Cohesion: 1.0
Nodes (0):

### Community 28 - "Store Index"

Cohesion: 1.0
Nodes (0):

### Community 29 - "Store Types"

Cohesion: 1.0
Nodes (0):

## Knowledge Gaps

- **Thin community `Minimax Provider`** (2 nodes): `minimax.ts`, `createMiniMaxProvider()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Glob Tool`** (2 nodes): `patternsFromGlob()`, `glob.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Bash Tool`** (2 nodes): `truncateOutput()`, `bash.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Question Tool`** (2 nodes): `question.ts`, `formatQuestions()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Agent Index`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Parser Index`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Provider Types`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Write Tool`** (1 nodes): `write.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Skills Index`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Skills Types`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Store Index`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Store Types`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `AgentLoop` connect `Agent Loop + Memory` to `Core Infrastructure`, `Session + Agent Types`, `Rollout/Event Sourcing`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `executeSubagent()` connect `Agent Loop + Memory` to `Core Infrastructure`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `SkillRegistry` connect `Skills System` to `Agent Loop + Memory`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Should `Bus + Thread Store` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Agent Loop + Memory` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Skills System` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Core Infrastructure` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
