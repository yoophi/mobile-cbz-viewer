import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { fixtureBytes, fixturePaths, imageBytes } from './zip-fixture';

type Check = { name: string; passed: boolean; detail?: string };
export type ZipProbeResult = { platform: string; checks: Check[]; passed: boolean };

// Native libraries require decoded filesystem paths, rather than percent-encoded file URIs.
function nativePath(uri: string) {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code) : 'UNKNOWN';
}

let runningProbe: Promise<ZipProbeResult> | undefined;

export function runZipProbe(): Promise<ZipProbeResult> {
  // A remount/deep link must not delete the working directory of an active probe.
  runningProbe ??= executeZipProbe().finally(() => { runningProbe = undefined; });
  return runningProbe;
}

async function executeZipProbe(): Promise<ZipProbeResult> {
  if (!__DEV__ || Platform.OS === 'web') throw new Error('Native development build required');
  const { listContents, unzip, ErrorCodes } = await import('react-native-zip-archive');
  const root = new Directory(Paths.cache, 'zip-probe');
  if (root.exists) root.delete();
  root.create();
  const checks: Check[] = [];
  try {
    const archive = new File(root, '한글 샘플.cbz');
    archive.write(fixtureBytes);
    const entries = await listContents(nativePath(archive.uri));
    checks.push({ name: 'Pre-extraction inventory: Unicode, nested paths and sizes',
      passed: entries.length === 4 && fixturePaths.every((path) => entries.some((entry) =>
        entry.path === path && entry.size === imageBytes.length && !entry.isEncrypted && !entry.isDirectory)) });

    const output = new Directory(root, 'selected');
    output.create();
    await unzip(nativePath(archive.uri), nativePath(output.uri), { entries: fixturePaths });
    let identical = true;
    for (const path of fixturePaths) {
      const bytes = await new File(output, path).bytes();
      identical &&= bytes.length === imageBytes.length && bytes.every((value, index) => value === imageBytes[index]);
    }
    checks.push({ name: 'Selective disk extraction preserves PNG bytes and Unicode paths',
      passed: identical && !new File(output, 'notes.txt').exists });

    const corrupt = new File(root, 'corrupt.cbz');
    corrupt.write(fixtureBytes.slice(0, 40));
    try {
      await listContents(nativePath(corrupt.uri));
      checks.push({ name: 'Corrupt archive rejected before extraction', passed: false });
    } catch (error) {
      const code = errorCode(error);
      // iOS minizip reports FILE_NOT_FOUND when it cannot open an invalid archive;
      // Android zip4j may report CORRUPT_ARCHIVE or UNZIP. Verify rejection, not parity.
      checks.push({ name: 'Corrupt archive rejected before extraction',
        passed: [ErrorCodes.CORRUPT_ARCHIVE, ErrorCodes.FILE_NOT_FOUND, ErrorCodes.UNZIP].some((expected) => code === expected), detail: code });
    }

    const controller = new AbortController();
    controller.abort();
    const cancelled = new Directory(root, 'cancelled');
    try {
      await unzip(nativePath(archive.uri), nativePath(cancelled.uri), { signal: controller.signal });
      checks.push({ name: 'Pre-aborted extraction writes nothing', passed: false });
    } catch (error) {
      const code = errorCode(error);
      checks.push({ name: 'Pre-aborted extraction writes nothing',
        passed: code === ErrorCodes.CANCELLED && !cancelled.exists, detail: code });
    }
  } catch (error) {
    checks.push({ name: 'Native ZIP module execution', passed: false, detail: errorCode(error) });
  } finally {
    if (root.exists) root.delete();
  }
  const result = { platform: Platform.OS, checks, passed: checks.length === 4 && checks.every((check) => check.passed) };
  new File(Paths.document, 'zip-probe-result.json').write(JSON.stringify(result, null, 2));
  console.info('ZIP_PROBE_RESULT', JSON.stringify(result));
  return result;
}
