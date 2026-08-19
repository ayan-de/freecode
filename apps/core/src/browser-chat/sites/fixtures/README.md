# Site stream fixtures

Real captured stream bodies from live chat sites. `fixtures.test.ts` picks up every `.txt`
file here automatically — adding a fixture requires no test changes.

## Naming

```
<site>-<description>.txt
```

The prefix before the first `-` selects the adapter, so `claude-hello.txt` is decoded with
`sites/claude.ts`.

## Capturing one

```bash
cd apps/core
pnpm exec tsx src/cli.ts browser capture --site claude --name hello
```

Then send a message in the browser tab. The raw response body is written here verbatim.

## Why these exist

The site adapters were written from guesses and validated by a single live run. "It worked
once" is not "it is correct": without a fixture, a change to the site's frame shape fails
silently for a user instead of loudly in CI. Fixture replay cannot catch a *transport*
change (see the spec's inline shape check for that), but it does catch a payload change,
which is the more common of the two.

Scrub anything identifying before committing a fixture — these are real responses from a
real account.
