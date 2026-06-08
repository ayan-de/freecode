# FreeCode Implementation TODOs

## Completed

- [x] Rollout/Event Sourcing system
- [x] Two-phase context collection
- [x] Phase 1 Skills infrastructure (manager, loader, registry, injection)
- [x] 10 Hook Types (8 fully wired, 2 stubbed)
- [x] Provider-specific prompts (session/prompt/*.txt files)
- [x] Subagent Lifecycle (agent tool with hooks + Bus events)
- [x] Thread Store (SQLite + JSON persistence)
- [x] Permission Profiles (sandbox levels for tool permissions)

## Pending

### Effect/Layer DI (Complex - Skipped for now)

**Status:** Skipped - requires significant architectural change using Effect framework

**Reference:** opencode's `packages/opencode/src/effect/` directory for `makeRuntime<I, S, E>()` pattern

## Input suggestion
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ push                                         
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

                                                                                                                                
✶ Adding dependency to package.json… (1m 25s · ↓ 1.8k tokens · thought for 4s)
  ⎿  ◼ Task 1: Add dependency and configure package.json 
     ◻ Task 2: Create MCP types and Zod schemas    
     ◻ Task 3: Create MCP config loader              
     ◻ Task 4: Create MCP transport implementation 
     ◻ Task 5: Create MCP service with Effect/Layer                                                                             
     ◻ Task 6: Create CLI entry point with yargs         
     ◻ Task 7: Implement convertMcpTool function                                                                                
     ◻ Task 8: Integrate MCP tools into agent tool system                                
     ◻ Task 9: Add Bus events for MCP                                                                                           
     ◻ Task 10: End-to-end test with contextcarry MCP                                                                           

       ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ctrl+t to hide tasks                  ⧉ In pnpm-lock.yaml


       ● Read 1 file (ctrl+o to expand)                                                                                                
                                                                  
● Bash(Task 1: Add MCP dependency)                                                                                              
  ⎿  Done (4 tool uses · 10.2k tokens · 33s)                                                                                    
  (ctrl+o to expand)                                                                                                            
                                                                                                                                
● Task(Task 2: Create MCP types)                                                                                                
  ⎿                                                                                                                             
     Search(pattern: "apps/core/src/**/*.test.ts")                                                                              
                                                                                                
     +8 more tool uses (ctrl+o to expand)                                      
     ctrl+b to run in background                                               
                                                         ● Bash(Task 1: Add MCP dependency)
  ⎿  Done (4 tool uses · 10.2k tokens · 33s)
  (ctrl+o to expand)

● Task(Task 2: Create MCP types)
  ⎿  Done (22 tool uses · 30.6k tokens · 4m 48s)
  (ctrl+o to expand)                                  
  ⎿  Found 7 new diagnostic issues in 2 files (ctrl+o to expand)
                                                                
● Task(Task 3: Create MCP config loader)                               
  ⎿  Done (6 tool uses · 20.5k tokens · 1m 8s)                                                                                  
  (ctrl+o to expand)                                                                                                      
                                                                                                                          
● Task(Task 4: Create MCP transport)                                              
  ⎿  Done (7 tool uses · 18.6k tokens · 32s)                                                                                    
  (ctrl+o to expand)                                                                                         
                                                                                   
● Task(Task 5: Create MCP service)                                                 
  ⎿  Done (16 tool uses · 25.9k tokens · 2m 45s)                                                                                
  (ctrl+o to expand)                                                                 
                                                                                                                                
  Task(Task 6: Create CLI entry point)                                                                                          
  ⎿                                                                                                                             
     Search(pattern: "export.*getConfigDir|function getConfigDir|const getConfigDir", path: "apps/core/src")                    
                                                                                                                                
     +9 more tool uses (ctrl+o to expand)                                                                                       
     ctrl+b to run in background                                                                                                
                                                                                                                                
· Creating CLI entry point with yargs… (13m 28s · ↓ 17.6k tokens · thought for 16s)                                             
  ⎿  ◼ Task 6: Create CLI entry point with yargs                                                                                
     ◻ Task 7: Implement convertMcpTool function                                                                                
     ◻ Task 8: Integrate MCP tools into agent tool system                                                                       
     ◻ Task 9: Add Bus events for MCP                                                                                           
     ◻ Task 10: End-to-end test with contextcarry MCP                                                                           
     ✔ Task 1: Add dependency and configure package.json                                                                        
     ✔ Task 2: Create MCP types and Zod schemas                                                                                 
     ✔ Task 3: Create MCP config loader                                                                                         
     ✔ Task 4: Create MCP transport implementation                                                                              
     ✔ Task 5: Create MCP service with Effect/Layer                                                                             
     Skill(superpowers:subagent-driven-development)
  ⎿  Successfully loaded skill

● I'm using Subagent-Driven Development to implement this plan.

  Let me first read the plan and extract all tasks, then create the todo list and start dispatching implementer subagents.

● Read 1 file (ctrl+o to expand)

● Bash(Task 1: Add MCP dependency)
  ⎿  Done (4 tool uses · 10.2k tokens · 33s)
  (ctrl+o to expand)

● Task(Task 2: Create MCP types)
  ⎿  Done (22 tool uses · 30.6k tokens · 4m 48s)
  (ctrl+o to expand)                                  
  ⎿  Found 7 new diagnostic issues in 2 files (ctrl+o to expand)
                                                                
● Task(Task 3: Create MCP config loader)                               
  ⎿  Done (6 tool uses · 20.5k tokens · 1m 8s)                                                                                  
  (ctrl+o to expand)                                                                                                      
                                                                                                                          
● Task(Task 4: Create MCP transport)                                              
  ⎿  Done (7 tool uses · 18.6k tokens · 32s)                                                                                    
  (ctrl+o to expand)                                                                                         
                                                                                   
● Task(Task 5: Create MCP service)                                                 
  ⎿  Done (16 tool uses · 25.9k tokens · 2m 45s)                                                                                
  (ctrl+o to expand)                                                                 
                                                                                                                                
● Task(Task 6: Create CLI entry point)                                                                                          
  ⎿  Done (37 tool uses · 47.6k tokens · 5m 44s)                                                                                
  (ctrl+o to expand)                                                                                                            
                                                                                                                                
● Task(Task 7: Implement convertMcpTool)                                                                                        
  ⎿  Done (6 tool uses · 16.7k tokens · 43s)                                                                                    
  (ctrl+o to expand)                                                                                                            
                                                                                                                                
● Task(Task 8: Integrate MCP tools)                                                                                             
  ⎿  Done (9 tool uses · 28.7k tokens · 2m 24s)                                                                                 
  (ctrl+o to expand)                                                                                                            
                                                                                                                                
● Task(Task 9: Add Bus events for MCP)                                                                                          
  ⎿                                                                                                                             
     Waiting… diff apps/core/src/bus/index.ts)                                                                                  
                                                                                                                                
     +8 more tool uses (ctrl+o to expand)                                                                                       
     ctrl+b to run in background                                                                                                
                                                                                                                                
✶ Adding Bus events for MCP… (24m 49s · ↓ 32.8k tokens · thought for 9s)                                                        
  ⎿  ◼ Task 9: Add Bus events for MCP                                                                                           
     ◻ Task 10: End-to-end test with contextcarry MCP                                                                           
     ✔ Task 1: Add dependency and configure package.json                                                                        
     ✔ Task 2: Create MCP types and Zod schemas                                                                                 
     ✔ Task 3: Create MCP config loader                                                                                         
     ✔ Task 4: Create MCP transport implementation                                                                              
     ✔ Task 5: Create MCP service with Effect/Layer                                                                             
     ✔ Task 6: Create CLI entry point with yargs                                                                                
     ✔ Task 7: Implement convertMcpTool function                                                                                
     ✔ Task 8: Integrate MCP tools into agent tool system                                                                       