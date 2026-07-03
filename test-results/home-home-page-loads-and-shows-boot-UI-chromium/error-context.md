# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: home.spec.js >> home page loads and shows boot UI
- Location: tests\home.spec.js:3:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('#title')
Expected pattern: /AI Muralist/i
Received string:  "EXPERIMENT №001GraffitAIAutonomous street art · powered by Claude"
Timeout: 5000ms

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('#title')

```

```yaml
- text: EXPERIMENT №001 GraffitAI Autonomous street art · powered by Claude
```

```
Tearing down "context" exceeded the test timeout of 30000ms.
```