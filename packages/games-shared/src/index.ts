/**
 * @casino/games-shared — primitives compartidos entre todos los juegos
 * propios de la plataforma.
 *
 * Exporta:
 *   - Provably fair: commit-reveal con hash chain.
 *   - RNG determinístico: alimenta el math desde el roundSeed.
 *   - Monte Carlo runner: valida RTP empírico de un juego.
 *
 * Documentación de cada submódulo en su archivo.
 */

export {
  newServerSeed,
  computeRoundSeed,
  verifyCommit,
  isValidClientSeed,
  newClientSeedDefault,
} from './provably-fair';

export {
  createDeterministicRng,
  type DeterministicRng,
} from './rng';

export {
  runSimulation,
  formatSimulationResult,
  type SimulationResult,
} from './monte-carlo';
