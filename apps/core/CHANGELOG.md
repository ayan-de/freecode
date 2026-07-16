# @thisisayande/freecode-core

## 0.3.1

### Bug Fixes

- Strip Windows-illegal characters from formatted session directory names; the drive-letter colon (`C:\…`) previously caused `ENOENT` when creating the sessions directory on Windows

## 0.2.0

### Features

- Add permission bypass logic for `danger` agent mode
- Agent loop skips permission hooks when mode is `danger`
