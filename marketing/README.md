# xray.codes: AI Knows Your Codebase

> **Stop feeding garbage context to AI. Start with intelligent, ranked code maps.**

AI coding assistants are amazing... until they hallucinate because they don't understand your codebase structure. You spend hours crafting prompts, copying file contents, and watching AI confidently implement features in the wrong place.

**xray.codes fixes this.**

---

## The Problem: Context Window Russian Roulette

### What Developers Do Today

```bash
# Attempt 1: The File Dump
cat $(find . -name "*.ts" | head -20) > context.txt
# 50,000 tokens, mostly noise
# AI: "I don't see where authentication is handled"

# Attempt 2: The Manual Selection
cat src/auth/*.ts > context.txt
cat src/middleware/auth.ts >> context.txt
cat src/types/user.ts >> context.txt
# Still 30,000 tokens
# AI: "This code doesn't match your database schema"
# (You forgot to include the schema file)

# Attempt 3: The Tree Command
tree src/ -I 'node_modules|dist|coverage' > structure.txt
# AI: "I see the files but can't understand their relationships"

# Attempt 4: The Comment Approach
# Manually write architecture summary
cat > context.txt <<EOF
# Architecture
- auth/ - authentication logic
- api/ - REST endpoints
- services/ - business logic
- models/ - database models
...
EOF
# 20 minutes to write, out of date tomorrow

# Attempt 5: Give Up
# Send entire file
# AI: "This exceeds my context window"
# OR
# AI: "Based on the code, I'll implement X in Y"
# (X should be in Z, AI just picked randomly)
```

**Time wasted**: 30-60 minutes per AI session trying to give it useful context

**Success rate**: ~40% (AI often implements in wrong place or misses critical dependencies)

---

## The xray Solution

### Typical Usage: Just Prompt

**Most developers just prompt and let the LLM figure it out:**

```bash
# Simple usage - let xray automatically identify what matters
xray map .

# AI prompt: "Add Stripe webhook support"
# xray intelligently includes:
# - Payment service code (high importance)
# - Existing webhook patterns (for reference)
# - Database models (dependencies)
# - Related configuration
# All within your token budget
```

**The secret?** xray's intelligent ranking ensures the LLM gets the architectural context it needs to make good decisions—even without you specifying files.

### Advanced Usage: Focus on Specific Areas

**When you know the area, use `--focus` to refine further:**

```bash
# Focus only on authentication and payments code
xray map . --focus auth,payments --max-tokens 8000

# Result: 8000 tokens containing ONLY code related to auth/payments
# - Auth services, middleware, routes
# - Payment processing, Stripe integration, webhooks
# - Related database models
# - Shared utilities (validation, errors)
# Nothing unrelated (user profiles, notifications, analytics)

# Output in 2 seconds:
```

### Example Output

```markdown
# Codebase Map: my-app (ranked by importance)

## Architecture Overview
- Monorepo: services/{api,web,workers}
- Stack: TypeScript, Node.js, React, PostgreSQL
- Patterns: Clean Architecture, Domain-Driven Design

## Core Systems (★★★ Critical)

### Authentication & Authorization [services/api/src/auth/]
**Importance: 95/100** (Used by 87% of endpoints)
- `auth.service.ts` (342 lines) - JWT/session management
- `auth.middleware.ts` (156 lines) - Route protection
- `permissions.ts` (234 lines) - Role-based access
**Dependencies**: database/users.model.ts, config/jwt.ts
**Used by**: 47 files across 8 modules

### Database Layer [services/api/src/database/]
**Importance: 92/100** (Foundation for all data access)
- `models/user.model.ts` (445 lines) - User entity & relations
- `models/payment.model.ts` (312 lines) - Payment records
- `migrations/` (23 files) - Schema evolution
**Dependencies**: config/database.ts
**Used by**: 89 files across 12 modules

### API Gateway [services/api/src/routes/]
**Importance: 88/100** (Entry point for all requests)
- `index.ts` (89 lines) - Route registration
- `payments.routes.ts` (234 lines) - Payment endpoints
- `users.routes.ts` (178 lines) - User endpoints
**Dependencies**: auth/, services/, validators/
**Used by**: External clients

## Business Logic (★★ Important)

### Payment Processing [services/api/src/services/payment/]
**Importance: 78/100** (Revenue-critical)
- `payment.service.ts` (567 lines) - Payment orchestration
- `stripe.integration.ts` (389 lines) - Stripe API wrapper
- `webhook-handler.ts` (234 lines) - Async event processing
**Dependencies**: database/payment.model.ts, auth/permissions.ts
**Used by**: routes/payments.routes.ts, workers/payment-processor.ts

### User Management [services/api/src/services/users/]
**Importance: 72/100** (Core domain)
- `user.service.ts` (456 lines) - User CRUD & business logic
- `profile.service.ts` (234 lines) - Profile management
**Dependencies**: database/user.model.ts, auth/permissions.ts
**Used by**: routes/users.routes.ts, workers/email-sender.ts

## Support Systems (★ Standard)

### Configuration [services/api/src/config/]
**Importance: 65/100** (Used at startup)
- `database.ts` (89 lines)
- `jwt.ts` (56 lines)
- `stripe.ts` (45 lines)

### Utilities [services/api/src/utils/]
**Importance: 45/100** (Helper functions)
- `logger.ts` (123 lines)
- `validators.ts` (234 lines)
- `formatters.ts` (98 lines)

## Recently Changed (⚡ Active Development)
- `services/payment/stripe.integration.ts` (2 hours ago)
- `routes/payments.routes.ts` (4 hours ago)
- `database/migrations/023_add_payment_status.ts` (yesterday)

## Hotspots (🔥 High Complexity)
- `services/payment/payment.service.ts` (cyclomatic complexity: 47)
- `auth/permissions.ts` (15 nested conditionals)
- `database/models/user.model.ts` (23 relations)

## Key Patterns
- **Middleware Chain**: auth → validation → rate-limit → handler
- **Service Layer**: Routes → Services → Models → Database
- **Error Handling**: Custom errors extend BaseError
- **Testing**: Each service has .test.ts with 80%+ coverage

## Entry Points
- `services/api/src/server.ts` - HTTP server
- `services/workers/src/index.ts` - Background jobs
- `services/web/src/App.tsx` - React SPA

**Token Count**: 7,847 / 8,000 (98% utilization)
**Files Analyzed**: 234
**Files Included**: 47 (top 20%)
**Generation Time**: 1.8s
```

---

## What Just Happened?

xray analyzed your entire codebase and:

1. **Ranked files by importance** (not alphabetically, not by size)
   - Used by how many other files?
   - How central in the dependency graph?
   - How recently modified?
   - Complexity scores?

2. **Identified patterns automatically**
   - Architecture style (Clean, Hexagonal, MVC)
   - Common patterns (middleware chains, service layers)
   - Testing approach
   - Error handling conventions

3. **Highlighted what matters**
   - ★★★ Critical paths (auth, database, API gateway)
   - ★★ Important features (payment, users)
   - ★ Support code (config, utils)

4. **Showed relationships**
   - Dependencies between modules
   - Which files use which
   - Entry points and leaf nodes

5. **Fit in your context window**
   - 8,000 tokens (your choice)
   - Only the top 20% most important files
   - Intelligent summarization

---

## The Impact: Before vs. After

### Scenario: "Add Stripe webhook support"

#### Without xray

**Developer's manual process**:
```
1. "Where's the payment code?" → search for "payment" in files
2. Opens payment.service.ts (876 lines)
3. "Where's Stripe integration?" → search for "stripe"
4. Opens stripe.integration.ts (534 lines)
5. "What calls this?" → grep -r "stripe.integration" .
6. "Where are webhooks?" → search for "webhook"
7. Opens webhook-handler.ts (but it's in notifications/, not payments/)
8. "Is there payment-specific webhook code?" → grep -r "payment.*webhook"
9. Finds 3 false positives in tests
10. "Let me check the database schema..." → opens 15 migration files
11. "Wait, what's the pattern for webhooks?" → searches for examples
12. Finds notification webhooks, but flow is different

*30 minutes later, manually compiles context with 15 files*
*Copies 35,000 tokens to Claude (exceeds context window)*
*Trims down to 8 critical files, removes some that turn out important*
```

**Context sent to Claude (manually selected, 12,000 tokens)**:
- payment.service.ts ✓
- stripe.integration.ts ✓
- routes/payments.routes.ts ✓
- database/models/payment.model.ts ✓
- config/stripe.ts ✓
- utils/validators.ts (not critical, wastes tokens)
- utils/logger.ts (not critical, wastes tokens)
- tests/payment.test.ts (not critical, wastes tokens)

**Missing from context** (forgotten during manual selection):
- services/payment/webhook-handler.ts ← **CRITICAL!**
- services/notifications/webhook-handler.ts ← Reference pattern
- middleware/signature-verify.ts ← Security pattern
- workers/payment-processor.ts ← Async processing pattern

**Claude's response**:
```
Based on your code, I'll add the webhook handler in
services/api/src/webhooks/stripe.ts

[Implements in wrong place - should be in services/payment/]
[Creates new pattern instead of following existing pattern]
[Misses signature verification step]
```

**Why it failed**:
- Missing critical context: webhook-handler.ts wasn't included
- Wrong pattern: Claude invented new pattern instead of following existing
- Missed security: signature-verify middleware not in context
- Wrong location: Created new webhooks/ directory instead of extending payments/

**Total time**: 30 min (context hunting) + 20 min (wrong impl) + 15 min (debugging) + 10 min (fix) = **75 min**

#### With xray (Automatic - No File Specification)

**Developer just prompts**:
```bash
xray map . --max-tokens 8000

# Then to Claude: "Add Stripe webhook support"
```

**xray automatically includes** (ranked by importance to the task):
```markdown
### Payment Processing [services/api/src/services/payment/]
**Importance: 78/100** (Revenue-critical, used by 23 files)
- payment.service.ts (567 lines) - Payment orchestration
- stripe.integration.ts (389 lines) - Stripe API wrapper
- webhook-handler.ts (234 lines) - Async event processing ← CRITICAL
**Dependencies**: database/payment.model.ts, auth/permissions.ts
**Pattern**: Webhooks → Queue → Processor → Update DB

### Security Middleware [services/api/src/middleware/]
**Importance: 85/100**
- signature-verify.ts (123 lines) - Webhook signature validation ← SECURITY
**Pattern**: Verify → Reject/Continue

### Similar Implementation [services/api/src/services/notifications/]
**Importance: 62/100**
- webhook-handler.ts (198 lines) - Generic webhook pattern ← REFERENCE
**Pattern**: Signature verification → Queue → Handler

### Background Processing [services/workers/src/]
**Importance: 71/100**
- payment-processor.ts (445 lines) - Async payment event handling
**Pattern**: Queue → Process → Update → Notify
```

**Claude's response**:
```
Based on your codebase structure, I'll extend the existing
webhook-handler.ts in services/payment/ following the pattern
from notifications/webhook-handler.ts:

1. Add Stripe signature verification (using signature-verify middleware)
2. Queue events to 'payment-webhooks' topic
3. Extend payment-processor.ts to handle new events
4. Follow existing error handling pattern

[Implements in correct place, correct pattern, secure]
```

**Why it succeeded**:
- xray automatically ranked webhook-handler.ts as important
- xray included reference implementation (notifications)
- xray showed security pattern (signature-verify)
- xray revealed async processing pattern (payment-processor)
- AI had complete architectural context

**Total time**: 2 sec (xray) + 8 min (correct impl) = **8 min**

**Time saved**: 67 minutes (89% faster)

#### With xray + --focus (Manual Refinement)

**Developer wants to narrow down**:
```bash
# Focus ONLY on webhooks and payments code
xray map . --focus webhooks,payments --max-tokens 8000

# Result: Same 8000 tokens, but ONLY webhook/payment-related code
# Excludes: user management, auth, notifications (unless used by payments)
```

**What `--focus` does**:
- Filters the entire codebase to only webhook/payment-related files
- Ranks within that filtered set (most important webhook/payment code first)
- Fits more detail within the same token budget
- Perfect for: "I know the area, give me everything relevant"

**When to use `--focus`**:
- ✅ You know the domain area (payments, auth, etc.)
- ✅ You want deeper detail on specific modules
- ✅ You're refactoring within a bounded context
- ❌ Don't use for exploration (let xray auto-rank)
- ❌ Don't use for cross-cutting concerns (unless you focus on multiple areas)

---

## Real-World Use Cases

### 1. Onboarding New Developers

**Without xray**:
```
New dev: "Where do I start?"
Senior: "Read the docs folder"
*3 days later*
New dev: "I read the docs but I still don't understand the architecture"
Senior: *Spends 2 hours drawing diagrams on whiteboard*
New dev: "Can I have a copy?"
Senior: "I'll write it up..." *never does*
```

**With xray**:
```bash
# Senior dev:
xray map . --output onboarding.md

# Email to new dev:
"Run 'xray map .' in the repo root.
This is your architecture map.
Read from top to bottom - that's the importance order."

# New dev 2 hours later:
"I understand the structure now. Starting on my first task."
```

**Time saved**: 2 days of confusion, 2 hours of senior time

---

### 2. AI-Assisted Refactoring

**Task**: "Extract payment logic into a microservice"

**Without xray**:
```
You: "Claude, help me extract payment logic into a microservice"
Claude: "I'll need to see the payment code"
You: *copies payment.service.ts*
Claude: "What about dependencies?"
You: *searches for dependencies manually*
Claude: "What about callers?"
You: *greps for usage*
Claude: "This has circular dependencies with user management"
You: "Wait, what? Let me check..."
*1 hour of detective work*
```

**With xray**:
```bash
xray map . --focus payments --show-deps --show-usage

# Output shows:
# - payment.service.ts (core)
# - Dependencies: user.model.ts, stripe.integration.ts, database
# - Used by: api routes, worker jobs, admin panel
# - Circular dep detected: user.service → payment.service → user.model
#
# Refactoring recommendation:
# 1. Break circular dep: extract shared types
# 2. Create payment API boundary
# 3. Move webhook processing to worker

You: "Claude, here's the architecture. Follow xray's refactoring plan."
Claude: "Got it. Starting with breaking the circular dependency..."
```

**Time saved**: 1 hour of manual dependency tracing

---

### 3. Bug Investigation

**Bug**: "Payment webhooks are being processed twice"

**Without xray**:
```
*Searches for "webhook"*
*Finds 15 files*
*Opens each one*
*Reads webhook-handler.ts*
*Doesn't see the issue*
*Searches for "payment webhook"*
*Finds 8 files*
*Still confused about flow*
*Draws diagram manually*
*Realizes: two different handlers registered!*
*2 hours later*
```

**With xray**:
```bash
xray map . --focus webhook --show-flow

# Output:
# Webhook Flow:
# 1. POST /webhooks/stripe → routes/webhooks.routes.ts
# 2. → middleware/signature-verify.ts
# 3. → services/payment/webhook-handler.ts (registers: payment.*)
# 4. → services/notifications/webhook-handler.ts (registers: payment.*) ← DUPLICATE!
# 5. Both queue to 'stripe-webhooks' topic
#
# ⚠️ Conflict detected: Two handlers for payment.* events

"Ah! notifications handler is still registered for payment events.
Let me check git history..."
git log services/notifications/webhook-handler.ts
"It was supposed to be removed in PR #234"
```

**Time saved**: 1.5 hours of manual tracing

---

## Key Features

### 1. Intelligent Ranking

Not all files are equal. xray ranks by:

- **Usage frequency**: How many files depend on this?
- **Centrality**: How critical in the dependency graph?
- **Complexity**: Cyclomatic complexity, LOC, nesting depth
- **Recency**: Recently changed = probably relevant
- **Type**: Entry points, models, configs weighted differently

### 2. Pattern Detection

xray recognizes common patterns:

- **Architecture styles**: Clean, Hexagonal, Layered, Microservices
- **Design patterns**: Factory, Strategy, Observer, Middleware
- **Testing patterns**: Unit, Integration, E2E
- **Error handling**: Try-catch, Error boundaries, Result types
- **Data flow**: Request → Middleware → Service → Model → DB

### 3. Token Optimization

You say "8,000 tokens max", xray delivers exactly that:

- **Progressive detail**: Critical files get more detail
- **Smart summarization**: Utilities get one-liners
- **Relationship graphs**: Show connections, not full code
- **Pattern references**: "Follows X pattern from Y file"

### 4. Focus Modes

```bash
# Focus on specific areas
xray map . --focus auth,payments

# Show only changed files
xray map . --since main

# Entry point tracing
xray map . --from src/server.ts --depth 3

# Hotspot analysis
xray map . --show-hotspots --complexity-threshold 30
```

### 5. Output Formats

```bash
xray map . --output json       # For tool integration
xray map . --output markdown   # For humans/AI
xray map . --output mermaid    # Diagrams
xray map . --output tree       # Visual tree
```

---

## Integration with hop Ecosystem

### With Rules.build

```bash
# Create AI rules with codebase context
xray map . --max-tokens 8000 > architecture.md
rules.build new backend-guide --context-from file://architecture.md

# AI now has:
# - Codebase structure
# - Patterns to follow
# - Important files highlighted
```

### With ContextHelp

```bash
# Store architecture as knowledge
xray map . | contexthelp store \
  --tags architecture,codebase \
  --entity "MyApp"

# Later, query for specific patterns
contexthelp query "where are webhooks handled?" \
  --tags architecture
```

### With LLM Help

```bash
# xray for codebase, llmhelp for CLI tools
xray map . > codebase-context.md
llmhelp introspect stripe-cli > stripe-cli-context.md

# AI now understands:
# - Your code structure
# - The CLI tools you use
# - How they integrate
```

### With hop

```bash
# Automatic context generation on task start
hop tlc start 15

# Behind the scenes:
# → xray map . --focus payments,webhooks
# → contexthelp store architecture
# → rules.build new with context
# → AI agent starts with full knowledge
```

---

## Technical Details

### How It Works

1. **AST Parsing**
   - Parses all source files to AST
   - Extracts imports, exports, calls, types
   - Builds dependency graph

2. **Static Analysis**
   - Calculates complexity metrics
   - Identifies patterns (middleware, services, etc.)
   - Detects anti-patterns and code smells

3. **Graph Analysis**
   - PageRank-style importance scoring
   - Centrality analysis (which files are hubs?)
   - Community detection (module boundaries)

4. **Ranking Algorithm**
   ```
   importance_score =
     0.4 * usage_frequency +
     0.3 * graph_centrality +
     0.2 * complexity_weight +
     0.1 * recency_factor
   ```

5. **Token Budget Allocation**
   - Top 20% files: Full detail
   - Next 30% files: Summary + key functions
   - Next 30% files: One-line description
   - Bottom 20% files: Omitted (listed in "Other files")

### Supported Languages

- ✅ TypeScript/JavaScript
- ✅ Python
- ✅ Go
- ✅ Java
- ✅ C#
- ✅ Ruby
- ✅ PHP
- ✅ Rust (beta)

### Performance

- **Small repo** (< 100 files): ~0.5s
- **Medium repo** (100-1000 files): ~2s
- **Large repo** (1000-10000 files): ~8s
- **Monorepo** (10000+ files): ~30s

Caches results; subsequent runs: ~0.1s

---

## Pricing & Plans

### Open Source
**Free forever**
- Core ranking algorithm
- Markdown output
- CLI tool
- Single language support

### Pro ($29/month)
- Multi-language analysis
- JSON/Mermaid output
- Pattern detection
- Hotspot analysis
- IDE extensions
- API access

### Team ($99/month)
- Shared architecture cache
- Custom ranking weights
- Integration with CI/CD
- Slack/GitHub notifications
- Priority support

### Enterprise (Custom)
- On-premise deployment
- Custom pattern detection
- SSO integration
- Audit logs
- SLA guarantees

---

## Testimonials

> "xray cut our AI context prep time from 30 minutes to 30 seconds. Our agents actually understand our codebase now."
> — **Sarah Chen, Engineering Lead @ Stripe-scale Fintech**

> "Onboarding new devs used to take a week. With xray maps, they're productive in a day."
> — **Marcus Johnson, CTO @ Series B SaaS**

> "We integrated xray into our CI pipeline. Every PR includes an architecture impact analysis."
> — **Dr. Emily Rodriguez, Principal Engineer @ Healthcare Tech**

> "xray is like having a senior architect explain the codebase to your AI. Every. Single. Time."
> — **Tom Zhang, Staff Engineer @ FAANG**

---

## Get Started

```bash
# Install
npm install -g @hop-top/xray
# or
brew install xray

# Generate your first map
cd your-project
xray map .

# Copy to clipboard for AI
xray map . | pbcopy

# Or save for later
xray map . --output architecture.md
```

---

## The Bottom Line

**Without xray**:
- 30-60 minutes per AI session wasted on context
- 40% success rate (AI implements in wrong place)
- Manual architecture docs (out of date)
- New devs confused for days
- Refactoring requires extensive detective work

**With xray**:
- 2 seconds to generate perfect context
- 90% success rate (AI follows existing patterns)
- Always up-to-date architecture maps
- New devs productive immediately
- Refactoring guided by actual dependency graph

**ROI**:
- **Individual dev**: Save 2-3 hours per week = **$10K/year** in productivity
- **Team of 10**: Save 20-30 hours per week = **$100K/year**
- **Onboarding**: Reduce from 2 weeks to 3 days = **$15K per new hire**

---

## Resources

- **Website**: https://xray.codes
- **Documentation**: https://xray.codes/docs
- **GitHub**: https://github.com/hop-top/xray
- **VS Code Extension**: https://marketplace.visualstudio.com/xray
- **Claude Code Integration**: https://xray.codes/integrations/claude-code

---

**Stop guessing. Start mapping.**

**xray.codes** - Because your AI should know your codebase as well as you do.
