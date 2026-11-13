import { describe, expect, it, vi } from 'vitest';
import { FileReadError, readFileBytes } from './readFile';
import { flakyFile } from './testFiles';

describe('readFileBytes', () => {
  it('leest een bestand in', async () => {
    const { file } = flakyFile('a.pdf', 0);
    expect(new TextDecoder().decode(await readFileBytes(file, 0))).toBe('%PDF-1.7 inhoud');
  });

  it('probeert het na een leesfout nog één keer', async () => {
    const { file, arrayBuffer } = flakyFile('a.pdf', 1);
    expect(new TextDecoder().decode(await readFileBytes(file, 0))).toBe('%PDF-1.7 inhoud');
    expect(arrayBuffer).toHaveBeenCalledTimes(2);
  });

  it('lukt het ook de tweede keer niet, dan een eigen fout met de naam van het bestand', async () => {
    const { file, arrayBuffer } = flakyFile('rapport.pdf', 2);
    const error = await readFileBytes(file, 0).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FileReadError);
    expect((error as FileReadError).fileName).toBe('rapport.pdf');
    expect(arrayBuffer).toHaveBeenCalledTimes(2);
  });

  it('wacht even voor de tweede poging', async () => {
    vi.useFakeTimers();
    try {
      const { file, arrayBuffer } = flakyFile('a.pdf', 1);
      const result = readFileBytes(file);
      await vi.advanceTimersByTimeAsync(200);
      expect(arrayBuffer).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100);
      await result;
      expect(arrayBuffer).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
