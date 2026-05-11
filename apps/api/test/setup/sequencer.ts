/**
 * Custom Jest sequencer: ordena las suites alfabéticamente por path.
 *
 * Por default Jest ordena heurísticamente (por tamaño/historial). Con
 * orden alfabético explícito, las corridas son deterministas — un test
 * que falla por contaminación cross-suite va a fallar siempre igual,
 * no aleatoriamente. Facilita debugging.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Sequencer = require('@jest/test-sequencer').default;

interface JestTest {
  path: string;
}

class AlphabeticalSequencer extends Sequencer {
  sort(tests: JestTest[]): JestTest[] {
    return [...tests].sort((a, b) => (a.path < b.path ? -1 : 1));
  }
}

module.exports = AlphabeticalSequencer;
