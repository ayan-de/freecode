---
name: test
description: Run tests with coverage
argHint: [pattern]
---
Run the test suite with coverage report.

{{#if args}}
Focus on: {{args}}
{{/if}}

Provide the coverage summary and any failing tests.
