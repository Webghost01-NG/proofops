// Explicit maintenance command; never run by the application or normal npm install/build.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { keccak256, toUtf8Bytes } from 'ethers';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length !== 3) throw new Error('Usage: node scripts/build-bridge-reference.mjs <pinned-upstream-checkout>');
const upstream = resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(resolve(project, 'docs/adapters/bridge-v1-upstream.json')));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim(), manifest.revision);
assert.equal(execFileSync('git', ['diff', 'HEAD', '--name-only'], { cwd: upstream, encoding: 'utf8' }).trim(), '', 'upstream tracked source must be unchanged');
for (const entry of manifest.files) assert.equal(digest(resolve(upstream, entry.path)), entry.sha256, entry.path);
for (const entry of manifest.package.files) assert.equal(digest(resolve(upstream, 'node_modules/@gluwa/asc-contracts', entry.path)), entry.sha256, entry.path);
assert.equal(JSON.parse(readFileSync(resolve(upstream, 'node_modules/@openzeppelin/contracts/package.json'))).version, '5.4.0');

execFileSync('forge', ['build', '--root', 'bridge', '--force'], { cwd: upstream, stdio: 'inherit' });
execFileSync('forge', ['build', 'shared/contracts/sol/TestERC20.sol'], { cwd: upstream, stdio: 'inherit' });
const runtimes = {};
const deployments = { notice: 'Compiled pinned upstream creation bytecode for disposable local EVM tests only. Never used to deploy from ProofOps.', revision: manifest.revision, contracts: {} };
for (const [role, relative, name] of [['source', 'out', 'TestERC20'], ['minter', 'bridge/out', 'ASCMinter'], ['wrapped', 'bridge/out', 'BridgeTestToken']]) {
  const path = resolve(upstream, relative, `${name}.sol`, `${name}.json`);
  const artifact = JSON.parse(readFileSync(path));
  const metadata = typeof artifact.metadata === 'string' ? JSON.parse(artifact.metadata) : artifact.metadata;
  assert.equal(metadata.compiler.version, '0.8.30+commit.73712a01');
  assert.equal(metadata.settings.evmVersion, 'shanghai');
  assert.deepEqual(metadata.settings.optimizer, { enabled: true, runs: 200 });
  assert.equal(metadata.settings.viaIR, true);
  const compilationRoot = role === 'source' ? upstream : resolve(upstream, 'bridge');
  // Foundry normalizes CRLF in package sources before passing them to solc.
  for (const [source, entry] of Object.entries(metadata.sources)) assert.equal(keccak256(toUtf8Bytes(readFileSync(resolve(compilationRoot, source), 'utf8').replaceAll('\r\n', '\n'))), entry.keccak256, source);
  assert.equal(Object.keys(artifact.deployedBytecode.linkReferences).length, 0, 'decoder must be inlined');
  const refs = Object.values(artifact.deployedBytecode.immutableReferences ?? {}).flat();
  assert.equal(refs.length, role === 'minter' ? 3 : 0);
  for (const ref of refs) assert.equal(ref.length, 32);
  runtimes[role] = { bytecode: artifact.deployedBytecode.object, verifierOffsets: refs.map(ref => ref.start), artifactSha256: digest(path) };
  deployments.contracts[role] = { abi: artifact.abi, bytecode: artifact.bytecode.object };
}
writeFileSync(resolve(project, 'src/bridge/runtimes.ts'), '// Generated from pinned upstream Solidity sources; see docs/adapters/bridge-v1-build.md and UPSTREAM-LICENSES.md.\nexport const runtimes: Record<\'source\' | \'minter\' | \'wrapped\', { bytecode: string; verifierOffsets: number[]; artifactSha256: string }> = ' + JSON.stringify(runtimes, null, 2) + ';\n');
writeFileSync(resolve(project, 'test/fixtures/bridge-deployments.json'), JSON.stringify(deployments, null, 2) + '\n');
console.log('Rebuilt three pinned runtime references and isolated deployment fixtures.');
