import { Interface, id } from 'ethers';

// Pinned signatures: docs/adapters/bridge-v1-upstream.json. ABI data, not executable plugins.
export const PROFILE_REVISION = '6668487ad07fdf8119f54aab9db99b6c50155b5c';
export const VERIFIER = '0x0000000000000000000000000000000000000FD2';
export const BURN_TOPIC = id('TokensBurnedForBridging(address,uint256)');
export const ASC_MINTER = id('ASC_MINTER');
export const minterAbi = [
  'function execute(uint8 action,uint64 chainKey,uint64 blockHeight,bytes encodedTransaction,bytes32 merkleRoot,(bytes32 hash,bool isLeft)[] siblings,bytes32 lowerEndpointDigest,bytes32[] continuityRoots) returns (bool)',
  'function wrappedTokens(address) view returns (address)',
  'function processedQueries(bytes32) view returns (bool)',
  'function VERIFIER() view returns (address)',
  'event TokensMinted(address indexed wrappedTokenAddress,address indexed burntFrom,uint256 amount,bytes32 indexed queryId)',
  'error InvalidAction(uint8 action)'
] as const;
export const minterInterface = new Interface(minterAbi);
export const tokenInterface = new Interface([
  'function owner() view returns (address)',
  'function hasRole(bytes32,address) view returns (bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'error AccessControlUnauthorizedAccount(address account,bytes32 neededRole)'
]);
export const verifierInterface = new Interface([
  'function calculateTxIndex((bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof) view returns (uint64)'
]);
